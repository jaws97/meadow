// The garden plan, in metres, with the hero plant at the origin and the
// default camera looking toward -z. Every part of the scene places itself
// from these numbers so the bed, path, lantern, arch and trees agree.
// Per-owner variation (colours, small offsets, which side the lantern stands)
// is applied by each part from Rng(seed + "|garden"), never by editing this.

export type Vec3 = readonly [number, number, number];

export const LAYOUT = {
  hero: [0, 0, 0] as Vec3,

  /** Raised flower bed: an oval around and behind the hero, mulch top at `height`. */
  bed: { center: [0, 0, -0.35] as Vec3, rx: 0.95, rz: 0.62, height: 0.08, lipWidth: 0.12 },

  /** Lantern post inside the bed's front-left corner; the lamp hangs at `lampHeight`. */
  lantern: { position: [-0.95, 0, -0.5] as Vec3, lampHeight: 1.3, color: "#ffb86b" },

  /** Stone path entering front-left, curving past the bed to the arch. */
  path: [
    [-1.7, 0, 1.5],
    [-1.0, 0, 1.0],
    [-1.15, 0, 0.2],
    [-0.55, 0, -0.9],
    [0.45, 0, -1.9],
    [1.15, 0, -2.85],
  ] as readonly Vec3[],
  pathWidth: 0.55,

  /** Vine-covered arch the path passes under. */
  arch: { center: [1.15, 0, -2.9] as Vec3, radius: 0.85, yaw: 0.35, thickness: 0.05 },

  /** Low hedges and shrubs closing the mid-ground, each an ellipsoid footprint. */
  hedges: [
    { center: [-2.4, 0, -2.6] as Vec3, rx: 1.3, rz: 0.7, height: 0.9 },
    { center: [2.6, 0, -2.2] as Vec3, rx: 1.1, rz: 0.6, height: 0.8 },
    { center: [-0.6, 0, -3.4] as Vec3, rx: 1.4, rz: 0.6, height: 1.0 },
    { center: [3.3, 0, -3.8] as Vec3, rx: 1.0, rz: 0.8, height: 1.1 },
  ],

  /** Weathered fence section behind the left hedge. */
  fence: { from: [-4.2, 0, -3.6] as Vec3, to: [-1.4, 0, -4.2] as Vec3, height: 0.95 },

  /** Trees with gaps between them for sky; canopy is a sphere-ish cluster at `canopyY`. */
  trees: [
    { position: [-3.2, 0, -6.0] as Vec3, height: 5.2, canopyY: 3.6, canopyR: 2.2 },
    { position: [2.9, 0, -6.8] as Vec3, height: 5.8, canopyY: 4.0, canopyR: 2.5 },
    { position: [-0.4, 0, -8.5] as Vec3, height: 6.5, canopyY: 4.6, canopyR: 2.9 },
    { position: [5.5, 0, -5.2] as Vec3, height: 4.6, canopyY: 3.2, canopyR: 2.0 },
    { position: [-6.0, 0, -4.8] as Vec3, height: 4.9, canopyY: 3.4, canopyR: 2.1 },
  ],

  /** Default framing: the hero in the lower-middle third, bed, path and arch in view. */
  camera: { position: [0.25, 1.05, 3.0] as Vec3, target: [0, 0.55, -0.3] as Vec3, focusRange: 1.6 },
} as const;
