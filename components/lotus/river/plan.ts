// The Meadow's lazy river, Option A (the Rose Island moat), as plain numbers: a port of the design's own generator
// (scratchpad lotus\v2\river\gen-a.mjs, the plan the owner chose) onto the Meadow's real constants
// (components/meadow/layout.ts, lib/server/plots.ts), for the /lotus-concepts preview. Nothing here is the product's
// plan: layout.ts and plots.ts are untouched, and this file only says where things would stand.
//
// From the rose outward: the dais, the inner path and bed 0 are unchanged and become the island. The ring path
// beyond bed 0 becomes the inner towpath; then a granite coping, 4.5 m of slow water, a coping and the outer towpath;
// beds 1 and 2 and everything beyond them move out 7.6 m. Four flat granite slab bridges cross on the diagonals (the
// inner bed's avenues), their decks level with the paving, three slabs of 1.27 m on two piers, with 0.45 m parapets
// flaring from 2.6 m between them over the water to a 4.0 m mouth over each coping, and a 2.2 m lamp post at every
// parapet end. The cardinal avenues end at the outer towpath. 56 lotus pockets line the walls (6 a quarter on the
// inner bank, 8 on the outer), each a still planting shelf 2.2 m along the wall and 1.1 m out, one every 2.7 m,
// ringed by sill stones; reeds and stones dress the bridge mouths and the gaps between pockets. Levels are metres
// from the paving (y = 0): coping top +0.08, water -0.40, pocket shelf -0.55, wall ledge -0.70, channel bed -1.60.
// The water flows toward decreasing polar angle, left to right across the near reach as the party screen sees it.
//
// Angles as layout.ts: a point at polar angle a sits at (r cos a, 0, r sin a). Pure: no three, no DOM.
import { AVENUE_HALF, BED, DAIS, HEDGE_SPEC, tangentYaw, yawOf, type Box2, type P2 } from "@/components/meadow/layout";
import { AVENUE_GAP, PLOT_RINGS } from "@/lib/server/plots";

const TAU = Math.PI * 2;

// ---- the Meadow's constants that layout.ts keeps private (copied) ----------------------------------------------------
const CHAMFER = 1.05;
const PROMENADE = 2.6;
const LAWN = 2.8;
const PATH_W = 2.6;
const PARK_OFF = 0.85;

// ---- Option A ----------------------------------------------------------------------------------------------------------
/** How far beds 1 and 2 (and everything beyond) move out to make room for the river and its towpaths. */
export const SHIFT = 7.6;
/** The six planned rings, the outer four moved out by SHIFT (counts unchanged). */
export const RINGS: ReadonlyArray<{ radius: number; count: number }> = PLOT_RINGS.map((r, i) => ({ radius: i < 2 ? r.radius : Math.round((r.radius + SHIFT) * 100) / 100, count: r.count }));
/** Heights from the paving (y = 0). */
export const LEVEL = {
  coping: 0.08,
  /** the copings' underside, resting on the wall */
  copingBase: -0.06,
  water: -0.4,
  shelf: -0.55,
  ledge: -0.7,
  bed: -1.6,
  /** the sill stones' tops, 4 cm above the water */
  sill: -0.36,
  /** the bridge deck's top (level with the paving's top course) and its soffit */
  deck: 0.028,
  soffit: -0.22,
  parapet: 0.45,
  lamp: 2.2,
} as const;
export const RIVER = { coping: 0.25, water: 4.5, ledge: 0.5 } as const;
export const POCKET = { len: 2.2, out: 1.1, pitch: 2.7, lotusOut: 0.55, perArc: { in: 6, out: 8 } } as const;
/** The bridge in its own frame: u = radius along its diagonal, v = across it. */
export const BRIDGE = { deckHalf: 1.3, mouthHalf: 2.0, parT: 0.3, flare: 1.15, pierT: 0.35, slabT: 0.25 } as const;
/** The current: metres a second for the two ripple layers, toward decreasing polar angle. */
export const FLOW = { fast: 0.1, slow: 0.06 } as const;
/** The cart cannot cross a coping or a parapet: an unseen barrier this tall over each (as the kerbs'). */
export const BARRIER_H = 1.4;
/** Pocket plot indexes start here (the write-up's WATER_BASE). */
export const WATER_BASE = 2000;
/** Banks alternate in sowing: 3 inner to 4 outer, inner first. */
const BANK_PATTERN: readonly Bank[] = ["in", "out", "in", "out", "in", "out", "out"];

