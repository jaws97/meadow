// What kind of screen the garden is opening on, and what it should ask of it.
//
// The garden is seen on phones (most of the audience), iPads, office laptops
// with integrated graphics, the odd workstation, and a 1080p screen at the
// party. Each gets a starting quality tier (the content: how many leaves,
// which materials, which post effects) and a pixel budget: a cap on the
// canvas's total rendered pixels, because almost every cost in the frame is
// paid per pixel and a high-DPI laptop would otherwise draw two million of
// them through the full post stack. The runtime governor (lib/garden/quality)
// then moves the budget inside its floor and ceiling to hold the frame rate.
//
// The budget's floor is a pixel ratio, not a pixel count: below about 0.85 of
// a CSS pixel on a laptop (1.0 on a tablet, 1.1 on a phone held close) the
// rose's petal rims and thorns visibly stair-step, and a lighter tier drawn
// crisp looks better than a richer one drawn soft. So at the floor the
// governor steps the tier down rather than cutting pixels; only the lightest
// tier, with nowhere further to go, may sink below it to a last-resort ratio.
//
// Classification reads only what the browser offers without a prompt: the
// screen's size, the primary pointer, maxTouchPoints, devicePixelRatio,
// hardwareConcurrency, deviceMemory (Chromium only) and the GPU's name
// (masked to "Apple GPU" in Safari). iPadOS reports a Mac user agent, so an
// iPad is a "Mac" with touch points.
import type { Quality } from "@/lib/garden/store";

export type DeviceKind = "phone" | "tablet" | "laptop" | "bigscreen";
export type GpuClass = "low" | "mid" | "high";

export interface Device {
  kind: DeviceKind;
  /** The primary input is a finger, not a mouse or trackpad. */
  touch: boolean;
  dpr: number;
  cores: number;
  /** GB; Chromium reports it, elsewhere it is assumed. */
  memory: number;
  gpu: string;
  gpuClass: GpuClass;
}

/** Megapixels of canvas the governor may draw on the current canvas: where it starts and the range it moves in. */
export interface PixelBudget {
  /** MIN_DPR's worth of pixels: at this floor and still slow, the tier steps down instead. */
  floor: number;
  /** LAST_DPR's worth: how far the lightest tier may sink when even it is slow at the floor. */
  hardFloor: number;
  start: number;
  ceiling: number;
}

export interface QualityPlan {
  tier: Quality;
  /** The highest tier the governor may climb back to. */
  maxTier: Quality;
}

export const TIERS: readonly Quality[] = ["lite", "balanced", "cinematic"];

/** Software rasterisers and the oldest mobile and integrated parts. */
const LOW_GPU =
  /swiftshader|llvmpipe|software|basic render|mali-[4t]|adreno \(tm\) [345]\d\d|adreno [345]\d\d|powervr|intel\(r\) hd graphics|intel hd graphics|uhd graphics 6\d\d|gma/i;
/** Discrete desktop and laptop cards, Apple silicon (named in Chrome), Intel Arc. */
const HIGH_GPU = /geforce|rtx|gtx|quadro|nvidia|radeon rx|radeon pro|apple m\d|\barc\b/i;

/** The GPU's name from a throwaway context, or "" where the browser hides it. */
export function gpuName(): string {
  try {
    const gl = document.createElement("canvas").getContext("webgl");
    if (!gl) return "";
    const info = gl.getExtension("WEBGL_debug_renderer_info");
    const name = info ? String(gl.getParameter(info.UNMASKED_RENDERER_WEBGL)) : String(gl.getParameter(gl.RENDERER));
    gl.getExtension("WEBGL_lose_context")?.loseContext();
    return name;
  } catch {
    return "";
  }
}

export function classifyGpu(name: string): GpuClass {
  if (LOW_GPU.test(name)) return "low";
  if (HIGH_GPU.test(name)) return "high";
  // Integrated Radeon and Iris, phone GPUs from the last few years, Safari's
  // masked "Apple GPU", and anything unrecognised.
  return "mid";
}

