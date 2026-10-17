// The game rules the API enforces around the model, kept pure so they are tested without a database: the planting
// window, when a retried planting may be answered with the original, what a care action may do right now (rate limits,
// idempotent retries, shade and cover changes, revive and replant conditions), how stored event rows become the model's
// TimedEvents, IST clock helpers, and the coarse bands the Meadow shows.
//
// The model stays the authority: step() validates every event again and ignores a can or feed inside its rate limit.
// These checks exist so the player gets a calm, specific answer instead of an action that silently does nothing.
import {
  BED,
  GAME_START_MS,
  HOUR_MS,
  IST_OFFSET_MIN,
  PLANT_OPEN_H,
  canPlant,
  dateOfHour,
  type PlantState,
  type TimedEvent,
  type Visual,
} from "@/lib/sim";
import type { CareKind } from "./validate";

// ---- time ----------------------------------------------------------------------------------------------------------

/** ISO timestamp of the start of game hour h. */
export function hourIso(h: number): string {
  return dateOfHour(h).toISOString();
}

/** IST clock hour of a moment, fractional (14.5 = 14:30 IST): toVisual's clock for the jasmine rhythm and sundrop head. */
export function istClock(now: Date): number {
  const hours = (now.getTime() - GAME_START_MS) / HOUR_MS;
  return ((hours % 24) + 24) % 24;
}

/** The IST calendar date (YYYY-MM-DD) game hour h falls on: the day sprinkles are counted by. */
export function istDayOfHour(h: number): string {
  return new Date(dateOfHour(h).getTime() + IST_OFFSET_MIN * 60_000).toISOString().slice(0, 10);
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "15:00", "tomorrow at 03:00" or "12 Nov, 09:00": when game hour h starts, in IST, as seen from hour nowH. */
export function formatIstHour(h: number, nowH: number): string {
  const hod = String(((h % 24) + 24) % 24).padStart(2, "0") + ":00";
  const day = Math.floor(h / 24), today = Math.floor(nowH / 24);
  if (day === today) return hod;
  if (day === today + 1) return `tomorrow at ${hod}`;
  const d = new Date(dateOfHour(h).getTime() + IST_OFFSET_MIN * 60_000);
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}, ${hod}`;
}

// ---- planting window ------------------------------------------------------------------------------------------------

/**
 * open: the real window (PLANT_OPEN_H on 10 Nov, to 10 Dec 23:59 IST). rehearsal: before the party, where env.ts allows it
 * (outside production, or MEADOW_REHEARSAL=1 before the game clock starts). early: before the party otherwise. closed:
 * after 10 Dec.
 */
export type PlantingWindow = "open" | "rehearsal" | "early" | "closed";

export function plantingWindow(h: number, rehearsal: boolean): PlantingWindow {
  if (canPlant(h)) return "open";
  if (h < PLANT_OPEN_H) return rehearsal ? "rehearsal" : "early";
  return "closed";
}

/** "10 Nov at 15:00 IST" (or whatever hour the model sets): when planting opens, from PLANT_OPEN_H, for messages. */
export function plantingOpensText(): string {
  const d = new Date(dateOfHour(PLANT_OPEN_H).getTime() + IST_OFFSET_MIN * 60_000);
  const hod = String(((PLANT_OPEN_H % 24) + 24) % 24).padStart(2, "0");
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} at ${hod}:00 IST`;
}

// ---- retried plantings ------------------------------------------------------------------------------------------------

/** How long after planting a retry (same clientEventId) is still answered with the original planting. */
export const SEED_REPLAY_WINDOW_MS = 30 * 60_000;

export interface PriorPlanting {
  personId: string;
  firstName: string;
  species: string;
  createdAt: Date;
}

/**
 * What a planting request whose clientEventId was already used gets. replay: the same request again (same name and
 * species, within the window, from no session or from the planting's own), answered with the original planting.
 * Anything else is refused, so the id is not a password that opens someone's garden. mismatch: different details, or a
 * device that holds another garden. expired: too long after the planting (the garden link is the way back in).
 */
