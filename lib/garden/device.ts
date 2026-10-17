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
// iPad is a "Mac" with touch points. The panel's refresh rate is measured
// from the page's first animation frames (measureRefresh).
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

interface RememberedTier {
  tier: Quality;
  kind: DeviceKind;
  gpu: string;
  at: number;
  /** When a visit last found room for the tier above and asked the next visit to open on it. */
  climbedAt?: number;
}

/** What this device remembered, if it is the same kind of device with the same GPU and the memory is recent. */
function readTier(d: Device): RememberedTier | null {
  try {
    const raw = window.localStorage.getItem(TIER_KEY);
    if (!raw) return null;
    const s = JSON.parse(raw) as RememberedTier;
    if (s.kind !== d.kind || s.gpu !== d.gpu || !(Date.now() - s.at < TIER_MAX_AGE_MS)) return null;
    return TIERS.includes(s.tier) ? s : null;
  } catch {
    return null;
  }
}

/**
 * The tier this device settled on last time, if it is the same kind of
 * device with the same GPU and the memory is recent. A colleague visits every
 * day: opening straight on the tier that fits saves trying a richer one under
 * the veil first (three or four seconds on an office laptop). The governor
 * never climbs a tier on a showing garden; where it found room for one, this
 * is the tier above, so the climb happens here, under the veil, where the
 * floor rule can still step back. Browser storage is a convenience only;
 * without it the plan's own tier is used.
 */
export function recallTier(d: Device, maxTier: Quality): Quality | null {
  const s = readTier(d);
  if (!s || TIERS.indexOf(s.tier) > TIERS.indexOf(maxTier)) return null;
  return s.tier;
}

/** This page has asked the next visit to climb, so its later reminders keep asking. */
let climbing = false;

/**
 * Remembers the tier a visit settled on (see recallTier), or `climbTo`, the
 * tier above it that the governor found room for. A climb is tried at most
 * once a week: if another visit asked for one in the last week (and then
 * stepped back down under the veil, or this one would not be asking again),
 * this visit's own tier is kept, so a device that is only slow at its
 * opening does not trade tiers at every visit.
 */
export function rememberTier(d: Device, tier: Quality, climbTo?: Quality) {
  try {
    let climbedAt = readTier(d)?.climbedAt;
    let next = tier;
    if (climbTo) {
      const recent = climbedAt !== undefined && Date.now() - climbedAt < TIER_MAX_AGE_MS;
      if (climbing || !recent) {
        next = climbTo;
        if (!climbing) climbedAt = Date.now();
        climbing = true;
      }
    }
    const s: RememberedTier = { tier: next, kind: d.kind, gpu: d.gpu, at: Date.now(), climbedAt };
    window.localStorage.setItem(TIER_KEY, JSON.stringify(s));
  } catch {
    // storage full or blocked: the next visit starts from the plan
  }
}

/**
 * The refresh rates a panel is taken to run at: most phones and laptops 60,
 * ProMotion iPhones and iPads 120 (though Safari often still paces pages at
 * 60), gaming laptops 144, and 30 for an iPhone in Low Power Mode, which
 * paces pages at half rate. Nothing between 30 and 60: a 50 Hz television
 * is judged as a 60 Hz panel, which asks no more of it (the comfortable line
 * is 50 fps either way), while a loaded page's steady 48 fps cadence on a
 * 144 Hz laptop must never pass for a slow panel.
 */
export const REFRESH_RATES: readonly number[] = [30, 60, 72, 75, 90, 100, 120, 144, 165, 240];

/** The refresh rate (Hz) a frame interval of `ms` is nearest, by ratio. */
export function snapRefresh(ms: number): number {
  const hz = 1000 / Math.max(1, ms);
  let best = 60;
  let gap = Infinity;
  for (const r of REFRESH_RATES) {
    const g = Math.abs(Math.log(r / hz));
    if (g < gap) {
      gap = g;
      best = r;
    }
  }
  return best;
}

/**
 * The panel's refresh rate, read from a second or so of animation frames at
 * startup, before the canvas draws anything (lib/garden/quality judges
 * smoothness against it), and once more when a startup reading needs a
 * second (settleRefresh). A busy page only ever lengthens the intervals, so
 * the fastest quarter of them is the panel; a reading under 55 Hz counts only
 * when the frames are as regular as Low Power Mode's half rate, since a
 * loading page's jank is not. Calls back once, or not at all where frames do
 * not come (a hidden tab: the governor corrects the default from its own
 * frames).
 */
export function measureRefresh(done: (hz: number) => void): void {
  if (typeof requestAnimationFrame !== "function") return;
  const gaps: number[] = [];
  const t0 = performance.now();
  let last = -1;
  const tick = (ts: number) => {
    const gap = ts - last;
    if (last >= 0 && gap > 2 && gap < 100) gaps.push(gap);
    last = ts;
    if (gaps.length < 48 && performance.now() - t0 < 1500) {
      requestAnimationFrame(tick);
      return;
    }
    if (gaps.length < 8) return;
    gaps.sort((a, b) => a - b);
    const quick = gaps[Math.floor(gaps.length / 4)];
    if (1000 / quick < 55 && gaps[Math.floor(gaps.length / 2)] > quick * 1.1) return;
    done(snapRefresh(quick));
  };
  requestAnimationFrame(tick);
}

/**
 * The panel's rate from a startup reading under 55 Hz and a second one taken
 * once the garden is live (both from measureRefresh, so standard rates).
 * Low Power Mode's 30 Hz and a 60 Hz page pacing itself at half rate under a
 * busy GPU look alike at startup, and judging a 60 Hz panel as a 30 Hz one
 * would leave a struggling garden at 30 fps for the whole visit, so 30 counts
 * only when both readings say so; otherwise the second reading, never under 60.
 */
export function settleRefresh(boot: number, second: number): number {
  return boot < 55 && second < 55 ? second : Math.max(60, second);
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