const INNER_AV: readonly number[] = [1, 3, 5, 7].map((k) => (k * Math.PI) / 4);
const OUTER_AV: readonly number[] = [0, 1, 2, 3, 4, 5, 6, 7].map((k) => (k * Math.PI) / 4);
const ARC_ORDER: Readonly<Record<number, readonly number[]>> = { 4: [0, 2, 1, 3], 8: [0, 4, 2, 6, 1, 5, 3, 7] };

export type Bank = "in" | "out";

export interface Ring2 {
  inner: number;
  outer: number;
}
export interface PathRing2 extends Ring2 {
  r: number;
  name: string;
}
export interface AvenueSeg {
  angle: number;
  from: number;
  to: number;
}
export interface Plaza2 extends P2 {
  r: number;
  /** paving clipped to this band of radius (the towpath plazas stop at the copings) */
  rMin: number;
  rMax: number;
}
export interface Sector2 {
  bed: number;
  points: P2[];
  rMin: number;
  rMax: number;
}
export interface Tree2 extends P2 {
  canopyR: number;
  canopyY: number;
}
export interface Pocket {
  bank: Bank;
  /** the wall face this pocket stands against, and which way is out from it (+1 outward in radius) */
  face: number;
  dir: 1 | -1;
  /** the quarter (0 starts at the first diagonal) and its place along the bank */
  arc: number;
  place: number;
  /** the lotus's place: polar angle and radius (0.55 m out from the wall), and in plan */
  a: number;
  r: number;
  x: number;
  z: number;
  park: P2;
  stake: P2 & { yaw: number };
  /** sowing order (0 first) and plot index */
  order: number;
  index: number;
}
export interface Bridge {
  a: number;
  /** the deck's outline (parapets' outer lines), the parapets' footprints, closed, in plan */
  deck: P2[];
  parapets: P2[][];
  /** the parapets' inner face line, u and v, one side (mirror v for the other) */
  face: ReadonlyArray<readonly [number, number]>;
  parBoxes: Box2[];
  /** lamp posts at the parapet ends, in plan */
  lamps: P2[];
  /** pier centres along u, and the span between them */
  piers: number[];
  span: number;
}
export interface Dressing extends P2 {
  kind: "reeds" | "stones";
  /** which way is out from the wall (+1 outward in radius) */
  dir: 1 | -1;
  seed: number;
}
export interface BedPlot extends P2 {
  index: number;
  ring: number;
  a: number;
  r: number;
  bed: number;
  side: "inner" | "outer";
  park: P2;
  stake: P2 & { yaw: number };
}
export interface RiverPlan {
  beds: Ring2[];
  paths: PathRing2[];
  towIn: PathRing2;
  towOut: PathRing2;
  river: { c0: number; wIn: number; wOut: number; c1: number; mid: number };
  avenues: AvenueSeg[];
  sectors: Sector2[];
  kerbs: Box2[];
  lanterns: P2[];
  plazas: Plaza2[];
  hedgeR: number;
  groundR: number;
  hedge: Box2[];
  trees: Tree2[];
  bridges: Bridge[];
  copings: Box2[];
  pockets: Pocket[];
  dressing: Dressing[];
  plots: BedPlot[];
}

// ---- helpers (layout.ts's, copied: it keeps them private) ---------------------------------------------------------------
export const polar = (r: number, a: number): P2 => ({ x: r * Math.cos(a), z: r * Math.sin(a) });
export function wrapAngle(a: number): number {
  a %= TAU;
  if (a > Math.PI) a -= TAU;
  else if (a <= -Math.PI) a += TAU;
  return a;
}
function rand(seed: number): () => number {
  let s = seed >>> 0 || 1;
  return () => (s = (s * 16807) % 2147483647) / 2147483647;
}

