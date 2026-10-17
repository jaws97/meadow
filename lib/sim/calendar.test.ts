// Game time: the IST anchor, the planting window and hour arithmetic around it.
import { describe, expect, it } from "vitest";
import {
  GAME_START_IST, GAME_START_MS, PLANT_CLOSE_H, PLANT_OPEN_H, TYPICAL_BLOOM_DAYS, canPlant, dateOfHour, dayOf, hod, hourIndexOf, istHour,
} from "./calendar";

describe("game clock", () => {
  it("starts at 10 Nov 2026 00:00 IST", () => {
    expect(GAME_START_IST).toBe("2026-11-10T00:00+05:30");
    expect(GAME_START_MS).toBe(Date.parse(GAME_START_IST));
    expect(GAME_START_MS).toBe(Date.parse("2026-11-09T18:30:00Z"));
    expect(dateOfHour(0).toISOString()).toBe("2026-11-09T18:30:00.000Z");
  });

  it("counts whole hours, rounding down, and converts to IST clock hours", () => {
    expect(hourIndexOf(new Date("2026-11-10T00:00:00+05:30"))).toBe(0);
    expect(hourIndexOf(new Date("2026-11-10T00:59:59.999+05:30"))).toBe(0);
    expect(hourIndexOf(new Date("2026-11-09T23:30:00+05:30"))).toBe(-1);
    expect(hod(-1)).toBe(23);
    const nineAm = new Date("2026-11-24T03:30:00Z");               // 09:00 IST, two weeks in
    expect(hourIndexOf(nineAm)).toBe(14 * 24 + 9);
    expect(hod(hourIndexOf(nineAm))).toBe(9);
    expect(dayOf(hourIndexOf(nineAm))).toBe(14);
    for (const h of [-30, 0, 15, 354, 743, 1000]) {
      expect(hourIndexOf(dateOfHour(h))).toBe(h);
      expect(hourIndexOf(new Date(dateOfHour(h + 1).getTime() - 1))).toBe(h);
    }
    expect(istHour(2026, 11, 10, 15)).toBe(15);
    expect(istHour(2026, 12, 11)).toBe(744);
  });

  it("opens planting at the party, 10 Nov 15:00 IST, and closes it after 10 Dec 23:59", () => {
    expect(PLANT_OPEN_H).toBe(hourIndexOf(new Date("2026-11-10T15:00:00+05:30")));
    expect(canPlant(hourIndexOf(new Date("2026-11-10T14:59:00+05:30")))).toBe(false);
    expect(canPlant(hourIndexOf(new Date("2026-11-10T15:00:00+05:30")))).toBe(true);
    expect(canPlant(hourIndexOf(new Date("2026-12-10T23:59:59+05:30")))).toBe(true);
    expect(PLANT_CLOSE_H).toBe(hourIndexOf(new Date("2026-12-11T00:00:00+05:30")));
    expect(canPlant(PLANT_CLOSE_H)).toBe(false);
    expect([-1, 0, 14, 15, 16, 400, 743, 744, 745].map(canPlant)).toEqual([false, false, false, true, true, true, true, false, false]);
  });

  it("names the typical bloom day for copy only", () => {
    expect(TYPICAL_BLOOM_DAYS).toBe(14);
  });
});
