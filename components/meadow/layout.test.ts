// The Meadow's plan with the river (Option A, the Rose Island moat), checked without a browser: the radii the write-up
// gives (the island, the towpaths 2.6 m wide, the copings, the water, beds 1 and 2 beyond, the hedge), the walls where
// plots.ts puts them; every plot drawn once and found by its number, no bed plot on the water or a path and every
// pocket in the water on both banks; the colliders the write-up counts, with the copings and parapets closing both
// banks except at the four decks; and the cart's world: water out of bounds, taps on it sent to the nearer towpath,
// the route graph joined across the river only by the bridges, and every plot's parking spot reachable from the start.
import { describe, expect, it } from "vitest";
import { BED, buildLayout, inBed, inWater, meadowLayout, onBridge, plotAt, plotOf, plotSlotIn, type MeadowLayout } from "@/components/meadow/layout";
import { pocketOutline } from "@/components/meadow/river";
import { planRoute, ROUTE_CLEARANCE } from "@/components/meadow/route";
import { pointClear, pushOut, reachableNear, segmentClear } from "@/components/meadow/space";
import { PLOT_CAPACITY, POCKET_COUNT, RIVER_WALLS, WATER_BASE, isPocketIndex } from "@/lib/server/plots";

const L = meadowLayout();
const R = L.river.band;
const near = (a: number, b: number, eps = 0.011) => Math.abs(a - b) < eps;
/** The first and last legs of a route may start close to a wall (route.ts END_CLEARANCE). */
const END_CLEARANCE = 0.32;

describe("the plan: the river's rings", () => {
  it("keeps the island and lays the towpaths, copings and water at the write-up's radii", () => {
    expect(L.rings).toBe(6);
    expect(near(L.beds[0].inner, 7.45) && near(L.beds[0].outer, 11.55)).toBe(true);
    expect([R.c0, R.wIn, R.wOut, R.c1].every((v, i) => near(v, [14.15, 14.4, 18.9, 19.15][i]))).toBe(true);
    expect(R.wIn).toBe(RIVER_WALLS.inner);
    expect(R.wOut).toBe(RIVER_WALLS.outer);
    expect(near(L.beds[1].inner, 21.75) && near(L.beds[1].outer, 25.85)).toBe(true);
    expect(near(L.beds[2].inner, 28.45) && near(L.beds[2].outer, 32.55)).toBe(true);
    expect(near(L.hedgeR, 37.95)).toBe(true);
  });

  it("runs a 2.6 m towpath along each bank, from the island's bed to the inner coping and from the outer coping to bed 1", () => {
    const [inner, towIn, towOut, ring, promenade] = L.paths;
    expect(L.paths.map((p) => p.kind)).toEqual(["path", "towpath", "towpath", "path", "path"]);
    expect(towIn.outer - towIn.inner).toBeCloseTo(2.6, 9);
    expect(towOut.outer - towOut.inner).toBeCloseTo(2.6, 9);
    expect(towIn.inner).toBe(L.beds[0].outer);
    expect(towIn.outer).toBe(R.c0);
    expect(towOut.inner).toBe(R.c1);
    expect(towOut.outer).toBe(L.beds[1].inner);
    expect(inner.outer).toBe(L.beds[0].inner);
    expect([ring.inner, ring.outer]).toEqual([L.beds[1].outer, L.beds[2].inner]);
    expect(promenade.inner).toBe(L.beds[2].outer);
  });

  it("breaks the diagonal avenues at the river (their bridges carry them) and starts the others at the outer towpath", () => {
    const diagonals = L.avenues.filter((av) => Math.round((av.angle * 4) / Math.PI) % 2 === 1);
    expect(diagonals.length).toBe(8);
    for (const av of diagonals) expect(av.to <= R.c0 + 1e-9 || av.from >= R.c1 - 1e-9).toBe(true);
    const cardinals = L.avenues.filter((av) => Math.round((av.angle * 4) / Math.PI) % 2 === 0);
    expect(cardinals.length).toBe(4);
    for (const av of cardinals) expect(av.from).toBe(L.paths[2].r);
    // no plaza paves the water: a towpath's stops at its coping
    for (const p of L.plazas) {
      const r = Math.hypot(p.x, p.z);
      expect(Math.min(r + p.r, p.rMax) <= R.c0 + 1e-9 || Math.max(r - p.r, p.rMin) >= R.c1 - 1e-9).toBe(true);
    }
  });
});

