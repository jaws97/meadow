// The lotus garden's own place (the owner's decision: "our garden for flowers and lotus looks same but they
// shouldn't... the ambience should be different"): a small South Indian courtyard round the koi tank, in world metres
// (the hero mark at the origin, the camera looking toward -z, as the flower garden's plan). Original throughout: no
// real temple, house or carving is copied. Pure numbers and helpers: no three, no DOM.
//
// - The tank (pond.ts): the water's rectangle sunk in granite. Three steps come down to it on its sides and back, a
//   miniature temple-tank (kalyani) feel; at the front an open landing at the coping's level, where the camera stands,
//   runs between the side steps toward the veranda, so the water is never hidden behind steps.
// - Terraces at the steps' top on either side and behind, paved in granite slabs.
// - A laterite wall closes the court behind and at the sides, with a carved granite-framed niche on the tank's axis
//   for a brass lamp; a veranda plinth closes it behind the camera.
// - Brass oil lamps (nilavilakku in form: a round foot, a knopped stem, a dish of five wick spouts and a bud finial,
//   drawn from scratch) stand on the back steps either side of the axis and in the niche; at dusk small clay lamps
//   line the lowest back step.
// - A banana clump in the back-left corner, areca palms rising at the right, a jasmine trained on the wall beside the
//   niche.

import { POND } from "@/components/lotus/pond";

/** The steps round the tank: each tread 15 cm deep, each rise 11 cm, three of them up to the terraces. */
export const STEP = { tread: 0.15, rise: 0.11, count: 3 } as const;

/** The court's levels, world y. */
export const LEVEL = {
  /** the coping (the lowest step) and the landing in front of the tank */
  coping: POND.copingY,
  /** the terraces at the steps' top */
  terrace: POND.copingY + STEP.count * STEP.rise,
} as const;

/** The water's rectangle in world terms. */
export const TANK = {
  x0: POND.cx - POND.rx,
  x1: POND.cx + POND.rx,
  /** the back wall and the front wall of the water */
  zBack: POND.cz - POND.rz,
  zFront: POND.cz + POND.rz,
} as const;

/** The court's bounds: the inner faces of the laterite walls (back, sides) and the veranda plinth's edge (front). */
export const COURT = {
  xMin: -2.5,
  xMax: 2.5,
  zBack: -1.8,
  zFront: 3.4,
  /** the walls' thickness and height over the terrace */
  wallThick: 0.32,
  wallH: 1.55,
  /** the veranda plinth behind the camera */
  plinthH: 0.42,
  plinthDepth: 1.1,
} as const;

/**
 * The step a point stands on: 0 the coping and the landing, 1 and 2 the steps, 3 the terraces; or -1 for the water.
 * The steps are rectangular rings round the water and the landing together (a square-cornered offset, so the corners
 * are mitred as a tank's are), so the side steps run on along the landing toward the veranda.
 */
export function stepAt(x: number, z: number): number {
  const inX = x >= TANK.x0 && x <= TANK.x1;
  if (inX && z >= TANK.zBack && z <= TANK.zFront) return -1;
  const d = Math.max(TANK.x0 - x, x - TANK.x1, TANK.zBack - z, 0);
  if (d <= 0) return 0;
  return Math.min(STEP.count, Math.max(0, Math.ceil(d / STEP.tread - 1e-9) - 1));
}

/** The top of the step at a point, world y (the water's fill line over the tank). */
export function stepTopAt(x: number, z: number): number {
  const s = stepAt(x, z);
  return s < 0 ? POND.waterY : LEVEL.coping + s * STEP.rise;
}

/** The niche on the tank's axis in the back wall: an arched opening framed in granite, a lamp on its sill. */
export const NICHE = {
  x: 0,
  /** the sill over the terrace, the opening's width, the springing of the arch and its crown, its depth into the wall */
  sillY: LEVEL.terrace + 0.18,
  width: 0.34,
  springY: LEVEL.terrace + 0.18 + 0.28,
  crownY: LEVEL.terrace + 0.18 + 0.44,
  depth: 0.17,
  /** the granite frame's width round the opening and how far it stands proud of the wall */
  frame: 0.07,
  proud: 0.025,
} as const;

export type LampKind = "tall" | "niche";

export interface LampSpot {
  kind: LampKind;
  /** foot position, world */
  x: number;
  y: number;
  z: number;
  /** turn about y (the five spouts' set) */
  yaw: number;
}

/**
 * The brass lamps: two tall ones on the first back step either side of the axis (their flames mirror into the front
 * of the water from the product camera), and a small one on the niche's sill.
 */
export const LAMPS: readonly LampSpot[] = [
  { kind: "tall", x: -0.5, y: LEVEL.coping + STEP.rise, z: TANK.zBack - STEP.tread - STEP.tread / 2, yaw: 0.2 },
  { kind: "tall", x: 0.5, y: LEVEL.coping + STEP.rise, z: TANK.zBack - STEP.tread - STEP.tread / 2, yaw: -0.3 },
  { kind: "niche", x: NICHE.x, y: NICHE.sillY, z: COURT.zBack - NICHE.depth * 0.45, yaw: 0 },
];

/** The lamps' heights: foot to the wick spouts. */
export const LAMP_H: Record<LampKind, number> = { tall: 0.44, niche: 0.2 };

/** Small clay lamps along the lowest back step and the first steps at the back corners, lit at dusk. */
export const DIYAS: readonly { x: number; y: number; z: number }[] = (() => {
  const out: { x: number; y: number; z: number }[] = [];
  const z0 = TANK.zBack - STEP.tread * 0.45;
  for (let i = 0; i < 7; i++) out.push({ x: -0.45 + i * 0.15, y: LEVEL.coping, z: z0 });
  for (const s of [-1, 1]) {
    out.push({ x: s * (POND.rx + STEP.tread * 0.45), y: LEVEL.coping, z: TANK.zBack + 0.12 });
    out.push({ x: s * (POND.rx + STEP.tread * 0.45), y: LEVEL.coping, z: TANK.zBack + 0.32 });
  }
  return out;
})();

/** The plants: a banana clump, areca palms and a jasmine, with their feet on the terraces. */
export const BANANA = { x: -2.05, z: -1.45, stems: 3 } as const;
export const ARECAS: readonly { x: number; z: number; h: number; lean: number; yaw: number }[] = [
  { x: 1.62, z: -1.55, h: 6.4, lean: 0.035, yaw: 0.6 },
  { x: 2.12, z: -0.62, h: 5.6, lean: 0.05, yaw: 2.4 },
  { x: 1.95, z: 0.9, h: 6.9, lean: 0.03, yaw: 4.1 },
];
export const JASMINE = { x: 0.78, z: COURT.zBack + 0.2, w: 0.8, h: 0.95 } as const;

/** The brass water pot on the left side's first step near the back (the top-up is a 15 L bucket: pond model section 2). */
export const KODAM = { x: -(POND.rx + STEP.tread * 1.5), y: LEVEL.coping + STEP.rise, z: TANK.zBack + 0.2 } as const;
