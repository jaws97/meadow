"use client";
// A tiny external store: React re-renders only where a value is selected,
// and the render loop reads the latest state directly without re-rendering.
// In the browser the quality tier starts at what the device can carry.
// For a signed-in visitor the plant's numbers are the model's live Visual,
// eased in by lib/client/plant; the defaults are the owner's rose in full bloom.
// The care layer also says how much of the screen its card covers (dock), so
// the camera can keep the plant in the open part of the view. A lotus brings
// its pond as well (pond: the model's pond numbers, eased the same way, and the
// moments this device's own care started); it is null for the seven soil flowers, whose own can (canMoment) the
// garden plays once instead.
import { useSyncExternalStore } from "react";
import { planFor, readDevice, recallTier, rememberTier } from "@/lib/garden/device";
import { startPicture } from "@/lib/garden/picture";
import { quality } from "@/lib/garden/quality";
import type { SpeciesId } from "@/lib/plant/species";

export type Quality = "cinematic" | "balanced" | "lite";

/**
 * A lotus's pond as the garden draws it: the model's PondVisual (lib/sim/pond.ts), with the levels and shares eased by
 * lib/client/plant (counts and flags step), and the moments this device's own top-up, pinch and planting began, so
 * the scene plays each once.
 */
export interface PondShown {
  stage: "jar" | "pond";
  /** in the jar: its root and first leaf are out, so the next water action plants it */
  moveReady: boolean;
  /** the pond's level against the fill line, mm (negative below it), and the water over the pot's pebbles, mm */
  waterMM: number;
  stonesMM: number;
  /** the pond has fallen below the pot's rim; the pot's own water is gone too */
  potIsolated: boolean;
  potDry: boolean;
  /** the jar's water, 1 clear .. 0 murky, and green water 0..1 */
  jarClarity: number;
  algae: number;
  floatLeaves: number;
  aerialLeaves: number;
  /** floating leaves browning on a drying pot, and the share the koi have nibbled */
  floatBrown: number;
  nibbled: number;
  koiHunger: number;
  /** the koi gathered at the pot after a pinch, 0..1 */
  koiGather: number;
  /** the koi gulping at the surface at dawn in green water */
  koiGasp: boolean;
  aphids: number;
  /** 1, 2 or 3 on the flower's three days (0 otherwise); flowers so far; seed pods; the latest pod's drying */
  flowerDay: 0 | 1 | 2 | 3;
  flowers: number;
  pods: number;
  podDry: number;
  /** the next bud's progress, and day 3's falling petals, 0..1 */
  bud2: number;
  petalDrop: number;
  /** the flower's own warmth, 0..1, only while the model says it is warm */
  warmth: number;
  /** when this device's top-up, pinch for the koi and planting began (epoch ms), 0 for none */
  topUpAt: number;
  pinchAt: number;
  plantedAt: number;
}

/** The soil as it was before a can: the plant asked for water, it was fine, or it was still damp (watered anyway). */
export type CanSoil = "thirsty" | "ok" | "damp";

/**
 * This page's own can for a soil flower (lib/client/plant sendCare), which the garden plays once: the watering can is
 * carried to the bed and pours (components/garden/garden/canMoment). Never remembered, so a reload never replays it.
 */
export interface CanMoment {
  /** when Water was pressed (epoch ms) */
  at: number;
  /** when the server refused it, or the phone gave up offline (epoch ms), 0 for not: the can goes home */
  refusedAt: number;
  soil: CanSoil;
}

/**
 * This page's own top-up for a lotus, refused by the server or given up offline (lib/client/plant sendCare): the
 * courtyard's brass pot, pouring for it, goes home without a snap (components/lotus/product/pourLive). Never remembered.
 */
export interface TopUpRefusal {
  /** the press refused (the pond's topUpAt it was stamped with, epoch ms) */
  at: number;
  /** when it was refused (epoch ms) */
  refusedAt: number;
}

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
  /** a lotus's pond (lib/client/plant pondShownOf), or null for a soil flower and before the lotus's numbers arrive */
  pond: PondShown | null;
  /** this page's own can for a soil flower, played once by the garden; null for none (and for a lotus, a friend's garden) */
  canMoment: CanMoment | null;
  /** this page's own lotus top-up that was refused, so the brass pot goes home; null for none */
  topUpRefused: TopUpRefusal | null;
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
  pond: null,
  canMoment: null,
  topUpRefused: null,
};

const QUALITIES: readonly Quality[] = ["cinematic", "balanced", "lite"];

/**
 * The tier this device starts on, from its class and GPU (lib/garden/device),
 * and the pixel budget the runtime governor starts from (lib/garden/quality).
 * A picture chosen in the name pill's menu (lib/garden/picture), or until one
 * is, the default of Cinematic, comes first, except on the party screen; `?quality=` pins a tier for testing, as
 * the development panel does when a tier is picked there, over both;
 * `?governor=off` freezes the budget as well.
 */
export function detectQuality(): Quality {
  if (typeof window === "undefined") return initial.quality;
  const params = new URLSearchParams(window.location.search);
  const asked = params.get("quality");
  const device = readDevice();
  const plan = planFor(device);
  const pinnedTier = asked && (QUALITIES as readonly string[]).includes(asked) ? (asked as Quality) : null;
  // A device that settled on another tier last time opens on it (device.recallTier).
  const recalled = recallTier(device, plan.maxTier);
  const party = window.location.pathname.startsWith("/party");
  // until the visitor chooses, every device opens on Cinematic (lib/garden/picture), save one whose GPU is old or
  // missing (a software renderer, an old phone's), which opens on Auto
  const { chosen, auto } = startPicture(recalled ?? plan.tier, {
    party,
    pinnedByUrl: pinnedTier !== null,
    plan: plan.tier,
    defaultChoice: device.gpuClass === "low" ? "auto" : "cinematic",
  });
  // the last visit died on a tier it had climbed to: the plan's tier is remembered instead, and the climb waits a week
  if (recalled !== null && auto !== recalled) rememberTier(device, auto);
  const tier = pinnedTier ?? chosen ?? auto;
  quality.init(device, { ...plan, tier }, {
    pinned: pinnedTier !== null || chosen !== null,
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
