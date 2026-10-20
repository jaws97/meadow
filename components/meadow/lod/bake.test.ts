import { describe, expect, it } from "vitest";
import { CELLS, HEIGHTS, TRIANGLES } from "@/components/meadow/lod/atlasManifest";
import { bakeLodPlant } from "@/components/meadow/lod/bake";
import * as THREE from "three";
import { makeLotusPlot, pocketPadGeometry } from "@/components/lotus/lod";
import { bandOf, BANDS, cellIndex, CELL_COUNT, hasLight, LOD_KINDS, LOD_REACH, LOD_SPECIES, plotTilt, plotTurn, pocketSpin, SPINS, plotSpin } from "@/components/meadow/lod/bands";

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
    for (const kind of LOD_KINDS) {
      for (const band of BANDS) {
        if (!hasLight(kind, band)) {
          expect(TRIANGLES[kind][band]).toBe(0);
          continue;
        }
        const p = bakeLodPlant(kind, band);
        expect(p.triangles).toBe(TRIANGLES[kind][band]);
        expect(p.height).toBeCloseTo(HEIGHTS[kind][band], 3);
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

  it("gives every kind, band and angle its own atlas cell, the river's lotus appended last", () => {
    const seen = new Set<number>();
    for (const kind of LOD_KINDS) for (const band of BANDS) SPINS.forEach((_, s) => seen.add(cellIndex(kind, band, s)));
    expect(seen.size).toBe(CELL_COUNT);
    expect(CELL_COUNT).toBe(108);
    expect(CELLS.length).toBe(CELL_COUNT);
    expect(Math.max(...seen)).toBe(CELL_COUNT - 1);
    // the eight species fill the first 96 cells, a row of twelve each in the picker's order, and the river's lotus the last
    for (const species of LOD_SPECIES) for (const band of BANDS) expect(cellIndex(species, band, 0)).toBeLessThan(96);
    expect(cellIndex("lily", "sprout", 0)).toBe(72);
    expect(cellIndex("lotus", "sprout", 0)).toBe(84);
    expect(cellIndex("lotusRiver", "sprout", 0)).toBe(96);
    // a kind with no light plant in a band has an empty cell, never drawn
    expect(CELLS[cellIndex("lotusRiver", "sprout", 1)].every((v) => v === 0)).toBe(true);
  });
});

describe("the lotus in a river pocket", () => {
  it("stands its light plant on the water, no urli and no floating leaves, within 700 triangles", () => {
    expect(hasLight("lotusRiver", "sprout")).toBe(false);
    expect(() => bakeLodPlant("lotusRiver", "sprout")).toThrow();
    for (const band of ["leafy", "bud", "bloom"] as const) {
      const p = bakeLodPlant("lotusRiver", band);
      expect(p.triangles, band).toBeLessThanOrEqual(700);
      expect(p.triangles, band).toBeGreaterThan(100);
      const box = p.geometry.boundingBox!;
      // nothing under the water (its stalks start at the surface) and nothing lying on it: the lowest leaf stands well up
      expect(box.min.y, band).toBeGreaterThan(-0.01);
      const pos = p.geometry.attributes.position as THREE.BufferAttribute;
      const col = p.geometry.attributes.color as THREE.BufferAttribute;
      const brass = new THREE.Color("#a9843f"), slate = new THREE.Color("#3a4b55");
      for (let i = 0; i < pos.count; i++) {
        const c = new THREE.Color(col.getX(i), col.getY(i), col.getZ(i));
        expect(c.equals(brass) || c.equals(slate), band).toBe(false);
      }
      // a bud or a flower stands about 0.9 m over the water at the Meadow's scale (above the coping's 0.48)
      if (band !== "leafy") expect(p.head.y * 1.3, band).toBeGreaterThan(0.85);
      p.geometry.dispose();
    }
  });

  it("turns its standing plant to the angle nearest to facing its channel, and draws its leaves on the water as one instanced leaf", () => {
    expect(SPINS[pocketSpin(0.1)]).toBe(0);
    expect(SPINS[pocketSpin(2.0)]).toBeCloseTo((2 * Math.PI) / 3, 9);
    expect(SPINS[pocketSpin(-1.5)]).toBeCloseTo((4 * Math.PI) / 3, 9);
    const pad = pocketPadGeometry();
    pad.computeBoundingBox();
    expect(pad.attributes.position.count / 3).toBeLessThanOrEqual(40);
    expect(pad.boundingBox!.max.x).toBeCloseTo(1, 1);
    expect(Math.abs(pad.boundingBox!.min.y)).toBeLessThan(0.02);
    pad.dispose();
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
