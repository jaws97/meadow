// Agreed targets, part 3: over-watering and rain. Three cans a day show rot about day 1 and kill 4.5-5.5 days after the
// first can; a daily can through a wet week kills 4.5-5.5 days after its first heavy shower, whatever the hour of the
// can; rain alone does not rot a plant. Measured on recorded weather exactly as the prototype's run.mjs measures it, with
// the 3-10 Nov 2023 wet week (85 mm) grafted onto the game window, which has no week as wet.
import { describe, expect, it } from "vitest";
import { IDS, WK23_MM, YEARS, at, firstCan, graft, rainWindows, range, simulate, soakTimes } from "./__fixtures__/harness";

const inWindow = (a: number[]) => a.length > 0 && Math.min(...a) >= 4.45 && Math.max(...a) <= 5.55;

describe("targets: over-watering", () => {
  it("three cans a day: rot shows within 1.5 days, death 4.5-5.5 days after the first can (8 schedules)", () => {
    const SETS3 = [[8, 13, 18], [7, 12, 17], [9, 14, 19], [6, 12, 18], [8, 14, 20], [10, 15, 20], [7, 13, 21], [0, 8, 16]];
    for (const set of SETS3) {
      const t = YEARS.flatMap((y) => IDS.map((id) => soakTimes(simulate({ spId: id, year: y, policy: at((h, hod) => set.includes(hod)) }), firstCan(set))));
      const d = t.filter((x) => x !== null);
      expect(d.length, `${set} rot deaths`).toBe(18);
      expect(range(d.map((x) => x.death)), `${set} death days`).toSatisfy(([a, b]: number[]) => a >= 4.45 && b <= 5.55);
      expect(Math.max(...d.map((x) => x.rot ?? 9)), `${set} rot sign`).toBeLessThanOrEqual(1.5);
    }
  });

  it("one can a day through the wet week, at any of the 24 clock hours: death 4.5-5.5 days after its first heavy shower", () => {
    expect(WK23_MM).toBeCloseTo(84.8, 1);
    const bad: string[] = [];
    for (let hh = 0; hh < 24; hh++) {
      const d: number[] = [];
      for (const y of YEARS) {
        const g = graft(y, 3);
        for (const id of IDS) { const t = soakTimes(simulate({ spId: id, year: y, wxAt: g.wx, policy: at((h, hod) => hod === hh) }), g.anchor); if (t) d.push(t.death); }
      }
      if (d.length !== 18 || !inWindow(d)) bad.push(`${hh}:00 -> ${d.length} rot deaths, ${range(d).map((x) => x.toFixed(2)).join("-")} d`);
    }
    expect(bad).toEqual([]);
  });

  it("the same wet week on game days 1, 3, 5 or 7 (can at 09:00): death 4.5-5.5 days after the shower", () => {
    const d: number[] = [];
    for (const d0 of [1, 3, 5, 7]) for (const y of YEARS) {
      const g = graft(y, d0);
      for (const id of IDS) { const t = soakTimes(simulate({ spId: id, year: y, wxAt: g.wx, policy: at((h, hod) => hod === 9) }), g.anchor); if (t) d.push(t.death); }
    }
    expect(d).toHaveLength(72);
    expect(inWindow(d)).toBe(true);
  });
});

describe("targets: a rainy week with nobody watering (every 7-day window with >= 15 mm, and the grafted 85 mm week)", () => {
  let memo: ReturnType<typeof rainWindows> | null = null;
  const rw = () => (memo ??= rainWindows());

  it("rain alone never kills by rot, and every window with rain on 3 or more days survives (reworded target, awaiting sign-off)", () => {
    const r = rw();
    expect(r.n).toBe(156);
    expect(r.rot).toBe(0);
    expect(r.spread.n).toBe(114);
    expect(r.spread.deaths).toBe(0);
  });

  // KNOWN FAILURE carried over from the prototype: 10 plants die of drought in 2024 windows whose rain all fell on one or
  // two days. Kept as an expected failure so a fix (or a reworded target) is noticed: promote it to it() then.
  it.fails("strict wording: survives in every window", () => {
    expect(rw().bad).toEqual([]);
  });
});
