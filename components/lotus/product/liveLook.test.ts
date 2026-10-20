// The courtyard lotus's rebuild key (product/liveLook.ts), checked on a real season: a lotus grown under the pond model's
// good care (2025 weather), its numbers handed over as the garden store gets them. What moves every frame (the level
// within its step, the green, the jar clouding, the flower opening and closing, its warmth, the koi) never rebuilds the
// plant; what changes its shape (a leaf more, the flower's next day, a fallen petal) always does; and a whole season
// rebuilds only a few times a day. The frame's own writes put the flower where the model says.
import { describe, expect, it } from "vitest";
import { pondShownOf, flowerSizeOf } from "@/lib/client/plantShown";
import { POND_NONE, toVisualPond, type PondState } from "@/lib/sim";
import { goodCare, simulate } from "@/lib/sim/__fixtures__/pond-harness";
import type { LotusLookInput } from "@/components/lotus/live/pondLook";
import { aphidShare, applyLive, nibbleOf, shapeKey, shapeLook } from "@/components/lotus/product/liveLook";

const run = simulate({ year: 2025, policy: goodCare(), endH: 15 + 24 * 22 });
const input = (s: PondState, clock = s.hod): LotusLookInput => {
  const v = toVisualPond(s, null, clock);
  return { pond: pondShownOf(v), growth: v.growth, bloom: v.bloom, health: v.health, droop: v.droop, chlorosis: v.chlorosis, flowerSize: flowerSizeOf(v, s.gen), glow: v.glow, alive: v.alive };
};
const at = (fn: (s: PondState, h: number) => boolean) => {
  const r = run.rec.find((x) => fn(x.s, x.h));
  if (!r) throw new Error("not in the season");
  return r.s;
};
const with_ = (i: LotusLookInput, pond: Partial<LotusLookInput["pond"]>, rest: Partial<LotusLookInput> = {}): LotusLookInput => ({ ...i, ...rest, pond: { ...i.pond, ...pond } });

describe("the courtyard lotus rebuilds only when its shape changes", () => {
  const leafy = input(at((s) => s.stage === 1 && s.aMax >= 2 && s.bloomH === POND_NONE), 12);
  const key = shapeKey(leafy, 12);

  it("keeps its shape through what moves every frame", () => {
    for (const moved of [
      with_(leafy, { waterMM: Math.round(leafy.pond.waterMM / 12) * 12 + 1.5 }),
      with_(leafy, { algae: 0.6, jarClarity: leafy.pond.jarClarity, warmth: 0.8 }),
      with_(leafy, { koiHunger: 0.9, koiGather: 1, koiGasp: true, aphids: 0.5, nibbled: 0.4 }),
      with_(leafy, { topUpAt: 1, pinchAt: 2, plantedAt: 3 }),
      with_(leafy, {}, { bloom: 0.7, health: 0.4, glow: 1 }),
    ])
      expect(shapeKey(moved, 12)).toBe(key);
    // the dew's hours apart, any hour of the day builds the same plant
    expect(shapeKey(leafy, 15)).toBe(key);
  });

  it("rebuilds for a leaf more, a new standing leaf, a step of droop, browning or the level", () => {
    expect(shapeKey(with_(leafy, { floatLeaves: leafy.pond.floatLeaves + 1 }), 12)).not.toBe(key);
    expect(shapeKey(with_(leafy, { aerialLeaves: leafy.pond.aerialLeaves + 1 }), 12)).not.toBe(key);
    expect(shapeKey(with_(leafy, {}, { droop: leafy.droop + 0.1 }), 12)).not.toBe(key);
    expect(shapeKey(with_(leafy, { floatBrown: 0.5 }), 12)).not.toBe(key);
    expect(shapeKey(with_(leafy, { waterMM: leafy.pond.waterMM - 12 }), 12)).not.toBe(key);
  });

  it("rebuilds at most once while a bucket pours (the level easing up 11.5 mm), and stays on its side of the rim", () => {
    for (let from = -20; from <= 8; from += 0.7) {
      const keys = new Set<string>();
      for (let k = 0; k <= 40; k++) keys.add(shapeKey(with_(leafy, { waterMM: from + (11.5 * k) / 40 }), 12));
      expect(keys.size, `from ${from.toFixed(1)} mm`).toBeLessThanOrEqual(2);
    }
    // the floating leaves drift off the rim only once the water is really down to it
    expect(shapeLook(with_(leafy, { waterMM: -20 }), 12, "Lijas").waterMM).toBeGreaterThanOrEqual(-23);
    expect(shapeLook(with_(leafy, { waterMM: -24 }), 12, "Lijas").waterMM).toBeLessThan(-23);
  });

  it("rebuilds for the flower's next day and each fallen petal", () => {
    const day2 = input(at((s, h) => toVisualPond(s).flowerDay === 2 && h % 24 === 12), 12);
    const k2 = shapeKey(day2, 12);
    expect(shapeKey(with_(day2, { flowerDay: 3 }), 12)).not.toBe(k2);
    const day3 = with_(day2, { flowerDay: 3 });
    expect(shapeKey(with_(day3, { petalDrop: 1 / 18 }), 12)).not.toBe(shapeKey(day3, 12));
    // a falling petal's share within its eighteenth moves without a rebuild
    expect(shapeKey(with_(day3, { petalDrop: 1.4 / 18 }), 12)).toBe(shapeKey(with_(day3, { petalDrop: 1 / 18 }), 12));
  });

  it("rebuilds a few times a day through a whole season, never every hour", () => {
    let last = "";
    let rebuilds = 0;
    for (const x of run.rec) {
      const k = shapeKey(input(x.s), x.s.hod);
      if (k !== last) rebuilds++;
      last = k;
    }
    const days = run.rec.length / 24;
    expect(rebuilds / days).toBeLessThan(8);
  });
});

