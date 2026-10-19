// Plot assignment: inner rings fill first in planting order, freed plots are reused, rehearsal plants keep to the outer
// edge of the planned rings, the Meadow grows outward past them instead of turning anyone away, and the ring table maps
// every index to exactly one ring slot, clear of the avenues, sown evenly round each ring. The river's pockets: 56 of
// them, a number range of their own, sown inner bank first, 2.7 m apart and clear of the bridges; a lotus takes the next
// pocket and, once they are full, a bed plot, while every other seed is placed exactly as before.
import { describe, expect, it } from "vitest";
import {
  AVENUE_GAP,
  MAX_RINGS,
  PLOT_CAPACITY,
  PLOT_LIMIT,
  PLOT_RINGS,
  POCKET_COUNT,
  POCKET_PITCH,
  RIVER_WALLS,
  WATER_BASE,
  assignPlot,
  avenueAngles,
  bedOfRing,
  firstPlotOfRing,
  isBedIndex,
  isPlotIndex,
  isPocketIndex,
  plotKindOf,
  plotRing,
  pocketPlace,
  ringAt,
  ringsToDraw,
} from "./plots";

const range = (n: number) => Array.from({ length: n }, (_, i) => i);

describe("assignPlot", () => {
  it("hands out plots in planting order from the innermost ring", () => {
    const taken: number[] = [];
    for (let i = 0; i < 50; i++) {
      const p = assignPlot(taken);
      expect(p).toBe(i);
      taken.push(p as number);
    }
  });

  it("reuses the lowest freed plot, so a removed test plant leaves no hole", () => {
    expect(assignPlot([0, 1, 3, 4])).toBe(2);
    expect(assignPlot(new Set([1, 2]))).toBe(0);
  });

  it("puts rehearsal plants at the outer edge of the planned rings, away from where colleagues fill in", () => {
    expect(assignPlot([], { from: "outer" })).toBe(PLOT_CAPACITY - 1);
    expect(assignPlot([PLOT_CAPACITY - 1], { from: "outer" })).toBe(PLOT_CAPACITY - 2);
    expect(assignPlot([PLOT_CAPACITY - 1])).toBe(0);
  });

  it("grows past the planned rings instead of saying the Meadow is full", () => {
    // every planned plot taken (say by duplicates from second devices): the next seed opens the seventh ring
    expect(assignPlot(range(PLOT_CAPACITY))).toBe(PLOT_CAPACITY);
    expect(plotRing(PLOT_CAPACITY)).toMatchObject({ ring: PLOT_RINGS.length, slot: 0 });
    // a rehearsal plant with the planned rings full goes to the lowest free plot rather than nowhere
    expect(assignPlot(range(PLOT_CAPACITY), { from: "outer" })).toBe(PLOT_CAPACITY);
  });

  it("returns null only at the hard ceiling", () => {
    expect(assignPlot(range(PLOT_LIMIT))).toBeNull();
    expect(assignPlot(range(PLOT_LIMIT - 1))).toBe(PLOT_LIMIT - 1);
    expect(assignPlot(range(5), { limit: 5 })).toBeNull();
    expect(assignPlot(range(5), { limit: 5, from: "outer" })).toBeNull();
  });
});

