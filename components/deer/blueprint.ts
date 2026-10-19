// The doe as drawn from the side: an adult female chital (Axis axis), 0.71 m at the withers, standing square and
// relaxed, her head carried naturally. Metres, with the origin on the ground under her withers, +x toward her head, +y
// up and +z to her right. She is a background animal, seen mostly side-on from 4.5-8 m, so the side outline is what
// is designed with care; the widths only have to read as a deer from above and from three-quarters.
//
// The numbers merge two independent references gathered for this design: one from chital osteology and measured does
// (Graf & Nichols 1966, Hawaii: doe ear 12.6 cm, head 27.8 cm, tail 27 cm; Rajani et al. 2013 vertebrae; Islam et
// al. 2018 femur), one traced from side-on photographs of chital does in South Indian parks. Where they differ the
// silhouette follows the photographs. What sells her at a distance, in order: slim legs that taper into knobbly
// joints, the hock's point higher than the knee and sticking out behind, near-vertical cannons; the hind leg's rear
// outline one long curve from the buttock down to the hock; a nearly level back; a deep, narrow chest and a tucked
// belly; a slender neck rising steeply from low in the chest; a small wedge-shaped head; big oval ears.
//
// Every part is a loft (loft.ts): the body and neck as one, from the buttocks up to the throat latch, so the top line
// runs unbroken from the croup over the withers up the neck; the head as its own loft in its own frame, set onto the
// neck; each foreleg along its bones from the shoulder blade to the toe; each hind leg in two parts, the thigh and
// gaskin as one broad loft standing upright (its front edge the stifle, its back edge the hamstring curve) and the
// lower leg along its bones from the hock to the toe; the ears, the tail and the eyes. The joints named here are where
// the skeleton's bones pivot (build.ts).
import type { Ring } from "@/components/deer/loft";

export type Vec2 = readonly [number, number];

/**
 * The body and neck as drawn: pairs of points on the top and bottom of the side outline, with the half-width there.
 * Along the barrel the pairs stand upright; from the chest on they lean back with the neck, the top running up the
 * crest and the bottom over the brisket and up the throat, so each ring spans the neck square-ish to its own line.
 */
const OUTLINE: readonly (readonly [top: Vec2, bottom: Vec2, halfWidth: number])[] = [
  // the buttocks, round under the tail root
  [[-0.675, 0.59], [-0.675, 0.54], 0.03],
  [[-0.65, 0.632], [-0.65, 0.505], 0.06],
  [[-0.62, 0.664], [-0.62, 0.49], 0.077],
  [[-0.58, 0.69], [-0.58, 0.48], 0.087],
  // croup and hips: the top line all but level with the withers
  [[-0.53, 0.704], [-0.53, 0.472], 0.094],
  [[-0.47, 0.709], [-0.47, 0.466], 0.097],
  // the flank and loin, the belly line tucking up to the stifle fold
  [[-0.41, 0.709], [-0.41, 0.455], 0.1],
  [[-0.35, 0.707], [-0.35, 0.438], 0.106],
  [[-0.29, 0.705], [-0.29, 0.41], 0.112],
  // the barrel, widest behind the ribs
  [[-0.21, 0.703], [-0.21, 0.398], 0.117],
  [[-0.13, 0.704], [-0.13, 0.395], 0.115],
  // the girth just behind the elbows: deep and narrow, the chest floor at its lowest
  [[-0.06, 0.706], [-0.06, 0.398], 0.108],
  [[0.0, 0.71], [0.0, 0.4], 0.1],
  // withers to the chest's front: the brisket comes forward low down
  [[0.05, 0.711], [0.065, 0.405], 0.092],
  [[0.095, 0.705], [0.125, 0.425], 0.082],
  // the neck rises from low in the chest, the throat line concave
  [[0.13, 0.716], [0.165, 0.46], 0.07],
  [[0.158, 0.746], [0.2, 0.52], 0.058],
  [[0.183, 0.782], [0.228, 0.585], 0.05],
  [[0.206, 0.815], [0.25, 0.638], 0.045],
  [[0.228, 0.84], [0.27, 0.676], 0.041],
  // the throat latch, under the ears
  [[0.247, 0.857], [0.262, 0.7], 0.039],
  // inside the back of the head
  [[0.262, 0.866], [0.252, 0.722], 0.036],
];

/** The body and neck, from behind the buttocks to inside the head. */
export const BODY: readonly Ring[] = OUTLINE.map(([[tx, ty], [bx, by], w], i) => {
  const half = Math.hypot(tx - bx, ty - by) / 2;
  // the barrel is egg-shaped, widest a little below halfway; the neck rounder
  const neck = i >= 14;
  return { x: (tx + bx) / 2, y: (ty + by) / 2, up: half, down: half, w, a: Math.atan2(ty - by, tx - bx), taper: neck ? -0.05 : -0.12, n: 2.0 };
});