describe("the frame writes what moves into the shape", () => {
  it("opens the flower as the model says, holds day 1's dawn bud and day 3's wide petals", () => {
    const dawn = at((s) => toVisualPond(s).flowerDay === 1 && s.hod === 6);
    const i = input(dawn, 6.2);
    expect(shapeLook(i, 6.2, "Lijas").flower.kind).toBe("bud");
    const morning = input(at((s) => toVisualPond(s).flowerDay === 1 && s.hod === 9), 9);
    const look = shapeLook(morning, 9, "Lijas");
    expect(look.flower.kind).toBe("flower");
    applyLive(look, morning);
    expect(look.flower.open).toBeCloseTo(Math.pow(morning.bloom, 1.6), 9);
    expect(look.flower.warmth).toBeCloseTo(morning.pond.warmth, 9);
    // day 3's evening: half the petals gone, the rest still wide (the model's bloom falls with them)
    const evening = input(at((s) => toVisualPond(s).flowerDay === 3 && s.hod === 20), 20.5);
    const late = shapeLook(evening, 20.5, "Lijas");
    applyLive(late, evening);
    expect(evening.pond.petalDrop).toBeGreaterThan(0.4);
    expect(late.flower.fallen).toBeGreaterThan(0);
    expect(late.flower.open).toBeGreaterThan(Math.pow(evening.bloom, 1.6));
  });

  it("never warms a pod, and writes the jar's clearness and the green", () => {
    const pod = input(at((s) => toVisualPond(s).pods >= 1 && toVisualPond(s).flowerDay === 0 && s.hod === 22), 22);
    const look = shapeLook(pod, 22, "Lijas");
    applyLive(look, with_(pod, { warmth: 1, algae: 0.5 }));
    expect(look.flower.kind).toBe("pod");
    expect(look.flower.warmth).toBe(0);
    expect(look.algae).toBe(0.5);
    const jar = input(run.rec[10].s);
    const jl = shapeLook(jar, 12, "Lijas");
    applyLive(jl, with_(jar, { jarClarity: 0.37 }));
    expect(jl.jar.clarity).toBeCloseTo(0.37, 9);
  });

  it("shows aphids from the model's pressure and the koi nosing only in the pond", () => {
    expect(aphidShare(0)).toBe(0);
    expect(aphidShare(0.8)).toBe(1);
    expect(nibbleOf({ stage: "jar", koiHunger: 1, nibbled: 1 })).toBe(0);
    expect(nibbleOf({ stage: "pond", koiHunger: 0.9, nibbled: 0 })).toBe(1);
    expect(nibbleOf({ stage: "pond", koiHunger: 0, nibbled: 0 })).toBe(0);
  });
});
