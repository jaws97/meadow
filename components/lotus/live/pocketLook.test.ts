// The lotus in a Meadow river pocket (live/pocketLook.ts): the urli's reading of the model on the pond's plant, always in
// full, clear water; and its floating leaves, which the Meadow's instanced pads (Plants.tsx) and the visit's full plant
// lay identically, every leaf on its pocket's shelf inside the sill stones.
import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { pocketLookFromVisual, pocketPads, STAND_LIFT, FLOWER_LIFT } from "@/components/lotus/live/pocketLook";
import { urliLookFromVisual, urliStageOf, type MeadowBand } from "@/components/lotus/live/urliLook";
import { POND_FLOWER, POND_STANDS } from "@/components/lotus/look";
import { meadowLayout } from "@/components/meadow/layout";
import { SPINS, spinOfPlot } from "@/components/meadow/lod/bands";
import { POCKET_HAND_REACH } from "@/components/meadow/lod/materials";
import { PLANT_SCALE } from "@/components/meadow/plantLook";
import { pocketReach } from "@/components/meadow/river";
import { toVisualPond, type PondVisual } from "@/lib/sim";
import { goodCare, simulate } from "@/lib/sim/__fixtures__/pond-harness";

const run = simulate({ year: 2024, policy: goodCare(), endH: 15 + 24 * 20 });
const visual = (fn: (v: PondVisual) => boolean, clock?: number): PondVisual => {
  const x = run.rec.find((q) => fn(q.v)) as (typeof run.rec)[number];
  return toVisualPond(x.s, null, clock);
};
const BANDS: readonly MeadowBand[] = ["sprout", "leafy", "bud", "bloom", "resting"];
const at = { index: 2003, turn: 0 };

describe("the pocket lotus's look", () => {
  it("reads the model as the urli's lotus does: the same stage for every band and visit", () => {
    for (const band of ["seed", ...BANDS] as MeadowBand[]) expect(pocketLookFromVisual(null, band, 12, "p", at).stage, band).toBe(urliLookFromVisual(null, band, 12, "p").stage);
    const pod = visual((v) => v.pod === 1 && v.flowerDay === 0);
    expect(pocketLookFromVisual(pod, "bloom", 12, "p", at).stage).toBe(urliStageOf(pod, "bloom"));
    expect(pocketLookFromVisual(pod, "bloom", 12, "p", at).flower.kind).toBe("pod");
    const day2 = visual((v) => v.flowerDay === 2, 8.5);
    const look = pocketLookFromVisual(day2, "bloom", 8.5, "p", at);
    expect(look.frame).toBe("pond");
    expect(look.flower.kind).toBe("flower");
    expect(look.flower.open).toBeCloseTo(Math.pow(day2.bloom, 1.6), 9);
    expect(look.flower.warmth).toBeCloseTo(day2.warmth, 9);
  });

  it("is always full and clear, whatever the friend's own pond is doing", () => {
    const v = visual((q) => q.stage === "pond" && q.aerialLeaves >= 2);
    for (const pond of [v, { ...v, potIsolated: true, potDry: false }, { ...v, potIsolated: true, potDry: true, moisture: 0.1 }, { ...v, algae: 0.9 }]) {
      const look = pocketLookFromVisual(pond, "leafy", 12, "p", at);
      expect(look.waterMM).toBe(0);
      expect(look.algae).toBe(0);
      expect(look.potWaterMM).toBeNull();
      for (const f of look.floating) expect(f.onMud).toBe(false);
    }
  });

  it("raises the standing leaves and the flower on pocket-length stalks, three leaves once it stands", () => {
    const look = pocketLookFromVisual(null, "bloom", 12, "p", at);
    expect(look.standing.length).toBe(3);
    look.standing.forEach((s, i) => expect(s.top[1]).toBeCloseTo(POND_STANDS[i].top[1] * STAND_LIFT * (1 - 0.05 * i), 6));
    expect(look.flower.head[1]).toBeCloseTo(POND_FLOWER.flower.head[1] * FLOWER_LIFT, 6);
    // the flower clears the coping (0.48 m over the water) at the Meadow's scale
    expect(look.flower.head[1] * PLANT_SCALE).toBeGreaterThan(0.85);
    expect(pocketLookFromVisual(null, "sprout", 12, "p", at).standing.length).toBe(0);
    expect(pocketLookFromVisual(null, "leafy", 12, "p", at).flower.kind).toBe("none");
  });

  it("browns a resting plant, with no flower and no light", () => {
    const look = pocketLookFromVisual(null, "resting", 21, "p", at);
    expect(look.flower.kind).toBe("none");
    expect(look.glowAt).toBe("none");
    expect(look.floating.length).toBeGreaterThan(0);
    for (const f of look.floating) expect(f.brown).toBeGreaterThanOrEqual(0.75);
  });
});