describe("the ring table", () => {
  it("plans room for everyone at the celebration, and twice as many rings as a backstop", () => {
    expect(PLOT_CAPACITY).toBe(360);
    expect(PLOT_CAPACITY).toBe(PLOT_RINGS.reduce((n, r) => n + r.count, 0));
    expect(PLOT_LIMIT).toBe(1152);
    expect(PLOT_LIMIT).toBeGreaterThanOrEqual(3 * 300);
  });

  it("grows outward in the same rhythm as the planned rings", () => {
    for (let r = 0; r < PLOT_RINGS.length; r++) expect(ringAt(r)).toEqual(PLOT_RINGS[r]);
    expect(ringAt(6)).toEqual({ radius: 36.0, count: 104 });
    expect(ringAt(7)).toEqual({ radius: 38.4, count: 112 });
    expect(ringAt(MAX_RINGS - 1)).toEqual({ radius: 51.8, count: 160 });
    expect(ringAt(MAX_RINGS)).toBeNull();
    expect(ringAt(-1)).toBeNull();
  });

  it("orders rings from the inside out", () => {
    for (let i = 1; i < MAX_RINGS; i++) expect(ringAt(i)!.radius).toBeGreaterThan(ringAt(i - 1)!.radius);
  });

  it("maps every index to one ring slot, inner rings first", () => {
    const seen = new Set<string>();
    let lastRing = 0;
    for (let i = 0; i < PLOT_LIMIT; i++) {
      const p = plotRing(i);
      expect(p).not.toBeNull();
      if (!p) continue;
      expect(p.ring).toBeGreaterThanOrEqual(lastRing);
      lastRing = p.ring;
      const ring = ringAt(p.ring)!;
      expect(p.slot).toBeLessThan(ring.count);
      expect(p.radius).toBe(ring.radius);
      seen.add(`${p.ring}:${p.slot}`);
    }
    expect(seen.size).toBe(PLOT_LIMIT);
    expect(plotRing(0)).toMatchObject({ ring: 0, slot: 0 });
    expect(plotRing(PLOT_RINGS[0].count)).toMatchObject({ ring: 1, slot: 0 });
    expect(plotRing(-1)).toBeNull();
    expect(plotRing(PLOT_LIMIT)).toBeNull();
    expect(plotRing(1.5)).toBeNull();
  });
});

describe("the angle rule", () => {
  const wrap = (a: number) => {
    let d = a % (Math.PI * 2);
    if (d > Math.PI) d -= Math.PI * 2;
    if (d <= -Math.PI) d += Math.PI * 2;
    return d;
  };

  it("keeps every plot clear of the avenues that cross its bed", () => {
    for (let i = 0; i < PLOT_LIMIT; i++) {
      const p = plotRing(i)!;
      expect(p.angle).toBeGreaterThanOrEqual(0);
      expect(p.angle).toBeLessThan(Math.PI * 2);
      for (const a of avenueAngles(bedOfRing(p.ring))) {
        // arc distance at the plant row from the avenue's centreline
        expect(Math.abs(wrap(p.angle - a)) * p.radius).toBeGreaterThan(AVENUE_GAP / 2);
      }
    }
  });

  it("never puts two plots of a ring in the same place", () => {
    for (let r = 0; r < MAX_RINGS; r++) {
      const ring = ringAt(r)!;
      const first = firstPlotOfRing(r);
      const angles = Array.from({ length: ring.count }, (_, s) => plotRing(first + s)!.angle).sort((x, y) => x - y);
      for (let k = 1; k < angles.length; k++) expect((angles[k] - angles[k - 1]) * ring.radius).toBeGreaterThan(1.1);
    }
  });

  it("sows a ring evenly: the first plants of a ring land in different arcs, each in the middle of its arc", () => {
    const arcs = avenueAngles(0).length;
    const firsts = Array.from({ length: arcs }, (_, s) => plotRing(s)!);
    expect(new Set(firsts.map((p) => p.arc)).size).toBe(arcs);
    const perArc = PLOT_RINGS[0].count / arcs;
    for (const p of firsts) expect(Math.abs(p.place - (perArc - 1) / 2)).toBeLessThanOrEqual(0.5);
    // the second plant of the ring goes opposite the first
    expect(Math.abs(Math.abs(wrap(plotRing(1)!.angle - plotRing(0)!.angle)) - Math.PI)).toBeLessThan(0.01);
  });

  it("draws the planned rings at least, and whole beds as the Meadow grows", () => {
    expect(ringsToDraw(-1)).toBe(PLOT_RINGS.length);
    expect(ringsToDraw(0)).toBe(PLOT_RINGS.length);
    expect(ringsToDraw(PLOT_CAPACITY - 1)).toBe(PLOT_RINGS.length);
    expect(ringsToDraw(PLOT_CAPACITY)).toBe(PLOT_RINGS.length + 2);
    expect(ringsToDraw(PLOT_LIMIT - 1)).toBe(MAX_RINGS);
    expect(firstPlotOfRing(1)).toBe(PLOT_RINGS[0].count);
    expect(firstPlotOfRing(PLOT_RINGS.length)).toBe(PLOT_CAPACITY);
  });
});

