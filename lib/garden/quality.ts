// The garden's render budget at run time: which stage of opening it is in,
// how many pixels it may draw, and the calm governor that moves that number
// to hold the frame rate.
//
// Two levers, of very different weight. The pixel budget (and so the canvas's
// pixel ratio) is light: a change reallocates the post-processing buffers and
// the picture gets a touch softer or crisper, so the governor moves it freely,
// in steps of ten to thirty per cent, never more than once a second, but
// never below the device's pixel-ratio floor (lib/garden/device): there a
// lighter tier drawn crisp beats a richer one drawn soft. The quality tier is
// heavy: it rebuilds the garden's geometry and recompiles its shaders. Under
// the opening veil the governor steps it as soon as the floor is proven too
// slow, so the right tier is found before anyone sees the garden. Once the
// garden is showing it changes only on a sustained drop (under 45 fps for
// eight seconds, after the cheaper shadow rung) while nobody is touching the
// screen, and then behind a held copy of the last frame that dissolves into
// the new tier, never the veil.
//
// Measurement: where the browser offers a GPU timer (Chromium on desktop) the
// governor reads how long the GPU spent on each frame, which says how much
// headroom there is even on a 60 Hz screen where every frame takes 16.7 ms.
// The timer only wraps the post chain's draw, though, and misses compositing
// and the final upscale, so the frame clock has the last word: slow frames
// under a quiet timer are an unproven guess, tested by a small budget step.
// Elsewhere (Safari, Firefox) the governor reads the frame interval and
// probes upward now and then, stepping back and waiting longer each time a
// probe fails.
//
// Opening sequence (`phase`): boot (page and chunk loading) -> compiling
// (shaders compiling in parallel, then a few small pre-draws, nothing on
// screen) -> warming (the first frame drawn) -> calibrating (a second or so of
// frames to settle the budget) -> revealing (the veil, or a held frame, fades)
// -> live. The first opening runs under the loading veil (`veiled`); a tier
// change once the garden is live runs the same sequence behind a held frame.
import { useSyncExternalStore } from "react";
import { budgetFor, dprForBudget, LAST_DPR, TIERS, type Device, type PixelBudget, type QualityPlan } from "@/lib/garden/device";
import type { Quality } from "@/lib/garden/store";

export type Phase = "boot" | "compiling" | "warming" | "calibrating" | "revealing" | "live";

export interface QualityState {
  phase: Phase;
  /** The opening is running under the loading veil (true until the garden is first live). */
  veiled: boolean;
  device: Device | null;
  plan: QualityPlan | null;
  /** The tier the budget's range was built for. */
  tier: Quality;
  /** Megapixels the canvas may draw. */
  budget: number;
  range: PixelBudget;
  /** The pixel ratio that spends the budget on the canvas's current size. */
  dpr: number;
  /** The canvas in CSS pixels. */
  css: readonly [number, number];
  /** The tier was chosen by hand (development panel or ?quality=): the governor leaves it alone. */
  pinned: boolean;
  /** ?governor=off freezes the budget, for screenshots and comparisons. */
  auto: boolean;
  /** Shadow map refresh: every frame (1) or every other (2), a cheap rung before a tier change. */
  shadowEvery: 1 | 2;
  tierChanges: number;
  stats: { fps: number; frameMs: number; gpuMs: number; timer: boolean };
}

const FALLBACK_RANGE: PixelBudget = { floor: 0.7, hardFloor: 0.5, start: 1, ceiling: 2 };

let state: QualityState = {
  phase: "boot",
  veiled: true,
  device: null,
  plan: null,
  tier: "balanced",
  budget: FALLBACK_RANGE.start,
  range: FALLBACK_RANGE,
  dpr: 1,
  css: [1280, 800],
  pinned: false,
  auto: true,
  shadowEvery: 1,
  tierChanges: 0,
  stats: { fps: 0, frameMs: 0, gpuMs: 0, timer: false },
};
const serverState = state;
const listeners = new Set<() => void>();

