// Plot assignment: inner rings fill first in planting order, freed plots are reused, rehearsal plants keep to the outer
// edge of the planned rings, the Meadow grows outward past them instead of turning anyone away, and the ring table maps
// every index to exactly one ring slot.
import { describe, expect, it } from "vitest";
import { MAX_RINGS, PLOT_CAPACITY, PLOT_LIMIT, PLOT_RINGS, assignPlot, plotRing, ringAt } from "./plots";

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
    expect(ringAt(6)).toEqual({ radius: 28.4, count: 104 });
    expect(ringAt(7)).toEqual({ radius: 30.8, count: 112 });
    expect(ringAt(MAX_RINGS - 1)).toEqual({ radius: 44.2, count: 160 });
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