describe("the river's pockets", () => {
  const all = Array.from({ length: POCKET_COUNT }, (_, k) => pocketPlace(WATER_BASE + k)!);
  const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));
  const bridges = avenueAngles(0);

  it("numbers 56 pockets in a range of their own, clear of every bed plot", () => {
    expect(WATER_BASE).toBeGreaterThanOrEqual(PLOT_LIMIT);
    expect(POCKET_COUNT).toBe(56);
    expect(all.map((p) => p.index)).toEqual(Array.from({ length: 56 }, (_, k) => 2000 + k));
    expect(all.map((p) => p.order)).toEqual(Array.from({ length: 56 }, (_, k) => k));
    expect(all.filter((p) => p.bank === "in").length).toBe(24);
    expect(all.filter((p) => p.bank === "out").length).toBe(32);
    // every place on each bank used once
    expect(new Set(all.map((p) => `${p.bank}:${p.arc}:${p.place}`)).size).toBe(56);
    expect(pocketPlace(WATER_BASE - 1)).toBeNull();
    expect(pocketPlace(WATER_BASE + POCKET_COUNT)).toBeNull();
    expect(pocketPlace(3)).toBeNull();
  });

  it("stands every lotus in the water, 0.55 m off its wall", () => {
    for (const p of all) {
      expect(p.radius).toBeGreaterThan(RIVER_WALLS.inner);
      expect(p.radius).toBeLessThan(RIVER_WALLS.outer);
      expect(p.radius).toBeCloseTo(p.bank === "in" ? RIVER_WALLS.inner + 0.55 : RIVER_WALLS.outer - 0.55, 9);
      expect(p.angle).toBeGreaterThanOrEqual(0);
      expect(p.angle).toBeLessThan(Math.PI * 2);
    }
  });

  it("sows the inner bank first, from the near-left reach the party screen sees, as the beds are sown", () => {
    expect(all.slice(0, 24).every((p) => p.bank === "in")).toBe(true);
    expect(all.slice(24).every((p) => p.bank === "out")).toBe(true);
    const first = all[0];
    expect([first.bank, first.arc, first.place, ((first.angle * 180) / Math.PI).toFixed(2)]).toEqual(["in", 0, 2, "84.83"]);
    // the next three go to the other quarters, the second opposite the first
    expect(all.slice(0, 4).map((p) => p.arc)).toEqual([0, 2, 1, 3]);
    expect(all[24]).toMatchObject({ bank: "out", arc: 0, place: 3 });
  });

  it("spaces neighbours 2.7 m apart along each bank, and keeps clear of each bridge's parapet", () => {
    for (const bank of ["in", "out"] as const) {
      const ps = all.filter((p) => p.bank === bank).sort((p, q) => p.arc - q.arc || p.place - q.place);
      for (let i = 0; i < ps.length - 1; i++) {
        if (ps[i].arc !== ps[i + 1].arc) continue;
        expect(Math.abs(wrap(ps[i + 1].angle - ps[i].angle)) * ps[i].radius).toBeCloseTo(POCKET_PITCH, 6);
      }
      // the pocket's end (1.1 m along from its middle, at its wall) to the parapet's outer face (2.3 m off the axis)
      let least = Infinity;
      for (const p of ps) {
        const wall = bank === "in" ? RIVER_WALLS.inner : RIVER_WALLS.outer;
        for (const b of bridges) least = Math.min(least, Math.abs(wrap(p.angle - b)) * wall - 1.1 - 2.3);
      }
      expect(least).toBeGreaterThan(bank === "in" ? 1.35 : 1.65);
    }
  });

  it("tells a bed plot from a pocket, and both from anything else", () => {
    expect(isPlotIndex(-1)).toBe(false);
    expect(isPlotIndex(1.5)).toBe(false);
    expect(isPlotIndex(0)).toBe(true);
    expect(isPlotIndex(1151)).toBe(true);
    expect(isPlotIndex(1152)).toBe(false);
    expect(isPlotIndex(1999)).toBe(false);
    expect(isPlotIndex(2000)).toBe(true);
    expect(isPlotIndex(2055)).toBe(true);
    expect(isPlotIndex(2056)).toBe(false);
    expect(isBedIndex(2000)).toBe(false);
    expect(isPocketIndex(359)).toBe(false);
    expect([plotKindOf(4), plotKindOf(2003), plotKindOf(1999)]).toEqual(["bed", "pocket", null]);
  });

  it("never lets a pocket number decide how many rings to draw", () => {
    expect(ringsToDraw(WATER_BASE + 10)).toBe(PLOT_RINGS.length);
    expect(plotRing(WATER_BASE)).toBeNull();
  });
});

