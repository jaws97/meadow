// The courtyard lotus drawn from the model (live/pondLook.ts), checked without a browser on a real season: a lotus
// grown under the pond model's good care (2025 weather), its numbers handed over as the garden store would get them
// (lib/client/plant pondShownOf). Its stages, leaf counts, flower clock, warmth and water follow the model; every
// floating leaf lies on open water; and the preview's own rules (look.ts) still hold for the frames it makes.
import { describe, expect, it } from "vitest";
import { onOpenWater } from "@/components/lotus/look";
import { BUD_GROWTH, flowerOpen, lotusDefaultLook, pondLookFromShown, pondStageOf, type LotusLookInput } from "@/components/lotus/live/pondLook";
import { pondShownOf, flowerSizeOf } from "@/lib/client/plantShown";
import { toVisualPond, type PondState } from "@/lib/sim";
import { goodCare, simulate, type Rec } from "@/lib/sim/__fixtures__/pond-harness";

const run = simulate({ year: 2025, policy: goodCare(), endH: 15 + 24 * 20 });
const input = (s: PondState, clock = s.hod): LotusLookInput => {
  const v = toVisualPond(s, null, clock);
  return { pond: pondShownOf(v), growth: v.growth, bloom: v.bloom, health: v.health, droop: v.droop, chlorosis: v.chlorosis, flowerSize: flowerSizeOf(v, s.gen), glow: v.glow, alive: v.alive };
};
const at = (fn: (x: Rec) => boolean) => run.rec.find(fn) as Rec;