/** True for an iPad on iPadOS 13+, which reports itself as a Mac. */
function isIpadOs(): boolean {
  return /Macintosh/.test(navigator.userAgent) && navigator.maxTouchPoints > 1;
}

const mq = (q: string) => (typeof window.matchMedia === "function" ? window.matchMedia(q).matches : false);

/**
 * The primary input is a finger. The primary pointer, not touch support: a
 * touchscreen laptop is still driven by its trackpad. An iPad with a keyboard
 * and trackpad still counts as touch, because that is how it is mostly held.
 */
export function primaryTouch(): boolean {
  return isIpadOs() || mq("(pointer: coarse)") || (!mq("(pointer: fine)") && navigator.maxTouchPoints > 0);
}

export function readDevice(): Device {
  const nav = navigator as Navigator & { deviceMemory?: number };
  const ipad = isIpadOs();
  const touch = primaryTouch();
  const sw = window.screen.width;
  const sh = window.screen.height;
  const shortSide = Math.min(sw, sh);
  const longSide = Math.max(sw, sh);
  const dpr = window.devicePixelRatio || 1;
  let kind: DeviceKind;
  if (touch) kind = shortSide < 600 && !ipad ? "phone" : "tablet";
  // A big, low-density screen viewed from across a room: the party screen or a desktop monitor.
  else if (longSide >= 1800 && dpr <= 1.25) kind = "bigscreen";
  else kind = "laptop";
  // ?device=phone|tablet|laptop|bigscreen tries another class's plan (for testing on a desktop).
  const forced = new URLSearchParams(window.location.search).get("device");
  if (forced === "phone" || forced === "tablet" || forced === "laptop" || forced === "bigscreen") kind = forced;
  const gpu = gpuName();
  return {
    kind,
    touch,
    dpr,
    cores: nav.hardwareConcurrency || 4,
    memory: nav.deviceMemory ?? (touch ? 4 : 8),
    gpu,
    gpuClass: classifyGpu(gpu),
  };
}

/**
 * Where each tier starts and how far it may climb, in megapixels. Phones get
 * their own: a small screen held close forgives a softer image. The floors
 * come from MIN_DPR and the canvas's size (budgetFor).
 */
const BUDGETS: Record<DeviceKind, Record<Quality, { start: number; ceiling: number }>> = {
  phone: {
    lite: { start: 0.7, ceiling: 1.3 },
    balanced: { start: 0.6, ceiling: 1.1 },
    cinematic: { start: 0.8, ceiling: 1.3 },
  },
  tablet: {
    lite: { start: 0.9, ceiling: 1.6 },
    balanced: { start: 0.9, ceiling: 1.7 },
    cinematic: { start: 1.2, ceiling: 2.0 },
  },
  laptop: {
    lite: { start: 1.1, ceiling: 2.0 },
    balanced: { start: 0.95, ceiling: 2.0 },
    cinematic: { start: 1.6, ceiling: 2.4 },
  },
  bigscreen: {
    lite: { start: 1.2, ceiling: 2.1 },
    balanced: { start: 1.1, ceiling: 2.1 },
    cinematic: { start: 1.8, ceiling: 2.5 },
  },
};

/** The lowest pixel ratio a class is drawn at before the tier steps down instead (see the header). */
export const MIN_DPR: Record<DeviceKind, number> = { phone: 1.1, tablet: 1.0, laptop: 0.85, bigscreen: 0.85 };
/** The lightest tier's last resort, when it is still slow at MIN_DPR. */
export const LAST_DPR: Record<DeviceKind, number> = { phone: 0.85, tablet: 0.75, laptop: 0.6, bigscreen: 0.6 };

/** The densest pixel ratio worth drawing: the screen's own, but never past 2, past which nobody can tell. */
export const maxDpr = (deviceDpr: number) => Math.min(2, Math.max(1, deviceDpr));

const lower = (q: Quality): Quality => TIERS[Math.max(0, TIERS.indexOf(q) - 1)];

/**
 * The starting plan for a device. Phones open on "lite": a phone that holds a
 * steady frame rate beats one that renders more and stutters, and it runs
 * cooler through a daily visit. Tablets and laptops follow the GPU: integrated
 * graphics get "balanced", a discrete card or Apple silicon "cinematic". Few
 * cores or little memory pull a device down a tier.
 */
