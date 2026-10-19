// The Meadow's opening view, its part in the opening's peace (lib/garden/opening): the garden first comes into sight
// wide, centred on the rose's island with the whole river ring and its four bridges in frame, and then the camera
// settles, slowly and calmly, onto the usual start behind the cart. CameraRig.tsx plays it; this file holds its numbers.
//
// The wide view keeps the camera's fixed bearing and looks down as steeply as the overview the rig turns into when it
// is pulled far back, so the river reads as a ring. How far back it stands follows the screen's shape, fitted rather
// than guessed: the nearest distance at which the ring, out to a strip of the far towpath and up to the bridges' lamp
// tops, sits inside the frame with a little margin. A laptop's frame is filled top to bottom by it, a tall iPad's or a
// phone's side to side.
//
// Behind the quote moment the reveal's focus pull happens on the wide view, and the settle begins a second after the
// reveal (in place of the push-in the personal garden keeps); when the quote is skipped (a quote moment on this device
// in the last ten minutes) it begins a second after the plain veil starts to lift. It takes five and a half seconds,
// easing in and out with no overshoot, the distance eased in proportion (a steady zoom to the eye rather than a lunge
// at the end); at each distance on the way in the rig looks down as steeply as it does when pulled back there, so the
// steep look holds while the camera is far out and tilts to the follow view's angle over the last stretch, while where
// it looks goes straight across from the river's middle to the start's. The welcome line and the UI keep their own
// times and arrive while it is still settling. Anything the visitor does to move the view (a drag, a pinch or the
// wheel, the keys, a tap on the ground or a plant) stops it where it is and the view is theirs from there, at the zoom
// it had come in to; reduced motion opens on the start view with no glide at all.
//
// The field of view per screen shape, and the ring-centring focus the overview also uses, live here as well, so the
// fit is made with exactly the camera the rig draws with. Pure: no three, no DOM, no React (openingView.test.ts).
import { LEVEL, riverBand } from "@/components/meadow/river";
import type { DriveMode } from "@/components/meadow/runtime";
import { quoteRuns, type OpeningState } from "@/lib/garden/opening";

/** Vertical field of view on landscape screens, degrees. */
export const FOV = 30;
/** Narrowest horizontal field of view allowed on tall screens, degrees. */
const MIN_HORIZONTAL_FOV = 24;
/** Widest horizontal field of view allowed on screens wider than 16:9, degrees. */
const MAX_HORIZONTAL_FOV = 60;
/** Wider than this, the horizontal view has a ceiling (and the rig steps back a touch). */
export const WIDE_FROM = 16 / 9;

const DEG = Math.PI / 180;

/** The vertical field of view that gives `horizontal` degrees across at this aspect. */
const verticalFor = (horizontal: number, aspect: number) => (2 * Math.atan(Math.tan((horizontal * DEG) / 2) / aspect)) / DEG;

/**
 * The camera's vertical field of view (degrees) at this aspect: 30 on a landscape screen, opened up on a tall one so
 * it never sees less than 24 degrees across, and closed down on one wider than 16:9 so it never sees more than 60.
 */
export function fovFor(aspect: number): number {
  let fov = Math.max(FOV, verticalFor(MIN_HORIZONTAL_FOV, aspect));
  if (aspect > WIDE_FROM) fov = Math.min(fov, verticalFor(MAX_HORIZONTAL_FOV, aspect));
  return fov;
}

/**
 * How far toward the camera to set the focus, `distance` back and `phi` from straight up, so a ring of radius `r` round
 * the rose sits centred on the screen: its nearest and farthest points as far below and above the middle (seen from
 * above at a slant, the near half of a ring looms larger than the far half). Whatever the field of view.
 */
export function ringFocus(distance: number, phi: number, r: number): number {
  const h = distance * Math.cos(phi);
  // where the view's two lines to the ring's near and far points make equal angles with its middle line
  const a = (-h * Math.cos(2 * phi)) / Math.sin(2 * phi);
  return a + Math.sqrt(a * a + r * r + h * h) - distance * Math.sin(phi);
}

/**
 * The wide view looks down this steeply, from straight up: the overview's own angle (CameraRig's OVERVIEW_PHI; the
 * follow view's is 0.28 pi), which the rig holds at the wide view's distance, so a settle stopped there has no tilt to undo.
 */
export const WIDE_PHI = 0.17 * Math.PI;
/** The ring fills at most this share of the frame's half-width and half-height: the little margin round it. */
export const WIDE_FILL = 0.9;
/**
 * What the wide view holds: the river ring out past its outer coping by a strip of towpath (which takes in the bridges'
 * mouths and their lamp posts), and up to the lamp tops, which stand highest on the far bank.
 */
export const WIDE_RING = { radius: riverBand().c1 + 0.6, height: LEVEL.lamp } as const;

/** How many points round the ring the fit checks, at its foot and at its top. */
const RING_SAMPLES = 96;

/**
 * Whether the ring (radius `radius`, standing `height` tall) fits inside a frame of this aspect and vertical field of
 * view, filling no more than `fill` of it, seen from `distance` back at `phi` with the focus set by ringFocus. The ring
 * is round, so the bearing does not matter: the camera stands out along +x here.
 */