describe("the plan: plots", () => {
  it("draws every bed plot of the six rings and the 56 pockets, each found by its number", () => {
    expect(L.bedPlots).toBe(PLOT_CAPACITY);
    expect(L.plots.length).toBe(PLOT_CAPACITY + POCKET_COUNT);
    expect(L.plots.filter((p) => p.kind === "bed").length).toBe(360);
    expect(L.plots.filter((p) => p.kind === "pocket").length).toBe(56);
    for (const p of L.plots) expect(plotAt(p.index)).toBe(p);
    expect(plotAt(WATER_BASE)!.kind).toBe("pocket");
    expect(plotAt(PLOT_CAPACITY)).toBeNull();
    expect(plotAt(WATER_BASE + POCKET_COUNT)).toBeNull();
    expect(plotAt(-1)).toBeNull();
    expect(plotAt(1.5)).toBeNull();
  });

  it("keeps every bed plot in its bed, off the water and off every path", () => {
    for (const p of L.plots.filter((q) => q.kind === "bed")) {
      expect(p.r < R.c0 || p.r > R.c1).toBe(true);
      expect(inBed(p.x, p.z)).toBe(true);
      for (const path of L.paths) expect(p.r < path.inner || p.r > path.outer).toBe(true);
      expect(p.y).toBe(BED.soilH);
      expect(p.stake.y).toBe(BED.soilH);
    }
  });

  it("stands every pocket's lotus, and its whole sill line, in the water, on both banks", () => {
    const pockets = L.plots.filter((q) => q.kind === "pocket");
    expect(pockets.filter((p) => p.bank === "in").length).toBe(24);
    expect(pockets.filter((p) => p.bank === "out").length).toBe(32);
    for (const p of pockets) {
      expect(inWater(p.x, p.z)).toBe(true);
      expect(inBed(p.x, p.z)).toBe(false);
      expect(p.y).toBeLessThan(0);
      // visited from its own bank's towpath
      expect(p.path).toBe(p.bank === "in" ? 1 : 2);
      const parkR = Math.hypot(p.park.x, p.park.z);
      expect(parkR).toBeCloseTo(p.bank === "in" ? 13.3 : 20.0, 6);
      // the stake on the coping
      const stakeR = Math.hypot(p.stake.x, p.stake.z);
      expect(p.bank === "in" ? stakeR > R.c0 && stakeR < R.wIn : stakeR > R.wOut && stakeR < R.c1).toBe(true);
    }
    for (const pk of L.river.pockets) {
      for (const q of pocketOutline(pk)) {
        const r = Math.hypot(q.x, q.z);
        expect(r).toBeGreaterThanOrEqual(R.wIn - 1e-6);
        expect(r).toBeLessThanOrEqual(R.wOut + 1e-6);
        expect(onBridge(q.x, q.z)).toBe(false);
      }
    }
  });

  it("finds a grown Meadow's bed plots and the pockets after them", () => {
    const G: MeadowLayout = buildLayout(8);
    expect(G.bedPlots).toBe(PLOT_CAPACITY + 104 + 112);
    expect(G.plots.length).toBe(G.bedPlots + POCKET_COUNT);
    for (const p of G.plots) expect(plotOf(G, p.index)).toBe(p);
    expect(plotSlotIn(G, WATER_BASE)).toBe(G.bedPlots);
    expect(plotSlotIn(G, G.bedPlots)).toBe(-1);
    expect(G.plots.filter((p) => p.kind === "bed").every((p) => !isPocketIndex(p.index))).toBe(true);
  });
});

