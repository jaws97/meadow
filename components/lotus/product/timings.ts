// The courtyard's moments, as pure timings (Moments.tsx draws them): what this device's own care starts, played once
// each from the moment the button was pressed (lib/client/plant's pondStamps: topUpAt, pinchAt, plantedAt, epoch ms).
// - The pour: the brass water pot lifts a little, tips over the coping and pours its bucket (a stream, rings where it
//   lands, the level rising as the water arrives), then is set back on its step. A top-up the server refuses (or a
//   phone that gives up offline) never pours if the answer comes before the water does, stops the stream gently if it
//   comes mid-pour, and always eases the pot home: it never snaps. The pour plays on from its press whatever the stamp
//   does after (stepPour): the stamp going back to 0 is as often the top-up's hour folding into the server's state as
//   it is a refusal, so only the store's own refusal of that press (topUpRefused) changes how it plays.
// - The spill: when that bucket brought the pond to its notch, the extra runs out over the left coping near the front and wets
//   the stone there, which dries over the next half minute.
// - The pinch: a scatter of pellets on the open water at the front right, taken one by one as the koi come up.
// - The planting: the seedling and its light rise out of the jar, glide over the water to the pot and sink into it, a
//   ring spreading where they went in; the jar fades from the coping; the first leaf opens on the water. Once per plant
//   on each device: a reload, or the server catching up, never plays it again.
// Pure: no three, no DOM (the planting's memory takes a storage it is handed).
import type { TopUpRefusal } from "@/lib/garden/store";

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
/** The stream fades out over this long (s): at the pour's own end, or when the top-up is refused mid-pour. */
export const POUR_FADE = 0.35;
/** A pot refused before it pours eases back onto its step over this long (s), from wherever it had got to. */
export const POUR_HOME = 0.6;
/**
 * After a refusal the level is drawn from the pour for this long (s), while the pond's own level eases back down: by
 * then the two easings it goes through (lib/client/plant's and the courtyard's) have well under a tenth of a millimetre
 * of it left.
 */
export const POUR_SETTLE = 6;

export interface PourPose {
  tilt: number;
  lift: number;
  /** the stream, 0 none .. 1 full */
  flow: number;
}

/** Refused before the stream starts (`refused` s after the press; -1 for not refused): the pot never pours. */
const dry = (refused: number) => refused >= 0 && refused < POUR.flowFrom;

/** When the stream stops (s; it fades over POUR_FADE after): a refusal's moment mid-pour, else the pour's own. */
const streamStop = (refused: number) => (refused >= POUR.flowFrom && refused < POUR.flowTo - POUR_FADE ? refused : POUR.flowTo - POUR_FADE);

/** When the pot is back on its step (s from the press), for a top-up refused `refused` s after it (-1 for not refused). */
export function pourHome(refused = -1): number {
  if (dry(refused)) return refused + POUR_HOME;
  return streamStop(refused) + POUR_FADE + (POUR.back - POUR.flowTo);
}

/** The pot's lift and tip `x` s into the full pour. */
function shape(x: number, out: PourPose) {
  const up = smooth(0, POUR.lift, x);
  const down = smooth(POUR.flowTo, POUR.back, x);
  out.lift = LIFT * up * (1 - down);
  out.tilt = (0.15 * up + (TIP - 0.15) * smooth(POUR.lift, POUR.tip, x)) * (1 - down);
}

/**
 * The brass pot's pose and the stream's strength `t` seconds after the press (at rest outside the moment), for a top-up
 * refused `refused` s after its press (-1 for not refused). Refused before the stream starts, the pot never pours: it
 * slows from wherever its lift and tip had got to and eases back onto its step over POUR_HOME. Refused mid-pour, the
 * stream fades over POUR_FADE and the pot rights itself over the pour's own back beat, brought forward to follow it.
 * Refused once the stream has begun to fade on its own, the pour finishes as it would have. Allocates nothing.
 */
export function pourPose(t: number, out: PourPose = { tilt: 0, lift: 0, flow: 0 }, refused = -1): PourPose {
  if (!(t >= 0) || t >= pourHome(refused)) {
    out.tilt = 0;
    out.lift = 0;
    out.flow = 0;
    return out;
  }
  if (dry(refused)) {
    // the pose it was moving through, let down from the refusal: it slows, stops and comes back without a jolt
    shape(t, out);
    const k = 1 - smooth(refused, refused + POUR_HOME, t);
    out.tilt *= k;
    out.lift *= k;
    out.flow = 0;
    return out;
  }
  const stop = streamStop(refused);
  // the pot is fully tipped from the stream's start until its righting, so bringing the righting forward to follow an
  // early stop moves nothing until it begins
  shape(t >= stop ? t + (POUR.flowTo - POUR_FADE - stop) : t, out);
  out.flow = smooth(POUR.flowFrom, POUR.flowFrom + 0.25, t) * (1 - smooth(stop, stop + POUR_FADE, t));
  return out;
}

