// A person's garden on the server: planting a seed, reading the plant caught up to the last completed hour, recording
// care, and sending a friend a sprinkle. Server-only; route handlers call these and turn ApiErrors into responses.
//
// Time: the model counts game hours from 10 Nov 2026 00:00 IST. A visit steps the plant's checkpoint through every
// completed hour (catchup.ts), so the state describes the top of the current hour; actions taken during the hour are
// recorded now and take effect when the hour completes (they come back as `pending` until then).
//
// Concurrency: recording an event locks the plant's checkpoint row, files the event at max(now hour, checkpoint hour)
// and bumps the checkpoint version, so no catch-up computed without the event can be saved and no event is ever filed
// behind a checkpoint that has already passed its hour. Retries are idempotent through (plant, client_event_id). Every
// locking transaction runs through db.ts transaction(), which bounds its waits.
//
// Planting: anyone may plant (since 21 Oct, party link or not). Plots are handed out under one advisory lock, inner
// rings first, growing past the planned rings when needed (plots.ts); a lotus takes the next of the river's 56 pockets
// instead (plot numbers from 2000), and a bed plot once they are all taken. A global throttle (PLANTINGS_PER_MINUTE)
// slows a runaway script, and the UI retries its 429, or a 503, by itself with the same clientEventId. A seed planted
// without the party code (party.ts) also waits while the Meadow has taken in many seeds over the past hour or day
// (rules.ts openPlantingWait): a 429 meadow_resting the person reads, so strangers can never crowd the Meadow or the
// party's big screen. A retried planting is answered with the original only for the same name and species, within half
// an hour, and from no session or its own (rules.ts decideSeedReplay).
//
// Names are unique in the Meadow, ignoring case, so a friend finds the right flower: a planting checks under the same
// lock that hands out plots, so two people can never take one name at once, and the people_first_name_key index on
// lower(first_name) (migration 0007) holds the line for every other writer. A taken name is a 409 name_taken with
// field firstName, and the name step asks first (checkNameFree, POST /api/name).
//
// Planting opened on 20 Oct and has no closing date (since 21 Oct), and every planting through production is real,
// before the party too. Plantings through a dev server or a Preview (env.ts) are marked plants.rehearsal: they take plots
// from the outer end of the planned rings, the production Meadow never shows them, scripts/clear-rehearsals.mjs removes
// them, and such a server may tend only them.
//
// Writes outside a locking transaction (checkpoint saves) still go through db.ts transaction(), so every write waits
// a bounded time for a lock whichever role the app connects as.
//
// The lotus: a plant's model is chosen by its species (lib/sim/plant.ts), and every sim_version written or compared here
// is that model's (modelVersionOf: 7 for the six soil flowers, 1001 for the lotus), so a lotus checkpoint is never stepped
// by the soil model or the other way round.
import "server-only";
import { randomBytes } from "node:crypto";
import type postgres from "postgres";
import type { SpeciesId } from "@/lib/plant/species";
import {
  BED,
  CLIM_T,
  POND,
  bloomedAt,
  diedAt,
  expectBloom,
  flowerOpenedAt,
  hourIndexOf,
  isPondState,
  modelVersionOf,
  modelVersionOfState,
  ripeAt,
  toVisual,
  type PlantState,
  type TimedEvent,
  type Visual,
} from "@/lib/sim";
import { advanceCheckpoint, seedState, type AdvanceDeps, type CheckpointRecord } from "./catchup";
import { db, transaction, type Queryable } from "./db";
import { googleSignIn, isProduction, partyCodes, plantingOpenToAll, showRehearsals, writesDerivedState } from "./env";
import { ApiError } from "./http";
import { createGardenLink, createSession } from "./identity";
import { accountPerson, keepPlanting, loginStartSubject } from "./login";
import { plantingNeeds } from "./login-rules";
import { plantingPass } from "./party";
import { KNOWN_SPECIES } from "./species-guard";
import { PLOT_CAPACITY, assignPlot, isBedIndex } from "./plots";
import {
  careStatus,
  decideCare,
  decideSeedReplay,
  healthBand,
  hourIso,
  istClock,
  istDayOfHour,
  openPlantingWait,
  sprinkleMessage,
  stageOf,
  toRecordedEvent,
  toTimedEvent,
  type EventRow,
  type HealthBand,
  type PriorPlanting,
  type RecordedEvent,
  type Stage,
} from "./rules";
import { hashToken } from "./tokens";
import { nameTakenMessage, type CareInput, type CareKind, type NameCheckInput, type SeedInput, type SprinkleInput } from "./validate";
import { ensureWeather, loadWeather } from "./weather-store";

