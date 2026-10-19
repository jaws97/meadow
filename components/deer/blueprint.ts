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
// neck; each leg as one continuous loft from inside the body down to the hoof, drawn (as the body is) by pairs of points
// on its front and back edges, so the joints are knobs on one line rather than pieces fitted together; the ears, the
// tail and the eyes. The pivots named here are where the skeleton's bones turn (build.ts).
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
  [[0.228, 0.84], [0.27, 0.676], 0.033],
  // the throat latch, under the ears; the neck's end stays inside the head (where it pokes through the jaw's narrow
  // lower side it draws a crease down the cheek)
  [[0.247, 0.852], [0.262, 0.705], 0.024],
  // inside the back of the head
  [[0.255, 0.845], [0.264, 0.74], 0.018],
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
  // the forehead is broad and the jaws narrow beneath it, easing into the muzzle (an abrupt change creases the cheek)
  // (the jaw behind the eye stays full at the bottom, so it covers the throat where the neck meets it)
  const k = Math.min(1, Math.max(0, (u - 0.06) / 0.16));
  const jaw = Math.min(1, Math.max(0, (u - 0.0) / 0.1));
  return { x, y, up: (top - bottom) / 2, down: (top - bottom) / 2, w, taper: (0.04 + 0.14 * jaw) - 0.13 * k * k * (3 - 2 * k) };
});
/** The nose tip, in the head's frame, for the grazing solve. */
export const NOSE_UV: Vec2 = [0.243, -0.036];

/**
 * A leg as drawn from the side: from inside the body down to the hoof's sole, pairs of points on its front and back
 * edges, the half-width there, and how far out from the midline its centre stands. Each leg is one continuous surface
 * through these pairs (as the body is), so it tapers in one line from the body to the hoof with the joints as knobs on
 * it, never as cuffs where separate pieces meet.
 */
export type LegOutline = readonly (readonly [front: Vec2, back: Vec2, halfWidth: number, z: number])[];

/** How far each leg's centre line stands out from the midline where it is clear of the body. */
export const LEG_SPREAD = { fore: 0.062, hind: 0.067 } as const;

/**
 * The foreleg: hidden in the chest from the shoulder down to the elbow at the chest floor (the olecranon sticking out
 * behind), then a near-vertical column: the muscled forearm narrowing to a slight knob at the carpus (the "knee"), the
 * slim cannon (a flat blade, a little deeper than wide), the fetlock's knob (the dewclaws behind it), a short sloping
 * pastern and a small dark pointed hoof.
 */
export const FORE: LegOutline = [
  [[0.105, 0.57], [0.0, 0.62], 0.03, 0.035],
  [[0.115, 0.52], [-0.03, 0.55], 0.034, 0.045],
  [[0.085, 0.46], [-0.045, 0.47], 0.032, 0.052],
  // the elbow
  [[0.05, 0.415], [-0.048, 0.425], 0.03, 0.058],
  [[0.043, 0.375], [-0.03, 0.38], 0.026, 0.06],
  [[0.038, 0.32], [-0.018, 0.32], 0.022, 0.061],
  [[0.033, 0.272], [-0.012, 0.272], 0.019, 0.062],
  // the carpus
  [[0.034, 0.245], [-0.014, 0.245], 0.021, 0.062],
  [[0.027, 0.215], [-0.008, 0.215], 0.016, 0.062],
  [[0.024, 0.15], [-0.004, 0.15], 0.012, 0.062],
  [[0.024, 0.095], [-0.006, 0.095], 0.013, 0.062],
  // the fetlock
  [[0.028, 0.066], [-0.014, 0.062], 0.016, 0.062],
  [[0.035, 0.044], [0.0, 0.038], 0.014, 0.062],
  // the coronet and the hoof
  [[0.045, 0.03], [0.008, 0.024], 0.016, 0.062],
  [[0.058, 0.012], [0.012, 0.008], 0.015, 0.062],
  [[0.064, 0.003], [0.016, 0.003], 0.012, 0.062],
];

/**
 * The hind leg: the thigh, the rump's broad muscle, from inside the rump down to the stifle at the flank's fold; the
 * gaskin narrowing below it, its back edge the hamstring's long curve down to the point of the hock, which sticks out
 * behind, higher than the foreleg's knee; then the long slim cannon, the fetlock, the pastern and the hoof.
 */
export const HIND: LegOutline = [
  [[-0.47, 0.64], [-0.645, 0.64], 0.03, 0.045],
  [[-0.45, 0.57], [-0.672, 0.57], 0.046, 0.05],
  [[-0.43, 0.51], [-0.676, 0.51], 0.047, 0.055],
  // the stifle in front
  [[-0.408, 0.455], [-0.664, 0.455], 0.04, 0.06],
  [[-0.44, 0.41], [-0.648, 0.41], 0.032, 0.063],
  [[-0.488, 0.37], [-0.636, 0.37], 0.026, 0.065],
  [[-0.53, 0.335], [-0.628, 0.335], 0.022, 0.066],
  // the hock, its point behind
  [[-0.553, 0.305], [-0.626, 0.31], 0.02, 0.067],
  [[-0.561, 0.275], [-0.612, 0.282], 0.018, 0.067],
  [[-0.563, 0.245], [-0.598, 0.248], 0.015, 0.067],
  [[-0.559, 0.16], [-0.589, 0.16], 0.012, 0.067],
  [[-0.555, 0.095], [-0.587, 0.095], 0.013, 0.067],
  // the fetlock
  [[-0.55, 0.066], [-0.59, 0.062], 0.016, 0.067],
  [[-0.543, 0.044], [-0.574, 0.038], 0.014, 0.067],
  // the coronet and the hoof
  [[-0.535, 0.03], [-0.567, 0.024], 0.016, 0.067],
  [[-0.522, 0.012], [-0.566, 0.008], 0.015, 0.067],
  [[-0.516, 0.003], [-0.563, 0.003], 0.012, 0.067],
];

/** The joints the bones pivot at (top to toe), and the toe the hoof plants. */
export const FORE_PIVOTS: readonly Vec2[] = [
  [0.01, 0.68], // shoulder blade's top
  [0.095, 0.545], // shoulder joint
  [0.005, 0.41], // elbow
  [0.01, 0.245], // carpus
  [0.008, 0.064], // fetlock
  [0.062, 0.0], // toe on the ground
];
export const HIND_PIVOTS: readonly Vec2[] = [
  [-0.54, 0.597], // hip joint
  [-0.44, 0.445], // stifle
  [-0.585, 0.29], // hock
  [-0.57, 0.064], // fetlock
  [-0.518, 0.0], // toe on the ground
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

/** The eyes: large, dark and almond-shaped, set high on the head, their lids painted round them (coat.ts). */
export const EYE = {
  at: headPoint(0.088, -0.03),
  /** half-length along the head's axis, half-height, and how far it bulges */
  radii: [0.0165, 0.0105, 0.0075] as const,
  /** its centre out from the midline: the cornea stands a millimetre or two proud of the face */
  out: 0.0435,
  /** tilted down toward its front corner, along the line of the face */
  tilt: HEAD_ANGLE - 0.12,
} as const;

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
