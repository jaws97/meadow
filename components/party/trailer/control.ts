"use client";
// Starting, stopping and ending the party trailer, from the page (the Demo button and the D key). These run on the
// page's own timers, not the canvas's frame loop, so the panel and its QR code come back even if the garden has
// stalled: a watchdog stops the trailer once the garden has drawn nothing for a few seconds, and a stop at any moment
// dips to black, puts the garden back as the party shows it, and lifts the black on the panel. While it plays the
// governor is held (no pixel or tier step mid-shot), the garden keeps its full light set (lightSets: the set it opened
// with at golden hour), so the time-lapse through midday never prepares another, and the backdrop keeps the rose's
// colours (lib/garden/trailerFx heroHex), so a gate that changes the flower never rebuilds it.
//
// putBack is the one way the garden comes back: the trailer's own end calls it under its last black (HOME_AT), and a
// stop calls it under the stop's black, at any moment, as often as it likes. It puts back everything the trailer
// drives (the garden's store, the can, the weather, the focus, the doe, the camera's shot and lens, the scene's
// multipliers and the film look) and snaps the flower and its companions whole at once. The coda before it (a seed
// at night, under the title) is staged by stageCoda at the restore gate, the only remount the end needs.
import { lightSet } from "@/components/garden/lightSets";
import { weather } from "@/components/garden/garden/weather";
import { driveCan } from "@/components/garden/garden/canLive";
import { HOME, OWNER } from "@/components/party/logic";
import { stageShowcase } from "@/components/party/showcase";
import { party } from "@/components/party/store";
import { music } from "@/components/party/trailer/music";
import { CODA, TRAILER_S } from "@/components/party/trailer/script";
import { cover, QUIET, restLens, trailer, trailerCam, trailerCues } from "@/components/party/trailer/store";
import { env } from "@/lib/garden/env";
import { filmLook } from "@/lib/garden/look";
import { garden } from "@/lib/garden/store";
import { quality, visitorHold } from "@/lib/garden/quality";
import { trailerFx } from "@/lib/garden/trailerFx";
import { SPECIES } from "@/lib/plant/species";

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
  trailerCam.panelBack = saved.panel;
  party.set({ panel: false, tour: false });
  release?.();
  release = visitorHold.acquire(HOLD_S * 1000);
  lightSet.pin = true;
  // the look and the scene start as the party's own, and the backdrop holds the rose's colours through every gate
  filmLook.reset();
  trailerFx.reset();
  trailerFx.heroHex = SPECIES[garden.get().speciesId].flower.colorMid;
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

/**
 * The coda's garden (under the title, at the restore gate): the rose's own seed back in the bed at night, with no head
 * yet, so the flower remounts here, under black, and never again at the end. The weather snaps to the night at once.
 */
export function stageCoda(golden: number) {
  garden.set({
    speciesId: OWNER.species,
    seed: OWNER.seed,
    growth: CODA.growth,
    bloom: CODA.bloom,
    hour: golden + CODA.afterGolden,
    rain: CODA.rain,
    cloud: CODA.cloud,
    wind: CODA.wind,
    canMoment: null,
  });
  driveCan(null);
  trailerCues.doe = false;
  weather.primed = false;
}

/**
 * The garden as the party shows it, the camera home, the doe gone and the focus on the flower again, the scene's
 * multipliers and the film look the party's own, and the flower whole at once (under black). Safe to call again.
 */
export function putBack() {
  stageShowcase(window.location.search);
  // the can stands on its own spot again and the seed's drink has dried (components/garden/garden/canLive)
  garden.set({ canMoment: null });
  driveCan(null);
  // the stones dry and the lantern settles at once, rather than over the next half minute
  weather.primed = false;
  env.focus = null;
  trailerCues.doe = false;
  trailerCam.active = false;
  Object.assign(trailerCam.shot, HOME);
  restLens();
  trailerCam.snapFrames = 30;
  trailerFx.reset();
  filmLook.reset();
  // the rose and its companions take the showcase's growth and bloom at once rather than easing up to them
  trailerFx.snap++;
}

/** The panel and its QR code come back, and the film bars go (the tagline stays until its own time). */
export function returnPanel() {
  trailer.set({ bars: false });
  party.set({ panel: saved.panel, tour: saved.tour });
}

function done() {
  clearTimers();
  release?.();
  release = null;
  lightSet.pin = null;
  // the backdrop takes the flower's own colours again (the rose's, so nothing is rebuilt)
  trailerFx.heroHex = null;
  trailerFx.reset();
  filmLook.reset();
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
    // the garden settles under the black (the rose is whole at once; the backdrop and the lights catch up)
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