// any constant works; it only has to be the same for every instance
const PLOT_LOCK_KEY = 0x706c6f74; // "plot"
/**
 * Plantings per minute across the whole Meadow before new ones are asked to wait a few seconds: the whole office could
 * plant within one minute of the QR code going up and still pass. Seeds from outside the party also have their own,
 * lower limits (rules.ts openPlantingWait); this one brakes a runaway script whoever runs it.
 */
export const PLANTINGS_PER_MINUTE = 300;

/** Seconds a throttled planting waits: 4-10, spread so that a crowd told to wait does not come back in step. */
function plantingRetryAfterS(): number {
  return 4 + Math.floor(Math.random() * 7);
}

/** The calm answer for a seed from outside the party that has to wait (rules.ts openPlantingWait), read by the person. */
function restingError(wait: "hour" | "day", recent: { hour: number; day: number }): ApiError {
  console.warn(`[meadow api] a seed without the party link waits: ${recent.hour} seeds in the past hour, ${recent.day} in the past day`);
  return wait === "day"
    ? new ApiError(429, "meadow_resting", "The Meadow has taken in many new seeds today and is resting. Please come back tomorrow to plant yours.", { retryAfterS: 6 * 3600 })
    : new ApiError(429, "meadow_resting", "Many seeds have gone into the Meadow this past hour. Please come back in a little while to plant yours.", { retryAfterS: 20 * 60 });
}

function practiceOnly(): ApiError {
  return new ApiError(409, "practice_only", "This is a practice copy of the garden; real gardens are tended on the live site only.");
}

// ---- loading ----------------------------------------------------------------------------------------------------------

export interface PlantRef {
  personId: string;
  firstName: string;
  showName: boolean;
  plantId: string;
  species: SpeciesId;
  seed: string;
  plot: number;
  plantedH: number;
  rehearsal: boolean;
}

interface PlantRefRow {
  person_id: string;
  first_name: string;
  show_name: boolean;
  plant_id: string;
  species: SpeciesId;
  seed: string;
  plot_index: number;
  planted_h: number;
  rehearsal: boolean;
}

function toPlantRef(r: PlantRefRow): PlantRef {
  return {
    personId: r.person_id, firstName: r.first_name, showName: r.show_name, plantId: r.plant_id,
    species: r.species, seed: r.seed, plot: r.plot_index, plantedH: r.planted_h, rehearsal: r.rehearsal,
  };
}

/** A person's plant (garden slot 0), or null when they have none. */
export async function findPlantOfPerson(personId: string, q: Queryable = db()): Promise<PlantRef | null> {
  const rows = await q<PlantRefRow[]>`
    select pe.id as person_id, pe.first_name, pe.show_name, p.id as plant_id, p.species, p.seed, p.plot_index, p.planted_h,
           p.rehearsal
    from meadow.people pe
    join meadow.gardens g on g.person_id = pe.id
    join meadow.plants p on p.garden_id = g.id and p.garden_slot = 0
    where pe.id = ${personId}`;
  return rows[0] ? toPlantRef(rows[0]) : null;
}

async function requirePlant(personId: string): Promise<PlantRef> {
  const plant = await findPlantOfPerson(personId);
  if (!plant) throw new ApiError(404, "no_plant", "There is no seed in your garden yet. Plant one to begin.");
  return plant;
}

interface CheckpointRow {
  h: number;
  state: PlantState;
  sim_version: number;
  version: number;
}

const toCheckpoint = (r: CheckpointRow): CheckpointRecord => ({ h: r.h, state: r.state, simVersion: r.sim_version, version: r.version });

async function loadRecorded(q: Queryable, plantId: string, fromH: number, toH: number | null): Promise<RecordedEvent[]> {
  const rows = await q<EventRow[]>`
    select id, h, kind, amount, actor_id, client_event_id from meadow.plant_events
    where plant_id = ${plantId} and h >= ${fromH} and h < ${toH ?? 2147483647}
    order by h, id`;
  return rows.map(toRecordedEvent);
}

async function findEvent(q: Queryable, plantId: string, clientEventId: string): Promise<EventRow | null> {
  const rows = await q<EventRow[]>`
    select id, h, kind, amount, actor_id, client_event_id from meadow.plant_events
    where plant_id = ${plantId} and client_event_id = ${clientEventId}`;
  return rows[0] ?? null;
}

function timed(events: readonly RecordedEvent[]): TimedEvent[] {
  const out: TimedEvent[] = [];
  for (const e of events) {
    const t = toTimedEvent(e);
    if (t) out.push(t);
  }
  return out;
}

