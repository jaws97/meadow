// The lazy river's ambient koi (the owner asked for koi wherever the lotus grows in water: "for other flowers we have
// butterflies, here we have fishes"): twelve grown koi, scenery only (nobody owns them; owned koi are the personal
// pond's), cruising slow laps of the ring in loose company, some up the current and some down it. Pure: no DOM, so
// the paths' rules can be checked in a unit test (koiLanes.test.ts).
//
// Each fish is the pond's own koi (koi.ts: the same body, fins, paint and swimming), grown to a public garden's size,
// on a closed path once round the ring. A path keeps to the open channel: clear of the pockets' sill stones on both
// banks (1.1 m out from each wall, plus the stones), of the ledge stones and reeds along the walls, and under each
// bridge it threads the middle span between the two piers. The fish are drawn just under the opaque water's surface
// (RiverKoi.tsx), so their depth is a number per fish along the path, not a position.
//
// Sizes: drawn 44-62 cm, a garden canal's fish of a few years. Pond-keeping guides put grown koi at roughly 60-90 cm
// (e.g. guidarium.com/fishes/koi gives about 80 cm); FishBase's 28 cm maximum for Cyprinus rubrofuscus describes wild
// fish (fishbase.se/summary/59920). Speeds (0.1-0.17 m/s, an unhurried cruise) are an art choice, not a measurement.
import { BRIDGE, POCKET, riverPlan, type RiverPlan } from "@/components/lotus/river/plan";
import type { KoiSpec, KoiVariety } from "@/components/lotus/koi";

const TAU = Math.PI * 2;
/** Waypoints once round the ring (about 1.6 m apart at the channel's middle). */
export const KOI_WAYPOINTS = 64;
/** How near a fish's middle line comes to the sill stones' outer edge (its half-width and a little water). */
const SILL_CLEAR = 0.2;
/** The stones round a pocket's front stand this far beyond its sill line. */
const SILL_STONES = 0.12;

export interface RiverKoiSpec {
  variety: KoiVariety;
  seed: number;
  /** snout to the tail fin's tip, m */
  length: number;
  /** cruising speed, m/s */
  speed: number;
  /** +1 up the current (toward increasing polar angle), -1 down it */
  dir: 1 | -1;
  /** where the fish is at the page's still time: its polar angle */
  stillAngle: number;
  /** its line across the channel: how far from the middle it may swing (a share of the room there) and the swing's phase */
  swing: number;
  phase: number;
  /** waves of the swing once round the ring */
  waves: number;
  /** depth of its back under the surface, m: a mean and a slow change round the ring */
  depth: number;
  depthSwing: number;
}

/**
 * The twelve: three groups the preview's cameras see at the still time (by the near bridge, between it and the parked
 * cart, and in front of the side-on bridge), and the rest spread round the ring for the overview.
 */
export const RIVER_KOI: readonly RiverKoiSpec[] = [
  // between the near bridge and the cart (the product camera), and in front of the near bridge's lotus (close)
  { variety: "kohaku", seed: 21, length: 0.56, speed: 0.12, dir: 1, stillAngle: 0.43, swing: 0.75, phase: 1.7, waves: 7, depth: 0.102, depthSwing: 0.03 },
  { variety: "ogon", seed: 22, length: 0.5, speed: 0.12, dir: 1, stillAngle: 0.5, swing: 0.75, phase: 1.9, waves: 7, depth: 0.07, depthSwing: 0.024 },
  { variety: "sanke", seed: 23, length: 0.46, speed: 0.13, dir: 1, stillAngle: 0.56, swing: 0.4, phase: 3.1, waves: 9, depth: 0.134, depthSwing: 0.03 },
  // left of the near bridge
  { variety: "kohaku", seed: 24, length: 0.6, speed: 0.1, dir: -1, stillAngle: 1.02, swing: 0.6, phase: 0.9, waves: 6, depth: 0.118, depthSwing: 0.036 },
  { variety: "sanke", seed: 25, length: 0.52, speed: 0.11, dir: -1, stillAngle: 1.1, swing: 0.8, phase: 2.6, waves: 8, depth: 0.086, depthSwing: 0.024 },
  // in front of the side-on bridge (polar angle 7 pi / 4)
  { variety: "ogon", seed: 26, length: 0.54, speed: 0.14, dir: 1, stillAngle: 5.66, swing: 0.5, phase: 4.2, waves: 7, depth: 0.094, depthSwing: 0.03 },
  { variety: "kohaku", seed: 27, length: 0.48, speed: 0.14, dir: 1, stillAngle: 5.74, swing: 0.7, phase: 5.0, waves: 8, depth: 0.078, depthSwing: 0.024 },
  { variety: "sanke", seed: 28, length: 0.58, speed: 0.12, dir: -1, stillAngle: 5.86, swing: 0.45, phase: 0.2, waves: 6, depth: 0.142, depthSwing: 0.03 },
  // round the rest of the ring
  { variety: "kohaku", seed: 29, length: 0.5, speed: 0.16, dir: 1, stillAngle: 1.9, swing: 0.6, phase: 1.2, waves: 7, depth: 0.11, depthSwing: 0.036 },
  { variety: "ogon", seed: 30, length: 0.44, speed: 0.17, dir: -1, stillAngle: 2.75, swing: 0.7, phase: 2.2, waves: 9, depth: 0.086, depthSwing: 0.03 },
  { variety: "sanke", seed: 31, length: 0.55, speed: 0.13, dir: 1, stillAngle: 3.5, swing: 0.5, phase: 3.7, waves: 6, depth: 0.118, depthSwing: 0.03 },
  { variety: "kohaku", seed: 32, length: 0.62, speed: 0.11, dir: -1, stillAngle: 4.4, swing: 0.65, phase: 4.6, waves: 8, depth: 0.134, depthSwing: 0.036 },
];

