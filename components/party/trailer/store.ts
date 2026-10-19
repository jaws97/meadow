"use client";
// The party trailer's shared state, beside the party's own store (components/party/store):
// - `trailer`, what the page shows over the garden (the phase, the film bars, the caption, the closing card), read by
//   the overlay and the button through React, and changed only when one of them changes;
// - `trailerCam`, the shot the party camera takes while the trailer plays, written by the director every frame;
// - `trailerCues`, what the doe is told (whether she is in the garden);
// - `cover`, the black over the picture, written straight to its element every frame (no React render), or eased by
//   CSS when the trailer opens and closes, which keeps working even if the frame loop has stopped.
import { useSyncExternalStore } from "react";
import { HOME, type Shot } from "@/components/party/logic";

/** idle: the party screen as always; opening: dipping to black and preparing; playing; closing: stopped early, going back. */
export type TrailerPhase = "idle" | "opening" | "playing" | "closing";

export interface TrailerState {
  phase: TrailerPhase;
  bars: boolean;
  /** the lower bar's line and its second line (a flower's name): the last text each showed, kept while it fades out */
  caption: string;
  captionOn: boolean;
  sub: string;
  subOn: boolean;
  card: boolean;
}

const initial: TrailerState = { phase: "idle", bars: false, caption: "", captionOn: false, sub: "", subOn: false, card: false };

/** Nothing over the garden but (perhaps) the bars. */
export const QUIET: Partial<TrailerState> = { captionOn: false, subOn: false, card: false };
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
 * The party camera's shot while the trailer drives it; for `snapFrames` frames it takes the flower's head as it stands
 * rather than easing toward it (a new flower under a black dip, or the rose again at the end).
 */
export const trailerCam: { active: boolean; shot: Shot; snapFrames: number } = { active: false, shot: { ...HOME }, snapFrames: 0 };

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