/**
 * A PlantState as a JSON parameter. Pass it through sql.json(), never as a JSON.stringify()'d string with ::jsonb: the
 * server types such a parameter as jsonb and postgres.js would encode the string again, storing a JSON string scalar.
 */
export function asJson(state: PlantState): postgres.JSONValue {
  return state as unknown as postgres.JSONValue;
}

/** Saves a caught-up state if the checkpoint still has expectedVersion, mirroring the generation onto the plant. */
async function saveCheckpoint(q: Queryable, plantId: string, expectedVersion: number, state: PlantState): Promise<boolean> {
  const rows = await q<{ n: number }[]>`
    with c as (
      update meadow.checkpoints
      set h = ${state.h}, state = ${q.json(asJson(state))}, sim_version = ${modelVersionOfState(state)}, version = version + 1, updated_at = now()
      where plant_id = ${plantId} and version = ${expectedVersion}
      returning plant_id
    ), g as (
      update meadow.plants set generation = ${state.gen}
      where id in (select plant_id from c) and generation <> ${state.gen}
    )
    select count(*)::int as n from c`;
  return rows[0]?.n === 1;
}

function advanceDeps(plant: PlantRef): AdvanceDeps {
  const planting = { speciesId: plant.species, plantedH: plant.plantedH, owner: plant.personId };
  const persist = writesDerivedState();
  return {
    planting,
    async loadCheckpoint() {
      const rows = await db()<CheckpointRow[]>`
        select h, state, sim_version, version from meadow.checkpoints where plant_id = ${plant.plantId}`;
      if (rows[0]) return toCheckpoint(rows[0]);
      // a plant without a checkpoint (never expected) starts from its planting
      const seed = seedState(planting);
      if (persist) {
        await transaction((tx) => tx`
          insert into meadow.checkpoints (plant_id, h, state, sim_version)
          values (${plant.plantId}, ${seed.h}, ${tx.json(asJson(seed))}, ${modelVersionOf(plant.species)})
          on conflict (plant_id) do nothing`);
      }
      return { h: seed.h, state: seed, simVersion: modelVersionOf(plant.species), version: 0 };
    },
    loadEvents: async (fromH, toH) => timed(await loadRecorded(db(), plant.plantId, fromH, toH)),
    ensureWeather: async (fromH, toH) => {
      await ensureWeather(fromH, toH);
    },
    loadWeather,
    // outside production the catch-up is computed for the response and never saved (env.ts)
    saveCheckpoint: persist ? (expected, state) => transaction((tx) => saveCheckpoint(tx, plant.plantId, expected, state)) : undefined,
  };
}

// ---- the view the UI reads (GET /api/me, and every care response) ----------------------------------------------------

export interface MeView {
  person: { firstName: string; showName: boolean };
  plant: {
    plot: number;
    species: SpeciesId;
    seed: string;
    generation: number;
    plantedH: number;
    plantedAt: string;
    /** a practice plant, planted through a dev server or a Preview; the live Meadow never shows it */
    rehearsal: boolean;
  };
  now: { h: number; at: string; clock: number };
  state: {
    /** the moment the state describes: the start of hour h (the top of the current hour when up to date) */
    h: number;
    at: string;
    alive: boolean;
    stage: Stage;
    health: HealthBand;
    /** 0 at the seed, 0.64 when buds form, 1 at a mature bud */
    development: number;
    ripeH: number | null;
    bloomH: number | null;
    bloomedAt: string | null;
    /** when the flower now shown (or the last one) opened: bloomedAt for the first, then each later flower's (SIM_VERSION 8) */
    flowerOpenedAt: string | null;
    /**
     * how far a bed flower's first flower has opened, 0 (the bud) to 1 (fully open, and 1 from then on: the flowers
     * after it are the visual's); null for a lotus, whose flower opens and closes with its days
     */
    open: number | null;
    diedH: number | null;
    fairyUsed: boolean;
    /** sprinkles received today that the model counted (up to 2) */
    sprinklesToday: number;
  };
  visual: Visual;
  /** when the flower should open if care stays good from now; null once it has bloomed, when asleep, or beyond 90 days */
  forecast: { bloomH: number; bloomAt: string; days: number | null } | null;
  care: {
    /** a lotus's `planted`: its last water was its planting, so the next one is the pond's first top-up (rules careStatus) */
    water: { ready: boolean; nextH: number | null; nextAt: string | null; planted?: boolean };
    feed: { ready: boolean; nextH: number | null; nextAt: string | null };
    revive: boolean;
    replant: boolean;
    shade: boolean;
    /** the game hour the shade cloth went on (pending changes included), or null while it is off */
    shadeSinceH: number | null;
    cover: boolean;
    /**
     * a lotus's koi (null for the six soil flowers): whether "Tend the pond" now would also give them a pinch (one counts
     * every 4 h; a tend always rinses aphids), from when it would, and when they were last fed
     */
    koi: { ready: boolean; nextAt: string | null; lastAt: string | null } | null;
  };
  /** actions recorded since the state's hour; they take effect when their hour completes */
  pending: { kind: CareKind | "sprinkle"; h: number; at: string; on: boolean | null }[];
  /** friends who sprinkled this plant today, by first name ("A friend" when they keep their name private) */
  friendsToday: string[];
  weather: { upToDate: boolean; waitingFromH: number | null };
}