const spreadCache = new Map<number, number[]>();
/** The order the m places along an arc are filled: each next as far as can be from those taken and the ends (plots.ts). */
export function spreadOrder(m: number): number[] {
  const known = spreadCache.get(m);
  if (known) return known;
  const taken: number[] = [];
  const free = new Set(Array.from({ length: m }, (_, i) => i));
  while (free.size) {
    let best = -1;
    let bestD = -1;
    for (const p of free) {
      let d = Math.min(p + 1, m - p);
      for (const t of taken) d = Math.min(d, Math.abs(p - t));
      if (d > bestD) {
        bestD = d;
        best = p;
      }
    }
    taken.push(best);
    free.delete(best);
  }
  spreadCache.set(m, taken);
  return taken;
}

function clipHalfPlane(poly: P2[], c: P2, n: P2, k: number): P2[] {
  const out: P2[] = [];
  const side = (p: P2) => (p.x - c.x) * n.x + (p.z - c.z) * n.z - k;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length];
    const sa = side(a), sb = side(b);
    if (sa >= 0) out.push(a);
    if (sa >= 0 !== sb >= 0) {
      const t = sa / (sa - sb);
      out.push({ x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t });
    }
  }
  return out;
}

export function arcPoints(r: number, a0: number, a1: number, step: number): P2[] {
  const n = Math.max(1, Math.ceil((Math.abs(a1 - a0) * r) / step));
  return Array.from({ length: n + 1 }, (_, i) => polar(r, a0 + ((a1 - a0) * i) / n));
}

function sectorOutline(bed: Ring2, a0: number, a1: number, step: number): P2[] {
  const w = AVENUE_HALF;
  const si = Math.sqrt(bed.inner ** 2 - w * w), so = Math.sqrt(bed.outer ** 2 - w * w);
  const ai0 = a0 + Math.atan2(w, si), ai1 = a1 - Math.atan2(w, si);
  const ao0 = a0 + Math.atan2(w, so), ao1 = a1 - Math.atan2(w, so);
  const poly = [...arcPoints(bed.inner, ai0, ai1, step), ...arcPoints(bed.outer, ao1, ao0, step)];
  const u = (a: number): P2 => ({ x: Math.cos(a), z: Math.sin(a) });
  const tan = (a: number, s: number): P2 => ({ x: -Math.sin(a) * s, z: Math.cos(a) * s });
  const corners: Array<[P2, P2, P2]> = [
    [polar(bed.inner, ai0), tan(ai0, 1), u(a0)],
    [polar(bed.inner, ai1), tan(ai1, -1), u(a1)],
    [polar(bed.outer, ao1), tan(ao1, -1), { x: -Math.cos(a1), z: -Math.sin(a1) }],
    [polar(bed.outer, ao0), tan(ao0, 1), { x: -Math.cos(a0), z: -Math.sin(a0) }],
  ];
  let out = poly;
  for (const [c, d1, d2] of corners) {
    const nx = d1.x + d2.x, nz = d1.z + d2.z, len = Math.hypot(nx, nz) || 1;
    const n = { x: nx / len, z: nz / len };
    out = clipHalfPlane(out, c, n, CHAMFER * (d1.x * n.x + d1.z * n.z));
  }
  return out;
}

function signedArea(poly: P2[]): number {
  let s = 0;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length];
    s += a.x * b.z - b.x * a.z;
  }
  return s / 2;
}

function kerbsOf(poly: P2[]): Box2[] {
  const inward = Math.sign(signedArea(poly)) || 1;
  const out: Box2[] = [];
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length];
    const dx = b.x - a.x, dz = b.z - a.z, len = Math.hypot(dx, dz);
    if (len < 0.05) continue;
    const nx = (-dz / len) * inward, nz = (dx / len) * inward;
    out.push({ x: (a.x + b.x) / 2 + nx * (BED.kerbT / 2), z: (a.z + b.z) / 2 + nz * (BED.kerbT / 2), hx: len / 2 + 0.04, hz: BED.kerbT / 2, yaw: yawOf(dx, dz), h: BED.kerbH });
  }
  return out;
}

