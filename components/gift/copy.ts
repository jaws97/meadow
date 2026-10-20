// The words the gift flow uses more than once: whose gift it is, where the planting season stands and what someone
// without a seed is told (lib/sim's calendar: planting opened on 20 Oct for anyone with the party link, Lijas hands the
// seeds out at the party on 10 Nov, and planting closes after 10 Dec). Plain, warm, short sentences; people are named,
// never guessed at.
import { PLANT_CLOSE_H, dateOfHour, hourIndexOf } from "@/lib/sim";

/** The birthday committee member giving the seeds; their Enchanted Rose is the garden everyone sees first. */
export const OWNER = "Lijas";

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

/** Shown to people with no seed and no party link, by the season. */
export function showcaseLine(now: Date = new Date()): string {
  if (seasonAt(now) === "open") return "Seeds come with the party link. Ask a colleague to share it with you.";
  return "Planting closed on 10 December. The garden is here for you to enjoy.";
}