export function decideSeedReplay(
  prior: PriorPlanting,
  request: { firstName: string; species: string },
  sessionPersonId: string | null,
  now: Date,
): "replay" | "mismatch" | "expired" {
  if (sessionPersonId !== null && sessionPersonId !== prior.personId) return "mismatch";
  if (prior.firstName !== request.firstName || prior.species !== request.species) return "mismatch";
  if (now.getTime() - prior.createdAt.getTime() > SEED_REPLAY_WINDOW_MS) return "expired";
  return "replay";
}

// ---- events -----------------------------------------------------------------------------------------------------------

/** A plant_events row as the database returns it (id is a bigint, so it may arrive as a string). */
export interface EventRow {
  id: number | string | bigint;
  h: number;
  kind: string;
  amount: number | null;
  actor_id: string | null;
  client_event_id: string;
}

/** An event recorded for a plant, in API terms. */
export interface RecordedEvent {
  id: number;
  h: number;
  kind: CareKind | "sprinkle";
  /** shade and cover: on or off */
  on: boolean | null;
  actorId: string | null;
  clientEventId: string;
}

export function toRecordedEvent(r: EventRow): RecordedEvent {
  return {
    id: Number(r.id),
    h: r.h,
    kind: r.kind as RecordedEvent["kind"],
    on: r.amount === null ? null : r.amount === 1,
    actorId: r.actor_id,
    clientEventId: r.client_event_id,
  };
}

/**
 * The model's TimedEvent for a stored event. The numeric id orders same-rank events within an hour (a database serial
 * is monotonic) and is the model's in-hour idempotency key.
 */
export function toTimedEvent(e: RecordedEvent): TimedEvent | null {
  const base = { id: e.id, h: e.h };
  switch (e.kind) {
    case "shade":
    case "cover":
      return { ...base, kind: e.kind, amount: e.on ? 1 : 0 };
    case "sprinkle":
      // every sprinkle on a given day has a distinct giver (one per giver per day), so a placeholder for a missing
      // actor keeps the replay identical
      return { ...base, kind: "sprinkle", actor: e.actorId ?? `giver:${e.id}` };
    case "water":
    case "feed":
    case "tend":
    case "talk":
    case "revive":
    case "replant":
      return { ...base, kind: e.kind };
    default:
      return null;
  }
}

// ---- care -------------------------------------------------------------------------------------------------------------

export interface CareStatus {
  water: { ready: boolean; nextH: number | null };
  feed: { ready: boolean; nextH: number | null };
  /** Fairy Dust can wake the plant (it is asleep and the dust is unused) */
  revive: boolean;
  /** a fresh seed can go in (asleep, dust used, planting open) */
  replant: boolean;
  /** the shade cloth and rain cover as the player last set them, including this hour's changes */
  shade: boolean;
  /** the game hour the shade cloth went on (the hour its change was recorded in), or null while it is off */
  shadeSinceH: number | null;
  cover: boolean;
}

function lastOf(state: PlantState, pending: readonly RecordedEvent[], kind: "water" | "feed"): number {
  let last = kind === "water" ? state.lastCanH : state.lastFeedH;
  for (const e of pending) if (e.kind === kind && e.h > last) last = e.h;
  return last;
}

// A replant waiting in pending gives a fresh bed, shade cloth and rain cover off; step() takes it before that hour's
// shade and cover changes whatever their ids, so only those and later ones count after it.
function pendingReplantH(pending: readonly RecordedEvent[]): number | null {
  let h: number | null = null;
  for (const e of pending) if (e.kind === "replant" && (h === null || e.h > h)) h = e.h;
  return h;
}

/** The latest pending shade or cover change that will count, or null. */
function lastToggle(pending: readonly RecordedEvent[], kind: "shade" | "cover"): RecordedEvent | null {
  const from = pendingReplantH(pending) ?? -Infinity;
  let last: RecordedEvent | null = null;
  for (const e of pending) if (e.kind === kind && e.on !== null && e.h >= from && (last === null || e.id > last.id)) last = e;
  return last;
}