function lanternsOf(poly: P2[], bed: Ring2): P2[] {
  const out: P2[] = [];
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i], q = poly[(i + 1) % poly.length];
    const len = Math.hypot(q.x - p.x, q.z - p.z);
    const mid = { x: (p.x + q.x) / 2, z: (p.z + q.z) / 2 };
    const r = Math.hypot(mid.x, mid.z);
    if (Math.abs(len - CHAMFER * Math.SQRT2) > 0.35 || r < bed.inner + 0.1 || r > bed.outer - 0.1) continue;
    const toward = 0.42 / (r || 1);
    const s = r < (bed.inner + bed.outer) / 2 ? 1 : -1;
    out.push({ x: mid.x + mid.x * toward * s, z: mid.z + mid.z * toward * s });
  }
  return out;
}

function arcBoxes(r: number, a0: number, a1: number, maxLen: number, t: number, h: number): Box2[] {
  const count = Math.max(1, Math.ceil((Math.abs(a1 - a0) * r) / maxLen));
  const step = (a1 - a0) / count;
  const out: Box2[] = [];
  for (let i = 0; i < count; i++) {
    const am = a0 + step * (i + 0.5);
    const rc = r * Math.cos(step / 2);
    out.push({ ...polar(rc, am), hx: Math.abs(r * Math.sin(step / 2)) + 0.03, hz: t / 2, yaw: tangentYaw(am), h });
  }
  return out;
}

function buildTrees(hedgeR: number): Tree2[] {
  const rnd = rand(1729);
  const trees: Tree2[] = [];
  const count = Math.round((TAU * (hedgeR + 6)) / 5.2);
  for (let i = 0; i < count; i++) {
    const a = ((i + rnd() * 0.6) / count) * TAU;
    const r = hedgeR + 3.2 + rnd() * 5.5 + (i % 2) * 2.4;
    const canopyR = 1.7 + rnd() * 1.3;
    trees.push({ ...polar(r, a), canopyR, canopyY: 3.6 + canopyR * 0.9 + rnd() * 1.2 });
  }
  return trees;
}

// ---- pockets -------------------------------------------------------------------------------------------------------------

/** How far a pocket reaches out from its wall at `along` metres from its middle (a rounded end, 1.1 m at the middle). */
export function pocketReach(along: number): number {
  const t = Math.min(1, Math.abs(along) / (POCKET.len / 2));
  return POCKET.out * Math.pow(Math.max(0, 1 - t * t * t), 1 / 3);
}

/** A pocket's sill line in plan: from one end on the wall, out round its rounded front and back to the wall. */
export function pocketOutline(pk: Pick<Pocket, "face" | "dir" | "a">, n = 22): P2[] {
  const pts: P2[] = [];
  for (let i = 0; i <= n; i++) {
    const t = -1 + (2 * i) / n;
    const along = (t * POCKET.len) / 2;
    pts.push(polar(pk.face + pk.dir * pocketReach(along), pk.a + along / pk.face));
  }
  return pts;
}

/** The pocket on `bank` at this polar angle (nearest by angle), and where the point sits relative to it. */
export function pocketAt(plan: RiverPlan, bank: Bank, a: number): { pk: Pocket; along: number } {
  let best = plan.pockets[0];
  let bestD = Infinity;
  for (const pk of plan.pockets) {
    if (pk.bank !== bank) continue;
    const d = Math.abs(wrapAngle(a - pk.a));
    if (d < bestD) {
      bestD = d;
      best = pk;
    }
  }
  return { pk: best, along: wrapAngle(a - best.a) * best.face };
}

// ---- the plan ------------------------------------------------------------------------------------------------------------

