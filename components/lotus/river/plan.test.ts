// The river preview's plan (Option A, the Rose Island moat) against the write-up's numbers, checked without a
// browser: the rings and levels, the 56 pockets (24 inner, 32 outer, 2.2 x 1.1 m at a 2.7 m pitch, clear of each other
// and of the bridges by the open water the write-up promises), the sowing order's first seven, the dressing and the
// colliders it counts, and the party fill.
import { describe, expect, it } from "vitest";
import { BRIDGE, buildRiverPlan, LEVEL, partyFill, pocketOutline, pocketReach, POCKET, RINGS, wrapAngle } from "@/components/lotus/river/plan";

const P = buildRiverPlan();
const near = (a: number, b: number, eps = 0.011) => Math.abs(a - b) < eps;

describe("river plan: rings and levels", () => {
  it("keeps the island and moves beds 1 and 2 out 7.6 m", () => {
    expect(RINGS.map((r) => r.radius)).toEqual([8.3, 10.7, 22.6, 25, 29.3, 31.7]);
    expect(near(P.beds[0].inner, 7.45) && near(P.beds[0].outer, 11.55)).toBe(true);
    expect(near(P.beds[1].inner, 21.75) && near(P.beds[1].outer, 25.85)).toBe(true);
    expect(near(P.beds[2].inner, 28.45) && near(P.beds[2].outer, 32.55)).toBe(true);
    expect(near(P.hedgeR, 37.95)).toBe(true);
  });

  it("lays the towpaths, copings and water at the write-up's radii, the outer towpath meeting bed 1", () => {
    const R = P.river;
    expect([R.c0, R.wIn, R.wOut, R.c1].every((v, i) => near(v, [14.15, 14.4, 18.9, 19.15][i]))).toBe(true);
    expect(near(P.towIn.inner, 11.55) && near(P.towIn.outer, 14.15)).toBe(true);
    expect(near(P.towOut.outer, P.beds[1].inner, 1e-9)).toBe(true);
    expect(LEVEL.coping - LEVEL.water).toBeCloseTo(0.48, 5);
    // the deck at paving level clears the water by 18 cm under its soffit
    expect(LEVEL.soffit - LEVEL.water).toBeCloseTo(0.18, 5);
    expect(LEVEL.water - LEVEL.bed).toBeCloseTo(1.2, 5);
  });
});

describe("river plan: pockets", () => {
  it("has 56 pockets, 24 on the inner bank and 32 on the outer, each lotus in the water", () => {
    expect(P.pockets.length).toBe(56);
    expect(P.pockets.filter((p) => p.bank === "in").length).toBe(24);
    expect(P.pockets.filter((p) => p.bank === "out").length).toBe(32);
    for (const pk of P.pockets) {
      expect(pk.r).toBeGreaterThan(P.river.wIn);
      expect(pk.r).toBeLessThan(P.river.wOut);
    }
  });

  it("spaces them 2.7 m apart along each bank, 2.2 m long and 1.1 m out, leaving 0.5 m gaps", () => {
    expect(pocketReach(0)).toBeCloseTo(POCKET.out, 6);
    expect(pocketReach(POCKET.len / 2)).toBeCloseTo(0, 6);
    for (const bank of ["in", "out"] as const) {
      const ps = P.pockets.filter((p) => p.bank === bank).sort((p, q) => p.arc - q.arc || p.place - q.place);
      for (let i = 0; i < ps.length - 1; i++) {
        if (ps[i].arc !== ps[i + 1].arc) continue;
        const pitch = Math.abs(wrapAngle(ps[i + 1].a - ps[i].a)) * ps[i].r;
        expect(pitch).toBeCloseTo(POCKET.pitch, 6);
        // at the wall the pockets are a little closer (the wall's radius is smaller or larger than the lotus line)
        const gapAtWall = Math.abs(wrapAngle(ps[i + 1].a - ps[i].a)) * ps[i].face - POCKET.len;
        expect(gapAtWall).toBeGreaterThan(0.38);
      }
    }
  });

  it("leaves open water between each bridge's parapet and the first pocket (1.4 m inner, 1.7 m outer)", () => {
    const parapetOut = BRIDGE.mouthHalf + BRIDGE.parT;
    for (const bank of ["in", "out"] as const) {
      let least = Infinity;
      for (const pk of P.pockets.filter((p) => p.bank === bank)) {
        for (const b of P.bridges) {
          const d = Math.abs(wrapAngle(pk.a - b.a)) * pk.face - POCKET.len / 2 - parapetOut;
          least = Math.min(least, d);
        }
      }
      expect(least).toBeGreaterThan(bank === "in" ? 1.35 : 1.65);
    }
  });

  it("keeps every sill line in the water, off the far half of the channel", () => {
    for (const pk of P.pockets) {
      for (const q of pocketOutline(pk)) {
        const r = Math.hypot(q.x, q.z);
        expect(r).toBeGreaterThanOrEqual(P.river.wIn - 1e-6);
        expect(r).toBeLessThanOrEqual(P.river.wOut + 1e-6);
        expect(Math.abs(r - pk.face)).toBeLessThanOrEqual(POCKET.out + 1e-6);
      }
    }
  });

  it("sows the first seven as the write-up's table (banks inner, outer, inner, outer, inner, outer, outer)", () => {
    const first = P.pockets.slice(0, 7).map((p) => [p.bank, p.arc, p.place, ((p.a * 180) / Math.PI).toFixed(2)]);
    expect(first).toEqual([
      ["in", 0, 2, "84.83"],
      ["out", 0, 3, "85.78"],
      ["in", 2, 2, "264.83"],
      ["out", 2, 3, "265.78"],
      ["in", 1, 2, "174.83"],
      ["out", 1, 3, "175.78"],
      ["out", 3, 3, "355.78"],
    ]);
    expect(P.pockets.map((p) => p.index)).toEqual(Array.from({ length: 56 }, (_, i) => 2000 + i));
  });
});

describe("river plan: dressing, colliders and the party", () => {
  it("dresses the banks with 40 reed clumps and 40 pairs of stones", () => {
    expect(P.dressing.filter((d) => d.kind === "reeds").length).toBe(40);
    expect(P.dressing.filter((d) => d.kind === "stones").length).toBe(40);
  });

  it("counts the write-up's colliders: 760 kerb stones, 124 coping barriers, 40 parapet boxes, 110 hedge boxes", () => {
    expect(P.kerbs.length).toBe(760);
    expect(P.copings.length).toBe(124);
    expect(P.bridges.reduce((n, b) => n + b.parBoxes.length, 0)).toBe(40);
    expect(P.hedge.length).toBe(110);
  });

  it("puts four bridges on the diagonals with four lamp posts each, and keeps the bed plots' count", () => {
    expect(P.bridges.map((b) => Math.round((b.a * 4) / Math.PI))).toEqual([1, 3, 5, 7]);
    expect(P.bridges.reduce((n, b) => n + b.lamps.length, 0)).toBe(16);
    expect(P.plots.length).toBe(360);
  });

  it("fills 54 pockets at the party (18% of 300) with none overflowing, and overflows past 56", () => {
    expect(partyFill()).toEqual({ lotus: 54, inPockets: 54, overflow: 0, soil: 246, freePockets: 2 });
    expect(partyFill(300, 0.25).overflow).toBe(19);
    expect(partyFill(300, 0.33).overflow).toBe(43);
  });
});
