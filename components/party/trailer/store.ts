"use client";
// The party trailer's shared state, beside the party's own store (components/party/store):
// - `trailer`, what the page shows over the garden (the phase, the film bars, and the type: a line of words revealed a
//   group at a time, a flower's name under the montage's line, the title and the closing tagline), read by the overlay
//   and the button through React, and changed only when one of them changes;
// - `trailerCam`, the shot and the lens the party camera takes while the trailer plays, written by the director every
//   frame;
// - `trailerCues`, what the doe is told (whether she is in the garden);
// - `cover`, the black over the picture, written straight to its element every frame (no React render), or eased by
//   CSS when the trailer opens and closes, which keeps working even if the frame loop has stopped;
// - `overlayRoot`, the overlay's own element, on which the director sets where the coda's seed stands across the
//   screen (--coda-x), so the tagline sits over it.
import { useSyncExternalStore } from "react";
import { HOME, LENS_REST, type LensAim, type Shot } from "@/components/party/logic";
import type { LineId } from "@/components/party/trailer/script";

/** idle: the party screen as always; opening: dipping to black and preparing; playing; closing: stopped early, going back. */
export type TrailerPhase = "idle" | "opening" | "playing" | "closing";

export interface TrailerState {
  phase: TrailerPhase;
  bars: boolean;
  /**
   * The line of words (script LINES): the last one shown, kept while it fades out (null before the first), how many of
   * its reveal groups are showing, and whether it is on.
   */
  line: LineId | null;
  lineGroups: number;
  lineOn: boolean;
  /** a montage flower's name, under the montage's line: the last one shown, kept while it fades out, and whether it is on */
  name: string | null;
  nameOn: boolean;
  /** the title on black (script END_TITLE, or the crest alone) */
  title: boolean;
  /** the closing tagline (script TAGLINE), over the coda's seed */
  tagline: boolean;
}

const initial: TrailerState = {
  phase: "idle",
  bars: false,
  line: null,
  lineGroups: 0,
  lineOn: false,
  name: null,
  nameOn: false,
  title: false,
  tagline: false,
};

/** Nothing over the garden but (perhaps) the bars: every piece of type turned off (its last words kept, to fade out). */
export const QUIET: Partial<TrailerState> = { lineOn: false, nameOn: false, title: false, tagline: false };
let state = initial;
const listeners = new Set<() => void>();

export const trailer = {
  get: () => state,
  set(patch: Partial<TrailerState>) {
    const next = { ...state, ...patch };
    if ((Object.keys(patch) as (keyof TrailerState)[]).every((k) => next[k] === state[k])) return;
    state = next;
    listeners.forEach((l) => l());
  },
  subscribe(l: () => void) {
    listeners.add(l);
    return () => {
      listeners.delete(l);
    };
  },
};

export function useTrailer<T>(selector: (s: TrailerState) => T): T {
  return useSyncExternalStore(
    trailer.subscribe,
    () => selector(state),
    () => selector(initial),
  );
}

/**
 * The party camera's shot and lens while the trailer drives it (`active`); for `snapFrames` frames it takes the
 * flower's head as it stands rather than easing toward it (a cut, a new flower under a black dip, or the rose again at
 * the end). The lens (logic LensAim) pans toward `target` by `look`, shifts the picture by `shiftX`/`shiftY`, and with
 * `follow` takes the head as it stands every frame; at rest it is LENS_REST.
 */
export const trailerCam: { active: boolean; shot: Shot; snapFrames: number; lens: LensAim } = {
  active: false,
  shot: { ...HOME },
  snapFrames: 0,
  lens: { ...LENS_REST, target: { ...LENS_REST.target } },
};

/** Puts the trailer's lens back at rest (in place: the camera holds the object). */
export function restLens() {
  const l = trailerCam.lens;
  l.look = LENS_REST.look;
  l.target.x = LENS_REST.target.x;
  l.target.y = LENS_REST.target.y;
  l.target.z = LENS_REST.target.z;
  l.shiftX = LENS_REST.shiftX;
  l.shiftY = LENS_REST.shiftY;
  l.follow = LENS_REST.follow;
}

/** What the doe is told. */
export const trailerCues = { doe: false };

/**
 * The black never quite covers the garden: a canvas wholly hidden behind an opaque layer is set aside by the browser's
 * compositor, and the first frame that shows it again is a long one (measured at about half a second, and nearly two
 * after the trailer's preparation). At 99.5 % it reads as black and the canvas keeps being composited.
 */
const DARKEST = 0.995;

/** The black over the picture (the overlay registers its element). */
export const cover = {
  el: null as HTMLElement | null,
  /** Sets the black's opacity, at once (`seconds` 0, from the frame loop) or eased by CSS. */
  set(opacity: number, seconds = 0) {
    const el = cover.el;
    if (!el) return;
    const transition = seconds > 0 ? `opacity ${seconds}s cubic-bezier(0.4, 0, 0.2, 1)` : "none";
    if (el.style.transition !== transition) el.style.transition = transition;
    const value = String(Math.round(Math.min(DARKEST, Math.max(0, opacity)) * 1000) / 1000);
    if (el.style.opacity !== value) el.style.opacity = value;
  },
};

/** The overlay's root element (the overlay registers it), and where the coda's seed stands across the screen. */
export const overlayRoot = {
  el: null as HTMLElement | null,
  /** Sets --coda-x on the overlay's root: the coda seed's place across the screen, a share of its width (0..1). */
  setCodaX(share: number) {
    const el = overlayRoot.el;
    if (!el) return;
    const value = `${Math.round(Math.min(1, Math.max(0, share)) * 1000) / 10}%`;
    if (el.style.getPropertyValue("--coda-x") !== value) el.style.setProperty("--coda-x", value);
  },
};
