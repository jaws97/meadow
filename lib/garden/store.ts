"use client";
// A tiny external store: React re-renders only where a value is selected,
// and the render loop reads the latest state directly without re-rendering.
import { useSyncExternalStore } from "react";
import type { SpeciesId } from "@/lib/plant/species";

export type Quality = "cinematic" | "balanced" | "lite";

export interface GardenState {
  speciesId: SpeciesId;
  seed: string;
  growth: number;
  bloom: number;
  health: number;
  moisture: number;
  scorch: number;
  wind: number;
  /** fractional hour in Bangalore */
  hour: number;
  autoClock: boolean;
  cloud: number;
  rain: number;
  quality: Quality;
}

const initial: GardenState = {
  speciesId: "rose",
  seed: "Lijas",
  growth: 1,
  bloom: 1,
  health: 1,
  moisture: 0.6,
  scorch: 0,
  wind: 0.5,
  hour: 12,
  autoClock: true,
  cloud: 0.2,
  rain: 0,
  quality: "cinematic",
};

let state: GardenState = initial;
const listeners = new Set<() => void>();

export const garden = {
  get: () => state,
  set(patch: Partial<GardenState>) {
    state = { ...state, ...patch };
    listeners.forEach((l) => l());
  },
  subscribe(l: () => void) {
    listeners.add(l);
    return () => {
      listeners.delete(l);
    };
  },
  reset() {
    garden.set({ ...initial, hour: state.hour, quality: state.quality });
  },
};

export function useGarden<T>(selector: (s: GardenState) => T): T {
  return useSyncExternalStore(
    garden.subscribe,
    () => selector(garden.get()),
    () => selector(initial),
  );
}