function recomputeDpr(s: QualityState): number {
  const kind = s.device?.kind ?? "laptop";
  return dprForBudget(s.budget, s.css[0], s.css[1], s.device?.dpr ?? 1, LAST_DPR[kind]);
}

function rangeFor(s: QualityState, tier: Quality): PixelBudget {
  if (!s.device) return FALLBACK_RANGE;
  return budgetFor(s.device.kind, tier, s.css[0], s.css[1], s.device.dpr);
}

const clampTo = (r: PixelBudget, b: number, low = r.floor) => Math.min(r.ceiling, Math.max(low, b));

export const quality = {
  get: () => state,
  set(patch: Partial<QualityState>) {
    const next = { ...state, ...patch };
    if (patch.budget !== undefined || patch.css !== undefined || patch.device !== undefined) next.dpr = recomputeDpr(next);
    state = next;
    listeners.forEach((l) => l());
  },
  subscribe(l: () => void) {
    listeners.add(l);
    return () => {
      listeners.delete(l);
    };
  },
  /** Called once with the device's plan, before the canvas mounts. */
  init(device: Device, plan: QualityPlan, opts: { pinned: boolean; auto: boolean }) {
    const css: readonly [number, number] = [window.innerWidth || 1280, window.innerHeight || 800];
    const range = budgetFor(device.kind, plan.tier, css[0], css[1], device.dpr);
    quality.set({ device, plan, tier: plan.tier, css, range, budget: range.start, pinned: opts.pinned, auto: opts.auto });
  },
  /**
   * The canvas's CSS size changed; only a real change re-renders the canvas.
   * The floor and ceiling follow the new size, and the budget keeps its pixel
   * ratio as far as the new range allows.
   */
  setCss(w: number, h: number) {
    const [ow, oh] = state.css;
    if (w === ow && h === oh) return;
    const css: readonly [number, number] = [w, h];
    const range = rangeFor({ ...state, css }, state.tier);
    const scaled = state.budget * ((w * h) / Math.max(1, ow * oh));
    quality.set({ css, range, budget: clampTo(range, scaled, Math.min(range.floor, state.budget)) });
  },
  /** A new tier is live: the budget restarts from that tier's range, carrying over what was learnt where it can. */
  adoptTier(tier: Quality) {
    const range = rangeFor(state, tier);
    quality.set({ tier, range, budget: clampTo(range, Math.min(state.budget * 1.25, range.start)) });
  },
};

export function useQuality<T>(selector: (s: QualityState) => T): T {
  return useSyncExternalStore(
    quality.subscribe,
    () => selector(state),
    () => selector(serverState),
  );
}

// ---------------------------------------------------------------------------
// The governor

export type Decision =
  | { kind: "none" }
  | { kind: "budget"; budget: number }
  | { kind: "shadows"; every: 1 | 2 }
  | { kind: "tier"; dir: -1 | 1 };

const NONE: Decision = { kind: "none" };

/** GPU milliseconds per frame the governor aims for: room for the CPU's share inside a 60 Hz frame. */
export const TARGET_GPU_MS = 12.5;
const GPU_HIGH = 14.5;
const GPU_LOW = 8.5;
/** Far under target at the ceiling: the next tier up would fit. */
const GPU_TIER_UP = 5.2;
/**
 * Frame intervals: slower than about 51 fps is slow, faster than about 56 fps
 * is comfortable. On a 120 or 144 Hz panel a frame that just misses a vsync
 * waits for the next one, so a GPU time under target can still land at 48 fps;
 * slow frames with a busy GPU count as GPU-bound for that reason.
 */
const SLOW_MS = 19.5;
const OK_MS = 17.9;
/** Frames longer than this are hitches (a tab switch, a buffer reallocation, a garbage collection), not load. */
const HITCH_MS = 120;
/** Once the garden is showing, a tier changes only after this long under 45 fps (P1: no visible restarts). */
export const SUSTAINED_SLOW_MS = 1000 / 45;
export const SUSTAINED_FOR_MS = 8000;
/** A guess at a CPU limit tests itself with a budget step this size, and is given this many windows to pay off. */
const UNPROVEN_STEP = 0.85;
const UNPROVEN_WINDOWS = 2;
/** How long a proven CPU limit stops the governor from cutting pixels that will not help. */
const CPU_BOUND_HOLD_MS = 20000;

