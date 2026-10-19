"use client";
// Starting, stopping and ending the party trailer, from the page (the Demo button and the D key). These run on the
// page's own timers, not the canvas's frame loop, so the panel and its QR code come back even if the garden has
// stalled: a watchdog stops the trailer once the garden has drawn nothing for a few seconds, and a stop at any moment
// dips to black, puts the garden back as the party shows it, and lifts the black on the panel. While it plays the governor is held (no pixel or tier step mid-shot), and the garden keeps its full light set
// (lightSets: the set it opened with at golden hour), so the time-lapse through midday never prepares another.
import { lightSet } from "@/components/garden/lightSets";
import { weather } from "@/components/garden/garden/weather";
import { HOME } from "@/components/party/logic";
import { stageShowcase } from "@/components/party/showcase";
import { party } from "@/components/party/store";
import { music } from "@/components/party/trailer/music";
import { TRAILER_S } from "@/components/party/trailer/script";
import { cover, QUIET, trailer, trailerCam, trailerCues } from "@/components/party/trailer/store";
import { env } from "@/lib/garden/env";
import { quality, visitorHold } from "@/lib/garden/quality";

/** The dip to black as the trailer starts (s); the director prepares the garden under it. */
export const OPEN_S = 1.3;
/** A stop's dip to black, and the black lifting on the panel (s). */
const CLOSE_S = 0.8;
const RETURN_S = 1.6;
/** After a stop, the garden settles back under the black this long before it lifts (s). */
const SETTLE_BACK_S = 2;
/** At most this long preparing under black (s) before the trailer plays. */
export const PREPARE_MAX_S = 12;
/** The governor's hold lasts the trailer's length and this long besides (s); a slow device asks for it again. */
const SPARE_S = 25;
/** The watchdog stops the trailer once the garden has drawn nothing for this long (s): the frame loop has stalled. */
const STALL_S = 8;
/** ...or once it has run this many times its length (a device too slow to be worth waiting for). */
const SLOWEST = 4;

/** When the trailer was asked for, the director's last frame (performance.now), and whether the GPU context is lost. */
export const run = { openedAt: 0, beat: 0, lost: false };

let saved = { panel: true, tour: false };
let release: (() => void) | null = null;
let watchdog = 0;
let holdUntil = 0;
const timers = new Set<number>();

function later(seconds: number, fn: () => void) {
  const id = window.setTimeout(() => {
    timers.delete(id);
    fn();
  }, seconds * 1000);
  timers.add(id);
}

function clearTimers() {
  for (const id of timers) window.clearTimeout(id);
  timers.clear();
  window.clearInterval(watchdog);
}

const HOLD_S = OPEN_S + PREPARE_MAX_S + TRAILER_S + SPARE_S;

/** Every second while the trailer plays: is the garden still drawing, and is the governor still held? */
function watch() {
  const now = performance.now();
  const phase = trailer.get().phase;
  if (phase !== "opening" && phase !== "playing") return;
  if (now - run.beat > STALL_S * 1000 || now - run.openedAt > SLOWEST * HOLD_S * 1000) {
    stopTrailer();
    return;
  }
  // a device slower than the trailer's own pace takes longer: the hold is renewed before it lapses
  if (now > holdUntil - SPARE_S * 500) {
    release?.();
    release = visitorHold.acquire(HOLD_S * 1000);
    holdUntil = now + HOLD_S * 1000;
  }
}

/** Whether the trailer can start now: the garden is showing, it has not fallen back, and nothing else is playing. */
export function canPlay(): boolean {
  return quality.get().phase === "live" && !party.get().fallback && !run.lost && trailer.get().phase === "idle";
}

export function startTrailer(): boolean {
  if (!canPlay()) return false;
  const p = party.get();
  saved = { panel: p.panel, tour: p.tour };
  party.set({ panel: false, tour: false });
  release?.();
  release = visitorHold.acquire(HOLD_S * 1000);
  lightSet.pin = true;
  run.openedAt = run.beat = performance.now();
  holdUntil = run.openedAt + HOLD_S * 1000;
  trailer.set({ ...QUIET, phase: "opening", bars: true });
  cover.set(1, OPEN_S);
  // in the click or key press itself, the only moment a browser lets sound start
  music.begin();
  window.clearInterval(watchdog);
  watchdog = window.setInterval(watch, 1000);
  return true;
}

/** The garden as the party shows it, the camera home, the doe gone and the focus on the flower again (under black). */
export function putBack() {
  stageShowcase(window.location.search);
  // the stones dry and the lantern settles at once, rather than over the next half minute
  weather.primed = false;
  env.focus = null;
  trailerCues.doe = false;
  trailerCam.active = false;
  Object.assign(trailerCam.shot, HOME);
  trailerCam.snapFrames = 30;
}

/** The panel and its QR code come back, and the film bars go. */
export function returnPanel() {
  trailer.set({ ...QUIET, bars: false });
  party.set({ panel: saved.panel, tour: saved.tour });
}

function done() {
  clearTimers();
  release?.();
  release = null;
  lightSet.pin = null;
  trailer.set({ ...QUIET, phase: "idle", bars: false });
}

/** The trailer has played to its end (the director has already put the garden back and brought the panel). */
export function finishTrailer() {
  if (trailer.get().phase === "idle") return;
  cover.set(0);
  music.end(0.5);
  done();
}

/** Stops the trailer early (the button, D, the watchdog, or a failure): to black, the garden put back, the panel again. */
export function stopTrailer() {
  const phase = trailer.get().phase;
  if (phase === "idle" || phase === "closing") return;
  clearTimers();
  trailer.set({ ...QUIET, phase: "closing" });
  cover.set(1, CLOSE_S);
  music.end(CLOSE_S);
  later(CLOSE_S + 0.1, () => {
    putBack();
    // the rose eases back to full bloom under the black (the plant follows the store at 2.5 a second)
    later(SETTLE_BACK_S, () => {
      trailerCam.snapFrames = Math.max(trailerCam.snapFrames, 3);
      cover.set(0, RETURN_S);
      returnPanel();
      later(RETURN_S, done);
    });
  });
}

export function toggleTrailer() {
  if (trailer.get().phase === "idle") startTrailer();
  else stopTrailer();
}
