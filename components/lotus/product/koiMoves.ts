// How the product's three koi move with the pond model (components/lotus/product/LiveKoi.tsx draws them): their own
// slow loops from the concepts page (koi.ts KOI), reshaped as the model and the owner's care ask. Pure three.js and
// numbers, no DOM, so the rules can be checked in a unit test.
//
// - A pinch (the owner's "Tend the pond", pinchAt on this device): the pellets land on the open water at the tank's
//   front right, below the jar, where the owner stands; the koi come up to it within a few seconds, mill there just
//   under the surface taking them (a ring at a snout every second or two) for about forty seconds, and drift back to
//   their loops over the next twenty. The model's own "gathered" flag (koiGather, the two hours after any pinch, from
//   any device) keeps them a little nearer that corner, never the full crowd.
// - Hungry koi (the model's koiHunger past a quarter, the hours when it says they nose the young leaves): their loops
//   draw in round the pot, shallow under the floating leaves on the inner side (a nibble's ring now and then, and the
//   leaves knock: LotusPlant's nibble), back through the deep water behind it.
// - Green water at dawn (koiGasp, after a grey day): they hang at the surface, slow, gulping (rings every second or so).
// Every path keeps the page's rules (koi.ts): inside the walls by 6 cm, 30 cm from the pot's centre, over the shelf.
import * as THREE from "three";
import { smoothstep } from "@/lib/plant/prng";
import { KOI, KOI_POT, koiCurve, type KoiSpec } from "@/components/lotus/koi";

type P3 = readonly [number, number, number];

/** Where the pellets land (pond frame x, z): open water at the front right, clear of the leaves, below the jar. */
export const FEED_SPOT = { x: 0.46, z: 0.28 } as const;

/** How long a pinch's crowd lasts (s): coming up, milling, drifting back. */
export const PINCH = { arrive: 3.5, hold: 40, leave: 20 } as const;

/** The model's lingering after any pinch, and how much of the pond a hungry or gasping school takes over. */
const LINGER = 0.3;

/** Each fish's milling loop at the feeding spot: a small oval just under the surface, offset so the three jostle. */
function gatherPath(k: number): P3[] {
  const off = [
    [-0.03, -0.02],
    [0.025, 0.015],
    [0.0, 0.035],
  ][k % 3];
  const cx = FEED_SPOT.x + off[0];
  const cz = FEED_SPOT.z + off[1];
  const out: P3[] = [];
  const n = 8;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 * (k === 1 ? -1 : 1) + k * 2.1;
    out.push([cx + Math.cos(a) * 0.07, -0.032 - 0.012 * Math.sin(a * 2 + k), cz + Math.sin(a) * 0.055]);
  }
  return out;
}

/**
 * The hungry round: in along the inner arc behind the pot, shallow under the floating leaves (left to right), out along
 * a wider, deeper arc back (right to left). Nested, so it never crosses itself.
 */
const CIRCLE: readonly P3[] = [
  [-0.36, -0.05, 0.38],
  [-0.34, -0.045, 0.16],
  [-0.22, -0.05, -0.02],
  [0.0, -0.055, -0.08],
  [0.22, -0.05, -0.02],
  [0.34, -0.045, 0.16],
  [0.36, -0.05, 0.38],
  [0.44, -0.08, 0.12],
  [0.3, -0.1, -0.2],
  [0.0, -0.11, -0.3],
  [-0.3, -0.1, -0.2],
  [-0.44, -0.08, 0.12],
];

/** The depth a gasping fish holds (m under the fill line): its back just under, its mouth at the surface. */
const GASP_DEPTH = -0.022;
/** How far inside the walls a fish keeps (x, z half-extents of the water less 6 cm). */
const INSIDE = { x: 0.58, z: 0.45 } as const;

/**
 * A point (pond frame) as seen from the pot's centre: its bearing (0 straight behind the pot, +-pi straight in front,
 * where no fish passes: the pot stands 4 cm from the front wall) and its distance. Paths are blended in these terms, so
 * a fish changing course swings round behind the pot instead of cutting across it.
 */
export function aroundPot(x: number, z: number): { bearing: number; reach: number } {
  const dx = x - KOI_POT.x;
  const dz = z - KOI_POT.z;
  return { bearing: Math.atan2(dx, -dz), reach: Math.hypot(dx, dz) };
}

/** Back from aroundPot's terms to the pond frame, clear of the pot and inside the walls, into `out` (y untouched). */
export function fromPot(bearing: number, reach: number, out: THREE.Vector3): THREE.Vector3 {
  const r = Math.max(KOI_POT.clear, reach);
  out.x = Math.min(INSIDE.x, Math.max(-INSIDE.x, KOI_POT.x + r * Math.sin(bearing)));
  out.z = Math.min(INSIDE.z, Math.max(-INSIDE.z, KOI_POT.z - r * Math.cos(bearing)));
  return out;
}

const curveOf = (pts: readonly P3[]) => new THREE.CatmullRomCurve3(pts.map(([x, y, z]) => new THREE.Vector3(x, y, z)), true, "centripetal");

/** The weights a school's paths are blended by: gathered at the feeding spot, circling the pot, gasping at the top. */
export interface KoiMood {
  gather: number;
  circle: number;
  gasp: number;
}

const clamp01 = (x: number) => Math.min(1, Math.max(0, x));

