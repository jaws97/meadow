// The Meadow's urli lotus drawn from the snapshot's band and, on a visit, the friend's PondVisual (live/urliLook.ts).
import { describe, expect, it } from "vitest";
import { URLI, waterR } from "@/components/lotus/frame";
import { timeOfDay, urliLookFromVisual, urliStageOf, type MeadowBand } from "@/components/lotus/live/urliLook";
import { toVisualPond, type PondVisual } from "@/lib/sim";
import { goodCare, simulate } from "@/lib/sim/__fixtures__/pond-harness";

const run = simulate({ year: 2024, policy: goodCare(), endH: 15 + 24 * 20 });
const visual = (fn: (v: PondVisual) => boolean, clock?: number): PondVisual => {
  const x = run.rec.find((q) => fn(q.v)) as (typeof run.rec)[number];
  return toVisualPond(x.s, null, clock);
};

describe("the Meadow's urli lotus", () => {
  it("reads the band on the far plots, with the water at the fill line", () => {
    const want: Record<MeadowBand, string> = { seed: "jar", sprout: "floating", leafy: "aerial", bud: "bud", bloom: "bloom", resting: "floating" };
    for (const [band, stage] of Object.entries(want) as [MeadowBand, string][]) {
      const look = urliLookFromVisual(null, band, 12, "plot-4");
      expect(look.frame, band).toBe("urli");
      expect(look.stage, band).toBe(stage);
      expect(look.waterMM, band).toBe(URLI.fillMM);
    }
  });

  it("on a visit, follows the friend's lotus: the pod, the flower's own opening and warmth", () => {
    const pod = visual((v) => v.pod === 1 && v.flowerDay === 0);
    expect(urliStageOf(pod, "bloom")).toBe("pod");
    expect(urliLookFromVisual(pod, "bloom", 12, "p").flower.kind).toBe("pod");
    const day2 = visual((v) => v.flowerDay === 2, 8.5);
    const look = urliLookFromVisual(day2, "bloom", 8.5, "p");
    expect(look.flower.kind).toBe("flower");
    expect(look.flower.open).toBeCloseTo(Math.pow(day2.bloom, 1.6), 9);
    expect(look.flower.warmth).toBeCloseTo(day2.warmth, 9);
  });

  it("runs low when the friend's pond is under the pot's rim, and bares the mud when the pot has dried", () => {
    const v = visual((q) => q.stage === "pond" && q.aerialLeaves >= 2);
    const low = urliLookFromVisual({ ...v, potIsolated: true, potDry: false }, "leafy", 12, "p");
    expect(low.waterMM).toBeLessThan(URLI.fillMM);
    for (const f of low.floating) expect(Math.hypot(f.x, f.z) + f.r * Math.cos(f.tilt)).toBeLessThanOrEqual(waterR(low.waterMM) + 1e-6);
    const dry = urliLookFromVisual({ ...v, potIsolated: true, potDry: true, moisture: 0.2 }, "leafy", 12, "p");
    expect(dry.waterMM).toBe(0);
    expect(dry.mudMoisture).toBeCloseTo(0.2, 9);
  });

  it("keeps a resting lotus's leaves, browned, with no flower and no light", () => {
    const look = urliLookFromVisual(null, "resting", 21, "p");
    expect(look.flower.kind).toBe("none");
    expect(look.glowAt).toBe("none");
    expect(look.floating.length).toBeGreaterThan(0);
    for (const f of look.floating) expect(f.brown).toBeGreaterThanOrEqual(0.75);
  });

  it("knows the time of day from the clock", () => {
    expect([5, 12, 17, 18.5, 22, 1].map(timeOfDay)).toEqual(["predawn", "noon", "golden", "dusk", "night", "night"]);
  });
});