/**
 * The head's own frame: the poll (the top of the head between the ears) and the head's long axis, which points 35
 * degrees below horizontal toward the nose. A head point (u along the axis, v across it, up positive) is at
 * POLL + u * HEAD_U + v * HEAD_V.
 */
export const POLL: Vec2 = [0.265, 0.875];
const HEAD_ANGLE = (-35 * Math.PI) / 180;
export const HEAD_U: Vec2 = [Math.cos(HEAD_ANGLE), Math.sin(HEAD_ANGLE)];
export const HEAD_V: Vec2 = [-Math.sin(HEAD_ANGLE), Math.cos(HEAD_ANGLE)];
export const headPoint = (u: number, v: number): Vec2 => [POLL[0] + u * HEAD_U[0] + v * HEAD_V[0], POLL[1] + u * HEAD_U[1] + v * HEAD_V[1]];

/**
 * The head's profile in its frame (u, the dorsal v, the ventral v, half-width): the jaw's deep angle behind, the eyes
 * the widest part of the skull, the long straight face narrowing to the muzzle and a blunt nose. No roman nose.
 */
const HEAD_PROFILE: readonly (readonly [u: number, top: number, bottom: number, halfWidth: number])[] = [
  [-0.012, -0.008, -0.085, 0.036],
  [0.013, 0.004, -0.118, 0.042],
  [0.062, 0.006, -0.128, 0.045],
  [0.097, 0.004, -0.118, 0.05],
  [0.141, 0.001, -0.1, 0.038],
  [0.176, -0.001, -0.087, 0.031],
  [0.207, -0.004, -0.076, 0.025],
  [0.227, -0.008, -0.069, 0.022],
  // a blunt nose, not a point
  [0.239, -0.018, -0.06, 0.018],
];

/** The head: from behind the ears (inside the neck's end) to the nose, pointing forward and down. */
export const HEAD: readonly Ring[] = HEAD_PROFILE.map(([u, top, bottom, w]) => {
  const c = (top + bottom) / 2;
  const [x, y] = headPoint(u, c);
  // the forehead is broad and the jaws narrow beneath it
  return { x, y, up: (top - bottom) / 2, down: (top - bottom) / 2, w, taper: u < 0.15 ? 0.18 : 0.05 };
});
/** The nose tip, in the head's frame, for the grazing solve. */
export const NOSE_UV: Vec2 = [0.243, -0.036];

/** A leg's joints from where it leaves the body to the toe, with the thickness there: front and back of the bone's line. */
export interface LegJoint {
  name: string;
  at: Vec2;
  front: number;
  back: number;
  /** half-width */
  w: number;
  /** how far out from the midline, where it differs from the leg's (the shoulder sits inside the chest wall) */
  z?: number;
}

/** How far each leg's centre line stands out from the midline. */
export const LEG_SPREAD = { fore: 0.062, hind: 0.067 } as const;

/**
 * The foreleg: the shoulder blade's top inside the withers, the point of the shoulder at the chest's front, the upper
 * arm hidden in the body down to the elbow at the chest floor, then a near-vertical column: the muscled forearm, the
 * carpus (the "knee", a slight knob), the slim cannon (a flat blade, deeper than wide), the fetlock knob, a short
 * sloping pastern and the dark pointed hoof.
 */
export const FORE: readonly LegJoint[] = [
  { name: "scapula", at: [0.03, 0.63], front: 0.035, back: 0.035, w: 0.016, z: 0.03 },
  { name: "shoulder", at: [0.09, 0.545], front: 0.05, back: 0.05, w: 0.026, z: 0.045 },
  { name: "arm", at: [0.05, 0.47], front: 0.045, back: 0.05, w: 0.028, z: 0.055 },
  { name: "elbow", at: [0.005, 0.41], front: 0.034, back: 0.048, w: 0.026, z: 0.06 },
  { name: "forearm", at: [0.008, 0.33], front: 0.032, back: 0.03, w: 0.022 },
  { name: "carpus", at: [0.01, 0.24], front: 0.02, back: 0.022, w: 0.02 },
  { name: "cannon", at: [0.011, 0.15], front: 0.012, back: 0.014, w: 0.011 },
  { name: "fetlock", at: [0.012, 0.058], front: 0.016, back: 0.021, w: 0.016 },
  { name: "pastern", at: [0.021, 0.041], front: 0.012, back: 0.012, w: 0.014 },
  // a small, steep hoof, nearly under the cannon
  { name: "coronet", at: [0.031, 0.027], front: 0.016, back: 0.018, w: 0.016 },
  { name: "toe", at: [0.053, 0.006], front: 0.005, back: 0.005, w: 0.011 },
];

