import { describe, expect, it } from "vitest";
import { LOD_SPECIES } from "@/components/meadow/lod/bands";
import { readSynthetic, syntheticFriend, syntheticSnapshot, SYNTHETIC_MAX } from "@/components/meadow/lod/synthetic";
import type { PondVisual } from "@/lib/sim";
import { POCKET_COUNT, WATER_BASE, isPocketIndex } from "@/lib/server/plots";

const range = (n: number, from = 0) => Array.from({ length: n }, (_, i) => from + i);

describe("readSynthetic", () => {
  it("reads a count and an optional stage", () => {
    expect(readSynthetic("?synthetic=400")).toEqual({ count: 400, stage: undefined });
    expect(readSynthetic("?dev&synthetic=120&stage=bloom")).toEqual({ count: 120, stage: "bloom" });
  });

  it("ignores anything else", () => {
    expect(readSynthetic("?plot=3")).toBeNull();
    expect(readSynthetic("?synthetic=lots")).toBeNull();
    expect(readSynthetic("?synthetic=-4")).toBeNull();
    expect(readSynthetic("?synthetic=10&stage=huge")).toEqual({ count: 10, stage: undefined });
    expect(readSynthetic("?synthetic=9999")?.count).toBe(SYNTHETIC_MAX);
  });

  it("reads &same=1 (visits grow from the detail levels' seed)", () => {
    expect(readSynthetic("?synthetic=40&same=1")).toEqual({ count: 40, stage: undefined, same: true });
  });
});

describe("syntheticSnapshot", () => {
  it("fills the first plots with a mix of species, stages and health", () => {
    const s = syntheticSnapshot({ count: 400 }, 0);
    expect(s.count).toBe(400);
    // the first bed plots, and the river's first pockets, each once
    const beds = s.plots.filter((p) => !isPocketIndex(p.plot)).map((p) => p.plot).sort((a, b) => a - b);
    const pockets = s.plots.filter((p) => isPocketIndex(p.plot)).map((p) => p.plot).sort((a, b) => a - b);
    expect(beds).toEqual(range(beds.length));
    expect(pockets).toEqual(range(pockets.length, WATER_BASE));
    expect(beds.length + pockets.length).toBe(400);
    expect(new Set(s.plots.map((p) => p.species)).size).toBe(LOD_SPECIES.length);
    expect(new Set(s.plots.map((p) => p.stage))).toEqual(new Set(["seed", "sprout", "leafy", "bud", "bloom", "resting"]));
    expect(new Set(s.plots.map((p) => p.health))).toEqual(new Set(["thriving", "fine", "poorly", "resting"]));
    for (const p of s.plots) {
      expect(p.health === "resting").toBe(p.stage === "resting");
      if (p.stage !== "bloom") expect(p.bloom).toBe(0);
    }
  });

  it("is the same Meadow every time", () => {
    expect(syntheticSnapshot({ count: 50 }, 0)).toEqual(syntheticSnapshot({ count: 50 }, 0));
  });

  it("puts every plant in full bloom when asked", () => {
    const s = syntheticSnapshot({ count: 30, stage: "bloom" }, 0);
    expect(s.plots.every((p) => p.stage === "bloom" && p.bloom === 3)).toBe(true);
  });
});

describe("a made-up Meadow's lotus", () => {
  it("sows them into the river's pockets in order, and once all 56 are taken into bed plots' urlis", () => {
    for (const count of [120, 300, 480, 720]) {
      const plots = syntheticSnapshot({ count }, 0).plots;
      const lotus = plots.filter((p) => p.species === "lotus");
      const inPockets = lotus.slice(0, POCKET_COUNT);
      expect(inPockets.map((p) => p.plot)).toEqual(range(inPockets.length, WATER_BASE));
      expect(lotus.slice(POCKET_COUNT).every((p) => !isPocketIndex(p.plot))).toBe(true);
      // nothing but a lotus in a pocket
      expect(plots.filter((p) => isPocketIndex(p.plot)).every((p) => p.species === "lotus")).toBe(true);
    }
    // with eight species to sow, ?synthetic=300 sows its lotus all into the river, 480 fills every pocket, and 490 puts
    // the next two lotus in urlis
    const lotusOf = (count: number) => syntheticSnapshot({ count }, 0).plots.filter((p) => p.species === "lotus");
    expect(lotusOf(300).every((p) => isPocketIndex(p.plot))).toBe(true);
    expect(lotusOf(480).length).toBe(POCKET_COUNT);
    expect(lotusOf(480).every((p) => isPocketIndex(p.plot))).toBe(true);
    expect(lotusOf(490).filter((p) => !isPocketIndex(p.plot)).length).toBe(2);
  });
});

describe("syntheticFriend", () => {
  it("answers a visit with numbers that match the plant's stage", () => {
    const opts = { count: 40 };
    const plant = syntheticSnapshot(opts, 0).plots[7];
    const friend = syntheticFriend(plant.plot, opts)!;
    expect(friend.species).toBe(plant.species);
    expect(friend.stage).toBe(plant.stage);
    expect(friend.visual.alive).toBe(plant.stage !== "resting");
    expect(friend.visual.growth).toBeGreaterThan(0);
  });

  it("answers a lotus in the river by its pocket", () => {
    const opts = { count: 40 };
    const lotus = syntheticSnapshot(opts, 0).plots.find((p) => isPocketIndex(p.plot))!;
    expect(syntheticFriend(lotus.plot, opts)).toMatchObject({ plot: lotus.plot, species: "lotus" });
  });

  it("finds nothing where nobody was sown", () => {
    const opts = { count: 40 };
    const beds = syntheticSnapshot(opts, 0).plots.filter((p) => !isPocketIndex(p.plot)).length;
    expect(syntheticFriend(beds, opts)).toBeNull();
    expect(syntheticFriend(-1, opts)).toBeNull();
    expect(syntheticFriend(WATER_BASE + POCKET_COUNT - 1, opts)).toBeNull();
  });
});

describe("a made-up lotus", () => {
  const opts = { count: 720 };
  const plots = syntheticSnapshot(opts, 0).plots.filter((p) => p.species === "lotus");
  const visual = (stage: string, health?: string) => {
    const p = plots.find((q) => q.stage === stage && (!health || q.health === health))!;
    return syntheticFriend(p.plot, opts)!.visual as PondVisual;
  };

  it("is answered with a lotus's numbers at every stage", () => {
    expect(new Set(plots.map((p) => p.stage))).toEqual(new Set(["seed", "sprout", "leafy", "bud", "bloom", "resting"]));
    for (const p of plots) expect(syntheticFriend(p.plot, opts)!.visual).toMatchObject({ medium: "pond" });
    expect(visual("seed").stage).toBe("jar");
    expect(visual("sprout")).toMatchObject({ stage: "pond", aerialLeaves: 0 });
    expect(visual("leafy").aerialLeaves).toBeGreaterThan(0);
    expect(visual("resting").alive).toBe(false);
  });

  it("has fallen below its pot when it is poorly", () => {
    expect(visual("leafy", "poorly")).toMatchObject({ potIsolated: true, potDry: false });
    expect(visual("leafy", "thriving").potIsolated).toBe(false);
  });
});