/** How much of a pinch's crowd there is `since` seconds after it (0 before it and once it has drifted away). */
export function pinchCrowd(since: number): number {
  if (!(since >= 0)) return 0;
  const { arrive, hold, leave } = PINCH;
  if (since < arrive) return smoothstep(0, arrive, since);
  if (since < arrive + hold) return 1;
  return 1 - smoothstep(arrive + hold, arrive + hold + leave, since);
}

/**
 * The school's mood now: this device's pinch (`pinchAt`, epoch ms, 0 for none) gathers it fully; the model's flag after
 * any pinch keeps it lingering a little; hunger draws it round the pot (never while gathered); green water at dawn
 * holds it at the surface.
 */
export function koiMood(p: { koiGather: number; koiHunger: number; koiGasp: boolean; pinchAt: number }, nowMs: number): KoiMood {
  const crowd = p.pinchAt > 0 ? pinchCrowd((nowMs - p.pinchAt) / 1000) : 0;
  const gather = Math.max(crowd, LINGER * clamp01(p.koiGather));
  const circle = smoothstep(0.25, 0.6, p.koiHunger) * (1 - gather);
  return { gather, circle, gasp: p.koiGasp ? 1 - gather : 0 };
}

/** How fast a fish swims against its own cruising speed: darting for pellets, nosing round hungry, slow when gasping. */
export function koiPace(m: KoiMood): number {
  return (1 + 0.45 * m.gather + 0.15 * m.circle) * (1 - 0.4 * m.gasp);
}

/** Seconds between a fish's rings on the water for a mood: once in a long while; taking pellets; gulping; nibbling. */
export function ringGap(m: KoiMood): number {
  const calm = 16;
  const busy = m.gather > 0.6 ? 1.6 : m.gasp > 0.5 ? 1.3 : m.circle > 0.5 ? 4.5 : calm;
  return busy;
}

/**
 * One fish's path, reshaped live: its own loop blended toward its milling loop and the hungry round by the mood's
 * weights (point by point at the same share of the way round, so the blend is always a closed path), then lifted
 * toward the surface for a gasp. Its arc lengths are measured again whenever the weights have moved.
 */
export class MorphPath extends THREE.Curve<THREE.Vector3> {
  readonly own: THREE.CatmullRomCurve3;
  readonly mill: THREE.CatmullRomCurve3;
  readonly round: THREE.CatmullRomCurve3;
  private readonly w: KoiMood = { gather: 0, circle: 0, gasp: 0 };
  private readonly a = new THREE.Vector3();
  private readonly b = new THREE.Vector3();
  private readonly c = new THREE.Vector3();

  constructor(spec: KoiSpec, k: number) {
    super();
    this.own = koiCurve(spec);
    this.mill = curveOf(gatherPath(k));
    this.round = curveOf(CIRCLE);
    this.arcLengthDivisions = 64;
  }

  /** Sets the blend; true when it moved enough to have re-measured the path. */
  setMood(m: KoiMood): boolean {
    const w = this.w;
    if (Math.abs(w.gather - m.gather) < 0.008 && Math.abs(w.circle - m.circle) < 0.008 && Math.abs(w.gasp - m.gasp) < 0.008) return false;
    w.gather = m.gather;
    w.circle = m.circle;
    w.gasp = m.gasp;
    this.updateArcLengths();
    return true;
  }

  override getPoint(t: number, out = new THREE.Vector3()): THREE.Vector3 {
    const { gather, circle, gasp } = this.w;
    const u = ((t % 1) + 1) % 1;
    this.own.getPoint(u, this.a);
    this.round.getPoint(u, this.c);
    this.mill.getPoint(u, this.b);
    const own = Math.max(0, 1 - gather - circle);
    if (own >= 1) out.copy(this.a);
    else {
      // (aroundPot inline, so the frame loop allocates nothing)
      const { a, b, c } = this;
      const px = KOI_POT.x;
      const pz = KOI_POT.z;
      const bearing = Math.atan2(a.x - px, pz - a.z) * own + Math.atan2(b.x - px, pz - b.z) * gather + Math.atan2(c.x - px, pz - c.z) * circle;
      const reach = Math.hypot(a.x - px, a.z - pz) * own + Math.hypot(b.x - px, b.z - pz) * gather + Math.hypot(c.x - px, c.z - pz) * circle;
      fromPot(bearing, reach, out);
      out.y = this.a.y * own + this.b.y * gather + this.c.y * circle;
    }
    out.y += (GASP_DEPTH - out.y) * 0.85 * gasp;
    return out;
  }
}

/** The three fish's paths. */
export function morphPaths(): MorphPath[] {
  return KOI.map((spec, k) => new MorphPath(spec, k));
}

/** The nearest a path comes to the pot's centre and to the walls (m), and its shallowest and deepest points: the rules' check. */
export function pathReach(curve: THREE.Curve<THREE.Vector3>, n = 240): { pot: number; wallX: number; wallZ: number; top: number; bottom: number } {
  const p = new THREE.Vector3();
  let pot = Infinity;
  let wallX = Infinity;
  let wallZ = Infinity;
  let top = -Infinity;
  let bottom = Infinity;
  for (let i = 0; i < n; i++) {
    curve.getPoint(i / n, p);
    pot = Math.min(pot, Math.hypot(p.x - KOI_POT.x, p.z - KOI_POT.z));
    wallX = Math.min(wallX, 0.64 - Math.abs(p.x));
    wallZ = Math.min(wallZ, 0.51 - Math.abs(p.z));
    top = Math.max(top, p.y);
    bottom = Math.min(bottom, p.y);
  }
  return { pot, wallX, wallZ, top, bottom };
}