describe("the pocket's floating leaves", () => {
  it("lie on its shelf inside the sill stones, clear of each other, more as it grows", () => {
    for (const band of BANDS) {
      for (const index of [2000, 2017, 2033, 2055]) {
        const leaves = pocketPads(band, index);
        expect(leaves.length, band).toBeGreaterThanOrEqual(band === "sprout" || band === "resting" ? 6 : 9);
        for (const f of leaves) {
          // every point of the leaf's rim (pocket frame: x along the wall, z out from the lotus line, 0.55 m off the wall)
          for (let k = 0; k < 16; k++) {
            const a = (k / 16) * Math.PI * 2;
            const along = (f.x + Math.cos(a) * f.r) * PLANT_SCALE;
            const out = 0.55 + (f.z + Math.sin(a) * f.r) * PLANT_SCALE;
            expect(out).toBeGreaterThan(0.03);
            expect(out).toBeLessThan(pocketReach(along) - 0.1);
          }
        }
      }
    }
    expect(pocketPads("seed", 2000)).toEqual([]);
  });

  it("are the same leaves on the water for the instanced pads and the visit's full plant", () => {
    const L = meadowLayout();
    const up = new THREE.Vector3(0, 1, 0);
    for (const plot of L.plots.filter((p) => p.kind === "pocket")) {
      const yaw = plot.yaw!;
      const plant = SPINS[spinOfPlot(plot)];
      // the standing plant faces its channel to within one of the three angles
      expect(Math.abs(Math.atan2(Math.sin(plant - yaw), Math.cos(plant - yaw)))).toBeLessThanOrEqual(Math.PI / 3 + 1e-9);
      const pads = pocketPads("bloom", plot.index);
      const visit = pocketLookFromVisual(null, "bloom", 12, "p", { index: plot.index, turn: yaw - plant }).floating;
      expect(visit.length).toBe(pads.length);
      pads.forEach((f, i) => {
        const a = new THREE.Vector3(f.x, f.y, f.z).multiplyScalar(PLANT_SCALE).applyAxisAngle(up, yaw);
        const g = visit[i];
        const b = new THREE.Vector3(g.x, g.y, g.z).multiplyScalar(PLANT_SCALE).applyAxisAngle(up, plant);
        expect(a.distanceTo(b)).toBeLessThan(1e-9);
        expect(Math.cos(g.yaw + plant - (f.yaw + yaw))).toBeCloseTo(1, 9);
        // and in the water, on the pocket's side of the river
        const w = a.add(new THREE.Vector3(plot.x, 0, plot.z));
        const r = Math.hypot(w.x, w.z);
        expect(r).toBeGreaterThan(L.river.band.wIn);
        expect(r).toBeLessThan(L.river.band.wOut);
        expect(plot.bank === "in" ? r < L.river.band.mid : r > L.river.band.mid).toBe(true);
      });
    }
  });

  it("hand over to the visit exactly the visited pocket's own leaves: all within the handover's reach, no other's", () => {
    const L = meadowLayout();
    const up = new THREE.Vector3(0, 1, 0);
    const pockets = L.plots.filter((p) => p.kind === "pocket");
    for (const band of BANDS) {
      // every leaf centre on the water, as Plants.tsx lays them, with its pocket
      const leaves = pockets.flatMap((plot) =>
        pocketPads(band, plot.index).map((f) => ({ plot, w: new THREE.Vector3(f.x, 0, f.z).multiplyScalar(PLANT_SCALE).applyAxisAngle(up, plot.yaw!) })),
      );
      for (const plot of pockets) {
        for (const { plot: own, w } of leaves) {
          const d = Math.hypot(own.x + w.x - plot.x, own.z + w.z - plot.z);
          if (own === plot) expect(d, `${band} ${plot.index}`).toBeLessThan(POCKET_HAND_REACH - 0.15);
          else expect(d, `${band} ${plot.index} by ${own.index}`).toBeGreaterThan(POCKET_HAND_REACH + 0.15);
        }
      }
    }
  });
});