const round = (x: number, d: number) => Math.round(x * 10 ** d) / 10 ** d;

async function friendsToday(plantId: string, nowH: number): Promise<string[]> {
  const rows = await db()<{ name: string }[]>`
    select case when pe.show_name then pe.first_name else 'A friend' end as name
    from meadow.sprinkles s join meadow.people pe on pe.id = s.giver_id
    where s.plant_id = ${plantId} and s.ist_day = ${istDayOfHour(nowH)}
    order by s.id`;
  return rows.map((r) => r.name);
}

function buildMe(plant: PlantRef, state: PlantState, pending: readonly RecordedEvent[], now: Date, waitingFromH: number | null, friends: string[]): MeView {
  const nowH = hourIndexOf(now), clock = istClock(now);
  const visual = toVisual(state, null, clock);
  const pond = isPondState(state);
  const bloomed = bloomedAt(state), flowered = flowerOpenedAt(state), ripe = ripeAt(state), died = diedAt(state);
  // both models' "not yet" marks read right at negative hours too, so a plant planted before 10 Nov gets its forecast
  const forecast = bloomed === null ? expectBloom(state, null, { h: Math.max(nowH, state.h), climT: CLIM_T }) : null;
  const care = careStatus(state, pending, nowH);
  return {
    person: { firstName: plant.firstName, showName: plant.showName },
    plant: {
      plot: plant.plot, species: plant.species, seed: plant.seed, generation: state.gen,
      plantedH: plant.plantedH, plantedAt: hourIso(plant.plantedH), rehearsal: plant.rehearsal,
    },
    now: { h: nowH, at: now.toISOString(), clock: round(clock, 3) },
    state: {
      h: state.h, at: hourIso(state.h), alive: state.alive, stage: stageOf(state), health: healthBand(visual),
      development: round(state.D, 4),
      ripeH: ripe,
      bloomH: bloomed,
      bloomedAt: bloomed === null ? null : hourIso(bloomed),
      flowerOpenedAt: flowered === null ? null : hourIso(flowered),
      open: isPondState(state) ? null : round(state.op, 2),
      diedH: died,
      fairyUsed: state.fairyUsed,
      sprinklesToday: Math.min(state.daySpr, pond ? POND.sprinkleCap : BED.sprinkleCap),
    },
    visual,
    forecast: forecast && forecast.days !== null ? { bloomH: forecast.bloomH, bloomAt: hourIso(forecast.bloomH), days: forecast.days } : null,
    care: {
      ...care,
      water: { ...care.water, nextAt: care.water.nextH === null ? null : hourIso(care.water.nextH) },
      feed: { ...care.feed, nextAt: care.feed.nextH === null ? null : hourIso(care.feed.nextH) },
      koi: care.koi && {
        ready: care.koi.ready,
        nextAt: care.koi.nextH === null ? null : hourIso(care.koi.nextH),
        lastAt: care.koi.lastH === null ? null : hourIso(care.koi.lastH),
      },
    },
    pending: pending.map((e) => ({ kind: e.kind, h: e.h, at: hourIso(e.h), on: e.on })),
    friendsToday: friends,
    weather: { upToDate: waitingFromH === null, waitingFromH },
  };
}

/** The caller's plant, caught up to the last completed hour. */
export async function getMe(personId: string, now: Date = new Date()): Promise<MeView> {
  const plant = await requirePlant(personId);
  const nowH = hourIndexOf(now);
  const adv = await advanceCheckpoint(advanceDeps(plant), nowH);
  const [pending, friends] = await Promise.all([loadRecorded(db(), plant.plantId, adv.state.h, null), friendsToday(plant.plantId, nowH)]);
  return buildMe(plant, adv.state, pending, now, adv.weatherWaitingFromH, friends);
}

// ---- planting ---------------------------------------------------------------------------------------------------------

export interface PlantResult {
  personId: string;
  /** a new session for this device, or null when it already holds this garden's session (a retry from the same device) */
  sessionToken: string | null;
  linkToken: string;
  /** true when this was a retry of a planting that already happened (same clientEventId) */
  replay: boolean;
  /** the new garden is kept on the Google account signed in on this device (its login cookie is spent) */
  keptOnAccount: boolean;
  me: MeView;
}