interface Window {
  start: number;
  frames: number[];
  gpu: number[];
}

const median = (a: number[]) => {
  if (a.length === 0) return NaN;
  const s = [...a].sort((x, y) => x - y);
  return s[Math.floor(s.length / 2)];
};
const mean = (a: number[]) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : NaN);

/**
 * A driver keeps working for a few seconds after the first frame (ANGLE on
 * Direct3D builds each program's draw variants on first use, uploads settle),
 * so the first windows run slow and fall away, in steps. Three windows in a
 * row within this share of each other count as settled.
 */
const STABLE_SPREAD = 1.15;
const STABLE_WINDOWS = 3;
/** Windows (of a quarter second while calibrating) before the floor rule may step a tier under the veil. */
const FLOOR_RULE_AFTER = 3;

export interface SampleContext {
  /** Under the veil or a held frame: short windows, bold steps, and a tier step as soon as the floor is too slow. */
  calibrating: boolean;
  /** No tier to step down to (lite, a pinned tier, or the session's tier changes spent): spend pixels below the floor instead. */
  lowest: boolean;
}

/**
 * Pure decision logic, fed one frame at a time; the canvas component applies
 * what it decides. Calibrating, it waits for the frame times to settle before
 * moving the budget, so a start-up spike is not mistaken for the device's
 * speed, except that a budget already at its floor and plainly too slow for
 * two windows running (and not getting better) asks for a lighter tier at
 * once. Live, the light rungs (budget, then the shadow cadence after a grace
 * period) come first, and a tier only on a sustained, interval-measured drop.
 */
export class Governor {
  budget: number;
  private range: PixelBudget;
  private win: Window = { start: -1, frames: [], gpu: [] };
  private windows = 0;
  private settle = 1;
  private slowRun = 0;
  private fastRun = 0;
  private veryFastRun = 0;
  private shadowEvery: 1 | 2 = 1;
  /** Calibrating at the floor: slow windows in a row, and the last one's interval. */
  private floorSlow = 0;
  private floorPrev = Infinity;
  /** Live: when the frame rate last fell under 45 fps and stayed there, or null. */
  private slowSince: number | null = null;
  /** A budget step testing whether slow frames under a quiet GPU timer are really a CPU limit. */
  private unproven: { from: number; interval: number; windows: number } | null = null;
  private cpuBoundUntil = -Infinity;
  /** A budget where frames were proven slow despite a quiet timer: raises stop short of it for a while. */
  private cap = { budget: Infinity, until: -Infinity };
  /** Interval-only probing: the budget before the probe, and how long to wait before the next one. */
  private probeFrom: number | null = null;
  private probeWindows = 0;
  private probeWait = 10;
  private tierUpWait = 14;
  private recent: number[] = [];
  private lastNow = 0;
  private graceUntil = -Infinity;
  /** The last three windows agreed (see STABLE_SPREAD). */
  stable = false;
  last = { frameMs: 0, gpuMs: NaN, fps: 0 };

  constructor(range: PixelBudget, budget = range.start) {
    this.range = range;
    this.budget = budget;
  }

  /** A new range (a tier change) or an outside budget change; restarts the counters. */
  reset(range: PixelBudget, budget: number) {
    this.range = range;
    this.budget = budget;
    this.settle = 1;
    this.windows = 0;
    this.slowRun = this.fastRun = this.veryFastRun = this.floorSlow = 0;
    this.floorPrev = Infinity;
    this.shadowEvery = 1;
    this.slowSince = null;
    this.unproven = null;
    this.probeFrom = null;
    this.recent = [];
    this.stable = false;
    this.win = { start: -1, frames: [], gpu: [] };
  }

  /** The canvas changed size: a new floor and ceiling, the counters carry on. */
  setRange(range: PixelBudget, budget: number) {
    this.range = range;
    this.budget = budget;
  }

