// The timing of the garden's endless beds and its bird calls, as plain numbers: no Web Audio here, so it is tested in
// node (loopPlan.test.ts) and the engine (lib/sound/engine-layers) only turns each plan into nodes.
//
// A bed is a 50 s mono recording, and a plain loop of it would repeat its seam every 50 s, a tick or a hush the ear
// soon learns. So a bed plays as a chain of overlapping segments instead: each starts at a random place in the
// recording and runs a random 20 to about 40 s, and the next begins `fadeS` (about 3 s) before it ends, the two joined
// by an equal-power crossfade (sine in, cosine out, so the power of the two together stays level when they are
// unrelated sound). No seam ever falls in the same place twice. The ends of each file, where it was faded when it was
// made, are left out (`edgeS`), and the longest segments are shortened so that offsets always have room to vary.
//
// The engine plays each bed as two such chains from the same buffer, panned left and right, for a sense of width from
// a mono file. Two copies of a recording a few milliseconds apart would comb (a hollow, phasey sound), so wherever two
// segments overlap, whether one chain's crossfade or the two chains side by side, the new one's place in the recording
// is kept at least `minGapS` from the other's. Brown noise uses the same planner with shorter segments over its 12 s
// buffer.
//
// Bird calls are dropped in one at a time: after each call ends, a wait drawn from an exponential distribution (the
// gaps of a Poisson process) whose mean keeps the average close to the plan's calls per minute.

/** How a looped buffer is cut into segments. */
export interface LoopOptions {
  /** the buffer's length (s) */
  fileS: number;
  /** the equal-power crossfade between one segment and the next (s) */
  fadeS: number;
  /** the shortest and longest segment, fades included (s) */
  minS: number;
  maxS: number;
  /** left out at each end of the buffer, where the file was faded when it was made (s) */
  edgeS: number;
  /** overlapping segments keep at least this far apart in the recording, so they never comb (s) */
  minGapS: number;
  /** the span offsets are drawn from stays at least this wide; the longest segments are shortened to keep it (s) */
  minSpreadS: number;
}

/** A recorded bed: 20 to 45 s segments with 3 s crossfades (the longest shortened to fit a 50 s file). */
export const BED_LOOP: Omit<LoopOptions, "fileS"> = { fadeS: 3, minS: 20, maxS: 45, edgeS: 0.6, minGapS: 2.5, minSpreadS: 10 };
/** Brown noise, made in code: a 12 s buffer, 5 to 8 s segments with 2 s crossfades. */
export const NOISE_LOOP: Omit<LoopOptions, "fileS"> = { fadeS: 2, minS: 5, maxS: 8, edgeS: 0, minGapS: 1, minSpreadS: 3 };
/** The first segment of a chain comes in this quickly; the layer's own gain brings the sound in gently (s). */
export const FIRST_FADE_S = 0.03;
/** The number of points in a crossfade curve. */
export const CURVE_POINTS = 64;

/** One stretch of a recording, placed on the audio clock. */
export interface Segment {
  /** when it starts, on the audio clock (s) */
  at: number;
  /** where in the buffer it starts (s) */
  offset: number;
  /** how long it plays, fades included (s) */
  duration: number;
  /** its fade in from the start and its fade out to the end (s) */
  fadeIn: number;
  fadeOut: number;
}

/** A uniform random number in [0, 1). */
export type Random = () => number;

/** The shortest and longest segment a buffer allows (s). */
export function segmentBounds(o: LoopOptions): { min: number; max: number } {
  const usable = Math.max(0, o.fileS - 2 * o.edgeS);
  const max = Math.max(Math.min(o.maxS, usable - o.minSpreadS), Math.min(o.minS, usable));
  return { min: Math.min(o.minS, max), max };
}

/** Where in the recording a segment is at time `t`, carried on past its ends as if it ran on (s). */
export function positionAt(s: Segment, t: number): number {
  return s.offset + (t - s.at);
}

