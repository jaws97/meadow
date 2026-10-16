"use client";
// A tiny external store: React re-renders only where a value is selected,
// and the render loop reads the latest state directly without re-rendering.
// In the browser the quality tier starts at what the device can carry.
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

const QUALITIES: readonly Quality[] = ["cinematic", "balanced", "lite"];

/**
 * Integrated and mobile GPUs, by the renderer string WebGL reports (Intel's
 * discrete Arc cards excepted). A desktop on one of these runs the cinematic
 * tier, with its 4096 shadow map and larger depth-of-field buffers, at well
 * under 30 fps, so it starts a tier lower.
 */
const MODEST_GPU = /intel|radeon\(tm\) graphics|radeon graphics|vega \d+ graphics|mali|adreno|powervr|swiftshader|llvmpipe/i;

/** The GPU's name from a throwaway context, or "" where the browser hides it. */
function gpuName(): string {
  try {
    const gl = document.createElement("canvas").getContext("webgl");
    if (!gl) return "";
    const info = gl.getExtension("WEBGL_debug_renderer_info");
    const name = info ? String(gl.getParameter(info.UNMASKED_RENDERER_WEBGL)) : "";
    gl.getExtension("WEBGL_lose_context")?.loseContext();
    return name;
  } catch {
    return "";
  }
}

/**
 * The tier this device starts on. Phones (a coarse pointer on a small screen)
 * get "lite": most of the audience is on a phone, and a phone that holds a
 * steady frame rate beats one that renders more and stutters. Tablets and
 * modest laptops get "balanced", a capable desktop "cinematic". Core count,
 * memory (Chrome only) and an integrated GPU pull a machine down a tier.
 * `?quality=` overrides it for testing, and the development panel can change
 * it at any time.
 */
export function detectQuality(): Quality {
  if (typeof window === "undefined") return initial.quality;
  const asked = new URLSearchParams(window.location.search).get("quality");
  if (asked && (QUALITIES as readonly string[]).includes(asked)) return asked as Quality;
  const nav = navigator as Navigator & { deviceMemory?: number };
  // The primary pointer, not touch support: a touchscreen laptop is still driven by its trackpad.
  const touch = window.matchMedia ? window.matchMedia("(pointer: coarse)").matches : nav.maxTouchPoints > 0;
  const shortSide = Math.min(window.screen.width, window.screen.height);
  const cores = nav.hardwareConcurrency || 4;
  const memory = nav.deviceMemory ?? 8;
  if (touch && shortSide < 600) return "lite";
  if (touch) return cores >= 8 && memory >= 6 ? "balanced" : "lite";
  if (cores < 8 || memory < 8) return "balanced";
  const gpu = gpuName();
  return MODEST_GPU.test(gpu) && !/\barc\b/i.test(gpu) ? "balanced" : "cinematic";
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
