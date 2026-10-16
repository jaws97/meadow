// Agreed targets, part 1: bloom timing. Every flower keeps its own clock from its own planting hour and aims at dusk on
// day 14 after planting; there is no shared bloom, a late planter gets the same full-size chance, and how each plant is
// looked after decides the rest. Measured on recorded Bangalore weather (2023-25, game window) exactly as the prototype's
// run.mjs measures it, so future tuning cannot quietly break the agreed behaviour.
import { describe, expect, it } from "vitest";
import { hodOf } from "./model";
import { IDS, MEAN, PARTY, YEARS, bloomOf, everyN, goodCare, idealCare, simulate, type Bloom } from "./__fixtures__/harness";

describe("targets: bloom timing", () => {
  it("good care in mean 2023-25 weather blooms at dusk (18:00) on day 14 after planting, every species", () => {
    for (const id of IDS) {
      const b = bloomOf(simulate({ spId: id, wxAt: (h) => MEAN[h], policy: goodCare() }));
      expect(b, id).not.toBeNull();
      expect(Math.floor((b as Bloom).days), id).toBe(14);
      expect(hodOf((b as Bloom).at), id).toBe(18);
    }
  });

  it("even ideal care cannot bloom much before 13 days (the ideal twin, mean weather)", () => {
    for (const id of IDS) {
      const b = bloomOf(simulate({ spId: id, wxAt: (h) => MEAN[h], policy: idealCare(PARTY) }));
      expect(b?.days ?? 0, id).toBeGreaterThanOrEqual(12.9);
    }
  });

  it("planted at the party, 3 days later or 7 days later: good care blooms 13-15 days after its own planting, at full size", () => {
    const bad: string[] = [];
    for (const off of [0, 3, 7]) for (const y of YEARS) for (const id of IDS) {
      const b = bloomOf(simulate({ spId: id, year: y, plantH: PARTY + 24 * off, policy: goodCare() }));
      if (!b || b.days < 12.9 || b.days > 15.1 || b.flower < 0.9 || b.size < 0.9) bad.push(`${id} ${y} +${off} d: ${JSON.stringify(b)}`);
    }
    expect(bad).toEqual([]);
  });

  it("late planters follow the same rules: planted on any day 0-22, good care blooms at full size", () => {
    const bad: string[] = [];
    for (const y of YEARS) for (const id of IDS) for (let d = 0; d <= 22; d++) {
      const b = bloomOf(simulate({ spId: id, year: y, plantH: PARTY + 24 * d, policy: goodCare() }));
      if (!b || b.flower < 0.85 || b.size < 0.85) bad.push(`${id} ${y} day ${d}: ${JSON.stringify(b)}`);
    }
    expect(bad).toEqual([]);
  });

  it("a can only every 3 days blooms several days later, with a smaller flower in most cases", () => {
    let smaller = 0;
    const bad: string[] = [];
    for (const y of YEARS) for (const id of IDS) {
      const g = bloomOf(simulate({ spId: id, year: y, policy: goodCare() })), b = bloomOf(simulate({ spId: id, year: y, policy: everyN(3) }));
      if (!g || !b) { bad.push(`${id} ${y}: no bloom`); continue; }
      const delay = b.days - g.days;
      if (delay < 2 || delay > 10.05) bad.push(`${id} ${y}: ${delay.toFixed(2)} d later`);
      if (b.flower < g.flower - 0.02) smaller++;
    }
    expect(bad).toEqual([]);
    // the prototype's line, met exactly today (12 of 18): a rainy 2023 rescues the every-third-day flowers
    expect(smaller).toBeGreaterThanOrEqual(12);
  });

  it("abandoned from planting dies before it can bloom", () => {
    for (const y of YEARS) for (const id of IDS) {
      const r = simulate({ spId: id, year: y, policy: null });
      expect(r.s.alive, `${id} ${y} alive`).toBe(false);
      expect(bloomOf(r), `${id} ${y} bloom`).toBeNull();
      expect(r.rec.some((x) => x.s.bloomH > 0), `${id} ${y} ever bloomed`).toBe(false);
    }
  });
});