  /** Frozen (?governor=off): the budget stays where the page put it, whatever was decided. */
  hold(budget: number) {
    this.budget = budget;
  }

  /** No shadow-cadence or tier decisions until `ms` from `now`. */
  beginGrace(now: number, ms: number) {
    this.graceUntil = now + ms;
  }

  /** After a tier step down, a step back up needs a long, convincing stretch. */
  slowTierUp() {
    this.tierUpWait = 40;
  }

  /** Calibrating at the floor and slow: worth waiting a little longer under the veil for the tier step. */
  get wantsTier(): boolean {
    return this.floorSlow > 0;
  }

  sample(frameMs: number, gpuMs: number | null, now: number, ctx: SampleContext = { calibrating: false, lowest: false }): Decision {
    if (frameMs > HITCH_MS || frameMs <= 0) return NONE;
    const { calibrating, lowest } = ctx;
    this.lastNow = now;
    const w = this.win;
    if (w.start < 0) w.start = now;
    w.frames.push(frameMs);
    if (gpuMs !== null && Number.isFinite(gpuMs)) w.gpu.push(gpuMs);
    const span = calibrating ? 250 : 750;
    if (now - w.start < span || w.frames.length < (calibrating ? 6 : 20)) return NONE;

    const interval = mean(w.frames);
    const gpu = w.gpu.length >= w.frames.length / 3 ? median(w.gpu) : NaN;
    const start = w.start;
    this.win = { start: now, frames: [], gpu: [] };
    this.windows++;
    this.last = { frameMs: interval, gpuMs: gpu, fps: 1000 / interval };
    this.recent.push(Number.isFinite(gpu) ? gpu : interval);
    if (this.recent.length > STABLE_WINDOWS) this.recent.shift();
    this.stable =
      this.recent.length === STABLE_WINDOWS && Math.max(...this.recent) <= STABLE_SPREAD * Math.min(...this.recent);
    // The sustained-drop clock runs through budget moves and their settling windows.
    if (calibrating) this.slowSince = null;
    else if (interval > SUSTAINED_SLOW_MS) this.slowSince ??= start;
    else if (interval < SUSTAINED_SLOW_MS * 0.94) this.slowSince = null;
    if (this.settle > 0) {
      this.settle--;
      return NONE;
    }
    return calibrating ? this.calibrate(interval, gpu, lowest, now) : this.live(interval, gpu, lowest, now);
  }

  private atFloor() {
    return this.budget <= this.range.floor * 1.01;
  }

  private atCeiling() {
    return this.budget >= this.range.ceiling * 0.99;
  }

  /** `belowFloor` lets the lightest tier sink toward the last-resort floor; otherwise the floor holds (or wherever the budget already is under it). */
  private setBudget(b: number, belowFloor = false): Decision {
    const low = belowFloor ? this.range.hardFloor : Math.min(this.range.floor, this.budget);
    if (b > this.budget && this.lastNow < this.cap.until) b = Math.max(this.budget, Math.min(b, this.cap.budget));
    const next = Math.min(this.range.ceiling, Math.max(low, b));
    if (next === this.budget) return NONE;
    // A small step is not worth a reallocation, unless it is the last one to a bound.
    const atBound = next === this.range.ceiling || next === this.range.floor || next === this.range.hardFloor;
    if (!atBound && Math.abs(next - this.budget) / this.budget < 0.04) return NONE;
    this.budget = next;
    this.settle = 1;
    return { kind: "budget", budget: next };
  }

  /**
   * At the floor and still too slow: a lighter tier, or with none left, fewer
   * pixels than the floor. When the GPU timer reads quiet, fewer pixels may
   * buy nothing (a CPU limit), so that step is tested like any other guess.
   */
  private belowFloor(lowest: boolean, quietGpu: boolean, interval: number, now: number): Decision {
    this.slowRun = 0;
    if (!lowest) {
      this.settle = 2;
      return { kind: "tier", dir: -1 };
    }
    if (quietGpu) return this.testCpuGuess(interval, now, true) ?? NONE;
    return this.setBudget(this.budget * UNPROVEN_STEP, true);
  }

