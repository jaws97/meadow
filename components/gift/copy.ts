// The words the gift flow uses more than once: whose gift it is, where the planting season stands and what someone
// without a seed is told (lib/sim's calendar: seeds go out at the party, 10 Nov 15:00 IST, and planting closes after
// 10 Dec). Plain, warm, short sentences; people are named, never guessed at.
import { GAME_START_MS, IST_OFFSET_MIN, PLANT_CLOSE_H, PLANT_OPEN_H, dateOfHour, hourIndexOf } from "@/lib/sim";

/** The birthday committee member giving the seeds; their Enchanted Rose is the garden everyone sees first. */
export const OWNER = "Lijas";

export type Season = "early" | "open" | "closed";

/** Where the planting season stands at this moment, by the same hours the server checks (lib/server/rules.ts). */
export function seasonAt(now: Date = new Date()): Season {
  const h = hourIndexOf(now);
  if (h < PLANT_OPEN_H) return "early";
  if (h < PLANT_CLOSE_H) return "open";
  return "closed";
}

/** The moment seeds open (10 Nov, 15:00 IST), for timers. */
export const SEEDS_OPEN_MS = dateOfHour(PLANT_OPEN_H).getTime();

/**
 * The season the gift's welcome step follows on the live site. Until the game clock starts (10 Nov 00:00 IST) the
 * server takes practice plantings from anyone with the party link (lib/server/env.ts), so the step is open; on 10 Nov
 * it waits for 15:00 as the server does, and after 10 Dec it is closed.
 */
export function giftSeasonAt(now: Date = new Date()): Season {
  return now.getTime() < GAME_START_MS ? "open" : seasonAt(now);
}

/** When giftSeasonAt next changes (the game clock's start, then seeds opening), or null once it no longer will before 10 Dec. */
export function nextGiftSeasonChangeMs(nowMs: number = Date.now()): number | null {
  if (nowMs < GAME_START_MS) return GAME_START_MS;
  if (nowMs < SEEDS_OPEN_MS) return SEEDS_OPEN_MS;
  return null;
}

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

/** "3 pm on 10 November": when seeds open, in Bangalore time, from PLANT_OPEN_H. */
export function seedsOpenText(): string {
  const d = new Date(SEEDS_OPEN_MS + IST_OFFSET_MIN * 60_000);
  const h24 = d.getUTCHours();
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  return `${h12} ${h24 < 12 ? "am" : "pm"} on ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`;
}

/** Shown to people with no seed and no party link, by the season. */
export function showcaseLine(now: Date = new Date()): string {
  const season = seasonAt(now);
  if (season === "early") return "Seeds are handed out at the party on 10 November.";
  if (season === "open") return "Seeds come with the party link. Ask a colleague to share it with you.";
  return "Planting closed on 10 December. The garden is here for you to enjoy.";
}