function isUniqueViolation(err: unknown, constraint: string): boolean {
  const e = err as { code?: string; constraint_name?: string };
  return e?.code === "23505" && e.constraint_name === constraint;
}

/** A row the database's own check refused (23514), by constraint: a species the database does not know yet, for one. */
function isCheckViolation(err: unknown, constraint: string): boolean {
  const e = err as { code?: string; constraint_name?: string };
  return e?.code === "23514" && e.constraint_name === constraint;
}

async function findPriorPlanting(requestHash: Buffer): Promise<PriorPlanting | null> {
  const rows = await db()<{ id: string; first_name: string; species: string; created_at: Date }[]>`
    select pe.id, pe.first_name, p.species, pe.created_at
    from meadow.people pe
    join meadow.gardens g on g.person_id = pe.id
    join meadow.plants p on p.garden_id = g.id and p.garden_slot = 0
    where pe.seed_request_hash = ${requestHash}`;
  const r = rows[0];
  return r ? { personId: r.id, firstName: r.first_name, species: r.species, createdAt: r.created_at } : null;
}

/**
 * Whether a name is already on a sign in the Meadow, ignoring case, compared as the people_first_name_key index does.
 * exceptRequestHash leaves out the person a given planting request made (the asker's own planting whose answer was lost).
 */
async function nameTaken(q: Queryable, firstName: string, exceptRequestHash: Buffer | null = null): Promise<boolean> {
  const rows = await q<{ one: number }[]>`
    select 1 as one from meadow.people
    where lower(first_name) = lower(${firstName})
      and (${exceptRequestHash}::bytea is null or seed_request_hash is distinct from ${exceptRequestHash}::bytea)
    limit 1`;
  return rows.length > 0;
}

function nameTakenError(firstName: string): ApiError {
  return new ApiError(409, "name_taken", nameTakenMessage(firstName), { field: "firstName" });
}

export interface NameCheck {
  /** the name as the sign would show it (cleanFirstName) */
  firstName: string;
  available: boolean;
  /** what the name step shows when the name is taken, else null */
  message: string | null;
}

/**
 * Whether a name is still free, for the name step (POST /api/name), open to whoever may plant (party.ts plantingPass).
 * The device's own pending planting under that name does not count: its answer may have been lost, and planting again
 * with the same request returns that garden. Only a hint: plantSeed checks again under the plot lock.
 */
export async function checkNameFree(input: NameCheckInput): Promise<NameCheck> {
  plantingPass(input.partyCode, partyCodes(), isProduction(), plantingOpenToAll());
  const own = input.requestId === null ? null : hashToken(`seed:${input.requestId}`);
  const taken = await nameTaken(db(), input.firstName, own);
  return { firstName: input.firstName, available: !taken, message: taken ? nameTakenMessage(input.firstName) : null };
}

async function answerRetry(prior: PriorPlanting, input: SeedInput, sessionPersonId: string | null, now: Date): Promise<PlantResult> {
  const decision = decideSeedReplay(prior, input, sessionPersonId, now);
  if (decision === "mismatch") {
    throw new ApiError(409, "seed_request_used", "That planting request was already used for a different seed. Refresh the page and plant again.");
  }
  if (decision === "expired") {
    throw new ApiError(409, "seed_request_expired", "That seed was planted a while ago and is growing. Open your personal garden link to visit it.");
  }
  const { sessionToken, linkToken } = await transaction(async (tx) => ({
    sessionToken: sessionPersonId === prior.personId ? null : await createSession(tx, prior.personId),
    linkToken: await createGardenLink(tx, prior.personId),
  }));
  return { personId: prior.personId, sessionToken, linkToken, replay: true, keptOnAccount: false, me: await getMe(prior.personId, now) };
}

/** A planting with a Google account that keeps a garden already: each account keeps one (login-rules.ts). */
function accountHasGardenError(): ApiError {
  return new ApiError(409, "account_has_garden", "That Google account has a garden in the Meadow already. Continue with Google to open it here.");
}

/**
 * Plants a seed for a new person: checks who may plant, gives them the next plot, and creates the person, their
 * garden, the plant and its first checkpoint, a session and a personal garden link, all in one transaction. When a
 * Google account is signed in on the device (its login cookie, `loginToken`, login.ts), the new garden is kept on it;
 * signing in is never required.
 */
