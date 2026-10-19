// The Meadow's lazy river, Option A (the Rose Island moat), as plain numbers: everything about its build that does not
// decide plot order. lib/server/plots.ts holds what the server allocates by (the walls, RIVER_WALLS, and the pocket
// table); this file draws the rest round them, and layout.ts composes it into the Meadow's plan, as the river preview
// (components/lotus/river/plan.ts) does, from the same source.
//
// From the rose outward: the dais, the inner path and bed 0 are the island. The inner towpath runs round it; then a
// granite coping, 4.5 m of slow water, a coping and the outer towpath; beds 1 and 2 lie beyond. Four flat granite slab
// bridges cross on the diagonals (the inner bed's avenues), their decks level with the paving, three slabs of 1.27 m on
// two piers, with 0.45 m parapets flaring from 2.6 m between them over the water to a 4.0 m mouth over each coping, and
// a 2.2 m lamp post at every parapet end. 56 lotus pockets line the walls (6 a quarter on the inner bank, 8 on the
// outer), each a still planting shelf 2.2 m along the wall and 1.1 m out, one every 2.7 m, ringed by sill stones; reeds
// and stones dress the bridge mouths and the gaps between pockets. Levels are metres from the paving (y = 0): coping
// top +0.08, water -0.40, pocket shelf -0.55, wall ledge -0.70, channel bed -1.60. The water flows toward decreasing
// polar angle, left to right across the near reach as the party screen sees it.
//
// The cart cannot cross the water: an unseen barrier stands over each coping (broken only at the bridges' mouths, where
// it ends inside the parapets' end posts) and over each parapet, as tall as the kerbs' (PhysicsWorld, space.ts).
//
// Angles as layout.ts: a point at polar angle a sits at (r cos a, 0, r sin a). Pure: no three, no DOM. Its runtime
// imports come from plots.ts only (layout.ts builds its plan from this file when it loads, so this file never imports
// layout.ts at runtime), and it carries its own copies of layout.ts's small angle helpers.
import {
  avenueAngles,
  POCKET_COUNT,
  POCKET_LOTUS_OUT,
  POCKET_PITCH,
  pocketPlace,
  POCKETS_PER_QUARTER,
  pocketSpot,
  RIVER_WALLS,
  WATER_BASE,
  type PocketBank,
} from "@/lib/server/plots";
import type { Box2, P2 } from "@/components/meadow/layout";

const TAU = Math.PI * 2;

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
export const POCKET = { len: 2.2, out: 1.1, pitch: POCKET_PITCH, lotusOut: POCKET_LOTUS_OUT, perArc: POCKETS_PER_QUARTER } as const;
/** The bridge in its own frame: u = radius along its diagonal, v = across it. */
export const BRIDGE = { deckHalf: 1.3, mouthHalf: 2.0, parT: 0.3, flare: 1.15, pierT: 0.35, slabT: 0.25 } as const;
/** The current: metres a second for the two ripple layers, toward decreasing polar angle. */
export const FLOW = { fast: 0.1, slow: 0.06 } as const;
/** The cart cannot cross a coping or a parapet: an unseen barrier this tall over each (as the kerbs'). */
export const BARRIER_H = 1.4;
/** How far off the coping the cart pulls up beside a pocket's lotus (as beside a bed: layout.ts PARK_OFF). */
const PARK_OFF = 0.85;
export { WATER_BASE };

export type Bank = PocketBank;

/** The river's band, radii from the rose: the inner coping's land edge, the two walls (the water), the outer coping's. */
export interface RiverBand {
  c0: number;
  wIn: number;
  wOut: number;
  c1: number;
  /** the middle of the water, where a bridge's route node stands */
  mid: number;
}