/**
 * The hind leg's thigh and gaskin, as one broad upright loft (rings stacked down its height): at each height the
 * front edge (the stifle fold, the stifle, the gaskin's front) and the back edge (the hamstring curve from the buttock
 * down to the point of the hock), and the half-width; the thigh is the widest part of her hindquarters. z eases out
 * from inside the rump to the leg's line.
 */
export const THIGH: readonly (readonly [y: number, front: number, back: number, halfWidth: number])[] = [
  [0.66, -0.48, -0.63, 0.03],
  [0.57, -0.45, -0.672, 0.046],
  [0.51, -0.43, -0.674, 0.047],
  [0.455, -0.41, -0.662, 0.04],
  [0.41, -0.442, -0.645, 0.032],
  [0.37, -0.49, -0.634, 0.026],
  [0.335, -0.528, -0.627, 0.022],
  [0.305, -0.552, -0.62, 0.02],
  [0.282, -0.554, -0.62, 0.02],
];

/** The lower hind leg, along its bones: the hock (its point behind), the long slim cannon, fetlock, pastern, hoof. */
export const HIND_LOWER: readonly LegJoint[] = [
  { name: "hock", at: [-0.585, 0.29], front: 0.026, back: 0.036, w: 0.02 },
  { name: "tarsus", at: [-0.578, 0.245], front: 0.016, back: 0.021, w: 0.015 },
  { name: "cannon", at: [-0.57, 0.16], front: 0.014, back: 0.017, w: 0.012 },
  { name: "fetlock", at: [-0.558, 0.058], front: 0.017, back: 0.021, w: 0.016 },
  { name: "pastern", at: [-0.549, 0.041], front: 0.012, back: 0.013, w: 0.014 },
  { name: "coronet", at: [-0.539, 0.027], front: 0.016, back: 0.018, w: 0.016 },
  { name: "toe", at: [-0.517, 0.006], front: 0.005, back: 0.005, w: 0.011 },
];

/** The joints the bones pivot at (top to toe), and the toe the hoof plants. */
export const FORE_PIVOTS: readonly Vec2[] = [
  [0.01, 0.68], // shoulder blade's top
  [0.095, 0.545], // shoulder joint
  [0.005, 0.41], // elbow
  [0.01, 0.24], // carpus
  [0.012, 0.058], // fetlock
  [0.053, 0.0], // toe on the ground
];
export const HIND_PIVOTS: readonly Vec2[] = [
  [-0.54, 0.597], // hip joint
  [-0.44, 0.445], // stifle
  [-0.585, 0.29], // hock
  [-0.558, 0.058], // fetlock
  [-0.517, 0.0], // toe on the ground
];

/**
 * The ears: base on the top-back of the skull behind the poll, 0.13 m long with the hair, widest (0.068) about 45% up:
 * big ovals, the tallest thing on her head and the cue that says deer, not goat. At rest they are held up and out,
 * about 45 degrees above horizontal, the openings facing out and a little forward; alert, raised to about 60 degrees and
 * swung forward, the openings facing ahead.
 */
export const EAR = {
  base: [0.252, 0.858, 0.04] as const,
  // the visible length, with the hair
  length: 0.13,
  width: 0.068,
  /** degrees above horizontal, and the bearing from straight ahead out to the side */
  rest: { elevation: 40, azimuth: 105 },
  alert: { elevation: 60, azimuth: 72 },
  cup: 0.34,
} as const;

/** The tail: root high on the rump, hanging flat against the buttocks, dark above and fringed white. */
export const TAIL = {
  root: [-0.648, 0.632] as Vec2,
  tip: [-0.715, 0.445] as Vec2,
  /** half-widths across (side to side) and through (front to back) at the root */
  width: 0.03,
  depth: 0.02,
} as const;

/** The eyes: large and dark, set high on the head, bulging a little past the orbit. */
export const EYE = { at: headPoint(0.088, -0.03), r: 0.0145, out: 0.046 } as const;

/** Bone pivots along the body and neck, rump to head. */
export const SPINE = {
  pelvis: [-0.54, 0.6] as Vec2,
  loin: [-0.28, 0.6] as Vec2,
  chest: [0.0, 0.575] as Vec2,
  // the neck leaves the chest low, at the point of the shoulder's height
  neck0: [0.075, 0.56] as Vec2,
  neck1: [0.15, 0.655] as Vec2,
  neck2: [0.2, 0.73] as Vec2,
  // the atlas joint, at the occipital condyles below the poll
  head: headPoint(0.015, -0.045),
} as const;