export async function plantSeed(input: SeedInput, opts: { sessionPersonId: string | null; loginToken?: string; now?: Date }): Promise<PlantResult> {
  const now = opts.now ?? new Date();
  const h = hourIndexOf(now);
  const pass = plantingPass(input.partyCode, partyCodes(), isProduction(), plantingOpenToAll());
  // a retry first, so a device whose first attempt set the cookie but lost the response still gets its garden link
  const requestHash = hashToken(`seed:${input.requestId}`);
  const prior = await findPriorPlanting(requestHash);
  if (prior) return answerRetry(prior, input, opts.sessionPersonId, now);
  if (opts.sessionPersonId) {
    const mine = await findPlantOfPerson(opts.sessionPersonId);
    if (mine) {
      throw new ApiError(409, "already_planted", `This device already holds ${mine.firstName}'s garden; the seed is waiting there.`,
        { plot: mine.plot, firstName: mine.firstName });
    }
  }

  // a Google account signed in on this device keeps the new garden; one that keeps a garden already plants no second
  const subject = googleSignIn() !== null ? await loginStartSubject(db(), opts.loginToken) : null;
  if (plantingNeeds(subject !== null, subject !== null && (await accountPerson(db(), subject)) !== null) === "has_garden") {
    throw accountHasGardenError();
  }

  const species = input.species;
  // the live site plants real gardens; a dev server or a Preview, practice ones
  const rehearsal = !isProduction();
  const seed = randomBytes(6).toString("base64url");
  try {
    const created = await transaction(async (tx) => {
      // one planting at a time hands out plots, so two seeds never race for the same one
      await tx`select pg_advisory_xact_lock(${PLOT_LOCK_KEY})`;
      // every planting of the past minute, for the throttle; the real ones of the past hour and day, for seeds from
      // outside the party
      const [recent] = await tx<{ minute: number; hour: number; day: number }[]>`
        select (count(*) filter (where created_at > now() - interval '1 minute'))::int as minute,
               (count(*) filter (where not rehearsal and created_at > now() - interval '1 hour'))::int as hour,
               (count(*) filter (where not rehearsal))::int as day
        from meadow.plants where created_at > now() - interval '1 day'`;
      if (recent.minute >= PLANTINGS_PER_MINUTE) {
        throw new ApiError(429, "busy_planting", "Lots of seeds are going in at once. Yours will follow in a moment.", { retryAfterS: plantingRetryAfterS() });
      }
      if (pass === "open") {
        const wait = openPlantingWait(recent);
        if (wait !== "go") throw restingError(wait, recent);
      }
      // under the plot lock, so two people cannot take one name at once (the index is the backstop)
      if (await nameTaken(tx, input.firstName)) throw nameTakenError(input.firstName);
      const taken = await tx<{ plot_index: number }[]>`select plot_index from meadow.plants`;
      // a lotus is planted in the river: the next free pocket, or (all taken) a bed plot, where it stands in a brass urli
      const water = species === "lotus";
      const plot = assignPlot(taken.map((r) => r.plot_index), { from: rehearsal ? "outer" : "inner", water });
      if (plot === null) {
        console.error(`[meadow api] the Meadow is full: all ${taken.length} plots are taken`);
        throw new ApiError(503, "meadow_full", "The Meadow has no free plot just now. The committee has been told; please try again a little later.");
      }
      if (water && isBedIndex(plot)) console.info(`[meadow api] every river pocket is taken: this lotus goes to bed plot ${plot}, in an urli`);
      if (isBedIndex(plot) && plot >= PLOT_CAPACITY) console.warn(`[meadow api] plot ${plot} is beyond the ${PLOT_CAPACITY} planned plots; the Meadow is growing outward`);
      const [person] = await tx<{ id: string }[]>`
        insert into meadow.people (first_name, show_name, seed_request_hash)
        values (${input.firstName}, ${input.showName}, ${requestHash}) returning id`;
      const [garden] = await tx<{ id: string }[]>`insert into meadow.gardens (person_id) values (${person.id}) returning id`;
      const [plant] = await tx<{ id: string }[]>`
        insert into meadow.plants (garden_id, garden_slot, species, seed, plot_index, planted_h, sim_version, rehearsal)
        values (${garden.id}, 0, ${species}, ${seed}, ${plot}, ${h}, ${modelVersionOf(species)}, ${rehearsal}) returning id`;
      const state = seedState({ speciesId: species, plantedH: h, owner: person.id });
      await tx`
        insert into meadow.checkpoints (plant_id, h, state, sim_version)
        values (${plant.id}, ${state.h}, ${tx.json(asJson(state))}, ${modelVersionOf(species)})`;
      // kept on the Google account the device signed in with (the account's key is unique: never two gardens)
      if (subject && opts.loginToken) await keepPlanting(tx, opts.loginToken, subject, person.id);
      const ref: PlantRef = {
        personId: person.id, firstName: input.firstName, showName: input.showName, plantId: plant.id, species, seed, plot,
        plantedH: h, rehearsal,
      };
      return {
        ref,
        state,
        sessionToken: await createSession(tx, person.id),
        linkToken: await createGardenLink(tx, person.id),
      };
    });
    return {
      personId: created.ref.personId,
      sessionToken: created.sessionToken,
      linkToken: created.linkToken,
      replay: false,
      keptOnAccount: subject !== null,
      me: buildMe(created.ref, created.state, [], now, null, []),
    };
  } catch (err) {
    // the same request raced itself (a double tap before the first response): answer with the planting that won. That
    // planting holds this request's name too, so a taken name is first checked against this request's own seed.
    const nameClash = (err instanceof ApiError && err.code === "name_taken") || isUniqueViolation(err, "people_first_name_key");
    if (nameClash || isUniqueViolation(err, "people_seed_request_hash_key")) {
      const winner = await findPriorPlanting(requestHash);
      if (winner) return answerRetry(winner, input, opts.sessionPersonId, now);
    }
    if (nameClash) throw nameTakenError(input.firstName);
    // the same account planted on another device in the meantime
    if (isUniqueViolation(err, "logins_pkey")) throw accountHasGardenError();
    // a build that offers a seed the database's species list does not hold yet (the lotus, before migration 0006): a
    // calm answer rather than a failure, and nothing was planted (the transaction rolled back)
    if (isCheckViolation(err, "plants_species_check")) {
      console.error(`[meadow api] the database does not accept the species "${species}" yet (plants_species_check): apply the newest migration`);
      throw new ApiError(409, "seed_not_ready", "That seed is not quite ready to plant yet. Please choose another seed, or try again a little later.");
    }
    throw err;
  }
}

