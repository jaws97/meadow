import { describe, expect, it } from "vitest";
import { readSynthetic, syntheticFriend, syntheticSnapshot, SYNTHETIC_MAX } from "@/components/meadow/lod/synthetic";

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
    expect(s.plots.map((p) => p.plot)).toEqual(Array.from({ length: 400 }, (_, i) => i));
    expect(new Set(s.plots.map((p) => p.species)).size).toBe(6);
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

describe("syntheticFriend", () => {
  it("answers a visit with numbers that match the plant's stage", () => {
    const opts = { count: 40 };
    const plant = syntheticSnapshot(opts, 0).plots[7];
    const friend = syntheticFriend(7, opts)!;
    expect(friend.species).toBe(plant.species);
    expect(friend.stage).toBe(plant.stage);
    expect(friend.visual.alive).toBe(plant.stage !== "resting");
    expect(friend.visual.growth).toBeGreaterThan(0);
  });

  it("finds nothing past the made-up Meadow", () => {
    expect(syntheticFriend(40, { count: 40 })).toBeNull();
    expect(syntheticFriend(-1, { count: 40 })).toBeNull();
  });
});