/** The open water along the channel: the band of radius a fish's middle line may use, clear of the pockets' stones on
 * both banks (as if every place had a pocket; the gaps between them are only 0.5 m). */
export function channelBand(P: RiverPlan): { lo: number; hi: number } {
  const { wIn, wOut } = P.river;
  return { lo: wIn + POCKET.out + SILL_STONES + SILL_CLEAR, hi: wOut - POCKET.out - SILL_STONES - SILL_CLEAR };
}

/** Under a bridge: the middle span between its two piers, less a fish's half-width and a little water. */
export function spanBand(P: RiverPlan): { lo: number; hi: number } {
  const b = P.bridges[0];
  return { lo: b.piers[0] + BRIDGE.pierT / 2 + 0.16, hi: b.piers[1] - BRIDGE.pierT / 2 - 0.16 };
}

/** How far either side of a bridge's middle line (m, along the channel) a fish keeps to the middle span. */
export const SPAN_REACH = BRIDGE.mouthHalf + BRIDGE.parT + 1.4;
/** Over how many metres beyond that the band eases from the open channel's to the span's. */
const SPAN_EASE = 3.5;

/** The band at polar angle a: the open channel's, eased into each bridge's middle span, so paths bend gently. */
export function koiBand(P: RiverPlan, a: number): { lo: number; hi: number } {
  const open = channelBand(P);
  const span = spanBand(P);
  let k = 0;
  for (const b of P.bridges) {
    let d = a - b.a;
    d = Math.atan2(Math.sin(d), Math.cos(d));
    const m = Math.abs(d * P.river.mid);
    const t = m <= SPAN_REACH ? 1 : m >= SPAN_REACH + SPAN_EASE ? 0 : 1 - (m - SPAN_REACH) / SPAN_EASE;
    k = Math.max(k, t * t * (3 - 2 * t));
  }
  return { lo: open.lo + (span.lo - open.lo) * k, hi: open.hi + (span.hi - open.hi) * k };
}

/** A fish's line across the channel at polar angle a: radius. */
export function koiRadius(P: RiverPlan, spec: RiverKoiSpec, a: number): number {
  const { lo, hi } = koiBand(P, a);
  const mid = (lo + hi) / 2;
  const half = (hi - lo) / 2;
  const w = 0.72 * Math.sin(a * spec.waves + spec.phase) + 0.28 * Math.sin(a * (spec.waves * 2 + 3) + spec.phase * 1.7);
  return mid + half * spec.swing * w;
}

/** A fish's depth (its back under the surface) at polar angle a, m. */
export function koiDepth(spec: RiverKoiSpec, a: number): number {
  return spec.depth + spec.depthSwing * Math.sin(a * 3 + spec.phase * 2.3);
}

/** The pond koi's spec for a river fish: its closed path once round the ring (world x, 0, z), and where it is at the still time. */
export function riverKoiSpec(spec: RiverKoiSpec, P: RiverPlan = riverPlan()): KoiSpec & { pathLength: number } {
  const n = KOI_WAYPOINTS;
  const path: Array<[number, number, number]> = [];
  for (let j = 0; j < n; j++) {
    const a = spec.dir * ((j / n) * TAU);
    const r = koiRadius(P, spec, a);
    path.push([r * Math.cos(a), 0, r * Math.sin(a)]);
  }
  let pathLength = 0;
  for (let j = 0; j < n; j++) {
    const p = path[j], q = path[(j + 1) % n];
    pathLength += Math.hypot(q[0] - p[0], q[2] - p[2]);
  }
  // how far along the path (from waypoint 0, at angle 0) the still angle lies
  const turn = (((spec.dir * spec.stillAngle) % TAU) + TAU) % TAU;
  return {
    variety: spec.variety,
    length: spec.length,
    speed: spec.speed,
    beat: 0.55 + 0.25 * (spec.speed / 0.17),
    stillArc: (turn / TAU) * pathLength,
    path,
    surfaceAt: 0,
    seed: spec.seed,
    pathLength,
  };
}