export interface RiverPocket {
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
  /** where the cart pulls up to visit it, on the towpath beside its coping */
  park: P2;
  /** its name stake, on the coping's middle, facing the towpath */
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

/** What the river's drawing needs (components/lotus/river/River.tsx): its band, bridges, pockets and dressing. */
export interface RiverParts {
  band: RiverBand;
  bridges: Bridge[];
  pockets: RiverPocket[];
  dressing: Dressing[];
}

// ---- helpers (layout.ts's, copied: see the header) ---------------------------------------------------------------------
export const polar = (r: number, a: number): P2 => ({ x: r * Math.cos(a), z: r * Math.sin(a) });
const tangentYaw = (a: number) => Math.atan2(-Math.cos(a), -Math.sin(a));
const yawOf = (dx: number, dz: number) => Math.atan2(-dz, dx);
export function wrapAngle(a: number): number {
  a %= TAU;
  if (a > Math.PI) a -= TAU;
  else if (a <= -Math.PI) a += TAU;
  return a;
}

/** Barrier boxes along an arc of radius r from a0 to a1, `maxLen` metres apiece at most. */
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

/** The bridges stand on the inner bed's avenues, the diagonals. */
const bridgeAngles = (): readonly number[] => avenueAngles(0);

// ---- the band ------------------------------------------------------------------------------------------------------------

/** The river's radii, from its walls in plots.ts. */
export function riverBand(): RiverBand {
  const wIn = RIVER_WALLS.inner, wOut = RIVER_WALLS.outer;
  return { c0: wIn - RIVER.coping, wIn, wOut, c1: wOut + RIVER.coping, mid: (wIn + wOut) / 2 };
}

// ---- pockets -------------------------------------------------------------------------------------------------------------

/** How far a pocket reaches out from its wall at `along` metres from its middle (a rounded end, 1.1 m at the middle). */
export function pocketReach(along: number): number {
  const t = Math.min(1, Math.abs(along) / (POCKET.len / 2));
  return POCKET.out * Math.pow(Math.max(0, 1 - t * t * t), 1 / 3);
}

/** A pocket's sill line in plan: from one end on the wall, out round its rounded front and back to the wall. */
export function pocketOutline(pk: Pick<RiverPocket, "face" | "dir" | "a">, n = 22): P2[] {
  const pts: P2[] = [];
  for (let i = 0; i <= n; i++) {
    const t = -1 + (2 * i) / n;
    const along = (t * POCKET.len) / 2;
    pts.push(polar(pk.face + pk.dir * pocketReach(along), pk.a + along / pk.face));
  }
  return pts;
}

/** The pocket at `place` along quarter `arc` of `bank` (where plots.ts pocketSpot puts its lotus), as numbered. */
export function riverPocket(band: RiverBand, bank: Bank, arc: number, place: number, order: number, index: number): RiverPocket {
  const face = bank === "in" ? band.wIn : band.wOut;
  const dir = bank === "in" ? 1 : -1;
  const { radius: r, angle: a } = pocketSpot(bank, arc, place);
  const parkR = bank === "in" ? band.c0 - PARK_OFF : band.c1 + PARK_OFF;
  // the stake on the coping's middle, a little to one side of the lotus, facing the towpath
  const sa = a + 0.45 / r;
  const stakeR = bank === "in" ? (band.c0 + band.wIn) / 2 : (band.wOut + band.c1) / 2;
  const stakeYaw = bank === "in" ? yawOf(-Math.cos(sa), -Math.sin(sa)) : yawOf(Math.cos(sa), Math.sin(sa));
  return { bank, face, dir, arc, place, a, r, ...polar(r, a), park: polar(parkR, a), stake: { ...polar(stakeR, sa), yaw: stakeYaw }, order, index };
}

/** Every pocket in the server's sowing order (plots.ts): pocket k is plot WATER_BASE + k. */
export function buildPockets(band: RiverBand): RiverPocket[] {
  const out: RiverPocket[] = [];
  for (let k = 0; k < POCKET_COUNT; k++) {
    const p = pocketPlace(WATER_BASE + k)!;
    out.push(riverPocket(band, p.bank, p.arc, p.place, p.order, p.index));
  }
  return out;
}

// ---- bridges and copings -------------------------------------------------------------------------------------------------

/** The four bridges: decks, parapets (and their barrier boxes), lamp posts and piers. */
export function buildBridges(band: RiverBand): Bridge[] {
  const { c0, wIn, wOut, c1 } = band;
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
  const span = (wOut - wIn - 2 * B.pierT) / 3;
  return bridgeAngles().map((a) => {
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
}

/** The coping barriers, broken at each bridge mouth (they end inside the parapets' end posts). */
export function buildCopings(band: RiverBand): Box2[] {
  const { c0, wIn, wOut, c1 } = band;
  const av = bridgeAngles();
  const mouthOuter = BRIDGE.mouthHalf + BRIDGE.parT;
  const bridgeHalfAngle = (r: number, extra = 0) => Math.asin(Math.min(1, (mouthOuter + extra) / r));
  const copings: Box2[] = [];
  for (const r of [(c0 + wIn) / 2, (wOut + c1) / 2]) {
    const ha = bridgeHalfAngle(r, -0.12);
    for (let k = 0; k < 4; k++) copings.push(...arcBoxes(r, av[k] + ha, av[(k + 1) % 4] + (k === 3 ? TAU : 0) - ha, 1.5, RIVER.coping, BARRIER_H));
  }
  return copings;
}

// ---- dressing ------------------------------------------------------------------------------------------------------------

/**
 * Reeds at every bridge mouth (both banks, both sides) with stones beside them; in the 0.5 m gaps between pockets, reeds
 * and stones alternate.
 */
export function buildDressing(band: RiverBand, bridges: readonly Bridge[], pockets: readonly RiverPocket[]): Dressing[] {
  const { wIn, wOut } = band;
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
      // (halfway round the short way: in the quarter that crosses angle 0 the two pockets' angles straddle it)
      const a = p.a + wrapAngle(q.a - p.a) / 2;
      dressing.push({ kind: (p.place + (bank === "in" ? 0 : 1)) % 2 === 0 ? "reeds" : "stones", ...polar(r, a), dir: p.dir, seed: seed++ });
    }
  }
  return dressing;
}

/** The flow's direction at (x, z): along the ring toward decreasing polar angle. */
export function flowDir(x: number, z: number): P2 {
  const r = Math.hypot(x, z) || 1;
  return { x: z / r, z: -x / r };
}

// ---- the river -----------------------------------------------------------------------------------------------------------

/** The whole river for the Meadow: its parts, and the barrier boxes of its copings and parapets. */
export function buildRiver(): RiverParts & { copings: Box2[]; parapets: Box2[] } {
  const band = riverBand();
  const bridges = buildBridges(band);
  const pockets = buildPockets(band);
  return {
    band,
    bridges,
    pockets,
    dressing: buildDressing(band, bridges, pockets),
    copings: buildCopings(band),
    parapets: bridges.flatMap((b) => b.parBoxes),
  };
}