/**
 * The level the pond is drawn at during a pour: the pond's own (eased) level once the water is arriving, held at what
 * it was before the press until then, so it never rises before the stream reaches it. A refused top-up's level rises
 * only by the share its stream poured (none if it never poured) and goes down with the pond's own as that eases back,
 * until POUR_SETTLE after the refusal, when the two are the same again.
 */
export function pourLevel(t: number, before: number, now: number, refused = -1): number {
  if (!(t >= 0)) return now;
  if (refused < 0) return t >= POUR.flowTo ? now : before + (now - before) * smooth(POUR.flowFrom, POUR.flowTo, t);
  if (t >= refused + POUR_SETTLE) return now;
  const arrived = dry(refused) ? 0 : smooth(POUR.flowFrom, POUR.flowTo, Math.min(t, streamStop(refused) + POUR_FADE));
  return before + (now - before) * arrived;
}

/** The bucket brought the pond to its notch (20 mm over the fill line; the shown level stops there). */
export const spills = (levelMM: number) => levelMM >= 19.5;

/** The extra runs out over the coping until this long (s) after the stream stops; the stone dries over DRY (s). */
const SPILL_RUNS = POUR_FADE + 1.2;
const DRY = { from: POUR.flowTo + 6, to: POUR.flowTo + 32 } as const;

/**
 * The wet stone at the notch `t` s after the press: spreading as the extra runs out, then drying. A refused top-up's
 * spill stops spreading once its stream has stopped (there is none if it never poured) and dries as a full one does.
 */
export function spillWet(t: number, refused = -1): { spread: number; wet: number } {
  if (!(t >= 0) || dry(refused)) return { spread: 0, wet: 0 };
  const spread = smooth(POUR.flowFrom + 0.6, POUR.flowTo + 1.2, Math.min(t, streamStop(refused) + SPILL_RUNS));
  const wet = spread * (1 - smooth(DRY.from, DRY.to, t));
  return { spread, wet };
}

/** How long a top-up's moment lasts (s from its press): until its spill has dried, or POUR_SETTLE after a late refusal. */
export function pourOver(refused = -1): number {
  return Math.max(DRY.to, pourHome(refused), refused >= 0 ? refused + POUR_SETTLE : 0);
}

/** The top-up the courtyard is playing, as stepPour latched it (written in place). */
export interface PourLatch {
  /** the press playing (its topUpAt, epoch ms; 0 for none) */
  at: number;
  /** when its clock started (epoch ms): the press, or for a press that waited for the pot to come home, then */
  origin: number;
  /** when it was refused (s from origin), -1 for not refused */
  refused: number;
  /** the newest press seen (each is latched once), and a newer press waiting for the pot to be home (0 for none) */
  seen: number;
  waiting: number;
}

export const newPourLatch = (): PourLatch => ({ at: 0, origin: 0, refused: -1, seen: 0, waiting: 0 });

function latchPress(l: PourLatch, at: number, origin: number) {
  l.at = at;
  l.origin = origin;
  l.refused = -1;
}

/**
 * One frame of the courtyard's pour at `nowMs`: latches the pond's topUpAt (`stamp`) the first frame a newer one shows,
 * and plays from it after, whatever the stamp does: its going back to 0 (the top-up's hour folded into the server's
 * state, or a refusal withdrawing it) changes nothing by itself. `refusal` is the store's refusal of this page's own
 * top-up: if it names the press playing, that press is refused from then. A newer press while the pot is still out
 * waits until it is home and plays from then (refused while it waits, it never plays). An older stamp coming back (an
 * earlier top-up still pending when a later one is refused) is not a press. Returns the seconds since the playing
 * press, -1 for none.
 */
export function stepPour(l: PourLatch, stamp: number, refusal: TopUpRefusal | null, nowMs: number): number {
  const was = l.at > 0 ? (nowMs - l.origin) / 1000 : -1;
  const out = was >= 0 && was < pourHome(l.refused);
  if (stamp > l.seen) {
    l.seen = stamp;
    if (out) l.waiting = stamp;
    else latchPress(l, stamp, stamp);
  }
  if (l.waiting > 0) {
    if (refusal && refusal.at === l.waiting && refusal.refusedAt > 0) l.waiting = 0;
    else if (!out) {
      latchPress(l, l.waiting, nowMs);
      l.waiting = 0;
    }
  }
  if (l.at === 0) return -1;
  if (l.refused < 0 && refusal && refusal.at === l.at && refusal.refusedAt > 0) l.refused = Math.max(0, (refusal.refusedAt - l.origin) / 1000);
  const t = (nowMs - l.origin) / 1000;
  if (t >= pourOver(l.refused)) {
    l.at = 0;
    l.refused = -1;
    return -1;
  }
  return t >= 0 ? t : -1;
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
