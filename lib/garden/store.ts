"use client";
// A tiny external store: React re-renders only where a value is selected,
// and the render loop reads the latest state directly without re-rendering.
// In the browser the quality tier starts at what the device can carry.
// For a signed-in visitor the plant's numbers are the model's live Visual,
// eased in by lib/client/plant; the defaults are the owner's rose in full bloom.
// The care layer also says how much of the screen its card covers (dock), so
// the camera can keep the plant in the open part of the view.
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
  /** the model's droop for a live plant (0 upright .. 1 wilted); null derives it from moisture and health (droopOf) */
  droop: number | null;
  /** leaf yellowing 0..1 (short of nitrogen, or old drought injury); the lower leaves turn first */
  chlorosis: number;
  /** a dark, water-soaked stem base 0..1 */
  rot: number;
  /** pest pressure 0..1, mushrooms 0..5 and snails 0..3 in the bed (kept for the UI; not drawn yet) */
  pests: number;
  mushrooms: number;
  snails: number;
  /** the flower against a full one: smaller after stress while budding, 0.7 for a second-chance sprout */
  flowerSize: number;
  /** a soft extra glow for an hour after the plant is talked to, 0..1 */
  glow: number;
  /** the shade cloth (1 up, 0 folded away) and the rain cover over the bed; the garden eases them in and out */
  shade: number;
  cover: number;
  /** CSS px of the screen's bottom (a card) and right edge (a narrow side panel) under the care layer; 0 for none */
  dockBottom: number;
  dockRight: number;
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
  droop: null,
  chlorosis: 0,
  rot: 0,
  pests: 0,
  mushrooms: 0,
  snails: 0,
  flowerSize: 1,
  glow: 0,
  shade: 0,
  cover: 0,
  dockBottom: 0,
  dockRight: 0,
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
    // the clock, the tier and the care layer's dock are the screen's, not the plant's
    garden.set({ ...initial, hour: state.hour, quality: state.quality, dockBottom: state.dockBottom, dockRight: state.dockRight });
  },
};

export function useGarden<T>(selector: (s: GardenState) => T): T {
  return useSyncExternalStore(
    garden.subscribe,
    () => selector(garden.get()),
    () => selector(initial),
  );
}
