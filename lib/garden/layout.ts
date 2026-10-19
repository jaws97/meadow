// The garden plan, in metres, with the hero plant at the origin and the
// default camera looking toward -z. Every part of the scene places itself
// from these numbers so the bed, path, lantern, arch and trees agree.
// Per-owner variation (colours, small offsets, which side the lantern stands)
// is applied by each part from Rng(seed + "|garden"), never by editing this.

export type Vec3 = readonly [number, number, number];

/** One composed camera shot for a screen shape; see LAYOUT.camera. */
export interface Framing {
  aspect: number;
  azimuth: number;
  elevation: number;
  distance: number;
  fov: number;
  targetRise: number;
  targetLift: number;
}

/** The framing for any aspect ratio: the keyframes blended linearly, held flat past the ends. */
export function framingFor(aspect: number, keys: readonly Framing[] = LAYOUT.camera.framings): Framing {
  if (aspect <= keys[0].aspect) return keys[0];
  const last = keys[keys.length - 1];
  if (aspect >= last.aspect) return last;
  let i = 1;
  while (keys[i].aspect < aspect) i++;
  const a = keys[i - 1];
  const b = keys[i];
  const t = (aspect - a.aspect) / (b.aspect - a.aspect);
  const mix = (x: number, y: number) => x + (y - x) * t;
  return {
    aspect,
    azimuth: mix(a.azimuth, b.azimuth),
    elevation: mix(a.elevation, b.elevation),
    distance: mix(a.distance, b.distance),
    fov: mix(a.fov, b.fov),
    targetRise: mix(a.targetRise, b.targetRise),
    targetLift: mix(a.targetLift, b.targetLift),
  };
}

