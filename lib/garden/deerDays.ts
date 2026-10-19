// When the doe visits a garden (components/deer). Decided once, as the garden page loads, so on a visit her code is
// fetched and her shaders compile behind the loading veil with everything else, and on any other visit she costs
// nothing at all.
//
// The design the owner chose: two deer days a week for each person, picked from their seed (so a reload never
// re-rolls her, and their phone and laptop agree), never two days running; she comes in the cool of the morning
// (about 06:00-08:45 in Bangalore) or of the evening (about 16:00-18:45), when chital really feed and the garden's
// light is at its best; at most once a day; and a promise: anyone who has opened their garden on three days without
// seeing her finds her there on their next evening visit, deer day or not. No counters, no badges: she is a gift,
// never a thing to collect or to miss.
//
// Pure functions, so the calendar is tested in node; the page keeps the little memory (the day she was last seen and
// the days visited since) on the device, as it keeps the last plant shown.
import { Rng } from "@/lib/plant/prng";

/** Bangalore is UTC+5:30 all year. */
const IST_MS = 5.5 * 3600 * 1000;
const DAY_MS = 86400 * 1000;

export type DeerWindow = "morning" | "evening";

/** The cool hours she comes in, as minutes after midnight IST, start inclusive, end exclusive. */
export const DEER_WINDOWS: Readonly<Record<DeerWindow, readonly [number, number]>> = {
  morning: [6 * 60, 8 * 60 + 45],
  evening: [16 * 60, 18 * 60 + 45],
};

/** Visit-days without a sighting after which she keeps the promise on the next evening visit. */
export const PROMISE_AFTER = 3;

/** A day in Bangalore: its index (days since 1970-01-01 IST), its name (YYYY-MM-DD) and the minute of the day. */
export function istDay(ms: number): { index: number; name: string; minutes: number } {
  const t = ms + IST_MS;
  const index = Math.floor(t / DAY_MS);
  const name = new Date(index * DAY_MS).toISOString().slice(0, 10);
  const minutes = Math.floor((t - index * DAY_MS) / 60000);
  return { index, name, minutes };
}

/** Which of her windows a minute of the day falls in, if any. */
export function windowAt(minutes: number): DeerWindow | null {
  for (const w of ["morning", "evening"] as const) {
    const [a, b] = DEER_WINDOWS[w];
    if (minutes >= a && minutes < b) return w;
  }
  return null;
}

/** The two deer days (0-6) of a week for a person: picked from their seed, never adjacent. */
export function deerDaysOfWeek(seed: string, week: number): readonly [number, number] {
  const rng = new Rng(`${seed}|deer|${week}`);
  const a = rng.int(0, 6);
  const others = [0, 1, 2, 3, 4, 5, 6].filter((d) => Math.abs(d - a) > 1);
  const b = rng.pick(others);
  return a < b ? [a, b] : [b, a];
}

/** Whether a day (its IST index) is one of a person's deer days. Weeks run from Monday. */
export function isDeerDay(seed: string, dayIndex: number): boolean {
  // 1970-01-01 was a Thursday: shift so each week starts on a Monday
  const shifted = dayIndex + 3;
  const week = Math.floor(shifted / 7);
  const day = shifted - week * 7;
  return deerDaysOfWeek(seed, week).includes(day);
}

/** What the device remembers: the day she was last seen, and the days the garden was opened since. */
export interface DeerMemory {
  lastSeen: string | null;
  visitDays: readonly string[];
}

export const NO_DEER_MEMORY: DeerMemory = { lastSeen: null, visitDays: [] };

export type DeerVisit =
  | { visit: true; window: DeerWindow | null; why: "deer-day" | "promise" | "forced" }
  | { visit: false; why: "off" | "outside-window" | "seen-today" | "not-today" };

/**
 * Whether she is in the garden now. `force` is the page's ?deer=1 (always) or ?deer=0 (never), for the owner's own
 * checks; otherwise the calendar, the windows, once a day, and the promise.
 */
export function decideVisit(seed: string, nowMs: number, memory: DeerMemory, force: boolean | null = null): DeerVisit {
  const day = istDay(nowMs);
  const window = windowAt(day.minutes);
  if (force === true) return { visit: true, window, why: "forced" };
  if (force === false) return { visit: false, why: "off" };
  if (!window) return { visit: false, why: "outside-window" };
  if (memory.lastSeen === day.name) return { visit: false, why: "seen-today" };
  if (isDeerDay(seed, day.index)) return { visit: true, window, why: "deer-day" };
  const daysWithout = memory.visitDays.filter((d) => d !== day.name).length;
  if (window === "evening" && daysWithout >= PROMISE_AFTER) return { visit: true, window, why: "promise" };
  return { visit: false, why: "not-today" };
}

/** The memory after opening the garden today: today counted as a visit-day, or, if she was there, as her day. */
export function rememberDay(memory: DeerMemory, nowMs: number, saw: boolean): DeerMemory {
  const today = istDay(nowMs).name;
  if (saw) return { lastSeen: today, visitDays: [] };
  // her day already, or counted already
  if (memory.lastSeen === today || memory.visitDays.includes(today)) return memory;
  return { lastSeen: memory.lastSeen, visitDays: [...memory.visitDays, today].slice(-14) };
}
