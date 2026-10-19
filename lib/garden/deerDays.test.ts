import { describe, expect, it } from "vitest";
import { decideVisit, deerDaysOfWeek, isDeerDay, istDay, NO_DEER_MEMORY, rememberDay, windowAt } from "@/lib/garden/deerDays";

/** A moment in Bangalore: a date and an IST time. */
const ist = (date: string, hh: number, mm = 0) => Date.parse(`${date}T${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}:00+05:30`);

describe("the deer calendar", () => {
  it("gives each person two deer days a week, never two days running", () => {
    for (const seed of ["Lijas", "Asha", "Ravi", "Meera", "A friend"]) {
      for (let week = 2900; week < 2960; week++) {
        const [a, b] = deerDaysOfWeek(seed, week);
        expect(b - a).toBeGreaterThan(1);
        expect(a).toBeGreaterThanOrEqual(0);
        expect(b).toBeLessThanOrEqual(6);
      }
    }
  });

  it("picks the same days for the same person on every device, and different days for different people", () => {
    const days = (seed: string) => Array.from({ length: 28 }, (_, i) => isDeerDay(seed, 20400 + i));
    expect(days("Lijas")).toEqual(days("Lijas"));
    expect(days("Lijas").filter(Boolean)).toHaveLength(8);
    expect(days("Lijas")).not.toEqual(days("Asha"));
  });

  it("reads days and minutes in Bangalore time", () => {
    const d = istDay(ist("2026-11-10", 17, 30));
    expect(d.name).toBe("2026-11-10");
    expect(d.minutes).toBe(17 * 60 + 30);
    // a minute after midnight in Bangalore is still the previous evening in UTC
    expect(istDay(ist("2026-11-11", 0, 1)).name).toBe("2026-11-11");
  });

  it("comes only in the cool hours of the morning and the evening", () => {
    expect(windowAt(5 * 60 + 59)).toBeNull();
    expect(windowAt(6 * 60)).toBe("morning");
    expect(windowAt(8 * 60 + 44)).toBe("morning");
    expect(windowAt(8 * 60 + 45)).toBeNull();
    expect(windowAt(12 * 60)).toBeNull();
    expect(windowAt(16 * 60)).toBe("evening");
    expect(windowAt(18 * 60 + 45)).toBeNull();
  });
});

describe("whether she is there", () => {
  const seed = "Lijas";
  // find this person's next deer day and next ordinary day from the party on
  const party = istDay(ist("2026-11-10", 12)).index;
  const deerDay = Array.from({ length: 14 }, (_, i) => party + i).find((d) => isDeerDay(seed, d))!;
  const plainDay = Array.from({ length: 14 }, (_, i) => party + i).find((d) => !isDeerDay(seed, d))!;
  const at = (dayIndex: number, hh: number, mm = 0) => dayIndex * 86400000 - 5.5 * 3600000 + (hh * 60 + mm) * 60000;

  it("is there on a deer day, in a window, until she has been seen that day", () => {
    expect(decideVisit(seed, at(deerDay, 17, 10), NO_DEER_MEMORY)).toMatchObject({ visit: true, why: "deer-day", window: "evening" });
    expect(decideVisit(seed, at(deerDay, 7, 0), NO_DEER_MEMORY)).toMatchObject({ visit: true, window: "morning" });
    expect(decideVisit(seed, at(deerDay, 12, 0), NO_DEER_MEMORY)).toMatchObject({ visit: false, why: "outside-window" });
    const seen = rememberDay(NO_DEER_MEMORY, at(deerDay, 7, 0), true);
    expect(decideVisit(seed, at(deerDay, 17, 10), seen)).toMatchObject({ visit: false, why: "seen-today" });
  });

  it("is not there on an ordinary day", () => {
    expect(decideVisit(seed, at(plainDay, 17, 10), NO_DEER_MEMORY)).toMatchObject({ visit: false, why: "not-today" });
  });

  it("keeps the promise on the next evening visit after three days without her", () => {
    let memory = NO_DEER_MEMORY;
    for (const d of [plainDay - 5, plainDay - 3, plainDay - 1]) memory = rememberDay(memory, at(d, 13, 0), false);
    // the promise is for the evening, not the morning
    if (!isDeerDay(seed, plainDay)) {
      expect(decideVisit(seed, at(plainDay, 7, 0), memory)).toMatchObject({ visit: false });
      expect(decideVisit(seed, at(plainDay, 17, 0), memory)).toMatchObject({ visit: true, why: "promise" });
    }
    // and once she has been seen the count starts again
    memory = rememberDay(memory, at(plainDay, 17, 0), true);
    expect(memory.visitDays).toHaveLength(0);
  });

  it("counts a day once however often the garden is opened", () => {
    let memory = NO_DEER_MEMORY;
    for (let h = 9; h < 20; h++) memory = rememberDay(memory, at(plainDay, h), false);
    expect(memory.visitDays).toHaveLength(1);
  });

  it("does not count the day she was seen as a day without her", () => {
    let memory = rememberDay(NO_DEER_MEMORY, at(plainDay, 7, 0), true);
    memory = rememberDay(memory, at(plainDay, 19, 0), false);
    expect(memory.visitDays).toHaveLength(0);
  });

  it("can be forced on or off for the owner's own checks", () => {
    expect(decideVisit(seed, at(plainDay, 13, 0), NO_DEER_MEMORY, true)).toMatchObject({ visit: true, why: "forced" });
    expect(decideVisit(seed, at(deerDay, 17, 0), NO_DEER_MEMORY, false)).toMatchObject({ visit: false, why: "off" });
  });
});
