// What the Meadow says of a lotus (its stages in its own words, and its own lines said of it) and of a bed flower's
// flowers, one after another.
import { describe, expect, it } from "vitest";
import { syntheticFriend, syntheticSnapshot } from "@/components/meadow/lod/synthetic";
import { moodLine, stageWord } from "@/components/meadow/words";
import { POND_LINES, type PondVisual, type SoilVisual } from "@/lib/sim";
import type { FriendGarden } from "@/lib/server/meadow";

/** The first made-up lotus at `stage` (and health) in a Meadow of 720. */
function lotusAt(stage: FriendGarden["stage"], health?: FriendGarden["health"]): FriendGarden {
  const opts = { count: 720 };
  const p = syntheticSnapshot(opts, 0).plots.find((q) => q.species === "lotus" && q.stage === stage && (!health || q.health === health));
  if (!p) throw new Error(`no made-up lotus ${stage} ${health ?? ""}`);
  return syntheticFriend(p.plot, opts)!;
}

const NOON = Date.UTC(2026, 10, 12, 6, 30);

/** The first made-up bed flower of `species` in bloom, in a Meadow of 720. */
function soilAt(species: FriendGarden["species"]): FriendGarden & { visual: SoilVisual } {
  const opts = { count: 720 };
  const p = syntheticSnapshot(opts, 0).plots.find((q) => q.species === species && q.stage === "bloom" && q.health !== "poorly");
  if (!p) throw new Error(`no made-up ${species} in bloom`);
  return syntheticFriend(p.plot, opts)! as FriendGarden & { visual: SoilVisual };
}

describe("stageWord", () => {
  it("names a lotus's stages as a lotus grows them", () => {
    const word = (stage: FriendGarden["stage"], bloom: 0 | 1 | 2 | 3 = 0) => stageWord({ species: "lotus", stage, bloom });
    expect(word("seed")).toBe("in its jar");
    expect(word("sprout")).toBe("floating leaves");
    expect(word("leafy")).toBe("standing leaves");
    expect(word("bud")).toBe("in bud");
    expect(word("bloom", 3)).toBe("in bloom");
    expect(word("resting")).toBe("resting");
  });

  it("does not guess a closed flower from a seed pod on the snapshot alone; a visit tells them apart", () => {
    expect(stageWord({ species: "lotus", stage: "bloom", bloom: 0 })).toBe("has flowered");
    const pod = lotusAt("bloom");
    const v = pod.visual as PondVisual;
    expect(stageWord({ species: "lotus", stage: "bloom", bloom: 0 }, { ...v, flowerDay: 0, pod: 1 })).toBe("a seed pod");
    expect(stageWord({ species: "lotus", stage: "bloom", bloom: 0 }, { ...v, flowerDay: 2, pod: 0 })).toBe("in bloom");
  });

  it("leaves the soil flowers' words as they were", () => {
    expect(stageWord({ species: "rose", stage: "sprout", bloom: 0 })).toBe("a sprout");
    expect(stageWord({ species: "jasmine", stage: "leafy", bloom: 0 })).toBe("growing");
    expect(stageWord({ species: "marigold", stage: "bloom", bloom: 0 })).toBe("in bloom");
  });

  it("knows a bed flower's new bud between flowers from a visit", () => {
    const rose = soilAt("rose");
    expect(stageWord({ species: "rose", stage: "bloom", bloom: 0 }, { ...rose.visual, bloom: 0, rebud: 0.3 } as SoilVisual)).toBe("a new bud");
    expect(stageWord({ species: "rose", stage: "bloom", bloom: 3 }, rose.visual)).toBe("in bloom");
  });
});

describe("moodLine for a bed flower, flower after flower", () => {
  it("says its last day, its falling petals, the next bud and the next flower", () => {
    const rose = soilAt("rose");
    const at = (v: Partial<SoilVisual>) => moodLine({ ...rose, visual: { ...(rose.visual as SoilVisual), ...v } }, NOON);
    expect(at({ bloom: 1, wither: 0, shed: 0, rebud: 0 })).toBe("In full bloom.");
    expect(at({ bloom: 1, wither: 0.5 })).toBe("In bloom, its last day. The petals fall this evening.");
    expect(at({ bloom: 0.9, wither: 0.9, shed: 0.4 })).toBe("Its petals are falling. A new bud will follow.");
    expect(at({ bloom: 0, rebud: 0.2 })).toBe("A new bud is forming. The next flower is on its way.");
    expect(at({ bloom: 1, says: "in bloom again" })).toBe("In full bloom again.");
  });
});

describe("moodLine for a lotus", () => {
  it("says the lotus's own lines of it", () => {
    expect(moodLine({ ...lotusAt("seed"), day: 1 }, NOON)).toBe("Just planted, a seed in a jar of water.");
    expect(moodLine(lotusAt("leafy", "poorly"), NOON)).toBe("The pond has dropped below its pot. A top-up or two would help.");
    expect(moodLine(lotusAt("resting"), NOON)).toBe("Resting for now. Every garden has quiet days.");
    const bloom = lotusAt("bloom");
    const open = { ...bloom, visual: { ...(bloom.visual as PondVisual), says: "in bloom" as const, flowerDay: 2 as const } };
    expect(moodLine(open, NOON)).toBe("In full bloom.");
  });

  it("says every line in the third person, as a sentence, kindly", () => {
    const base = lotusAt("leafy");
    for (const says of POND_LINES) {
      const line = moodLine({ ...base, visual: { ...(base.visual as PondVisual), says } }, NOON);
      expect(line, says).toMatch(/^[A-Z].*\.$/);
      expect(line, says).not.toMatch(/\b(my|me|I)\b/);
      expect(line, says).not.toContain("!");
    }
  });

  it("says its pond and its koi are at home when it is seen in the Meadow, where the river has no koi", () => {
    const base = lotusAt("leafy");
    expect(moodLine(lotusAt("leafy", "poorly"), NOON, true)).toBe("At home, its pond has dropped below its pot. A top-up or two would help.");
    for (const says of POND_LINES) {
      const v = { ...(base.visual as PondVisual), says };
      const home = moodLine({ ...base, visual: v }, NOON);
      const away = moodLine({ ...base, visual: v }, NOON, true);
      expect(away, says).toMatch(/^[A-Z].*\.$/);
      expect(away, says).not.toMatch(/\b(my|me|I)\b/);
      // every word of the pond's level, its green or its koi is said of home
      if (/\b(koi|pond)\b/i.test(away)) expect(away, says).toMatch(/\bat home\b/i);
      if (!/\b(koi|pond)\b/i.test(home)) expect(away, says).toBe(home);
    }
    const standing = { ...(base.visual as PondVisual), says: "another bud is on its way" as const, aerialLeaves: 2 };
    expect(moodLine({ ...base, visual: { ...standing, says: "zzz" as never } }, NOON, true)).toBe("Standing leaves over the water, growing well.");
  });

  it("leaves a soil flower's line as it was", () => {
    const opts = { count: 720 };
    const p = syntheticSnapshot(opts, 0).plots.find((q) => q.species === "rose" && q.stage === "leafy" && q.health === "poorly")!;
    expect(moodLine(syntheticFriend(p.plot, opts)!, NOON)).toBe("Would love a little water today.");
  });
});