describe("the plan: walls", () => {
  it("counts the write-up's colliders: 760 kerb stones, 124 coping barriers, 40 parapet boxes, 110 hedge boxes", () => {
    expect(L.kerbs.length).toBe(760);
    expect(L.copings.length).toBe(124);
    expect(L.parapets.length).toBe(40);
    expect(L.hedge.length).toBe(110);
    expect(L.boxes.length).toBe(760 + 124 + 40 + 110);
  });

  it("closes both banks with copings and parapets, open only at the four bridges' decks", () => {
    for (const r of [(R.c0 + R.wIn) / 2, (R.wOut + R.c1) / 2]) {
      let openings = 0;
      let wasOpen = false;
      const n = Math.ceil((Math.PI * 2 * r) / 0.1);
      for (let i = 0; i <= n; i++) {
        const a = (i / n) * Math.PI * 2;
        const x = r * Math.cos(a), z = r * Math.sin(a);
        // a gap a 0.3 m disc could pass through is only ever a bridge's deck
        const open = segmentClear(x, z, x, z, 0.15);
        if (open) expect(onBridge(x, z)).toBe(true);
        if (open && !wasOpen) openings++;
        wasOpen = open;
      }
      expect(openings).toBe(4);
    }
  });

  it("puts four bridges on the diagonals, their decks level with the paving and the cart's way over", () => {
    expect(L.river.bridges.map((b) => Math.round((b.a * 4) / Math.PI))).toEqual([1, 3, 5, 7]);
    for (const b of L.river.bridges) {
      const mid = { x: R.mid * Math.cos(b.a), z: R.mid * Math.sin(b.a) };
      expect(onBridge(mid.x, mid.z)).toBe(true);
      expect(inWater(mid.x, mid.z)).toBe(false);
      expect(pointClear(mid.x, mid.z, ROUTE_CLEARANCE)).toBe(true);
      // straight along the deck from towpath to towpath, with the cart's clearance
      const a = { x: 12.85 * Math.cos(b.a), z: 12.85 * Math.sin(b.a) };
      const c = { x: 20.45 * Math.cos(b.a), z: 20.45 * Math.sin(b.a) };
      expect(segmentClear(a.x, a.z, c.x, c.z, ROUTE_CLEARANCE)).toBe(true);
    }
  });

  it("blocks a straight run across the water away from the bridges", () => {
    for (const a of [0, Math.PI / 2, 1.1, 2.0, Math.PI, 4.3, 5.9]) {
      const from = { x: 12.85 * Math.cos(a), z: 12.85 * Math.sin(a) };
      const to = { x: 20.45 * Math.cos(a), z: 20.45 * Math.sin(a) };
      expect(segmentClear(from.x, from.z, to.x, to.z, 0.1)).toBe(false);
    }
  });
});

