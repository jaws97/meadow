// Which growing plants are drawn as light 3D plants (near, L1) and which as pictures (far, L2), decided afresh every
// frame from how tall each plant stands on screen, in device pixels: a picture holds up to about the size it was
// drawn at (atlasBake.ts cells), and past that the real plant takes over. Pure, so it is tested on its own.
//
// Calm by construction: a plant comes near only once it stands taller than `enterPx` and goes back to a picture only
// once it is shorter than `leavePx` (so a plant at the boundary never flickers as the cart rocks), and the same at the
// edges of the screen: a plant comes near only inside the view (with a margin) but stays near until it is well
// outside it, so a big plant at the edge of the frame does not swap back and forth as the cart turns, and one just
// out of view keeps casting its light plant's shadow into it. At most `maxNear` plants are near at once, the tallest
// in view first, with the ones already near holding their place against a newcomer of about the same size. The swap
// itself is a short dissolve (`advanceFades`), never a cut.

export interface LevelOptions {
  enterPx: number;
  leavePx: number;
  maxNear: number;
}

/** Seconds a plant takes to dissolve from one level to the other. */
export const FADE_SECONDS = 0.35;
/** A plant already near counts this much taller when the near places are contested... */
const HOLD = 1.25;
/** ...and one out of view this much shorter. */
const OUT_OF_VIEW = 0.5;

/**
 * Updates `near` (1 = should be a light plant) from each plant's on-screen height `px` (0 when it is well out of view,
 * behind the camera or hidden) and whether it is in view (`inView`, 1 when a plant may come near). `scratch` is reused
 * between calls to avoid garbage.
 */
export function chooseNear(px: Float32Array, inView: Uint8Array, near: Uint8Array, count: number, opts: LevelOptions, scratch: { order: number[] }): void {
  const order = scratch.order;
  order.length = 0;
  for (let i = 0; i < count; i++) {
    const keep = near[i] ? px[i] >= opts.leavePx : inView[i] === 1 && px[i] >= opts.enterPx;
    if (keep) order.push(i);
    else near[i] = 0;
  }
  if (order.length > opts.maxNear) {
    const score = (i: number) => px[i] * (near[i] ? HOLD : 1) * (inView[i] ? 1 : OUT_OF_VIEW);
    order.sort((a, b) => score(b) - score(a));
    for (let k = opts.maxNear; k < order.length; k++) near[order[k]] = 0;
    order.length = opts.maxNear;
  }
  for (const i of order) near[i] = 1;
}

/**
 * Moves each plant's dissolve `fade` (0 a picture .. 1 a light plant) toward its level over FADE_SECONDS; returns
 * whether any plant changed. `ready[i]` = 0 holds a plant at the picture until its light plant has been built.
 */
export function advanceFades(fade: Float32Array, near: Uint8Array, ready: Uint8Array, count: number, dt: number): boolean {
  const step = Math.min(1, Math.max(0, dt) / FADE_SECONDS);
  let changed = false;
  for (let i = 0; i < count; i++) {
    const want = near[i] && ready[i] ? 1 : 0;
    const f = fade[i];
    if (f === want) continue;
    fade[i] = want > f ? Math.min(1, f + step) : Math.max(0, f - step);
    changed = true;
  }
  return changed;
}

/**
 * The share of a plant's dissolve steps its light plant draws, [from, to): its picture draws from `to` up and the full
 * plant being visited below `from`. `fade` is its level's dissolve (0 a picture .. 1 a light plant) and `share` the full
 * plant's share of the visit's handover (0 when it is not being visited).
 */
export function nearRange(fade: number, share: number): [number, number] {
  const s = Math.min(1, Math.max(0, share));
  return [s, s + (1 - s) * Math.min(1, Math.max(0, fade))];
}

/**
 * How tall `metres` stands on screen at `depth` metres in front of the camera, in device pixels, where `focalPx` is the
 * canvas height in device pixels over 2 tan(fov / 2).
 */
export function screenHeight(metres: number, depth: number, focalPx: number): number {
  return depth > 0.05 ? (metres / depth) * focalPx : 0;
}