  /**
   * Slow frames while the GPU timer reads quiet. The timer misses compositing
   * and the upscale, so a CPU limit is only a guess until fewer pixels have
   * failed to help: step the budget down and watch the frame interval.
   * Returns null when the guess is not worth testing.
   */
  private testCpuGuess(interval: number, now: number, lowest: boolean): Decision | null {
    if (now < this.cpuBoundUntil) return null;
    const from = this.budget;
    const d = this.setBudget(this.budget * UNPROVEN_STEP, lowest);
    if (d.kind !== "budget") return null;
    this.unproven = { from, interval, windows: 0 };
    return d;
  }

  /** Follows an unproven step: kept if the frames got quicker, undone if they did not. */
  private followCpuGuess(interval: number, now: number): Decision | null {
    const u = this.unproven;
    if (!u) return null;
    u.windows++;
    if (interval < u.interval * 0.92) {
      // Fewer pixels did help, so the timer under-reads this device: no climbing back to where it was slow.
      this.unproven = null;
      this.cap = { budget: u.from * 0.95, until: now + CPU_BOUND_HOLD_MS * 3 };
      return null;
    }
    if (u.windows < UNPROVEN_WINDOWS) return NONE;
    // Fewer pixels bought nothing: it is the CPU. Put the pixels back.
    this.unproven = null;
    this.cpuBoundUntil = now + CPU_BOUND_HOLD_MS;
    return this.setBudget(Math.min(u.from, this.range.ceiling), true);
  }

  private calibrate(interval: number, gpu: number, lowest: boolean, now: number): Decision {
    const timer = Number.isFinite(gpu);
    const gpuSlow = timer && gpu > GPU_HIGH;
    const frameSlow = interval > SLOW_MS;
    const cpuBound = now < this.cpuBoundUntil;
    // P1: at the floor (or proven CPU-bound) and plainly too slow, a lighter
    // tier now, under the veil, rather than a visible change ten seconds after
    // it lifts. A falling start-up spike is not a plateau, so the count
    // restarts while it improves. With no lighter tier, fewer pixels, unless
    // the limit is the CPU and pixels would not help; and then without the
    // hurry, only once the frames have settled, since start-up work alone
    // must not push the lightest tier below its floor.
    const stuck = this.atFloor() || (cpuBound && !lowest);
    const ready = lowest ? this.stable : this.windows >= FLOOR_RULE_AFTER;
    if (stuck && (gpuSlow || frameSlow) && ready && !(lowest && cpuBound)) {
      const improving = this.floorSlow > 0 && interval < this.floorPrev * 0.9;
      this.floorSlow = improving ? 1 : this.floorSlow + 1;
      this.floorPrev = interval;
      if (this.floorSlow >= 2) {
        this.floorSlow = 0;
        this.floorPrev = Infinity;
        return this.belowFloor(lowest, timer && !gpuSlow, interval, now);
      }
      return NONE;
    }
    this.floorSlow = 0;
    this.floorPrev = Infinity;
    const pending = this.followCpuGuess(interval, now);
    if (pending) return pending;
    if (!this.stable) return NONE;
    if (gpuSlow || (frameSlow && timer && gpu >= TARGET_GPU_MS * 0.8)) {
      // Pixels scale the GPU time roughly linearly; aim a little under the target.
      const k = Math.min(0.92, Math.max(0.45, (TARGET_GPU_MS / gpu) * 0.9));
      return this.setBudget(this.budget * k);
    }
    if (frameSlow) {
      if (timer) return this.testCpuGuess(interval, now, lowest) ?? NONE;
      return this.setBudget(this.budget * 0.7);
    }
    // P4: a raise needs a comfortable frame clock as well as a quiet GPU timer.
    if (timer && gpu < GPU_LOW && interval < OK_MS && !this.atCeiling()) {
      const k = Math.min(1.6, Math.max(1.06, (TARGET_GPU_MS / gpu) * 0.85));
      return this.setBudget(this.budget * k);
    }
    return NONE;
  }

