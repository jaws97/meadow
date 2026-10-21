// The words the gift flow uses more than once: where the planting season stands and what someone
// without a seed is told (lib/sim's calendar: planting opened on 20 Oct, open to everyone, party link or not, since 21
// Oct; Lijas hands the seeds out at the party on 10 Nov, and planting closes after 10 Dec). Plain, warm, short
// sentences; people are named, never guessed at.
import { PLANT_CLOSE_H, dateOfHour, hourIndexOf } from "@/lib/sim";

export type Season = "open" | "closed";

/** The moment planting closes (11 Dec 00:00 IST), for timers. */
export const PLANTING_CLOSES_MS = dateOfHour(PLANT_CLOSE_H).getTime();

/** Where the planting season stands at this moment, by the same hours the server checks (lib/sim canPlant). */
export function seasonAt(now: Date = new Date()): Season {
  return hourIndexOf(now) < PLANT_CLOSE_H ? "open" : "closed";
}

/** When seasonAt next changes (planting closing), or null once it has. */
export function nextSeasonChangeMs(nowMs: number = Date.now()): number | null {
  return nowMs < PLANTING_CLOSES_MS ? PLANTING_CLOSES_MS : null;
}

/** Shown to someone without a garden once planting has closed (until then the door offers everyone the seed). */
export const SHOWCASE_LINE = "Planting closed on 10 December. The garden is here for you to enjoy.";
