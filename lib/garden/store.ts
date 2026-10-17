"use client";
// A tiny external store: React re-renders only where a value is selected,
// and the render loop reads the latest state directly without re-rendering.
// In the browser the quality tier starts at what the device can carry.
import { useSyncExternalStore } from "react";
import { planFor, readDevice, recallTier } from "@/lib/garden/device";
import { quality } from "@/lib/garden/quality";
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

const QUALITIES: readonly Quality[] = ["cinematic", "balanced", "lite"];

/**
 * The tier this device starts on, from its class and GPU (lib/garden/device),
 * and the pixel budget the runtime governor starts from (lib/garden/quality).
 * `?quality=` pins a tier for testing, as the development panel does when a
 * tier is picked there; `?governor=off` freezes the budget as well.
 */
export function detectQuality(): Quality {
  if (typeof window === "undefined") return initial.quality;
  const params = new URLSearchParams(window.location.search);
  const asked = params.get("quality");
  const device = readDevice();
  const plan = planFor(device);
  const pinnedTier = asked && (QUALITIES as readonly string[]).includes(asked) ? (asked as Quality) : null;
  // A device that settled on another tier last time opens on it (device.recallTier).
  const tier = pinnedTier ?? recallTier(device, plan.maxTier) ?? plan.tier;
  quality.init(device, { ...plan, tier }, {
    pinned: pinnedTier !== null,
    auto: params.get("governor") !== "off",
  });
  return tier;
}

// The server renders with the initial state (see useGarden's server snapshot);
// the browser starts from the tier its device can carry, before the canvas
// mounts, so the first frame is already built at that tier.
let state: GardenState = typeof window === "undefined" ? initial : { ...initial, quality: detectQuality() };
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