/** A fresh personal garden link for someone who already has a garden (the newest few links keep working). */
export async function newGardenLink(personId: string): Promise<string> {
  await requirePlant(personId);
  return createGardenLink(db(), personId);
}

// ---- care -------------------------------------------------------------------------------------------------------------

export interface CareResult {
  /** duplicate: a retry, or a shade/cover change that was already in place (unchanged: true); nothing new was recorded */
  event: { kind: CareKind; h: number; at: string; duplicate: boolean; unchanged: boolean };
  me: MeView;
}

/** Records a care action (water, shade, cover, feed, tend, talk, revive, replant) for the caller's plant. */
export async function recordCare(personId: string, input: CareInput, now: Date = new Date()): Promise<CareResult> {
  const plant = await requirePlant(personId);
  if (!plant.rehearsal && !isProduction()) throw practiceOnly();
  const nowH = hourIndexOf(now);
  const adv = await advanceCheckpoint(advanceDeps(plant), nowH);

  const outcome = await transaction(async (tx) => {
    const [cp] = await tx<CheckpointRow[]>`
      select h, state, sim_version, version from meadow.checkpoints where plant_id = ${plant.plantId} for update`;
    if (!cp) throw new ApiError(404, "no_plant", "There is no seed in your garden yet. Plant one to begin.");
    // judge by the freshest state we have: the saved checkpoint, or the catch-up just computed if it could not be saved
    const state = cp.sim_version === modelVersionOf(plant.species) && cp.h >= adv.state.h ? cp.state : adv.state;
    const pending = await loadRecorded(tx, plant.plantId, state.h, null);
    const existing = await findEvent(tx, plant.plantId, input.clientEventId);
    const decision = decideCare(input, {
      state, pending, existing: existing ? toRecordedEvent(existing) : null, nowH, checkpointH: cp.h,
    });
    if (decision.action !== "insert") return { decision, state, pending, event: null };
    // the checkpoint row lock serialises events per plant, so the same id cannot be inserted twice
    const [inserted] = await tx<EventRow[]>`
      insert into meadow.plant_events (plant_id, h, kind, amount, client_event_id)
      values (${plant.plantId}, ${decision.h}, ${input.kind}, ${decision.amount}, ${input.clientEventId})
      returning id, h, kind, amount, actor_id, client_event_id`;
    // a catch-up computed before this event must not be saved now
    await tx`update meadow.checkpoints set version = version + 1 where plant_id = ${plant.plantId}`;
    const event = toRecordedEvent(inserted);
    return { decision, state, pending: [...pending, event], event };
  });

  const { decision } = outcome;
  if (decision.action === "reject") {
    throw new ApiError(decision.status, decision.code, decision.message,
      decision.retryH === undefined ? {} : { retryH: decision.retryH, retryAt: hourIso(decision.retryH) });
  }
  const recorded = decision.action === "duplicate" ? decision.event : outcome.event;
  const h = recorded ? recorded.h : decision.action === "unchanged" ? decision.h : nowH;
  const friends = await friendsToday(plant.plantId, nowH);
  return {
    event: {
      kind: input.kind, h, at: hourIso(h),
      duplicate: decision.action !== "insert",
      unchanged: decision.action === "unchanged",
    },
    me: buildMe(plant, outcome.state, outcome.pending, now, adv.weatherWaitingFromH, friends),
  };
}

