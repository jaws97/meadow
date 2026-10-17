import { describe, expect, it } from "vitest";
import { CELLS, HEIGHTS, TRIANGLES } from "@/components/meadow/lod/atlasManifest";
import { bakeLodPlant } from "@/components/meadow/lod/bake";
import { bandOf, BANDS, cellIndex, CELL_COUNT, LOD_SPECIES, SPINS } from "@/components/meadow/lod/bands";

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
