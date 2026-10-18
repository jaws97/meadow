// The owner's small koi pond (lotus v2, the pond model's POND_VERSION 1, scratchpad lotus\v2\pond-model.md) in world
// metres, now as a small stepped granite tank in its own South Indian courtyard (components/lotus/courtyard): a
// square-cornered tank sunk in a paved court, granite steps coming down to the water on its sides and back, an open
// landing at the front where the camera stands. Pure numbers and helpers: no DOM.
//
// What the look honours from the model (section 1), and what changed with the courtyard:
// - the water's surface stays 1.30 m2: a rectangle 1.28 x 1.02 m (1.306 m2) measured wall to wall, where the model's
//   oval was 1.66 x 1.00 m inside its coping; the coping's chamfered lip overhangs the water by 1.5 cm;
// - the fill line stands 5 cm under the coping's top (the lowest step);
// - a shelf 25.5 cm deep along the front, 1.28 x 0.49 m (0.63 m2, the model's "about 0.6"), the back 0.9 m deep
//   (0.68 m2, the model's "about 0.7"), walls upright granite blocks: 0.77 m3, the model's 0.78 m3 ("about 800 L");
// - the lotus pot, 40 cm across inside and 23 cm tall with no holes, stands on the shelf with its rim 2.5 cm and its
//   pebbles 5 cm under the fill line, its centre 9 cm behind the hero mark, as before;
// - an overflow notch 2 cm over the fill line (the level never shows higher);
// - new: the steps above the water drain into it, as a temple tank's do (the model assumed a coping that shed rain
//   outward): see the courtyard notes for what that changes (only the wet scenarios, which spill at the notch).
import { LAYOUT } from "@/lib/garden/layout";

export const POND = {
  /** the pond's centre (the pot keeps its place 9 cm behind the hero mark; the tank is centred 27 cm behind it) */
  cx: LAYOUT.hero[0],
  cz: -0.36,
  /** the water's rectangle, half-width (x) and half-depth (z) in metres, wall to wall */
  rx: 0.64,
  rz: 0.51,
  /** how far the coping's lip overhangs the water */
  lip: 0.015,
  /** the fill line, world y */
  waterY: 0.06,
  /** the coping's top (the lowest step), 5 cm over the fill line */
  copingY: 0.11,
  /** the shelf's floor and the deep zone's floor, under the fill line */
  shelfDepth: 0.255,
  deepDepth: 0.9,
  /** the shelf's back edge (the drop into the deep zone), in the pond's own z (0 at the centre, + toward the camera) */
  shelfEdge: 0.02,
  /** the lotus pot */
  potX: 0,
  potZ: -0.09,
  potR: 0.2,
  potWall: 0.012,
  potH: 0.23,
  rimDepth: 0.025,
  pebbleDepth: 0.05,
  mudDepth: 0.08,
  /** the overflow notch over the fill line, mm */
  overflowMM: 20,
  /** the lowest level the page draws, mm (the "never topped up" runs fall to about -124 mm) */
  lowestMM: -120,
} as const;

/** The water's surface area, m2 (wall to wall). */
export const POND_AREA = 4 * POND.rx * POND.rz;
/** The shelf's and the deep zone's areas, m2, and the volume at the fill line, m3. */
export const POND_SHELF_AREA = 2 * POND.rx * (POND.rz - POND.shelfEdge);
export const POND_DEEP_AREA = POND_AREA - POND_SHELF_AREA;
export const POND_VOLUME = POND_SHELF_AREA * POND.shelfDepth + POND_DEEP_AREA * POND.deepDepth;

/** The water's surface, world y, for a level in mm against the fill line (clamped to the notch). */
export const levelY = (mm: number) => POND.waterY + Math.min(POND.overflowMM, Math.max(POND.lowestMM, mm)) / 1000;

/** Distance from the pond's centre in "box units": 1 on the walls (the larger of the two axis shares). */
export function pondRho(x: number, z: number): number {
  return Math.max(Math.abs(x - POND.cx) / POND.rx, Math.abs(z - POND.cz) / POND.rz);
}

const smooth = (e0: number, e1: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
};

/** The shelf's back edge, in the pond's own z (straight across the tank, a granite step). */
export const shelfEdgeZ = (lx: number) => POND.shelfEdge + 0 * lx;

/** The basin's floor, world y, at (x, z): the shelf in front, a short steep step, the deep zone behind. */
export function pondFloorY(x: number, z: number): number {
  const lx = x - POND.cx;
  const lz = z - POND.cz;
  const t = smooth(shelfEdgeZ(lx) - 0.02, shelfEdgeZ(lx) + 0.02, lz);
  return POND.waterY - POND.deepDepth + (POND.deepDepth - POND.shelfDepth) * t;
}

/** The lotus's frame (look.ts and build.ts draw in it): the pot's centre at the fill line. */
export const POT_FRAME: readonly [number, number, number] = [POND.potX, POND.waterY, POND.potZ];

/** The pond's own frame (the koi swim in it): its centre at the fill line. */
export const POND_FRAME: readonly [number, number, number] = [POND.cx, POND.waterY, POND.cz];

export interface JarSpot {
  /** world position of the jar's foot on the coping's top */
  at: [number, number, number];
  yaw: number;
}

/**
 * Where the seed's jar stands (art direction 4.1, moved for the courtyard): on the front coping slab at the tank's
 * front right, between the water and the landing, in clear view of both framings. The seed is the owner's; the spot
 * no longer depends on it (the coping is dressed granite, not a fieldstone kerb).
 */
export function jarSpot(seed: string): JarSpot {
  void seed;
  return { at: [POND.cx + 0.44, POND.copingY, POND.cz + POND.rz + 0.075], yaw: 0.3 };
}