describe("the cart's world", () => {
  it("says where the water is: mid-channel yes, on a deck or a towpath no", () => {
    expect(inWater(R.mid, 0)).toBe(true);
    expect(inWater(0, -R.mid)).toBe(true);
    const d = Math.PI / 4;
    expect(inWater(R.mid * Math.cos(d), R.mid * Math.sin(d))).toBe(false);
    expect(inWater(12.85, 0)).toBe(false);
    expect(inWater(20.45, 0)).toBe(false);
    expect(pointClear(R.mid, 0, 0.1)).toBe(false);
  });

  it("sends a tap on the water to the nearer towpath, and lifts a disc out of the water onto the nearer bank", () => {
    for (const [r, a] of [
      [14.9, 0.3],
      [16.5, 2.0],
      [16.8, 3.5],
      [18.6, 5.0],
      [14.3, 1.7],
    ]) {
      const p = reachableNear(r * Math.cos(a), r * Math.sin(a), 0.8);
      const pr = Math.hypot(p.x, p.z);
      if (r < R.mid) expect(pr).toBeLessThan(R.c0);
      else expect(pr).toBeGreaterThan(R.c1);
      expect(pointClear(p.x, p.z, 0.32)).toBe(true);
      const q = { x: r * Math.cos(a), z: r * Math.sin(a) };
      if (inWater(q.x, q.z)) {
        expect(pushOut(q, 0.5)).toBe(true);
        expect(inWater(q.x, q.z)).toBe(false);
        expect(Math.hypot(q.x, q.z) < R.c0 || Math.hypot(q.x, q.z) > R.c1).toBe(true);
      }
    }
    // a tap on a deck stays on the deck
    const d = Math.PI * 0.75;
    const p = reachableNear(R.mid * Math.cos(d), R.mid * Math.sin(d), 0.8);
    expect(onBridge(p.x, p.z)).toBe(true);
  });

  it("starts the cart on the island's inner path, the rose behind it", () => {
    const r = Math.hypot(L.spawn.x, L.spawn.z);
    expect(r).toBeGreaterThan(L.paths[0].inner);
    expect(r).toBeLessThan(L.paths[0].outer);
    expect(pointClear(L.spawn.x, L.spawn.z, 0.5)).toBe(true);
  });
});

describe("the route graph", () => {
  const { nodes, edges } = L;

  it("is one connected graph", () => {
    expect(nodes.length).toBeGreaterThan(250);
    expect(nodes.length).toBeLessThan(340);
    const seen = new Set<number>([0]);
    const stack = [0];
    while (stack.length) for (const j of edges[stack.pop()!]) if (!seen.has(j) && seen.add(j)) stack.push(j);
    expect(seen.size).toBe(nodes.length);
  });

  it("crosses the river only by the bridges: eight edges, each to a node on a deck", () => {
    const rOf = (i: number) => Math.hypot(nodes[i].x, nodes[i].z);
    let crossing = 0;
    for (let i = 0; i < nodes.length; i++) {
      for (const j of edges[i]) {
        if (j <= i) continue;
        const lo = Math.min(rOf(i), rOf(j)), hi = Math.max(rOf(i), rOf(j));
        if (hi <= R.c0 || lo >= R.c1) continue;
        crossing++;
        expect(onBridge(nodes[i].x, nodes[i].z) || onBridge(nodes[j].x, nodes[j].z)).toBe(true);
        expect(segmentClear(nodes[i].x, nodes[i].z, nodes[j].x, nodes[j].z, ROUTE_CLEARANCE)).toBe(true);
      }
    }
    expect(crossing).toBe(8);
    // no node stands in the water or in a bed
    for (const n of nodes) {
      expect(inWater(n.x, n.z)).toBe(false);
      expect(inBed(n.x, n.z)).toBe(false);
    }
  });

  it("reaches every plot's parking spot from the start, every leg clear, and a pocket over the river by a bridge", () => {
    const start = { x: L.spawn.x, z: L.spawn.z };
    for (const p of L.plots) {
      expect(pointClear(p.park.x, p.park.z, END_CLEARANCE)).toBe(true);
      const route = planRoute(start, p.park);
      expect(route.length).toBeGreaterThanOrEqual(2);
      expect(route[route.length - 1]).toEqual(p.park);
      // never the direct-line fallback through a wall: every leg is a clear run
      for (let i = 1; i < route.length; i++) {
        expect(segmentClear(route[i - 1].x, route[i - 1].z, route[i].x, route[i].z, END_CLEARANCE)).toBe(true);
      }
      // a plot beyond the river is reached over a bridge
      if (Math.hypot(p.park.x, p.park.z) > R.c1) expect(route.some((q) => onBridge(q.x, q.z) || Math.hypot(q.x, q.z) > R.c1)).toBe(true);
    }
  });
});