export function buildRiverPlan(): RiverPlan {
  const beds: Ring2[] = [];
  for (let b = 0; b * 2 < RINGS.length; b++) beds.push({ inner: RINGS[b * 2].radius - BED.margin, outer: RINGS[b * 2 + 1].radius + BED.margin });
  const ring = (inner: number, outer: number, name: string): PathRing2 => ({ inner, outer, r: (inner + outer) / 2, name });
  const towIn = ring(beds[0].outer, beds[0].outer + PATH_W, "inner towpath");
  const c0 = towIn.outer;
  const wIn = c0 + RIVER.coping;
  const wOut = wIn + RIVER.water;
  const c1 = wOut + RIVER.coping;
  const river = { c0, wIn, wOut, c1, mid: (wIn + wOut) / 2 };
  const towOut = ring(c1, c1 + PATH_W, "outer towpath");
  const paths = [ring(DAIS.r, beds[0].inner, "inner path"), towIn, towOut, ring(beds[1].outer, beds[2].inner, "ring path"), ring(beds[2].outer, beds[2].outer + PROMENADE, "promenade")];
  const promenade = paths[4];

  // avenues: the diagonals run from the inner path to the promenade, broken by the river (the bridge carries them);
  // the cardinal avenues start at the outer towpath
  const avenues: AvenueSeg[] = [];
  for (const a of OUTER_AV) {
    const diag = INNER_AV.some((x) => Math.abs(x - a) < 1e-6);
    if (diag) {
      avenues.push({ angle: a, from: paths[0].r, to: c0 });
      avenues.push({ angle: a, from: c1, to: promenade.r });
    } else avenues.push({ angle: a, from: towOut.r, to: promenade.r });
  }

  const sectors: Sector2[] = [];
  const kerbs: Box2[] = [];
  const lanterns: P2[] = [];
  beds.forEach((bed, b) => {
    const avs = b === 0 ? INNER_AV : OUTER_AV;
    for (let k = 0; k < avs.length; k++) {
      const a1 = k + 1 < avs.length ? avs[k + 1] : avs[0] + TAU;
      const points = sectorOutline(bed, avs[k], a1, 1.0);
      sectors.push({ bed: b, points, rMin: bed.inner - 0.05, rMax: bed.outer + 0.05 });
      kerbs.push(...kerbsOf(points));
      lanterns.push(...lanternsOf(points, bed));
    }
  });

  // plazas where an avenue crosses a ring path; on a towpath the paving stops at the coping
  const plazas: Plaza2[] = [];
  for (const p of paths) {
    for (const a of OUTER_AV) {
      const crosses = avenues.some((av) => Math.abs(av.angle - a) < 1e-6 && p.r >= av.from - 0.01 && p.r <= av.to + 0.01);
      const onTow = p === towIn || p === towOut;
      const diag = INNER_AV.some((x) => Math.abs(x - a) < 1e-6);
      if (!crosses && !(onTow && diag)) continue;
      const half = (p.outer - p.inner) / 2;
      plazas.push({ ...polar(p.r, a), r: Math.hypot(half + 0.3, AVENUE_HALF + CHAMFER) + 0.1, rMin: p === towOut ? c1 : 0, rMax: p === towIn ? c0 : Infinity });
    }
  }

  const hedgeR = promenade.outer + LAWN;
  const hedge = arcBoxes(hedgeR + HEDGE_SPEC.t / 2, 0, TAU, 2.2, HEDGE_SPEC.t, HEDGE_SPEC.h);

  // bridges
  const B = BRIDGE;
  const uA = c0, uB = wIn + B.flare, uC = wOut - B.flare, uD = c1;
  const face: ReadonlyArray<readonly [number, number]> = [
    [uA, B.mouthHalf],
    [wIn, B.mouthHalf],
    [uB, B.deckHalf],
    [uC, B.deckHalf],
    [wOut, B.mouthHalf],
    [uD, B.mouthHalf],
  ];
  const span = (RIVER.water - 2 * B.pierT) / 3;
  const bridges: Bridge[] = INNER_AV.map((a) => {
    const U = { x: Math.cos(a), z: Math.sin(a) }, V = { x: -U.z, z: U.x };
    const w = (u: number, v: number): P2 => ({ x: U.x * u + V.x * v, z: U.z * u + V.z * v });
    const deck = [...face.map(([u, v]) => w(u, v + B.parT)), ...face.slice().reverse().map(([u, v]) => w(u, -v - B.parT))];
    const parapets: P2[][] = [];
    const parBoxes: Box2[] = [];
    for (const s of [1, -1]) {
      const inner = face.map(([u, v]) => w(u, s * v));
      const outer = face.slice().reverse().map(([u, v]) => w(u, s * (v + B.parT)));
      parapets.push([...inner, ...outer]);
      for (let i = 0; i < face.length - 1; i++) {
        const [u0, v0] = face[i], [u1, v1] = face[i + 1];
        const p0 = w(u0, s * (v0 + B.parT / 2)), p1 = w(u1, s * (v1 + B.parT / 2));
        const dx = p1.x - p0.x, dz = p1.z - p0.z, len = Math.hypot(dx, dz);
        if (len < 0.05) continue;
        parBoxes.push({ x: (p0.x + p1.x) / 2, z: (p0.z + p1.z) / 2, hx: len / 2 + 0.03, hz: B.parT / 2, yaw: yawOf(dx, dz), h: BARRIER_H });
      }
    }
    const lamps: P2[] = [];
    for (const u of [uA + 0.12, uD - 0.12]) for (const s of [1, -1]) lamps.push(w(u, s * (B.mouthHalf + B.parT / 2)));
    const piers = [wIn + span + B.pierT / 2, wIn + 2 * span + 1.5 * B.pierT];
    return { a, deck, parapets, face, parBoxes, lamps, piers, span };
  });
  const mouthOuter = B.mouthHalf + B.parT;
  const bridgeHalfAngle = (r: number, extra = 0) => Math.asin(Math.min(1, (mouthOuter + extra) / r));

  // coping barriers, broken at each bridge mouth (they end inside the parapets' end piers)
  const copings: Box2[] = [];
  for (const r of [(c0 + wIn) / 2, (wOut + c1) / 2]) {
    const ha = bridgeHalfAngle(r, -0.12);
    for (let k = 0; k < 4; k++) copings.push(...arcBoxes(r, INNER_AV[k] + ha, INNER_AV[(k + 1) % 4] + (k === 3 ? TAU : 0) - ha, 1.5, RIVER.coping, BARRIER_H));
  }

  // pockets: 6 a quarter on the inner bank, 8 on the outer, centred between the bridges at a 2.7 m pitch
  const pockets: Pocket[] = [];
  for (const [bank, face, dir] of [
    ["in", wIn, 1],
    ["out", wOut, -1],
  ] as const) {
    const n = POCKET.perArc[bank];
    const rl = face + dir * POCKET.lotusOut;
    for (let arc = 0; arc < 4; arc++) {
      const mid = INNER_AV[arc] + Math.PI / 4;
      for (let place = 0; place < n; place++) {
        const a = (mid + ((place - (n - 1) / 2) * POCKET.pitch) / rl + TAU) % TAU;
        const parkR = bank === "in" ? c0 - PARK_OFF : c1 + PARK_OFF;
        const sa = a + 0.45 / rl;
        const stakeR = bank === "in" ? (c0 + wIn) / 2 : (wOut + c1) / 2;
        const stakeYaw = bank === "in" ? yawOf(-Math.cos(sa), -Math.sin(sa)) : yawOf(Math.cos(sa), Math.sin(sa));
        pockets.push({ bank, face, dir, arc, place, a, r: rl, ...polar(rl, a), park: polar(parkR, a), stake: { ...polar(stakeR, sa), yaw: stakeYaw }, order: -1, index: -1 });
      }
    }
  }
  // sowing order: banks interleaved 3:4 (inner first); within a bank the bed rings' rule (arcs 0, 2, 1, 3; places
  // spread from the middle out)
  const seen: Record<Bank, number> = { in: 0, out: 0 };
  for (let k = 0; k < pockets.length; k++) {
    const bank = BANK_PATTERN[k % BANK_PATTERN.length];
    const s = seen[bank]++;
    const n = POCKET.perArc[bank];
    const arc = ARC_ORDER[4][s % 4];
    const place = spreadOrder(n)[Math.floor(s / 4)];
    const pk = pockets.find((p) => p.bank === bank && p.arc === arc && p.place === place)!;
    pk.order = k;
    pk.index = WATER_BASE + k;
  }
  pockets.sort((p, q) => p.order - q.order);

  // dressing: reeds at every bridge mouth (both banks, both sides) with stones beside them; in the 0.5 m gaps between
  // pockets, reeds and stones alternate
  const dressing: Dressing[] = [];
  let seed = 1;
  for (const b of bridges) {
    for (const [face, dir] of [
      [wIn, 1],
      [wOut, -1],
    ] as const) {
      for (const s of [1, -1]) {
        const r = face + dir * 0.32;
        dressing.push({ kind: "reeds", ...polar(r, b.a + (s * 3.15) / r), dir, seed: seed++ });
        dressing.push({ kind: "stones", ...polar(r + dir * 0.35, b.a + (s * 2.75) / r), dir, seed: seed++ });
      }
    }
  }
  for (const bank of ["in", "out"] as const) {
    const ps = pockets.filter((p) => p.bank === bank).sort((p, q) => p.arc - q.arc || p.place - q.place);
    for (let i = 0; i < ps.length - 1; i++) {
      const p = ps[i], q = ps[i + 1];
      if (p.arc !== q.arc) continue;
      const r = p.face + p.dir * 0.28;
      dressing.push({ kind: (p.place + (bank === "in" ? 0 : 1)) % 2 === 0 ? "reeds" : "stones", ...polar(r, (p.a + q.a) / 2), dir: p.dir, seed: seed++ });
    }
  }

  // bed plots: the server's order and angle rule (plots.ts), on the moved rings
  const plots: BedPlot[] = [];
  let index = 0;
  RINGS.forEach(({ radius, count }, ri) => {
    const avs = ri < 2 ? INNER_AV : OUTER_AV;
    const arcs = avs.length, perArc = count / arcs, order = spreadOrder(perArc);
    const bed = Math.floor(ri / 2);
    const inner = ri % 2 === 0;
    for (let slot = 0; slot < count; slot++) {
      const arc = ARC_ORDER[arcs][slot % arcs], place = order[Math.floor(slot / arcs)];
      const from = avs[arc], to = arc + 1 < arcs ? avs[arc + 1] : avs[0] + TAU;
      const clear = AVENUE_GAP / 2 / radius;
      const a = (from + clear + ((place + 0.5) / perArc) * (to - from - 2 * clear)) % TAU;
      const parkR = inner ? beds[bed].inner - PARK_OFF : beds[bed].outer + PARK_OFF;
      const sr = radius + (inner ? -1 : 1) * 0.37;
      const sa = a + 0.3 / radius;
      plots.push({
        index: index++,
        ring: ri,
        a,
        r: radius,
        ...polar(radius, a),
        bed,
        side: inner ? "inner" : "outer",
        park: polar(parkR, a),
        stake: { ...polar(sr, sa), yaw: inner ? yawOf(-Math.cos(sa), -Math.sin(sa)) : yawOf(Math.cos(sa), Math.sin(sa)) },
      });
    }
  });

  return {
    beds,
    paths,
    towIn,
    towOut,
    river,
    avenues,
    sectors,
    kerbs,
    lanterns,
    plazas,
    hedgeR,
    groundR: hedgeR + 16,
    hedge,
    trees: buildTrees(hedgeR),
    bridges,
    copings,
    pockets,
    dressing,
    plots,
  };
}

