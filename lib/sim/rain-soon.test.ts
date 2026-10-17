// The heavy-rain hint: rainSoon() reads the forecast rows the server already fetches and says when rain heavy enough to
// soak the bed by itself (BED.soakMM, as much as a can) is due within the next BED.soonH hours, so the app can say "heavy
// rain tonight; skip the can" and offer the rain cover. It must take parseHourly()'s rows as they come, treat gaps and
// junk as dry, and agree with the recorded season. The prototype's golden file holds the same cases (parity.test.ts).
import { describe, expect, it } from "vitest";
import { BED, rainSoon, type ForecastRow } from "./model";
import type { GameHourWeather } from "./weather";
import { rowsFor } from "./__fixtures__/harness";

const rows = (from: number, P: (number | null)[]): ForecastRow[] => P.map((p, k) => ({ h: from + k, wx: { P: p } }));

describe("rainSoon: is heavy rain due soon?", () => {
  it("looks 12 h ahead and calls 10 mm or more heavy, as much as a can", () => {
    expect(BED.soonH).toBe(12);
    expect(BED.soakMM).toBe(BED.can);
  });

  it("adds up the rain due in the window, to 0.1 mm, and says when it starts", () => {
    const r = rows(100, [0, 0, 0, 0, 0, 2, 3, 3, 2.5, 0, 0, 0, 9]);
    expect(rainSoon(r, 100)).toEqual({ heavy: true, mm: 10.5, startsInH: 5 });
    expect(rainSoon(r, 105)).toEqual({ heavy: true, mm: 19.5, startsInH: 0 });   // raining in the hour about to come
    expect(rainSoon(rows(0, [0.1, 0.2, 0.7]), 0)).toEqual({ heavy: false, mm: 1, startsInH: 0 });
  });

  it("light rain is not heavy, and rain before fromH or past the window does not count", () => {
    const r = rows(200, [5, 0, 1, 2, 3, 3.9, 0, 0, 0, 0, 0, 0, 0, 40]);
    expect(rainSoon(r, 201)).toEqual({ heavy: false, mm: 9.9, startsInH: 1 });
    expect(rainSoon(r, 201, 13)).toEqual({ heavy: true, mm: 49.9, startsInH: 1 });
    expect(rainSoon(r, 220)).toEqual({ heavy: false, mm: 0, startsInH: null });
  });

  it("the window defaults to 12 h; a fractional window rounds down, and a missing or invalid one falls back to 12", () => {
    const r = rows(0, [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1]);
    expect(rainSoon(r, 0).mm).toBe(12);
    expect(rainSoon(r, 0, 6.9).mm).toBe(6);
    expect(rainSoon(r, 0, 1).mm).toBe(1);
    for (const bad of [0, 0.5, -3, NaN, Infinity, null, undefined]) expect(rainSoon(r, 0, bad).mm, String(bad)).toBe(12);
  });

  it("counts hours with no row, or no usable rain value, as dry; a repeated hour counts once (the last row)", () => {
    const r = [
      { h: 10, wx: { P: 4 } }, { h: 11, wx: { P: null } }, { h: 12, wx: { P: "x" } }, { h: 13, wx: { P: -4 } }, { h: 14 }, null, undefined,
      { h: 15.5, wx: { P: 9 } }, { h: 16, wx: { P: 3 } }, { h: 16, wx: { P: 6.5 } }, { h: Number.NaN, wx: { P: 30 } }, { h: 9, wx: { P: 50 } },
    ] as (ForecastRow | null | undefined)[];
    expect(rainSoon(r, 10)).toEqual({ heavy: true, mm: 10.5, startsInH: 0 });
    expect(rainSoon(r, 11)).toEqual({ heavy: false, mm: 6.5, startsInH: 5 });
    expect(rainSoon([], 0)).toEqual({ heavy: false, mm: 0, startsInH: null });
    expect(rainSoon(null, 0)).toEqual({ heavy: false, mm: 0, startsInH: null });
    expect(rainSoon(r, Number.NaN)).toEqual({ heavy: false, mm: 0, startsInH: null });
  });

  it("takes weather.ts's forecast rows as they are, in any order, and never mutates them", () => {
    const fc: GameHourWeather[] = rowsFor(2024).map((wx, h) => ({ h, wx }));
    const shuffled = Object.freeze([...fc].reverse());
    for (let h = 0; h < fc.length; h += 7) expect(rainSoon(shuffled, h)).toEqual(rainSoon(fc, h));
  });

  it("agrees with the recorded 2024 season: every visit it flags is followed by at least 10 mm, and it flags cyclone Fengal", () => {
    const fc: GameHourWeather[] = rowsFor(2024).map((wx, h) => ({ h, wx }));
    let flagged = 0, missed = 0, fengal = false;
    for (let h = 15; h + BED.soonH <= fc.length; h++) {
      if (h % 24 !== 8 && h % 24 !== 18) continue;                       // the visits of the good-care player
      const due = fc.slice(h, h + BED.soonH).reduce((t, r) => t + r.wx.P, 0), r = rainSoon(fc, h);
      if (r.heavy) { flagged++; expect(due).toBeGreaterThanOrEqual(BED.soakMM - 0.05); }
      else if (due >= BED.soakMM + 0.05) missed++;
      if (r.heavy && h >= 24 * 20 && h < 24 * 24) fengal = true;          // 30 Nov - 3 Dec 2024
    }
    expect(flagged).toBeGreaterThan(0);
    expect(missed).toBe(0);
    expect(fengal).toBe(true);
  });
});
