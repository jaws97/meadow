// The device's little memory of the doe (lib/garden/deerDays): the day she was last seen here and the days the garden
// was opened since, for the once-a-day rule and the promise. In localStorage, a convenience only: without it she still
// keeps to her calendar, and at worst the promise starts counting again. Read and written in the browser only.
import { NO_DEER_MEMORY, type DeerMemory } from "@/lib/garden/deerDays";

const KEY = "garden.deer.v1";
const DAY = /^\d{4}-\d{2}-\d{2}$/;

export function readDeerMemory(): DeerMemory {
  try {
    const raw = JSON.parse(window.localStorage.getItem(KEY) ?? "null") as Partial<DeerMemory> | null;
    if (!raw || typeof raw !== "object") return NO_DEER_MEMORY;
    const lastSeen = typeof raw.lastSeen === "string" && DAY.test(raw.lastSeen) ? raw.lastSeen : null;
    const visitDays = Array.isArray(raw.visitDays) ? raw.visitDays.filter((d): d is string => typeof d === "string" && DAY.test(d)).slice(-14) : [];
    return { lastSeen, visitDays };
  } catch {
    return NO_DEER_MEMORY;
  }
}

export function writeDeerMemory(memory: DeerMemory): void {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(memory));
  } catch {
    // private browsing or full storage: she keeps to her calendar without it
  }
}

/** The page's own switch for the owner's checks: ?deer=1 brings her now, ?deer=0 keeps her away; otherwise null. */
export function deerOverride(search: string): boolean | null {
  const v = new URLSearchParams(search).get("deer");
  return v === "1" ? true : v === "0" ? false : null;
}
