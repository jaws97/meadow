// The courtyard's moments, as pure timings (Moments.tsx draws them): what this device's own care starts, played once
// each from the moment the button was pressed (lib/client/plant's pondStamps: topUpAt, pinchAt, plantedAt, epoch ms).
// - The pour: the brass water pot lifts a little, tips over the coping and pours its bucket (a stream, rings where it
//   lands, the level rising as the water arrives), then is set back on its step.
// - The spill: when that bucket brought the pond to its notch, the extra runs out over the left coping near the front and wets
//   the stone there, which dries over the next half minute.
// - The pinch: a scatter of pellets on the open water at the front right, taken one by one as the koi come up.
// - The planting: the seedling and its light rise out of the jar, glide over the water to the pot and sink into it, a
//   ring spreading where they went in; the jar fades from the coping; the first leaf opens on the water. Once per plant
//   on each device: a reload, or the server catching up, never plays it again.
// Pure: no three, no DOM (the planting's memory takes a storage it is handed).

const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
const smooth = (a: number, b: number, x: number) => {
  const t = clamp01((x - a) / (b - a));
  return t * t * (3 - 2 * t);
};

/** Seconds from a stamp to now, or -1 when there is none (or it is in the future: another clock). */
export function since(stamp: number, nowMs: number): number {
  if (!(stamp > 0)) return -1;
  const s = (nowMs - stamp) / 1000;
  return s >= 0 ? s : -1;
}

/** The pour's beats (s from the press): lifting, tipping over the coping, pouring, setting it back. */
export const POUR = { lift: 0.6, tip: 1.5, flowFrom: 1.5, flowTo: 3.7, back: 5 } as const;
/** How far the pot tips at the pour (radians, about 60 degrees) and lifts (m). */
const TIP = 1.05;
const LIFT = 0.03;

export interface PourPose {
  tilt: number;
  lift: number;
  /** the stream, 0 none .. 1 full */
  flow: number;
}

/** The brass pot's pose and the stream's strength `t` seconds after the press (at rest outside the moment). */
export function pourPose(t: number, out: PourPose = { tilt: 0, lift: 0, flow: 0 }): PourPose {
  if (!(t >= 0) || t >= POUR.back) {
    out.tilt = 0;
    out.lift = 0;
    out.flow = 0;
    return out;
  }
  const up = smooth(0, POUR.lift, t);
  const down = smooth(POUR.flowTo, POUR.back, t);
  out.lift = LIFT * up * (1 - down);
  out.tilt = (0.15 * up + (TIP - 0.15) * smooth(POUR.lift, POUR.tip, t)) * (1 - down);
  out.flow = smooth(POUR.flowFrom, POUR.flowFrom + 0.25, t) * (1 - smooth(POUR.flowTo - 0.35, POUR.flowTo, t));
  return out;
}

/**
 * The level the pond is drawn at during a pour: the pond's own (eased) level once the water is arriving, held at what
 * it was before the press until then, so it never rises before the stream reaches it.
 */
export function pourLevel(t: number, before: number, now: number): number {
  if (!(t >= 0) || t >= POUR.flowTo) return now;
  return before + (now - before) * smooth(POUR.flowFrom, POUR.flowTo, t);
}

/** The bucket brought the pond to its notch (20 mm over the fill line; the shown level stops there). */
export const spills = (levelMM: number) => levelMM >= 19.5;

/** The wet stone at the notch `t` s after the press: spreading as the extra runs out, then drying. */
export function spillWet(t: number): { spread: number; wet: number } {
  if (!(t >= 0)) return { spread: 0, wet: 0 };
  const spread = smooth(POUR.flowFrom + 0.6, POUR.flowTo + 1.2, t);
  const wet = spread * (1 - smooth(POUR.flowTo + 6, POUR.flowTo + 32, t));
  return { spread, wet };
}

/** The pellets: how many, when they land and when each is taken (s from the press). */
export const PELLETS = { count: 14, land: 0.5, firstTaken: 4, lastTaken: 34, gone: 36 } as const;

/** Whether pellet `i` is still on the water `t` s after the press (0 before it lands, 1 floating, easing out as taken). */
export function pelletLeft(i: number, t: number): number {
  if (!(t >= 0) || t >= PELLETS.gone) return 0;
  const land = smooth(0, PELLETS.land, t - 0.03 * i);
  // taken in a scattered order, the first soon after the koi arrive, the last about half a minute on
  const order = (i * 5) % PELLETS.count;
  const at = PELLETS.firstTaken + ((PELLETS.lastTaken - PELLETS.firstTaken) * order) / (PELLETS.count - 1);
  return land * (1 - smooth(at, at + 0.4, t));
}

/** The planting's beats (s from the press). */
export const GLIDE = { rise: 0.9, arrive: 3.7, under: 4.4, fade: 6, jarFadeFrom: 3, jarGone: 5.5, plantShows: 3.9, ring: 3.8 } as const;

export interface GlideState {
  /** 0..1 along the flight from the jar to the water over the pot (eased), then below the surface (0..1) */
  along: number;
  sink: number;
  /** the light's strength 0..1, and the jar's opacity 0..1 */
  light: number;
  jar: number;
  /** the plant in its pot shows (its first leaf grows in from here) */
  plant: boolean;
}

/** The planting `t` s after the press; null once it is over. */
export function glideState(t: number): GlideState | null {
  if (!(t >= 0) || t >= GLIDE.fade) return null;
  return {
    along: smooth(GLIDE.rise, GLIDE.arrive, t),
    sink: smooth(GLIDE.arrive, GLIDE.under, t),
    light: smooth(0, GLIDE.rise, t) * (1 - smooth(GLIDE.under, GLIDE.fade, t)),
    jar: 1 - smooth(GLIDE.jarFadeFrom, GLIDE.jarGone, t),
    plant: t >= GLIDE.plantShows,
  };
}

/** A planting moment older than this when first seen (a reload with the action still pending) is not played. */
export const GLIDE_FRESH_S = 4;

/** The key under which this device remembers the plantings it has played (per seed). */
export const GLIDE_KEY = "garden-lotus-planting:v1";

/** Storage as the moment needs it (window.localStorage, or a stand-in in a test). */
export interface Memo {
  getItem(k: string): string | null;
  setItem(k: string, v: string): void;
}

/**
 * Whether the planting stamped `stamp` for the plant `seed` should play now: fresh, and not already played on this
 * device. Remembers it as played when it says yes. Storage that fails simply lets it play.
 */
export function claimGlide(seed: string, stamp: number, nowMs: number, memo: Memo | null): boolean {
  const s = since(stamp, nowMs);
  if (s < 0 || s > GLIDE_FRESH_S) return false;
  let played: Record<string, number> = {};
  try {
    played = JSON.parse(memo?.getItem(GLIDE_KEY) ?? "{}") as Record<string, number>;
    if (!played || typeof played !== "object") played = {};
  } catch {
    played = {};
  }
  if (played[seed] === stamp) return false;
  played[seed] = stamp;
  try {
    memo?.setItem(GLIDE_KEY, JSON.stringify(played));
  } catch {
    // a convenience: without it the moment may play again on a reload while the planting is still pending
  }
  return true;
}