// ---- sprinkles --------------------------------------------------------------------------------------------------------

export interface SprinkleResult {
  plot: number;
  /** the friend's first name as the Meadow shows it */
  name: string;
  /** whether the model counts it (the first two sprinkles a plant gets each day water it; later ones are good wishes) */
  counts: boolean;
  duplicate: boolean;
  message: string;
}

/** One small sprinkle from the caller to the plant in another person's plot: one per giver per IST day. */
export async function sprinkle(giverId: string, input: SprinkleInput, now: Date = new Date()): Promise<SprinkleResult> {
  const nowH = hourIndexOf(now);
  const rows = await db()<PlantRefRow[]>`
    select pe.id as person_id, pe.first_name, pe.show_name, p.id as plant_id, p.species, p.seed, p.plot_index, p.planted_h,
           p.rehearsal
    from meadow.plants p
    join meadow.gardens g on g.id = p.garden_id
    join meadow.people pe on pe.id = g.person_id
    where p.plot_index = ${input.plot} and p.species = any(${KNOWN_SPECIES as string[]}::text[])`;
  const target = rows[0] ? toPlantRef(rows[0]) : null;
  // a practice plant hidden from this Meadow counts as an empty plot, and so does a plant of a species this build does not
  // know (species-guard.ts)
  if (!target || (target.rehearsal && !showRehearsals())) throw new ApiError(404, "plot_empty", "Nobody has planted in that plot yet.");
  if (!target.rehearsal && !isProduction()) throw practiceOnly();
  if (target.personId === giverId) {
    throw new ApiError(400, "own_plant", target.species === "lotus"
      ? "That is your own lotus; give it a top-up instead. Sprinkles are for friends."
      : "That is your own flower; give it a can of water instead. Sprinkles are for friends.");
  }
  const name = target.showName ? target.firstName : "A friend";
  const day = istDayOfHour(nowH);

  return transaction(async (tx) => {
    const [cp] = await tx<{ h: number }[]>`select h from meadow.checkpoints where plant_id = ${target.plantId} for update`;
    const h = Math.max(nowH, cp?.h ?? nowH);
    const existing = await findEvent(tx, target.plantId, input.clientEventId);
    if (existing) {
      if (existing.kind !== "sprinkle" || existing.actor_id !== giverId) {
        throw new ApiError(409, "client_event_id_reused", "That clientEventId was already used for a different action; send a fresh one.");
      }
      const [n] = await tx<{ before: number }[]>`
        select count(*)::int as before from meadow.sprinkles s
        where s.plant_id = ${target.plantId} and s.ist_day = ${istDayOfHour(existing.h)}
          and s.id < (select id from meadow.sprinkles where event_id = ${String(existing.id)})`;
      const counts = (n?.before ?? 0) < BED.sprinkleCap;
      return { plot: target.plot, name, counts, duplicate: true, message: sprinkleMessage(name, counts, target.species) };
    }
    const given = await tx<{ id: string }[]>`
      insert into meadow.sprinkles (giver_id, plant_id, ist_day, h)
      values (${giverId}, ${target.plantId}, ${day}, ${h})
      on conflict (giver_id, ist_day) do nothing returning id`;
    if (!given[0]) {
      throw new ApiError(409, "sprinkled_today", "You have shared today's sprinkle already. Tomorrow brings another.");
    }
    const [before] = await tx<{ n: number }[]>`
      select count(*)::int as n from meadow.sprinkles
      where plant_id = ${target.plantId} and ist_day = ${day} and id < ${given[0].id}`;
    const [event] = await tx<{ id: string }[]>`
      insert into meadow.plant_events (plant_id, h, kind, actor_id, client_event_id)
      values (${target.plantId}, ${h}, 'sprinkle', ${giverId}, ${input.clientEventId}) returning id`;
    await tx`update meadow.sprinkles set event_id = ${event.id} where id = ${given[0].id}`;
    await tx`update meadow.checkpoints set version = version + 1 where plant_id = ${target.plantId}`;
    const counts = before.n < BED.sprinkleCap;
    return { plot: target.plot, name, counts, duplicate: false, message: sprinkleMessage(name, counts, target.species) };
  });
}