/**
 * The next segment of a chain. `prev` is the chain's own latest segment (null for the first, which starts at `firstAt`
 * with a quick fade in), and `others` the segments of other chains that may overlap it. Each later segment starts as
 * `prev` begins its fade out, fading in over the same time.
 */
export function nextSegment(
  o: LoopOptions,
  random: Random,
  prev: Segment | null,
  others: readonly Segment[] = [],
  firstAt = 0,
): Segment {
  const { min, max } = segmentBounds(o);
  const duration = min + (max - min) * random();
  const at = prev ? prev.at + prev.duration - prev.fadeOut : firstAt;
  const fadeIn = prev ? prev.fadeOut : Math.min(FIRST_FADE_S, duration / 4);
  const fadeOut = Math.min(o.fadeS, duration / 3);
  const end = at + duration;
  const avoid: number[] = [];
  for (const s of prev ? [prev, ...others] : others) {
    if (s.at < end && s.at + s.duration > at) avoid.push(positionAt(s, at));
  }
  const offset = pickOffset(o.edgeS, o.fileS - o.edgeS - duration, avoid, o.minGapS, random);
  return { at, offset, duration, fadeIn, fadeOut };
}

/**
 * A random offset in [lo, hi] at least `gap` from every point in `avoid`, uniformly over the places allowed; when none
 * is, the place farthest from them all.
 */
export function pickOffset(lo: number, hi: number, avoid: readonly number[], gap: number, random: Random): number {
  if (!(hi > lo)) return Math.max(0, lo);
  let free: [number, number][] = [[lo, hi]];
  for (const p of avoid) {
    const next: [number, number][] = [];
    for (const [a, b] of free) {
      if (p + gap <= a || p - gap >= b) next.push([a, b]);
      else {
        if (p - gap > a) next.push([a, p - gap]);
        if (p + gap < b) next.push([p + gap, b]);
      }
    }
    free = next;
  }
  const total = free.reduce((sum, [a, b]) => sum + (b - a), 0);
  if (total > 1e-6) {
    let u = random() * total;
    for (const [a, b] of free) {
      if (u <= b - a) return a + u;
      u -= b - a;
    }
    return free[free.length - 1][1];
  }
  // nowhere is far enough: the farthest place, among the ends and the midpoints between the points to avoid
  const stops = [lo, ...avoid.map((p) => Math.min(hi, Math.max(lo, p))).sort((a, b) => a - b), hi];
  const candidates = [lo, hi];
  for (let i = 1; i < stops.length; i++) candidates.push((stops[i - 1] + stops[i]) / 2);
  const distance = (x: number) => Math.min(...avoid.map((p) => Math.abs(x - p)));
  return candidates.reduce((best, x) => (distance(x) > distance(best) ? x : best), lo);
}

/**
 * An equal-power fade for `AudioParam.setValueCurveAtTime`: sin for a fade in, cos for a fade out, so a fade out and
 * a fade in over the same span keep the power of two unrelated sounds level (sin² + cos² = 1).
 */
export function equalPowerCurve(direction: "in" | "out", points = CURVE_POINTS): Float32Array {
  const curve = new Float32Array(points);
  for (let i = 0; i < points; i++) {
    const x = (i / (points - 1)) * (Math.PI / 2);
    curve[i] = direction === "in" ? Math.sin(x) : Math.cos(x);
  }
  return curve;
}

/** A bird call is never followed by the next sooner than this (s). */
export const MIN_SHOT_REST_S = 2;

/**
 * The wait after a call before the next (s): MIN_SHOT_REST_S plus an exponential wait, its mean chosen so that the
 * call just heard (`callS`) and the wait together average the time between calls at `perMinute` (when calls that
 * long allow it). Infinity when no calls are wanted.
 */
export function shotGap(perMinute: number, callS: number, random: Random): number {
  if (!(perMinute > 0)) return Infinity;
  const scale = Math.max(1, 60 / perMinute - Math.max(0, callS) - MIN_SHOT_REST_S);
  return MIN_SHOT_REST_S - Math.log(1 - random()) * scale;
}
