// What the Meadow's overlay is showing: the visit card (for a plant, or the owner's rose), a find-a-friend journey
// on its way, and the find panel. A tiny external store, written by the canvas's controller on a tap or an arrival
// (never per frame) and by the overlay's buttons, so React re-renders only the parts that show it.
import { useSyncExternalStore } from "react";

export interface Journey {
  index: number;
  name: string;
}

export interface UiState {
  /** the plant (plot index) or the rose (ROSE) whose card is open, or null */
  card: number | null;
  /** a find-a-friend journey the fireflies are leading, until the cart arrives */
  journey: Journey | null;
  findOpen: boolean;
}

let state: UiState = { card: null, journey: null, findOpen: false };
const listeners = new Set<() => void>();

export const ui = {
  get: () => state,
  set(patch: Partial<UiState>) {
    state = { ...state, ...patch };
    listeners.forEach((l) => l());
  },
  subscribe(l: () => void) {
    listeners.add(l);
    return () => {
      listeners.delete(l);
    };
  },
};

const initial = state;

export function useUi<T>(selector: (s: UiState) => T): T {
  return useSyncExternalStore(
    ui.subscribe,
    () => selector(state),
    () => selector(initial),
  );
}
