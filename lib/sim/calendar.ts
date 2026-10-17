// Game time. The model counts whole hours from GAME_START_IST, 10 Nov 2026 00:00 IST (the day of the party), so hour
// index h covers [h, h + 1) and its IST clock hour is h % 24. India keeps no daylight saving, so every game day is 24 h
// and hour arithmetic is exact. This is the only part of lib/sim that touches Date: the model works on hour indexes alone.
//
// The seeds are handed out at the party (PLANT_OPEN_H, 10 Nov 15:00 IST) and planting closes after 10 Dec 23:59
// (PLANT_CLOSE_H). Each plant then keeps its own clock: under good care its bud matures about 13.25 days after its own
// planting and opens at the flower's natural hour (the next morning, or dusk for Night Jasmine), so it blooms 13-15 days
// (about TYPICAL_BLOOM_DAYS) after planting. Nothing steers a plant toward that number; it is for copy and expectations.
import { GAME_START, PLANT_CLOSE_H, PLANT_OPEN_H, canPlant, hodOf } from "./model";

export { PLANT_OPEN_H, PLANT_CLOSE_H, canPlant };

/** h = 0: 10 Nov 2026 00:00 IST. */
export const GAME_START_IST = GAME_START;
export const HOUR_MS = 3_600_000;
/** India Standard Time, UTC+05:30, all year. */
export const IST_OFFSET_MIN = 330;
/** GAME_START_IST as epoch milliseconds (2026-11-09T18:30:00Z). */
export const GAME_START_MS = Date.UTC(2026, 10, 10) - IST_OFFSET_MIN * 60_000;
/** Good care blooms about this many days after planting (13-15). Informational only: nothing steers toward it. */
export const TYPICAL_BLOOM_DAYS = 14;

/**
 * The game hour a moment falls in: whole hours since GAME_START_IST, rounded down (negative before the start). Pass
 * hourIndexOf(new Date()) as toH to catchUp() to step every completed hour and no more.
 */
export function hourIndexOf(date: Date): number {
  return Math.floor((date.getTime() - GAME_START_MS) / HOUR_MS);
}

/** The moment game hour h starts. */
export function dateOfHour(h: number): Date {
  return new Date(GAME_START_MS + h * HOUR_MS);
}

/** IST clock hour (0..23) of game hour h. */
export function hod(h: number): number {
  return hodOf(h);
}

/** Game day of hour h: day 0 is 10 Nov, day 1 is 11 Nov, and so on (IST midnights). */
export function dayOf(h: number): number {
  return Math.floor(h / 24);
}

/** The game hour at a given IST wall-clock time, for copy and tests: istHour(2026, 11, 10, 15) === PLANT_OPEN_H. */
export function istHour(year: number, month: number, day: number, hour = 0): number {
  return Math.round((Date.UTC(year, month - 1, day, hour) - IST_OFFSET_MIN * 60_000 - GAME_START_MS) / HOUR_MS);
}
