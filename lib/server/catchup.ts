// Bringing a stored plant up to the last completed hour, with optimistic concurrency. A checkpoint is a cache of
// planting + events + weather, so advancing it is safe to race: every request computes the same state from the same
// inputs, and the version column makes sure a state computed from stale inputs (an event recorded meanwhile bumps the
// version) is never saved. A loser reloads and tries again, or simply returns what it computed without saving.
//
// The storage is injected (AdvanceDeps), so this runs in tests against in-memory fakes; lib/server/garden.ts wires it
// to Postgres. A checkpoint written by another SIM_VERSION is not stepped on: the plant is rebuilt from its planting
// (seedState() and catchUp() over every event, what replayFromPlanting() does), which is what makes the event log the
// source of truth. A deployment that must not write checkpoints (env.ts: anything but production, while the database is
// shared) leaves saveCheckpoint out and gets the catch-up computed once, returned and dropped.
import { SIM_VERSION, catchUp, createPlant, type PlantState, type Planting, type TimedEvent, type WeatherAt } from "@/lib/sim";

export interface CheckpointRecord {
  h: number;
  state: PlantState;
  simVersion: number;
  version: number;
}

export interface AdvanceDeps {
  planting: Planting;
  loadCheckpoint(): Promise<CheckpointRecord>;
  /** every event of the plant with fromH <= h < toH */
  loadEvents(fromH: number, toH: number): Promise<TimedEvent[]>;
  /** make the weather store cover [fromH, toH) as far as real data allows; must not throw */
  ensureWeather(fromH: number, toH: number): Promise<void>;
  loadWeather(fromH: number, toH: number): Promise<WeatherAt>;
  /**
   * save state if the checkpoint still has expectedVersion; false when someone else got there first. Left out on a
   * deployment that must not write checkpoints: the catch-up is then computed once and returned unsaved.
   */
  saveCheckpoint?(expectedVersion: number, state: PlantState): Promise<boolean>;
}

export interface AdvanceResult {
  state: PlantState;
  /** the checkpoint row's version after this call (unchanged when nothing was saved) */
  version: number;
  saved: boolean;
  /** the first hour replay is waiting on weather for, or null when the state is at toH */
  weatherWaitingFromH: number | null;
}

/**
 * A fresh seed for a planting: createPlant(), except for a rehearsal planted before the game clock starts (a negative
 * hour, only ever before the party). The model marks "never watered or fed" as hour -99, which at a negative hour would
 * read as a recent can and refuse every can and feed for weeks, so for those plants alone the marks move 99 hours
 * before the planting. Real plantings (from PLANT_OPEN_H, on 10 Nov) are exactly createPlant().
 */
export function seedState(planting: Planting): PlantState {
  const s = createPlant(planting.speciesId, planting.plantedH, planting.owner);
  if (planting.plantedH >= 0) return s;
  const never = planting.plantedH - 99;
  return { ...s, lastCanH: Math.min(s.lastCanH, never), lastFeedH: Math.min(s.lastFeedH, never) };
}

/** The state to step from: the checkpoint, or a fresh seed when the checkpoint came from another model version. */
export function baseState(cp: CheckpointRecord, planting: Planting): { state: PlantState; rebuilt: boolean } {
  if (cp.simVersion === SIM_VERSION && cp.state.v === SIM_VERSION) return { state: cp.state, rebuilt: false };
  return { state: seedState(planting), rebuilt: true };
}

/** Steps the plant's checkpoint through every completed hour before toH and saves it; see the header for the rules. */
export async function advanceCheckpoint(deps: AdvanceDeps, toH: number, attempts = 3): Promise<AdvanceResult> {
  let last: AdvanceResult | null = null;
  for (let attempt = 0; attempt < attempts; attempt++) {
    const cp = await deps.loadCheckpoint();
    const { state: base, rebuilt } = baseState(cp, deps.planting);
    if (base.h >= toH && !rebuilt) {
      return { state: base, version: cp.version, saved: false, weatherWaitingFromH: null };
    }
    const fromH = base.h;
    await deps.ensureWeather(fromH, toH);
    const [events, weather] = await Promise.all([deps.loadEvents(fromH, toH), deps.loadWeather(fromH, toH)]);
    const next = catchUp(base, events, weather, toH);
    const waiting = next.h < toH ? next.h : null;
    if (next === base && !rebuilt) {
      // no weather for the first hour yet: nothing to save
      return { state: base, version: cp.version, saved: false, weatherWaitingFromH: waiting };
    }
    if (!deps.saveCheckpoint) return { state: next, version: cp.version, saved: false, weatherWaitingFromH: waiting };
    if (await deps.saveCheckpoint(cp.version, next)) {
      return { state: next, version: cp.version + 1, saved: true, weatherWaitingFromH: waiting };
    }
    last = { state: next, version: cp.version, saved: false, weatherWaitingFromH: waiting };
  }
  // lost every race: what we computed is still the right plant unless an event landed meanwhile, and the next visit
  // folds that in
  return last as AdvanceResult;
}
