// The posed plant (pose.ts) carries a lily's stem of flowers as the garden draws it (components/garden/Plant.tsx): the
// three flowers and the tip bud, the later flowers opening on the bloom clock (every one open when the look has none),
// and the head it reports is the lead flower's, below the tip. A flower that grows alone keeps its one head. Flower
// after flower, the petals let go through a flower's last evening and the next bud starts small.
import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { lodDetail } from "@/components/meadow/lod/bake";
import { posePlant, type PartMaterials, type PlantLook } from "@/components/meadow/lod/pose";
import { SPECIES } from "@/lib/plant/species";

const tags: PartMaterials<string> = {
  stem: (i, n) => (i === n - 1 ? "top" : "stem"),
  leaf: () => "leaf",
  petiole: () => "petiole",
  thorn: () => "thorn",
  sepal: () => "sepal",
  bud: () => "bud",
  petal: () => "petal",
  stamen: () => "stamen",
  stigma: () => "stigma",
};

const pose = (look: Partial<PlantLook>) =>
  posePlant({ speciesId: "lily", seed: "typical-199", growth: 1, bloom: 1, health: 1, moisture: 0.6, scorch: 0, ...look }, lodDetail(SPECIES[look.speciesId ?? "lily"]), tags);
const count = (parts: { material: string }[], m: string) => parts.filter((p) => p.material === m).length;
/** A lily has no sepals: each head's receptacle is its one "sepal" part. */
const heads = (parts: { material: string }[]) => count(parts, "sepal");

describe("a lily's stem of flowers, posed", () => {
  it("draws three flowers on stalks and the bud at the tip", () => {
    const posed = pose({});
    expect(heads(posed.parts)).toBe(4);
    for (const g of posed.own) g.dispose();
  });

  it("opens the later flowers on the bloom clock, and all of them with no clock", () => {
    // each open flower has its style (the light plant draws a share of the anthers, the style always)
    const flowersOpen = (opened: number | null | undefined) => {
      const posed = pose({ opened });
      for (const g of posed.own) g.dispose();
      return count(posed.parts, "stigma");
    };
    expect(flowersOpen(null)).toBe(1);
    expect(flowersOpen(2)).toBe(1);
    expect(flowersOpen(26)).toBe(2);
    expect(flowersOpen(50)).toBe(3);
    expect(flowersOpen(undefined)).toBe(3);
  });

  it("keeps every bud closed before the bloom, and reports the lead's head below the tip", () => {
    const bud = pose({ growth: 0.8, bloom: 0, opened: null });
    expect(count(bud.parts, "stamen") + count(bud.parts, "stigma")).toBe(0);
    expect(count(bud.parts, "bud")).toBe(4);
    const open = pose({});
    const top = Math.max(...open.parts.filter((p) => p.material === "top").map((p) => p.matrix.elements[13]));
    expect(open.head.y).toBeLessThan(top);
    expect(open.head.y).toBeGreaterThan(SPECIES.lily.stem.height * 0.5);
    for (const g of [...bud.own, ...open.own]) g.dispose();
  });

  it("follows the growing tip before the lead's bud shows", () => {
    const young = pose({ growth: 0.2, bloom: 0, opened: null });
    // only the tip is drawn: the flowers' stalks have not grown out
    expect(heads(young.parts)).toBe(1);
    const tipY = young.parts.filter((p) => p.material === "sepal").map((p) => p.matrix.elements[13])[0];
    expect(young.head.y).toBeGreaterThan(tipY);
    for (const g of young.own) g.dispose();
  });
});

describe("a flower that grows alone", () => {
  it("keeps its one head, whatever the clock says", () => {
    for (const opened of [null, 2, undefined]) {
      const posed = pose({ speciesId: "rose", seed: "Lijas", opened });
      expect(count(posed.parts, "sepal")).toBe(1 + SPECIES.rose.flower.sepals.count);
      for (const g of posed.own) g.dispose();
    }
  });
});

describe("the light plant's stamens", () => {
  it("shares the anthers it may draw among a lily's open flowers, and draws every one with no cap", () => {
    const anthers = (look: Partial<PlantLook>, stamens: number) => {
      const posed = posePlant(
        { speciesId: "lily", seed: "typical-199", growth: 1, bloom: 1, health: 1, moisture: 0.6, scorch: 0, ...look },
        { ...lodDetail(SPECIES.lily), stamens },
        tags,
      );
      for (const g of posed.own) g.dispose();
      return count(posed.parts, "stamen");
    };
    const perFlower = SPECIES.lily.flower.center.stamens;
    expect(anthers({}, Infinity)).toBe(3 * perFlower);
    expect(anthers({}, 8)).toBeLessThan(3 * perFlower);
    expect(anthers({}, 8)).toBeGreaterThanOrEqual(3);
  });
});

describe("a jasmine's cluster, posed", () => {
  const jas = (look: Partial<PlantLook>) =>
    posePlant({ speciesId: "jasmine", seed: "typical-2", growth: 1, bloom: 1, health: 1, moisture: 0.6, scorch: 0, ...look }, lodDetail(SPECIES.jasmine), tags);
  const r = SPECIES.jasmine.raceme!;
  const heads = r.flowers + (r.buds ?? 0) + 1;

  it("opens its flowers one a night among buds that stay closed", () => {
    // every head not open shows its bud's core
    const closedHeads = (opened: number | null | undefined) => {
      const posed = jas({ opened });
      for (const g of posed.own) g.dispose();
      return count(posed.parts, "bud");
    };
    expect(closedHeads(null)).toBe(heads - 1);
    expect(closedHeads(2)).toBe(heads - 1);
    expect(closedHeads(26)).toBe(heads - 2);
    expect(closedHeads(50)).toBe(heads - 3);
    expect(closedHeads(undefined)).toBe(heads - r.flowers);
    const bud = jas({ growth: 0.8, bloom: 0, opened: null });
    expect(count(bud.parts, "bud")).toBe(heads);
    expect(count(bud.parts, "stamen")).toBe(0);
    for (const g of bud.own) g.dispose();
  });
});

describe("flower after flower, posed as the garden draws it", () => {
  const rose = (look: Partial<PlantLook>) => {
    const posed = pose({ speciesId: "rose", seed: "typical-78", ...look });
    for (const g of posed.own) g.dispose();
    return posed.parts;
  };

  it("lets the petals go through a flower's last evening", () => {
    const all = count(rose({}), "petal");
    const half = count(rose({ shed: 0.5 }), "petal");
    expect(half).toBeGreaterThan(0);
    expect(half).toBeLessThan(all);
    expect(count(rose({ shed: 1 }), "petal")).toBe(0);
  });

  it("shows the next bud small between flowers, swelling as it grows", () => {
    const budSize = (rebud: number) => {
      const core = rose({ bloom: 0, rebud }).find((p) => p.material === "bud");
      return core ? new THREE.Vector3().setFromMatrixScale(core.matrix).x : 0;
    };
    expect(budSize(0.2)).toBeGreaterThan(0);
    expect(budSize(0.2)).toBeLessThan(budSize(0.7));
    // with no next bud, the grown plant's own full bud
    expect(budSize(0.7)).toBeLessThan(budSize(0));
  });
});