describe("assignPlot for a lotus", () => {
  const pockets = (n: number) => Array.from({ length: n }, (_, k) => WATER_BASE + k);

  it("takes the river's pockets in sowing order", () => {
    const taken: number[] = [];
    for (let k = 0; k < POCKET_COUNT; k++) {
      const p = assignPlot(taken, { water: true });
      expect(p).toBe(WATER_BASE + k);
      taken.push(p!);
    }
    // a freed pocket is taken again first
    expect(assignPlot([WATER_BASE, WATER_BASE + 2], { water: true })).toBe(WATER_BASE + 1);
  });

  it("goes to the lowest free bed plot, in its urli, once every pocket is taken", () => {
    expect(assignPlot(pockets(56), { water: true })).toBe(0);
    expect(assignPlot([...pockets(56), 0, 1, 2], { water: true })).toBe(3);
  });

  it("leaves every other seed exactly where it went before, whatever the pockets hold", () => {
    expect(assignPlot(pockets(30))).toBe(0);
    expect(assignPlot([...pockets(56), 0, 1, 3])).toBe(2);
    expect(assignPlot(pockets(56), { from: "outer" })).toBe(PLOT_CAPACITY - 1);
    expect(assignPlot([...pockets(56), ...range(PLOT_LIMIT - 1)])).toBe(PLOT_LIMIT - 1);
    expect(assignPlot([...pockets(56), ...range(PLOT_LIMIT)])).toBeNull();
  });

  it("keeps a rehearsal lotus to the far end: the last pocket down, then the planned rings' outer end", () => {
    expect(assignPlot([], { water: true, from: "outer" })).toBe(WATER_BASE + 55);
    expect(assignPlot([WATER_BASE + 55], { water: true, from: "outer" })).toBe(WATER_BASE + 54);
    expect(assignPlot(pockets(56), { water: true, from: "outer" })).toBe(PLOT_CAPACITY - 1);
    // a real lotus is never pushed off the first pocket by rehearsals at the far end
    expect(assignPlot([WATER_BASE + 55, WATER_BASE + 54], { water: true })).toBe(WATER_BASE);
  });

  it("returns null only when every bed plot and every pocket is taken", () => {
    expect(assignPlot(range(PLOT_LIMIT), { water: true })).toBe(WATER_BASE);
    expect(assignPlot([...range(PLOT_LIMIT), ...pockets(56)], { water: true })).toBeNull();
    expect(assignPlot([...range(PLOT_LIMIT - 1), ...pockets(56)], { water: true })).toBe(PLOT_LIMIT - 1);
  });

  it("hands out distinct plots to plantings arriving together, served one at a time under the planting lock", async () => {
    // garden.ts takes one advisory lock round "read the taken plots, choose, insert", so plantings arriving together are
    // served one at a time, each seeing the plots the earlier ones took (and unique(plot_index) backs it up)
    let lock: Promise<void> = Promise.resolve();
    const rows: number[] = [];
    const plant = (species: string, rehearsal: boolean) => {
      const run = lock.then(async () => {
        const taken = [...rows];
        await Promise.resolve();
        const plot = assignPlot(taken, { from: rehearsal ? "outer" : "inner", water: species === "lotus" })!;
        rows.push(plot);
        return plot;
      });
      lock = run.then(() => undefined);
      return run;
    };
    const mix = ["lotus", "rose", "lotus", "jasmine", "lotus", "marigold"];
    const plots = await Promise.all(Array.from({ length: 120 }, (_, i) => plant(mix[i % mix.length], i % 9 === 4)));
    expect(new Set(plots).size).toBe(plots.length);
    const lotus = plots.filter((_, i) => mix[i % mix.length] === "lotus");
    // 60 lotus: 56 in the pockets, 4 in urlis on bed plots; every other seed on a bed plot
    expect(lotus.filter((p) => isPocketIndex(p)).length).toBe(56);
    expect(lotus.filter((p) => isBedIndex(p)).length).toBe(4);
    expect(plots.filter((_, i) => mix[i % mix.length] !== "lotus").every((p) => isBedIndex(p))).toBe(true);
  });
});