let cached: RiverPlan | null = null;
/** The plan, built once. */
export function riverPlan(): RiverPlan {
  if (!cached) cached = buildRiverPlan();
  return cached;
}

/** True inside a planted bed of the plan (within a bed's outline). */
export function inPlanBed(plan: RiverPlan, x: number, z: number): boolean {
  const r = Math.hypot(x, z);
  for (const s of plan.sectors) {
    if (r < s.rMin || r > s.rMax) continue;
    let inside = false;
    const poly = s.points;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const a = poly[i], b = poly[j];
      if (a.z > z !== b.z > z && x < ((b.x - a.x) * (z - a.z)) / (b.z - a.z) + a.x) inside = !inside;
    }
    if (inside) return true;
  }
  return false;
}

/** The flow's direction at (x, z): along the ring toward decreasing polar angle. */
export function flowDir(x: number, z: number): P2 {
  const r = Math.hypot(x, z) || 1;
  return { x: z / r, z: -x / r };
}

// ---- the party, and the section the preview dresses ---------------------------------------------------------------------

/** At the party: 300 plantings, 18% lotus (54 in pockets, 2 free), 246 soil seeds in the lowest bed plots. */
export const PARTY = { people: 300, lotusShare: 0.18 } as const;
export function partyFill(people: number = PARTY.people, share: number = PARTY.lotusShare, pockets = 56) {
  const lotus = Math.round(people * share);
  const inPockets = Math.min(lotus, pockets);
  return { lotus, inPockets, overflow: lotus - inPockets, soil: people - lotus, freePockets: pockets - inPockets };
}