export const LAYOUT = {
  hero: [0, 0, 0] as Vec3,

  /** Raised flower bed: an oval around and behind the hero, mulch top at `height`. */
  bed: { center: [0, 0, -0.35] as Vec3, rx: 0.95, rz: 0.62, height: 0.12, lipWidth: 0.12 },

  /** Lantern post inside the bed's front-left corner; the lamp hangs at `lampHeight`. */
  lantern: { position: [-0.95, 0, -0.5] as Vec3, lampHeight: 1.18, color: "#ffb86b" },

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

  /**
   * Low hedges and shrubs closing the mid-ground, each an ellipsoid footprint.
   * The one straight behind the bed stands taller, so from either framing the
   * bloom is seen against its dark leaves rather than sitting on its top line.
   * The last four wrap the garden round its sides, out to about 110 degrees
   * either way of the camera's axis, so an orbit to the side finds the garden
   * closed off as a room rather than running out onto open lawn. On the left
   * they stand forward of the bed, leaving a corridor at the evening sun's
   * bearing (it comes in low from -x, a little behind): a hedge there would
   * lay its ten-metre golden-hour shadow straight across the bed.
   */
  hedges: [
    { center: [-2.4, 0, -2.6] as Vec3, rx: 1.3, rz: 0.7, height: 0.9 },
    { center: [2.6, 0, -2.2] as Vec3, rx: 1.1, rz: 0.6, height: 0.8 },
    { center: [-0.6, 0, -3.4] as Vec3, rx: 1.4, rz: 0.6, height: 1.3 },
    { center: [3.3, 0, -3.8] as Vec3, rx: 1.0, rz: 0.8, height: 1.1 },
    // seen mostly from an orbit, so dressed a little more lightly (density scales their cards and leaves)
    { center: [3.5, 0, -0.5] as Vec3, rx: 0.75, rz: 1.5, height: 1.05, density: 0.45 },
    { center: [-3.7, 0, 0.55] as Vec3, rx: 0.8, rz: 1.1, height: 1.1, density: 0.45 },
    { center: [3.0, 0, 1.6] as Vec3, rx: 0.8, rz: 0.75, height: 0.8, density: 0.45 },
    { center: [-3.0, 0, 1.9] as Vec3, rx: 0.75, rz: 0.6, height: 0.75, density: 0.45 },
    // low and well back in the sun's corridor: closes the view without shading the bed
    { center: [-4.7, 0, -1.9] as Vec3, rx: 0.95, rz: 0.6, height: 0.5, density: 0.45 },
  ],

  /** Weathered fence section behind the left hedge. */
  fence: { from: [-4.2, 0, -3.6] as Vec3, to: [-1.4, 0, -4.2] as Vec3, height: 0.95 },

  /**
   * The garden's front, behind the default camera, seen only when the view is
   * turned round (the camera's orbit goes all the way round the flower). The
   * hedges carry the side hedges on round the front in a ring about six
   * metres out, so a look back from behind the bed finds the lawn closed off
   * as a room, with a gateway at front-left where a short walk of the same
   * flagstones comes in to meet the path; a few trees stand beyond, their
   * crowns framing the sky as the trees behind the bed do. All of it stands
   * behind the camera of every default framing (so nothing new shows until
   * the view turns), north of the bed, where no sun of the season stands, so
   * none of it shades the bed. Kept in lists of their own and built from
   * random streams of their own, after everything else
   * (lib/garden/backdropGeometry, dressing's walkPlan), so the garden as the
   * default framings see it is exactly as it was.
   */
  front: {
    hedges: [
      { center: [3.4, 0, 3.4] as Vec3, rx: 0.75, rz: 1.0, height: 1.0, density: 0.45 },
      { center: [2.45, 0, 5.05] as Vec3, rx: 1.1, rz: 0.7, height: 1.1, density: 0.45 },
      { center: [0.75, 0, 6.05] as Vec3, rx: 1.3, rz: 0.62, height: 1.15, density: 0.45 },
      // the gateway between these two
      { center: [-0.55, 0, 6.3] as Vec3, rx: 0.58, rz: 0.55, height: 1.1, density: 0.45 },
      { center: [-2.8, 0, 5.85] as Vec3, rx: 0.72, rz: 0.66, height: 1.1, density: 0.45 },
      { center: [-3.5, 0, 4.15] as Vec3, rx: 0.65, rz: 1.1, height: 1.0, density: 0.45 },
    ],
    trees: [
      { position: [4.4, 0, 6.7] as Vec3, height: 5.0, canopyY: 3.2, canopyR: 2.3, density: 0.4 },
      { position: [-4.7, 0, 6.2] as Vec3, height: 5.4, canopyY: 3.4, canopyR: 2.4, density: 0.4 },
      { position: [1.0, 0, 8.9] as Vec3, height: 6.2, canopyY: 4.0, canopyR: 2.8, density: 0.45 },
    ],
    /** The gateway: two posts `width` apart across the walk, and a gate of the fence's boards standing open into the garden. */
    gate: { center: [-1.66, 0, 6.32] as Vec3, width: 1.0, height: 0.92, open: 1.15 },
    /** The front walk, from the gateway to just short of the path's first stone. */
    walk: [
      [-1.66, 0, 6.75],
      [-1.72, 0, 5.4],
      [-2.0, 0, 4.0],
      [-2.02, 0, 2.85],
      [-1.8, 0, 1.86],
    ] as readonly Vec3[],
  },

  /**
   * Trees with gaps between them for sky; canopy is a sphere-ish cluster at
   * `canopyY`, low enough that the crowns make a leafy frame along the top of
   * the picture instead of bare trunks against the sky. No trunk stands
   * straight behind the hero, so nothing grows out of the bloom; the far-left
   * tree keeps its crown clear of the golden-hour sun's bearing.
   */
  trees: [
    { position: [-3.2, 0, -6.0] as Vec3, height: 5.2, canopyY: 3.2, canopyR: 2.4 },
    { position: [2.9, 0, -6.8] as Vec3, height: 5.8, canopyY: 3.5, canopyR: 2.7 },
    { position: [-2.2, 0, -8.8] as Vec3, height: 6.5, canopyY: 4.1, canopyR: 3.0 },
    { position: [5.5, 0, -5.2] as Vec3, height: 4.6, canopyY: 2.9, canopyR: 2.1 },
    { position: [-6.0, 0, -4.8] as Vec3, height: 4.9, canopyY: 3.1, canopyR: 2.1 },
    // flanking the garden's sides, behind the side hedges: off the default frame, so fewer cards
    { position: [5.4, 0, -0.6] as Vec3, height: 5.0, canopyY: 3.3, canopyR: 2.2, density: 0.4 },
    { position: [-5.4, 0, 0.7] as Vec3, height: 5.3, canopyY: 3.4, canopyR: 2.3, density: 0.4 },
  ],

  /**
   * Default framings, one per screen shape, blended between by aspect ratio
   * (width / height) so every phone, tablet and monitor gets a composed shot.
   * In every one the full bloom's crown sits on the upper third line. Each
   * gives the camera's place round the orbit target as a compass bearing
   * (`azimuth`, radians from +z, positive toward +x), an `elevation` and a
   * `distance` for the full-grown plant, the vertical `fov`, and where on the
   * plant the target rides (target y = head y * rise + lift).
   *
   *  - Tall phones (0.46): close enough that the bed fills the width (the
   *    outermost kerb stones just cropped), the lantern at the left edge and
   *    the bloom on the upper third, with the camera low enough that the
   *    horizon sits back behind the hedge tops and the hedgerow beyond. A
   *    phone frame is far taller than the bed and bloom, so some lawn always
   *    shows below the kerb; this keeps it to about a quarter of the frame.
   *  - iPad portrait (0.72): closer, the lantern at the left edge, the kerb
   *    across the foot of the frame.
   *  - iPad landscape and laptops (1.33-1.6): the signed-off composition, the
   *    hero just above the middle with the bed, path, lantern and arch round
   *    it, looking down a little so the hedges, not pale sky, fill the band
   *    behind the bloom.
   *  - 16:9 and wider: the horizontal view is held near the 16:10 frame's
   *    (the lens narrows vertically instead), so a wide screen never runs out
   *    past the hedges onto open lawn; an ultrawide steps back a touch so the
   *    bed still fits.
   */
  camera: {
    target: [0, 0.55, -0.3] as Vec3,
    framings: [
      { aspect: 0.46, azimuth: 0.06, elevation: 0.33, distance: 4.1, fov: 50, targetRise: 0.45, targetLift: 0.1 },
      { aspect: 0.72, azimuth: 0.08, elevation: 0.3, distance: 3.3, fov: 49, targetRise: 0.64, targetLift: 0.1 },
      { aspect: 1.0, azimuth: 0.1, elevation: 0.24, distance: 3.5, fov: 45, targetRise: 0.68, targetLift: 0.1 },
      { aspect: 1.33, azimuth: 0.123, elevation: 0.163, distance: 3.71, fov: 42, targetRise: 0.72, targetLift: 0.1 },
      { aspect: 1.6, azimuth: 0.123, elevation: 0.163, distance: 3.71, fov: 42, targetRise: 0.72, targetLift: 0.1 },
      { aspect: 1.78, azimuth: 0.123, elevation: 0.163, distance: 3.75, fov: 40.1, targetRise: 0.72, targetLift: 0.1 },
      { aspect: 2.37, azimuth: 0.123, elevation: 0.17, distance: 4.4, fov: 31, targetRise: 0.664, targetLift: 0.1 },
    ] as readonly Framing[],
    focusRange: 1.6,
  },
} as const;
