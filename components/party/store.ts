"use client";
// The party screen's own small store, beside the garden's (lib/garden/store):
// whether the panel and the slow tour are on, how far the lens slides to keep
// the rose clear of the panel (written by the panel as it lays out, read by
// the camera every frame without a re-render), and whether the screen has
// fallen back to the panel alone because the 3D garden could not start.
import { useSyncExternalStore } from "react";

export interface PartyState {
  panel: boolean;
  tour: boolean;
  /** share of the frame's width the rose moves left while the panel shows */
  shiftX: number;
  /** share of the frame's height the rose moves up while the panel shows (portrait) */
  shiftY: number;
  /** the garden could not start (no WebGL, or it failed): the panel stands alone on a quiet backdrop */
  fallback: boolean;
}

const initial: PartyState = { panel: true, tour: false, shiftX: 0, shiftY: 0, fallback: false };

let state = initial;
const listeners = new Set<() => void>();

export const party = {
  get: () => state,
  set(patch: Partial<PartyState>) {
    const next = { ...state, ...patch };
    if ((Object.keys(patch) as (keyof PartyState)[]).every((k) => next[k] === state[k])) return;
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

export function useParty<T>(selector: (s: PartyState) => T): T {
  return useSyncExternalStore(
    party.subscribe,
    () => selector(state),
    () => selector(initial),
  );
}