function ringFits(distance: number, aspect: number, fov: number, radius: number, height: number, phi: number, fill: number): boolean {
  const tanV = Math.tan((fov * DEG) / 2) * fill;
  const tanH = tanV * aspect;
  const s = Math.sin(phi);
  const c = Math.cos(phi);
  const cx = ringFocus(distance, phi, radius) + distance * s;
  const cy = distance * c;
  for (let i = 0; i < RING_SAMPLES; i++) {
    const a = (i / RING_SAMPLES) * Math.PI * 2;
    const px = radius * Math.cos(a) - cx;
    const pz = radius * Math.sin(a);
    for (const y of [0, height]) {
      const py = y - cy;
      // into the view (forward is (-sin phi, -cos phi, 0)), across it (right is -z), and up it
      const depth = -s * px - c * py;
      const up = -c * px + s * py;
      if (depth <= 0 || Math.abs(pz) > tanH * depth || Math.abs(up) > tanV * depth) return false;
    }
  }
  return true;
}

/**
 * The wide view's distance from its focus (metres) on a screen of this aspect: the nearest at which a ring of `radius`,
 * `height` tall, fits the frame with the margin, at `phi` and the rig's field of view for the aspect.
 */
export function wideDistance(aspect: number, radius: number = WIDE_RING.radius, height: number = WIDE_RING.height, phi: number = WIDE_PHI): number {
  const fov = fovFor(aspect);
  let lo = radius * 0.5;
  let hi = radius * 40;
  for (let i = 0; i < 40; i++) {
    const mid = (lo + hi) / 2;
    if (ringFits(mid, aspect, fov, radius, height, phi, WIDE_FILL)) hi = mid;
    else lo = mid;
  }
  return hi;
}

/**
 * The settle begins this long after the Meadow starts to show (the reveal, or the plain veil starting to lift), ms: once
 * the reveal's focus pull (2.2 s) has cleared, so the wide view of the river is seen sharp and still before it moves.
 */
export const SETTLE_DELAY_MS = 2400;
/** And takes this long to come to rest on the start view, ms. */
export const SETTLE_MS = 5500;
/** Stopped part-way, what is left of its framing (pitch and focus, the distance carried over) eases out over this long, ms. */
export const RELEASE_MS = 1200;

const smooth = (t: number) => {
  const x = Math.min(1, Math.max(0, t));
  return x * x * (3 - 2 * x);
};

/** The settle's curve: 0 wide .. 1 at rest, easing in and out, never past either end. */
export const settleEase = (t: number): number => smooth(t);

/**
 * When the settle begins (performance.now() ms), or null while the Meadow is still behind a veil: SETTLE_DELAY_MS after
 * the reveal behind the quote moment, or after the Meadow was ready (the plain veil starting to lift) when it is skipped.
 */
export function settleStartAt(s: OpeningState): number | null {
  if (quoteRuns(s)) return s.revealAt === null ? null : s.revealAt + SETTLE_DELAY_MS;
  if (s.stage === "skip") return s.readyAt === null ? null : s.readyAt + SETTLE_DELAY_MS;
  return null;
}

/** How far the view has settled at `now`: 0 the wide view (held under the veil) .. 1 the start view; always 1 for reduced motion. */
export function settleProgress(s: OpeningState, now: number): number {
  if (s.reduced) return 1;
  const start = settleStartAt(s);
  return start === null ? 0 : settleEase((now - start) / SETTLE_MS);
}

/**
 * How far the view has settled after `elapsed` ms of the settle's own clock (frame time since it began, each frame's
 * share capped, so a hidden tab or a stall pauses it instead of skipping ahead): as settleProgress, without the wall clock.
 */
export function settleProgressAfter(s: OpeningState, elapsed: number): number {
  return s.reduced ? 1 : settleEase(elapsed / SETTLE_MS);
}

/** The camera's distance at progress `k`, from the wide view's `from` to the start view's `to`: eased in proportion. */
export const settleDistance = (k: number, from: number, to: number): number => from * Math.pow(to / from, k);

/** What the visitor did this frame: how the cart is driven (a tap to go or on a plant sets the autopilot off), whether the zoom moved, whether a tap reached the Meadow. */
export interface Hand {
  mode: DriveMode;
  zoomed: boolean;
  tapped: boolean;
}

/**
 * The settle stops (where it is, and the view is the visitor's) for anything that moves the view: a drag or the keys,
 * a pinch or the wheel, a tap on the ground or a plant, or the autopilot taking the cart anywhere. Only once the Meadow
 * is showing: under a veil nothing counts (a wheel over the quote, say), and the settle has not begun.
 */
export function stopsSettle(s: OpeningState, hand: Hand): boolean {
  if (s.reduced || settleStartAt(s) === null) return false;
  return hand.zoomed || hand.tapped || hand.mode !== "idle";
}

/** Stopped `elapsed` ms ago, the share of the settle's leftover framing still held: 1 at the stop, easing to 0. */
export const releaseShare = (elapsed: number): number => 1 - smooth(elapsed / RELEASE_MS);