  private live(interval: number, gpu: number, lowest: boolean, now: number): Decision {
    const timer = Number.isFinite(gpu);
    const frameSlow = interval > SLOW_MS;
    const gpuSlow = timer && (gpu > GPU_HIGH || (frameSlow && gpu >= TARGET_GPU_MS * 0.8));
    const pending = this.followCpuGuess(interval, now);
    if (pending) return pending;
    if (this.probeFrom !== null) {
      this.probeWindows++;
      if (interval > SLOW_MS - 0.5) {
        // The probe cost frames: back to where it was, and wait twice as long next time.
        const from = this.probeFrom;
        this.probeFrom = null;
        this.probeWait = Math.min(160, this.probeWait * 2);
        this.fastRun = 0;
        return this.setBudget(from);
      }
      if (this.probeWindows >= 3) this.probeFrom = null;
    }

    if (gpuSlow || frameSlow) {
      this.fastRun = this.veryFastRun = 0;
      if (!this.atFloor()) {
        if (gpuSlow) {
          this.slowRun = 0;
          const k = Math.min(0.9, Math.max(0.68, (TARGET_GPU_MS / gpu) * 0.9));
          return this.setBudget(this.budget * k);
        }
        if (!timer) {
          if (++this.slowRun < 2) return NONE;
          this.slowRun = 0;
          return this.setBudget(this.budget * 0.8);
        }
        // Slow frames, quiet timer: test the guess before believing it. A
        // proven CPU limit falls through to the rungs that lighten the CPU's load.
        const d = this.testCpuGuess(interval, now, lowest);
        if (d) return d;
      }
      // At the floor (or proven CPU-bound): the cheap rung, then a tier only on a sustained drop.
      if (now < this.graceUntil) return NONE;
      if (this.shadowEvery === 1) {
        if (++this.slowRun >= 3) {
          this.slowRun = 0;
          this.shadowEvery = 2;
          this.settle = 2;
          return { kind: "shadows", every: 2 };
        }
        return NONE;
      }
      if (lowest && frameSlow && now >= this.cpuBoundUntil) {
        if (++this.slowRun >= 2) return this.belowFloor(true, timer && !gpuSlow, interval, now);
        return NONE;
      }
      if (this.slowSince !== null && now - this.slowSince >= SUSTAINED_FOR_MS) return this.belowFloor(lowest, timer && !gpuSlow, interval, now);
      return NONE;
    }
    this.slowRun = 0;

    if (timer) {
      if (gpu < GPU_LOW && interval < OK_MS + 1) {
        if (this.atCeiling()) {
          this.fastRun = 0;
          if (gpu < GPU_TIER_UP && ++this.veryFastRun >= this.tierUpWait) {
            this.veryFastRun = 0;
            this.settle = 2;
            return { kind: "tier", dir: 1 };
          }
          return NONE;
        }
        this.veryFastRun = 0;
        if (++this.fastRun >= 3) {
          this.fastRun = 0;
          const k = Math.min(1.25, Math.max(1.06, (TARGET_GPU_MS / gpu) * 0.85));
          return this.setBudget(this.budget * k);
        }
        return NONE;
      }
      this.fastRun = this.veryFastRun = 0;
      return NONE;
    }

    // No timer: an occasional probe upward from a comfortable stretch.
    if (interval < OK_MS && !this.atCeiling()) {
      if (++this.fastRun >= this.probeWait) {
        this.fastRun = 0;
        const from = this.budget;
        const d = this.setBudget(this.budget * 1.12);
        if (d.kind === "budget") {
          this.probeFrom = from;
          this.probeWindows = 0;
        }
        return d;
      }
    } else this.fastRun = 0;
    return NONE;
  }
}

/** The tier one step from `q`, within [lite, max]. */
export function stepTier(q: Quality, dir: -1 | 1, max: Quality): Quality | null {
  const i = TIERS.indexOf(q) + dir;
  if (i < 0 || i > TIERS.indexOf(max)) return null;
  return TIERS[i];
}