/** The shade cloth or rain cover as the player last set it, the changes still pending included. */
function toggleOn(state: PlantState, pending: readonly RecordedEvent[], kind: "shade" | "cover"): boolean {
  const last = lastToggle(pending, kind);
  if (last) return last.on === true;
  return pendingReplantH(pending) === null && state[kind];
}

/**
 * The game hour the shade cloth went on, or null while it is off: the pending change that put it on, or else
 * state.h - shadeH from the replayed state (step() counts shadeH, the hours it has been on, from the hour its change was
 * filed at, and resets it when the cloth comes off or a fresh seed goes in).
 */
function shadeSince(state: PlantState, pending: readonly RecordedEvent[]): number | null {
  const last = lastToggle(pending, "shade");
  if (last) return last.on ? last.h : null;
  return pendingReplantH(pending) === null && state.shade ? state.h - state.shadeH : null;
}

/**
 * What the player can do at hour nowH, from the replayed state plus the events recorded since it (pending: they take
 * effect when their hour completes).
 */
export function careStatus(state: PlantState, pending: readonly RecordedEvent[], nowH: number): CareStatus {
  const lastCan = lastOf(state, pending, "water"), lastFeed = lastOf(state, pending, "feed");
  const nextCan = lastCan + BED.canGapH, nextFeed = lastFeed + BED.feedGapH;
  const waking = pending.some((e) => e.kind === "revive" || e.kind === "replant");
  return {
    water: { ready: nowH >= nextCan, nextH: nowH >= nextCan ? null : nextCan },
    feed: state.alive
      ? { ready: nowH >= nextFeed, nextH: nowH >= nextFeed ? null : nextFeed }
      : { ready: false, nextH: null },
    revive: !state.alive && !state.fairyUsed && !waking,
    replant: !state.alive && state.fairyUsed && canPlant(nowH) && !waking,
    shade: toggleOn(state, pending, "shade"),
    shadeSinceH: shadeSince(state, pending),
    cover: toggleOn(state, pending, "cover"),
  };
}

/** Shade or cover changes accepted per kind per hour: plenty for a person, a ceiling for a script. */
export const TOGGLES_PER_HOUR = 4;

export type CareDecision =
  | { action: "insert"; h: number; amount: 0 | 1 | null }
  | { action: "duplicate"; event: RecordedEvent }
  /** the shade cloth or rain cover is already as asked: nothing to record */
  | { action: "unchanged"; h: number; on: boolean }
  | { action: "reject"; status: number; code: string; message: string; retryH?: number };

export interface CareContext {
  state: PlantState;
  /** events recorded at or after the checkpoint hour, not yet inside the state */
  pending: readonly RecordedEvent[];
  /** an event of this plant already recorded under the same clientEventId, however old */
  existing: RecordedEvent | null;
  nowH: number;
  /** the checkpoint's hour: an event is never filed before it, or a catch-up would already have passed it by */
  checkpointH: number;
}

/**
 * Decides what a care request does: record it at an hour, answer a retry with the event already recorded, or decline
 * with a calm reason (and when to try again).
 */
