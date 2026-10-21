// Replay: what the server calls to bring a stored plant up to date. A plant is a checkpoint (a PlantState saved at some
// hour) plus the player events since then plus the weather; catchUp() folds them in, one completed hour at a time.
//
// Rules the API layer can rely on:
// - Hours run from checkpoint.h up to toH - 1, so the result describes the moment toH. Pass toH = hourIndexOf(now) to
//   step every completed hour and never the one in progress.
// - An event belongs to the hour it happened in (TimedEvent.h = hourIndexOf(its time)) and is applied at the start of
//   that hour's step. Events before checkpoint.h are already inside the checkpoint and are ignored; events at or after toH
//   wait for a later call. So the server may pass every event the plant ever had, or only the recent ones.
// - Within an hour, step() orders events by kind (revive, replant, shade and cover, feed, water, sprinkle, tend, talk),
//   then by numeric id, then by the order given here (stable). Give every event a monotonically increasing numeric id
//   (a database serial) and the order is fully determined however the rows come back.
// - An id repeated within one hour is applied once. Ids are not compared across hours: dedupe retries upstream (a unique
//   key on the event id), or a retry that lands in the next hour is applied twice.
// - Weather is never invented: replay stops at the first hour the weather lookup cannot supply, and the returned state's
//   h says where (h < toH). Backfill that hour (forecast past_days, or the archive) and call again from the result.
// - Stepping in chunks gives exactly the same state as stepping in one go, so checkpoints can be saved at any hour.
// - A soil flower and a lotus replay alike: plant.ts steps each state in the model that wrote it.
import type { SpeciesId } from "@/lib/plant/species";
import type { HourWeather, SimEvent } from "./model";
import { createPlant, step, type PlantState } from "./plant";

/** A player event and the game hour it happened in. */
export type TimedEvent = SimEvent & { h: number };

export type WeatherAt = (h: number) => HourWeather | undefined;

const NO_EVENTS: readonly SimEvent[] = Object.freeze([]);

// Events of [fromH, toH) grouped by hour, keeping their given order inside each hour.
function bucketByHour(events: readonly TimedEvent[], fromH: number, toH: number): Map<number, SimEvent[]> {
  const out = new Map<number, SimEvent[]>();
  for (const e of events) {
    if (!(e.h >= fromH && e.h < toH)) continue;
    const list = out.get(e.h);
    if (list) list.push(e);
    else out.set(e.h, [e]);
  }
  return out;
}

/**
 * Steps a checkpoint through every completed hour up to toH (exclusive), applying events by hour bucket. Stops early,
 * without inventing weather, at the first hour weather(h) returns undefined. Never mutates its inputs.
 */
export function catchUp<S extends PlantState>(checkpoint: S, events: readonly TimedEvent[], weather: WeatherAt, toH: number): S {
  if (!(checkpoint.h < toH)) return checkpoint;
  const buckets = bucketByHour(events, checkpoint.h, toH);
  let s = checkpoint;
  while (s.h < toH) {
    const h = s.h, wx = weather(h);
    if (!wx) break;
    // a state steps in the model that wrote it, so a soil state stays soil and a pond state stays pond
    const next = step(s as PlantState, { h, wx }, buckets.get(h) ?? NO_EVENTS) as S;
    if (next.h !== h + 1) break;          // a checkpoint from before its own planting hour: nothing can advance it
    s = next;
  }
  return s;
}

export interface Planting {
  speciesId: SpeciesId;
  /** the game hour the seed went in (any hour: planting never closes) */
  plantedH: number;
  /** the player's id; their own sprinkles do not count as a friend's */
  owner: string | null;
}

/** Rebuilds a plant from its planting: createPlant() and then catchUp() over every event. */
export function replayFromPlanting(planting: Planting, events: readonly TimedEvent[], weather: WeatherAt, toH: number): PlantState {
  return catchUp(createPlant(planting.speciesId, planting.plantedH, planting.owner), events, weather, toH);
}
