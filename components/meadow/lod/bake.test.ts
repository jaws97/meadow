import { describe, expect, it } from "vitest";
import { CELLS, HEIGHTS, TRIANGLES } from "@/components/meadow/lod/atlasManifest";
import { bakeLodPlant } from "@/components/meadow/lod/bake";
import * as THREE from "three";
import { makeLotusPlot } from "@/components/lotus/lod";
import { bandOf, BANDS, cellIndex, CELL_COUNT, LOD_REACH, LOD_SPECIES, plotTilt, plotTurn, SPINS, plotSpin } from "@/components/meadow/lod/bands";

describe("light plants", () => {
  for (const species of LOD_SPECIES) {
    it(`builds ${species} in every band within the triangle budget`, () => {
      for (const band of BANDS) {
        const p = bakeLodPlant(species, band);
        expect(p.triangles).toBeGreaterThan(50);
        expect(p.triangles).toBeLessThan(2500);
        for (const name of ["position", "normal", "color", "glow"]) expect(p.geometry.attributes[name]).toBeDefined();
        expect(p.height).toBeGreaterThan(0.1);
        p.geometry.dispose();
      }
    });
  }

  // The atlas in public/meadow/ is a picture of these very plants: if this fails, the plants' look changed and the
  // atlas is stale. Rebake it with `node scripts/bake-meadow-plants.mjs`.
  it("match the baked atlas", () => {
    for (const species of LOD_SPECIES) {
      for (const band of BANDS) {
        const p = bakeLodPlant(species, band);
        expect(p.triangles).toBe(TRIANGLES[species][band]);
        expect(p.height).toBeCloseTo(HEIGHTS[species][band], 3);
        p.geometry.dispose();
      }
    }
  });
});

describe("bands", () => {
  it("draws a closed flower as its bud and leaves seeds and resting plants to Plants.tsx", () => {
    expect(bandOf({ stage: "bloom", bloom: 2 })).toBe("bloom");
    expect(bandOf({ stage: "bloom", bloom: 0 })).toBe("bud");
    expect(bandOf({ stage: "seed", bloom: 0 })).toBeNull();
    expect(bandOf({ stage: "resting", bloom: 0 })).toBeNull();
  });

  it("gives every species, band and angle its own atlas cell", () => {
    const seen = new Set<number>();
    for (const species of LOD_SPECIES) for (const band of BANDS) SPINS.forEach((_, s) => seen.add(cellIndex(species, band, s)));
    expect(seen.size).toBe(CELL_COUNT);
    expect(CELLS.length).toBe(CELL_COUNT);
    expect(Math.max(...seen)).toBe(CELL_COUNT - 1);
  });
});

describe("the lotus in its urli", () => {
  it("stands its light plant's urli on the soil, as wide as its levels are chosen by", () => {
    for (const band of BANDS) {
      const p = bakeLodPlant("lotus", band);
      const box = p.geometry.boundingBox!;
      expect(box.min.y, band).toBeCloseTo(0, 6);
      // the urli across (its standing leaves reach past it)
      expect(box.max.x - box.min.x, band).toBeGreaterThan(LOD_REACH.lotus! - 0.005);
      if (band === "sprout") expect(box.max.x - box.min.x).toBeCloseTo(LOD_REACH.lotus!, 2);
      p.geometry.dispose();
    }
  });

  it("draws its plot's cheap urli light: a seed of light over the water, browned leaves at rest", () => {
    for (const kind of ["seed", "pads", "resting"] as const) {
      const g = makeLotusPlot(kind);
      g.computeBoundingBox();
      expect(g.boundingBox!.min.y, kind).toBeCloseTo(0, 6);
      expect(g.attributes.position.count / 3, kind).toBeLessThan(600);
      const glow = Array.from((g.attributes.glow as THREE.BufferAttribute).array);
      // only the seed glows (the Meadow's seed material lights it at night)
      expect(Math.max(...glow), kind).toBe(kind === "seed" ? 1 : 0);
      g.dispose();
    }
  });

  it("stands level whatever its health, turned to its plot's angle", () => {
    const tilt = plotTilt(7, 1.2, true, true, undefined, true);
    expect(tilt.toArray()).toEqual([0, 1, 0]);
    const turn = plotTurn(7, 1.2, true, true, undefined, true);
    const spin = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), SPINS[plotSpin(7)]);
    expect(turn.angleTo(spin)).toBeCloseTo(0, 6);
  });
});