describe("the courtyard lotus follows the model", () => {
  it("is a seed in its jar, its root out once it is ready", () => {
    const early = at((x) => x.s.stage === 0 && x.h === 30);
    const look = pondLookFromShown(input(early.s), 12, "Lijas");
    expect(look).toMatchObject({ frame: "pond", stage: "jar", glowAt: "seed", floating: [], standing: [] });
    expect(look.jar.show).toBe(true);
    const ready = at((x) => x.s.stage === 0 && x.v.moveReady);
    expect(pondLookFromShown(input(ready.s), 12, "Lijas").jar.root).toBe(1);
  });

  it("starts a planted seedling with a small coin leaf over its pot, spreading to the pond's full leaves", () => {
    const planted = at((x) => x.s.stage === 1);
    const first = pondLookFromShown(input(planted.s), 12, "Lijas");
    expect(first.floating.length).toBeGreaterThanOrEqual(1);
    for (const f of first.floating) {
      // a coin: a quarter of a grown leaf's size, wholly over the pot (radius 0.2 m)
      expect(f.r).toBeLessThan(0.04);
      expect(Math.hypot(f.x, f.z) + f.r).toBeLessThan(0.2);
    }
    const grown = at((x) => x.s.stage === 1 && x.v.growth >= 0.5);
    const later = pondLookFromShown(input(grown.s), 12, "Lijas");
    expect(Math.max(...later.floating.map((f) => f.r))).toBeGreaterThan(0.1);
  });

  it("draws as many floating and standing leaves as the model has, each floating leaf on open water", () => {
    let seenStanding = 0;
    for (const x of run.rec.filter((q) => q.s.stage === 1 && q.h % 12 === 0)) {
      const i = input(x.s), look = pondLookFromShown(i, 12, "Lijas");
      expect(look.floating.length, `h ${x.h}`).toBe(Math.min(8, Math.max(1, Math.round(i.pond.floatLeaves))));
      expect(look.standing.length, `h ${x.h}`).toBe(Math.min(3, Math.round(i.pond.aerialLeaves)));
      seenStanding = Math.max(seenStanding, look.standing.length);
      if (!i.pond.potIsolated) for (const f of look.floating) expect(onOpenWater(f), `h ${x.h}`).toBe(true);
      // the standing leaves stay low over the water (15-28 cm, the pond view's stalks)
      for (const s of look.standing) expect(s.top[1]).toBeLessThanOrEqual(0.25);
    }
    expect(seenStanding).toBe(3);
  });

  it("buds, then opens on three days by the model's clock: a goblet, a wide cup, widest; shut on the afternoons of days 1 and 2", () => {
    const bud = at((x) => x.s.D >= 1 && x.s.op === 0);
    const budLook = pondLookFromShown(input(bud.s), 2, "Lijas");
    expect(budLook.flower.kind).toBe("bud");
    expect(pondStageOf(input(bud.s))).toBe("bud");
    expect(input(bud.s).growth).toBeGreaterThanOrEqual(BUD_GROWTH);
    const peak = (day: number, clock: number) => {
      // the state at that clock hour of that flower day (the petals open through the morning)
      const x = at((q) => q.v.flowerDay === day && q.s.flN === 1 && q.s.hod === Math.floor(clock));
      return pondLookFromShown(input(x.s, clock), clock, "Lijas").flower;
    };
    expect(peak(1, 8.5).open).toBeCloseTo(Math.pow(input(at((q) => q.v.flowerDay === 1 && q.s.hod === 8).s, 8.5).bloom, 1.6), 9);
    expect(peak(1, 8.5).open).toBeGreaterThan(0.25);
    expect(peak(1, 8.5).open).toBeLessThan(peak(2, 8.5).open);
    expect(peak(2, 8.5).open).toBeLessThan(peak(3, 12).open);
    for (const d of [1, 2]) {
      const shut = peak(d, 16.5);
      expect(shut.open, `day ${d}`).toBeLessThan(0.06);
      expect(shut.morph, `day ${d}`).toBeGreaterThanOrEqual(0.3);
    }
    // day 3's petals fall in the evening
    const evening = peak(3, 21);
    expect(evening.fallen).toBeGreaterThan(0);
    expect(evening.relax).toBeGreaterThan(0.15);
  });

  it("glows only with the model's warmth, never on the pod", () => {
    for (const x of run.rec.filter((q) => q.s.D >= 0.9 && q.h % 3 === 0)) {
      const i = input(x.s), look = pondLookFromShown(i, x.s.hod, "Lijas");
      if (look.flower.kind === "bud" || look.flower.kind === "flower") expect(look.flower.warmth).toBeCloseTo(i.pond.warmth, 9);
      if (look.flower.kind === "pod") {
        expect(look.flower.warmth).toBe(0);
        expect(look.glowAt).toBe("none");
      }
    }
    expect(run.rec.some((q) => pondStageOf(input(q.s)) === "pod")).toBe(true);
  });

  it("shows the pond's level, the pot's own water under the rim, and the pot drying", () => {
    const x = at((q) => q.s.stage === 1 && q.h > 15 + 24 * 6);
    const base = input(x.s);
    expect(pondLookFromShown(base, 12, "Lijas").potWaterMM).toBeNull();
    const low = pondLookFromShown({ ...base, pond: { ...base.pond, waterMM: -40, potIsolated: true, stonesMM: 20 } }, 12, "Lijas");
    expect(low.waterMM).toBe(-40);
    expect(low.potWaterMM).toBe(-30);
    const dry = pondLookFromShown({ ...base, pond: { ...base.pond, waterMM: -90, potIsolated: true, potDry: true, stonesMM: 0, floatBrown: 0.8 } }, 12, "Lijas");
    expect(dry.potWaterMM).toBeNull();
    expect(dry.mudMoisture).toBeLessThan(0.6);
    expect(Math.max(...dry.floating.map((f) => f.brown))).toBeGreaterThan(0.5);
    const green = pondLookFromShown({ ...base, pond: { ...base.pond, algae: 0.6 } }, 12, "Lijas");
    expect(green.algae).toBe(0.6);
  });

  it("re-closes into a looser cup, as the page's flower does", () => {
    expect(flowerOpen(1, 3)).toEqual({ open: 1, morph: 1 });
    expect(flowerOpen(0.12, 2).morph).toBe(0.3);
    expect(flowerOpen(0, 0)).toEqual({ open: 0, morph: 0 });
  });

  it("opens on the preview's bloom at noon before any numbers arrive", () => {
    const look = lotusDefaultLook();
    expect(look).toMatchObject({ frame: "pond", stage: "bloom" });
    expect(look.flower.kind).toBe("flower");
  });
});
