// Agreed targets, part 2: the drought clock and good care. An abandoned plant droops about day 2, yellows about day 3
// and dies 5.5-6.5 days after its last can (the window's highest-demand days may be a day faster); a weekend away
// survives, costing about a day of bud development; good care keeps a plant healthy. Measured on recorded weather
// exactly as the prototype's run.mjs measures it.
import { beforeAll, describe, expect, it } from "vitest";
import { IDS, PARTY, YEARS, bloomOf, dryAll, goodCare, range, simulate, weekendStats, type DryKey } from "./__fixtures__/harness";

const TYPICAL: DryKey[] = ["syn", "r2023", "r2024", "r2025"];

describe("targets: abandonment (last can, then nobody; every species, every last-can hour)", () => {
  const res = {} as Record<DryKey, ReturnType<typeof dryAll>>;
  beforeAll(() => { for (const k of [...TYPICAL, "hot"] as DryKey[]) res[k] = dryAll(k); });

  it("every abandoned plant dies", () => {
    for (const k of Object.keys(res) as DryKey[]) expect(res[k].alive, k).toBe(0);
  });

  it("typical dry spells: droop about day 2, yellowing about day 3, death 5.5-6.5 days after the last can", () => {
    for (const k of TYPICAL) {
      const [d0, d1] = range(res[k].death), [y0, y1] = range(res[k].yellow), [p0, p1] = range(res[k].droop);
      expect(d0, `${k} earliest death`).toBeGreaterThanOrEqual(5.45);
      expect(d1, `${k} latest death`).toBeLessThanOrEqual(6.55);
      expect(y0, `${k} earliest yellowing`).toBeGreaterThanOrEqual(2.4);
      expect(y1, `${k} latest yellowing`).toBeLessThanOrEqual(3.6);
      expect(p0, `${k} earliest droop`).toBeGreaterThanOrEqual(1);
      expect(p1, `${k} latest droop`).toBeLessThanOrEqual(3.1);
    }
  });

  it("the highest-demand days are at most a day faster", () => {
    expect(Math.min(...res.hot.death)).toBeGreaterThanOrEqual(4.45);
  });
});

describe("targets: a weekend away (Fri 18:00 to Mon 09:00, every weekend of the window)", () => {
  let wk: ReturnType<typeof weekendStats>;
  beforeAll(() => { wk = weekendStats(); });

  it("survives", () => {
    expect(wk.n).toBe(360);
    expect(wk.deaths).toBe(0);
  });

  it("delays bud maturity by about a day on average when it is dry", () => {
    const d = wk.delaysDry.map((x) => x.d), mean = d.reduce((a, b) => a + b, 0) / d.length;
    expect(d.length).toBeGreaterThan(100);
    expect(mean).toBeGreaterThanOrEqual(0.5);
    expect(mean).toBeLessThanOrEqual(1.5);
  });
});

describe("targets: good care", () => {
  it("keeps health at or above 0.85 at bloom, planted on any day 0-22", () => {
    const bad: string[] = [];
    for (const y of YEARS) for (let d = 0; d <= 22; d++) for (const id of IDS) {
      const r = simulate({ spId: id, year: y, plantH: PARTY + 24 * d, policy: goodCare(), endH: PARTY + 24 * d + 24 * 16 });
      const b = bloomOf(r), health = b ? b.health : r.rec[r.rec.length - 1].v.health;
      if (health < 0.85) bad.push(`${id} ${y} day ${d}: ${health.toFixed(3)}`);
    }
    expect(bad).toEqual([]);
  });
});