export function decideCare(input: { kind: CareKind; on: boolean | null }, ctx: CareContext): CareDecision {
  const { state, pending, existing, nowH } = ctx;
  const h = Math.max(nowH, ctx.checkpointH);
  if (existing) {
    if (existing.kind === input.kind) return { action: "duplicate", event: existing };
    return { action: "reject", status: 409, code: "client_event_id_reused", message: "That clientEventId was already used for a different action; send a fresh one." };
  }
  const thisHour = (kind: RecordedEvent["kind"]) => pending.find((e) => e.kind === kind && e.h === h) ?? null;
  const waking = pending.find((e) => e.kind === "revive" || e.kind === "replant") ?? null;

  switch (input.kind) {
    case "water": {
      const last = lastOf(state, pending, "water"), next = last + BED.canGapH;
      if (h < next) {
        return { action: "reject", status: 429, code: "too_soon", retryH: next,
          message: `Your plant had a can of water not long ago; the next one is welcome from ${formatIstHour(next, nowH)} IST.` };
      }
      return { action: "insert", h, amount: null };
    }
    case "feed": {
      if (!state.alive) {
        return { action: "reject", status: 409, code: "resting", message: "Your plant is resting; plant food can wait until it wakes." };
      }
      const last = lastOf(state, pending, "feed"), next = last + BED.feedGapH;
      if (h < next) {
        return { action: "reject", status: 429, code: "too_soon", retryH: next,
          message: `Your plant was fed recently; plant food is best every two days. The next feed is welcome from ${formatIstHour(next, nowH)} IST.` };
      }
      return { action: "insert", h, amount: null };
    }
    case "shade":
    case "cover": {
      // a change that changes nothing is not recorded, so repeated taps cannot grow the event log
      const on = input.on === true;
      if (on === toggleOn(state, pending, input.kind)) return { action: "unchanged", h, on };
      const changes = pending.filter((e) => e.kind === input.kind && e.h === h).length;
      if (changes >= TOGGLES_PER_HOUR) {
        const what = input.kind === "shade" ? "shade cloth" : "rain cover";
        return { action: "reject", status: 429, code: "too_many_changes", retryH: h + 1,
          message: `The ${what} has moved a few times this hour; let it settle. You can change it again from ${formatIstHour(h + 1, nowH)} IST.` };
      }
      return { action: "insert", h, amount: on ? 1 : 0 };
    }
    case "tend":
    case "talk": {
      // once an hour is plenty: a second tend in the same hour would only compound the pest knock-down
      const same = thisHour(input.kind);
      return same ? { action: "duplicate", event: same } : { action: "insert", h, amount: null };
    }
    case "revive": {
      if (waking) return { action: "duplicate", event: waking };
      if (state.alive) {
        return { action: "reject", status: 409, code: "not_needed", message: "Your plant is awake; Fairy Dust is for a plant that has gone to sleep." };
      }
      if (state.fairyUsed) {
        return { action: "reject", status: 409, code: "fairy_used", message: "The Fairy Dust has been used; you can plant a fresh seed in the same bed instead." };
      }
      return { action: "insert", h, amount: null };
    }
    case "replant": {
      if (waking) return { action: "duplicate", event: waking };
      if (state.alive) {
        return { action: "reject", status: 409, code: "not_needed", message: "Your plant is still with you; replanting is for a bed whose plant has gone to sleep." };
      }
      if (!state.fairyUsed) {
        return { action: "reject", status: 409, code: "revive_first", message: "Try the Fairy Dust first; it can wake a sleeping plant once." };
      }
      if (!canPlant(h)) {
        return h < PLANT_OPEN_H
          ? { action: "reject", status: 409, code: "not_yet", message: `Replanting opens with the party on ${plantingOpensText()}.` }
          : { action: "reject", status: 409, code: "planting_closed", message: "Planting closed on 10 Dec, so a fresh seed cannot go in now. Your friends' flowers are still there to visit." };
      }
      return { action: "insert", h, amount: null };
    }
  }
}

// ---- Meadow bands -----------------------------------------------------------------------------------------------------

export type Stage = "seed" | "sprout" | "leafy" | "bud" | "bloom" | "resting";
export type HealthBand = "thriving" | "fine" | "poorly" | "resting";

/** Coarse growth stage from development D (buds form at 0.64, a mature bud at 1) and whether it has bloomed. */
export function stageOf(s: PlantState): Stage {
  if (!s.alive) return "resting";
  if (s.bloomH >= 0) return "bloom";
  if (s.D >= 0.64) return "bud";
  if (s.D >= 0.3) return "leafy";
  if (s.D >= 0.05) return "sprout";
  return "seed";
}

export function healthBand(v: Visual): HealthBand {
  if (!v.alive) return "resting";
  if (v.health >= 0.75) return "thriving";
  if (v.health >= 0.45) return "fine";
  return "poorly";
}

/** How open the flower is right now, 0 (closed or none) to 3 (fully open). */
export function bloomBand(v: Visual): 0 | 1 | 2 | 3 {
  return Math.max(0, Math.min(3, Math.round(v.bloom * 3))) as 0 | 1 | 2 | 3;
}
