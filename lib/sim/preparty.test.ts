// Real plants planted before the party. Planting opened on 20 Oct for anyone with the party link, so a plant can live
// its first weeks at negative game hours (h counts from 10 Nov 00:00 IST) and bloom before the party. The model must
// treat those hours like any others: the same growth as a plant planted at the party in the same weather, bloom and
// ripening hours that stay where they happened (the "not yet" marks sit below the planting hour, model.ts createPlant),
// a sensible forecast, and Fairy Dust and a second-chance sprout before 10 Nov.
import { describe, expect, it } from "vitest";
import type { SoilSpeciesId } from "@/lib/plant/species";
import { CLIM_T } from "./climate";
import { MEAN, NH, OWNER, goodCare, simulate, type Run } from "./__fixtures__/harness";
import { PLANT_CLOSE_H, canPlant, createPlant as createSoil, expectBloom, step as stepSoil, type HourWeather } from "./model";
import { bloomedAt, createPlant, diedAt, ripeAt, step } from "./plant";
import { POND_NONE } from "./pond";

/** 20 Oct 10:00 IST, the first real planting on the live site, and the same clock hour 21 days later. */
const EARLY = -494;
const SHIFT = 21 * 24;
const LATE = EARLY + SHIFT;
/** the fixture's November weather, relabelled so that hour EARLY reads the row LATE does */
const shifted = (h: number): HourWeather | undefined => MEAN[h + SHIFT];

const SPECIES: readonly SoilSpeciesId[] = ["rose", "sundrop", "magnolia", "marigold", "island", "jasmine"];
const HOURS = Math.min(24 * 30, NH - LATE);

function pair(id: SoilSpeciesId): { early: Run; late: Run } {
  const early = simulate({ spId: id, plantH: EARLY, endH: EARLY + HOURS, policy: goodCare(), wxAt: shifted });
  const late = simulate({ spId: id, plantH: LATE, endH: LATE + HOURS, policy: goodCare(), wxAt: (h) => MEAN[h] });
  return { early, late };
}

describe("a plant planted before the party", () => {
  it("grows hour for hour like one planted at the party in the same weather, across 10 Nov", () => {
    for (const id of SPECIES) {
      const { early, late } = pair(id);
      expect(early.rec.length, id).toBe(HOURS);
      expect(early.rec.at(-1)!.h, `${id} runs past 10 Nov`).toBeGreaterThan(0);
      for (let i = 0; i < HOURS; i += 7) {
        const a = early.rec[i].s, b = late.rec[i].s;
        const at = `${id} hour ${i}`;
        expect(a.h - b.h, at).toBe(-SHIFT);
        expect([a.alive, a.gen, a.D, a.B, a.W, a.op, a.Sc, a.budS], at).toEqual([b.alive, b.gen, b.D, b.B, b.W, b.op, b.Sc, b.budS]);
        expect(ripeAt(a) === null ? null : ripeAt(a)! + SHIFT, `${at} ripe`).toBe(ripeAt(b));
        expect(bloomedAt(a) === null ? null : bloomedAt(a)! + SHIFT, `${at} bloom`).toBe(bloomedAt(b));
      }
    }
  });

  it("keeps the hour it bloomed, before the party, instead of moving it on", () => {
    for (const id of SPECIES) {
      const { early } = pair(id);
      const first = early.rec.find((x) => bloomedAt(x.s) !== null);
      expect(first, `${id} blooms`).toBeDefined();
      const bloom = bloomedAt(first!.s)!;
      expect(bloom, `${id} blooms before 10 Nov`).toBeLessThan(0);
      const days = (bloom - EARLY) / 24;
      expect(days, `${id} days to bloom`).toBeGreaterThan(12);
      expect(days, `${id} days to bloom`).toBeLessThan(16);
      for (const x of early.rec.filter((r) => r.h > first!.h && r.s.gen === first!.s.gen)) expect(bloomedAt(x.s), `${id} at h ${x.h}`).toBe(bloom);
    }
  });

  it("is told about when it will bloom, as a plant planted at the party is", () => {
    for (const id of SPECIES) {
      const { early, late } = pair(id);
      const f = expectBloom(createSoil(id, EARLY, OWNER), null, { h: EARLY, climT: CLIM_T })!;
      const g = expectBloom(createSoil(id, LATE, OWNER), null, { h: LATE, climT: CLIM_T })!;
      expect(f.days, id).not.toBeNull();
      // the first week before 10 Nov reads the mean daily cycle of the table's first week (model.ts climAt)
      expect(Math.abs(f.days! - g.days!), `${id} forecast like the party's`).toBeLessThan(1);
      const bloom = early.rec.map((x) => bloomedAt(x.s)).find((b) => b !== null)!;
      expect(Math.abs(f.bloomH - bloom) / 24, `${id} forecast near the real bloom`).toBeLessThan(1.5);
      expect(late.rec.length).toBe(HOURS);
    }
  });

  it("starts with every \"not yet\" mark below its planting hour", () => {
    const s = createSoil("rose", EARLY, OWNER);
    for (const mark of [s.ripeH, s.bloomH, s.diedH]) expect(mark).toBeLessThan(EARLY);
    expect(s.lastCanH).toBeLessThanOrEqual(EARLY - 99);
    expect(s.lastFeedH).toBeLessThanOrEqual(EARLY - 99);
    expect(bloomedAt(s)).toBeNull();
    expect(ripeAt(s)).toBeNull();
    expect(diedAt(s)).toBeNull();
    // a planting on or after 10 Nov keeps the prototype's marks exactly
    const p = createSoil("rose", 15, OWNER);
    expect([p.ripeH, p.bloomH, p.diedH, p.lastCanH, p.lastFeedH, p.budDropDay]).toEqual([-1, -1, -1, -99, -99, -1]);
  });

  it("can be woken with Fairy Dust and replanted before the party, in a bed or a pond", () => {
    expect(canPlant(EARLY)).toBe(true);
    expect(canPlant(PLANT_CLOSE_H)).toBe(false);
    const wx = MEAN[10];
    // a soil plant asleep for the second time, a week before the party
    let s = { ...createSoil("marigold", EARLY, OWNER), alive: false, fairyUsed: true, diedH: -200 };
    s = stepSoil(s, { h: -168, wx }, [{ kind: "replant" }]);
    expect(s.alive).toBe(true);
    expect(s.gen).toBe(2);
    expect(s.plantedH).toBe(-168);
    expect(diedAt(s)).toBeNull();
    // a lotus the same
    const lotus = createPlant("lotus", EARLY, OWNER);
    let p = step({ ...lotus, alive: false, fairyUsed: true }, { h: -168, wx }, [{ kind: "replant" }]);
    expect(p.alive).toBe(true);
    expect(p.gen).toBe(2);
    expect(p.bloomH).toBe(POND_NONE);
    // Fairy Dust on the first sleep
    p = step({ ...lotus, alive: false, fairyUsed: false }, { h: -300, wx }, [{ kind: "revive" }]);
    expect(p.alive).toBe(true);
    expect(p.fairyUsed).toBe(true);
  });
});