export function planFor(d: Device): QualityPlan {
  let tier: Quality;
  if (d.kind === "phone") tier = "lite";
  else if (d.gpuClass === "low") tier = "lite";
  else if (d.gpuClass === "high" && !d.touch) tier = "cinematic";
  else tier = "balanced";
  if (d.kind !== "phone" && (d.cores < 4 || d.memory < 4)) tier = lower(tier);
  // Phones stay on lite; elsewhere the governor may climb back to what the GPU class allows.
  const maxTier: Quality = d.kind === "phone" ? "lite" : d.gpuClass === "high" ? "cinematic" : d.gpuClass === "mid" ? "balanced" : "lite";
  return { tier, maxTier: TIERS.indexOf(maxTier) < TIERS.indexOf(tier) ? tier : maxTier };
}

const TIER_KEY = "garden-tier:v1";
/** A remembered tier is trusted for a week; drivers and browsers update. */
const TIER_MAX_AGE_MS = 7 * 24 * 3600 * 1000;

/**
 * The tier this device settled on last time, if it is the same kind of
 * device with the same GPU and the memory is recent. A colleague visits every
 * day: opening straight on the tier that fits saves trying a richer one under
 * the veil first (three or four seconds on an office laptop). The governor
 * can still climb back if the device turns out to have room. Browser storage
 * is a convenience only; without it the plan's own tier is used.
 */
export function recallTier(d: Device, maxTier: Quality): Quality | null {
  try {
    const raw = window.localStorage.getItem(TIER_KEY);
    if (!raw) return null;
    const s = JSON.parse(raw) as { tier: Quality; kind: DeviceKind; gpu: string; at: number };
    if (s.kind !== d.kind || s.gpu !== d.gpu || !(Date.now() - s.at < TIER_MAX_AGE_MS)) return null;
    if (!TIERS.includes(s.tier) || TIERS.indexOf(s.tier) > TIERS.indexOf(maxTier)) return null;
    return s.tier;
  } catch {
    return null;
  }
}

/** Remembers the tier a visit settled on (see recallTier). */
export function rememberTier(d: Device, tier: Quality) {
  try {
    window.localStorage.setItem(TIER_KEY, JSON.stringify({ tier, kind: d.kind, gpu: d.gpu, at: Date.now() }));
  } catch {
    // storage full or blocked: the next visit starts from the plan
  }
}

/**
 * A tier's pixel budget on a canvas of `cssW` x `cssH`: the floor at MIN_DPR,
 * the ceiling never past what the screen can show (and never under the
 * floor, so a huge canvas steps tiers rather than going soft), the start
 * between them.
 */
export function budgetFor(kind: DeviceKind, tier: Quality, cssW: number, cssH: number, deviceDpr: number): PixelBudget {
  const b = BUDGETS[kind][tier];
  const area = Math.max(1, cssW * cssH) / 1e6;
  const top = maxDpr(deviceDpr);
  const floor = Math.min(MIN_DPR[kind], top) ** 2 * area;
  const hardFloor = Math.min(floor, Math.min(LAST_DPR[kind], top) ** 2 * area);
  const ceiling = Math.max(floor, Math.min(b.ceiling, top * top * area));
  return { floor, hardFloor, start: Math.min(ceiling, Math.max(floor, b.start)), ceiling };
}

/**
 * The pixel ratio that spends `megapixels` on a canvas of `cssW` x `cssH`:
 * never past the screen's own density (or 2), never under `minDpr`, and in
 * steps of 0.05 so a small budget move does not reallocate every buffer for
 * an invisible change.
 */
export function dprForBudget(megapixels: number, cssW: number, cssH: number, deviceDpr: number, minDpr = 0.5): number {
  const area = Math.max(1, cssW * cssH);
  const ideal = Math.sqrt((megapixels * 1e6) / area);
  const max = maxDpr(deviceDpr);
  return Math.round(Math.min(max, Math.max(Math.min(minDpr, max), ideal)) * 20) / 20;
}
