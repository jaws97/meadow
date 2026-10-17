// The garden's render budget at run time: which stage of opening it is in,
// how many pixels it may draw, and the calm governor that moves that number
// to hold the frame rate.
//
// Two levers, of very different weight. The pixel budget (and so the canvas's
// pixel ratio) is the lighter, and it only ever sits on a few fixed levels,
// about fourteen per cent of pixel ratio apart (budgetLevels), never below the
// device's pixel-ratio floor (lib/garden/device) while a lighter tier is left:
// there a lighter tier drawn crisp beats a richer one drawn soft. A change
// still resizes the drawing buffer, which clears the canvas and reallocates
// the post-processing buffers, so it is free only where nobody can see it.
// Under the opening veil the governor moves it as it likes. Once the garden is
// showing, every change is drawn behind a held copy of the last frame
// (RenderBudget, frameHold.ts), and changes are rare: a step down only after
// seven seconds of slow frames, never two changes within thirty seconds, never
// while someone is touching the screen, and a step up only one level at a
// time, after a long comfortable stretch and a cooldown, longer after a step
// down, so the budget cannot see-saw. A step up that turns the frames slow
// goes back once the thirty seconds are up (and only if they are still slow
// then); the one exception is a step up that drops them under 45 fps (with
// the GPU timer, where there is one, reading busy), which goes straight
// back. The quality tier is heavy: it rebuilds the garden's geometry
// and recompiles its shaders. Under the opening veil the governor steps it as
// soon as the floor is proven too slow, so the right tier is found before
// anyone sees the garden. Once the garden is showing it changes only on a
// sustained drop (under 45 fps for eight seconds, with the budget already at
// its floor) while nobody is touching the screen, and then behind the held
// frame too, never the veil.
//
// Measurement: where the browser offers a GPU timer (Chromium on desktop) the
// governor reads how long the GPU spent on each frame, which says how much
// headroom there is even on a 60 Hz screen where every frame takes 16.7 ms.
// The timer only wraps the post chain's draw, though, and misses compositing,
// the final upscale and other pages sharing the GPU, so the frame clock has
// the last word: slow frames under a quiet timer are an unproven guess, tested
// by a budget step and undone if fewer pixels bought nothing (at once under
// the veil, at the next calm moment once the garden is showing). Elsewhere
// (Safari, Firefox) the governor reads the frame interval and probes upward
// now and then, stepping back and waiting longer each time a probe fails.
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
  /** Megapixels the canvas may draw: always one of budgetLevels(range). */
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
  tierChanges: number;
  stats: { fps: number; frameMs: number; gpuMs: number; timer: boolean };
}

const FALLBACK_RANGE: PixelBudget = { floor: 0.7, hardFloor: 0.5, start: 1, ceiling: 2 };

/**
 * Neighbouring budgets are this far apart (about fourteen per cent of pixel
 * ratio): every step is a real change of cost, worth a reallocation, and the
 * canvas only ever has a handful of sizes.
 */
const LEVEL_STEP = 1.3;
/** A step that would land closer than this to the floor, the ceiling or the last resort is left out. */
const LEVEL_MERGE = 1.12;

/**
 * The budgets the canvas is ever drawn at on `r`, lowest first: the floor,
 * steps of LEVEL_STEP up to the ceiling and down to the last-resort floor
 * (where only the lightest tier goes), and both bounds.
 */
export function budgetLevels(r: PixelBudget): number[] {
  const out = new Set<number>([r.hardFloor, r.floor, r.ceiling]);
  for (let b = r.floor / LEVEL_STEP; b > r.hardFloor * LEVEL_MERGE; b /= LEVEL_STEP) out.add(b);
  for (let b = r.floor * LEVEL_STEP; b < r.ceiling / LEVEL_MERGE; b *= LEVEL_STEP) out.add(b);
  return [...out].sort((a, b) => a - b);
}

/** The level of `r` nearest `b`, by ratio. */
export function nearestLevel(r: PixelBudget, b: number): number {
  let best = r.floor;
  let gap = Infinity;
  for (const l of budgetLevels(r)) {
    const g = Math.abs(Math.log(l / b));
    if (g < gap) {
      gap = g;
      best = l;
    }
  }
  return best;
}

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
    quality.set({ device, plan, tier: plan.tier, css, range, budget: nearestLevel(range, range.start), pinned: opts.pinned, auto: opts.auto });
  },
  /**
   * The canvas's CSS size changed; only a real change re-renders the canvas.
   * The floor and ceiling follow the new size, and the budget keeps its pixel
   * ratio as far as the new range (and its levels) allow; the canvas resizes
   * anyway, so the level moves with it.
   */
  setCss(w: number, h: number) {
    const [ow, oh] = state.css;
    if (w === ow && h === oh) return;
    const css: readonly [number, number] = [w, h];
    const range = rangeFor({ ...state, css }, state.tier);
    const scaled = state.budget * ((w * h) / Math.max(1, ow * oh));
    quality.set({ css, range, budget: nearestLevel(range, clampTo(range, scaled, Math.min(range.floor, state.budget))) });
  },
  /** A new tier is live: the budget restarts from that tier's range, carrying over what was learnt where it can. */
  adoptTier(tier: Quality) {
    const range = rangeFor(state, tier);
    quality.set({ tier, range, budget: nearestLevel(range, clampTo(range, Math.min(state.budget * 1.25, range.start))) });
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

export type Decision = { kind: "none" } | { kind: "budget"; budget: number } | { kind: "tier"; dir: -1 | 1 };

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
/** Without a GPU timer to size the step, frames slower than this (about 34 fps) step down two levels at once. */
const VERY_SLOW_MS = 29;
/**
 * Frames longer than this are hitches (a buffer reallocation, a garbage
 * collection), not load; but once the garden is showing, this many in a row
 * are the device (or a GPU it shares) at a crawl, and count. Longer than the
 * pause is a hidden tab, never a frame.
 */
const HITCH_MS = 120;
const CRAWL_RUN = 4;
const PAUSE_MS = 1000;
/** Once the garden is showing, a tier changes only after this long under 45 fps (P1: no visible restarts). */
export const SUSTAINED_SLOW_MS = 1000 / 45;
export const SUSTAINED_FOR_MS = 8000;
/**
 * Once the garden is showing (P1: nothing blinks): slow frames for this long
 * before the budget steps down, never two changes closer together than the
 * gap (except that a step up dropping the frames under 45 fps goes straight
 * back), and no step up for the cooldown after any change, longer after a
 * step down, so the budget cannot see-saw.
 */
export const LIVE_DOWN_AFTER_MS = 7000;
export const LIVE_CHANGE_GAP_MS = 30000;
export const UP_COOLDOWN_MS = 45000;
export const UP_AFTER_DOWN_MS = 90000;
/** A step up also needs this long of comfortable frames, and a tier up this long with the GPU far under target. */
const UP_AFTER_MS = 10000;
const TIER_UP_AFTER_MS = 10000;
const TIER_UP_AFTER_DOWN_MS = 30000;
/**
 * A step up is on trial this long: slow frames for PROBE_FAIL_MS fail it (it
 * goes back after the gap, or at once under 45 fps), and the wait before the
 * next one doubles.
 */
const PROBE_TRIAL_MS = 6000;
const PROBE_FAIL_MS = 2000;
const PROBE_WAIT_MAX_MS = 600000;
/** A guess at a CPU limit tests itself with a budget step this size, and is given this many windows to pay off. */
const UNPROVEN_STEP = 0.85;
const UNPROVEN_WINDOWS = 2;
/** How long a proven CPU limit stops the governor from cutting pixels that will not help (live: from the restore, doubling each time). */
const CPU_BOUND_HOLD_MS = 20000;
const CPU_BOUND_LIVE_MS = 120000;

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
  /** No tier to step up to: the governor does not ask for one. */
  highest?: boolean;
  /** Someone touched the garden in the last few seconds: once it is showing, nothing changes until they stop. */
  interacting?: boolean;
}

/**
 * Pure decision logic, fed one frame at a time; the canvas component applies
 * what it decides. Calibrating, it waits for the frame times to settle before
 * moving the budget, so a start-up spike is not mistaken for the device's
 * speed, except that a budget already at its floor and plainly too slow for
 * two windows running (and not getting better) asks for a lighter tier at
 * once. Live, it changes rarely and only while nobody is touching the garden:
 * the budget down a level (or to the level the GPU timer says fits) after a
 * sustained slow stretch, a tier only on a sustained, interval-measured drop
 * with the budget at its floor, and the budget up a level only after a
 * comfortable stretch and a cooldown, on trial.
 */
export class Governor {
  budget: number;
  private range: PixelBudget;
  private levels: number[];
  private win: Window = { start: -1, frames: [], gpu: [] };
  private windows = 0;
  private settle = 1;
  /** Calibrating at the floor: slow windows in a row, and the last one's interval. */
  private floorSlow = 0;
  private floorPrev = Infinity;
  /** Live: when the frame rate last fell under 45 fps and stayed there, or null. */
  private slowSince: number | null = null;
  /** Live: since when the frames have been slow, comfortable, or comfortable with the GPU far under target (each restarts at a change). */
  private slowFrom: number | null = null;
  private easyFrom: number | null = null;
  private tierUpFrom: number | null = null;
  /** Live: the last budget or tier change, and the time before which nothing steps up. */
  private changedAt = -Infinity;
  private upAfter = -Infinity;
  /** A step up on trial (already failed, its undo waiting out the gap), and how long the wait after the next failed one is. */
  private probe: { from: number; at: number; failed: boolean } | null = null;
  private probeWait = UP_AFTER_DOWN_MS;
  /**
   * A budget to go back to once nobody is touching the garden (a failed
   * probe, or pixels cut for nothing); `ifSlow` drops it when the frames are
   * no longer slow by then.
   */
  private restore: { to: number; notBefore: number; ifSlow: boolean } | null = null;
  /** A budget step testing whether slow frames under a quiet GPU timer are really a CPU limit. */
  private unproven: { from: number; interval: number; windows: number } | null = null;
  private cpuBoundUntil = -Infinity;
  private cpuHold = CPU_BOUND_LIVE_MS;
  /** A budget where frames were proven slow despite a quiet timer: raises stop short of it for a while. */
  private cap = { budget: Infinity, until: -Infinity };
  private tierUpMs = TIER_UP_AFTER_MS;
  private recent: number[] = [];
  /** Hitches in a row (see CRAWL_RUN). */
  private hitches = 0;
  private lastNow = 0;
  private graceUntil = -Infinity;
  /** The last three windows agreed (see STABLE_SPREAD). */
  stable = false;
  last = { frameMs: 0, gpuMs: NaN, fps: 0 };

  constructor(range: PixelBudget, budget = range.start) {
    this.range = range;
    this.levels = budgetLevels(range);
    this.budget = budget;
  }

  /**
   * A new range (a tier change) or an outside budget change; restarts the
   * counters. `now` marks a change made in the open: nothing climbs back for
   * a long while after it.
   */
  reset(range: PixelBudget, budget: number, now?: number) {
    this.range = range;
    this.levels = budgetLevels(range);
    this.budget = budget;
    this.settle = 1;
    this.windows = 0;
    this.floorSlow = 0;
    this.floorPrev = Infinity;
    this.slowSince = this.slowFrom = this.easyFrom = this.tierUpFrom = null;
    this.unproven = null;
    this.probe = null;
    this.restore = null;
    this.recent = [];
    this.stable = false;
    this.win = { start: -1, frames: [], gpu: [] };
    if (now !== undefined) {
      this.changedAt = now;
      this.upAfter = Math.max(this.upAfter, now + UP_AFTER_DOWN_MS);
    }
  }

  /** The canvas changed size: a new floor, ceiling and set of levels, the counters carry on. */
  setRange(range: PixelBudget, budget: number) {
    this.range = range;
    this.levels = budgetLevels(range);
    this.budget = budget;
  }

  /** Frozen (?governor=off): the budget stays where the page put it, whatever was decided. */
  hold(budget: number) {
    this.budget = budget;
  }

  /** The garden is being revealed: no heavy decisions until `ms` from `now`, and no step up for the cooldown. */
  beginGrace(now: number, ms: number) {
    this.graceUntil = now + ms;
    this.upAfter = Math.max(this.upAfter, now + UP_COOLDOWN_MS);
  }

  /** After a tier step down, a step back up needs a long, convincing stretch. */
  slowTierUp() {
    this.tierUpMs = TIER_UP_AFTER_DOWN_MS;
  }

  /** Calibrating at the floor and slow: worth waiting a little longer under the veil for the tier step. */
  get wantsTier(): boolean {
    return this.floorSlow > 0;
  }

  sample(frameMs: number, gpuMs: number | null, now: number, ctx: SampleContext = { calibrating: false, lowest: false }): Decision {
    if (frameMs > PAUSE_MS || frameMs <= 0) return NONE;
    const { calibrating, lowest } = ctx;
    // Under the veil a run of long frames is start-up work; it never counts there.
    if (frameMs <= HITCH_MS) this.hitches = 0;
    else if (calibrating || ++this.hitches < CRAWL_RUN) return NONE;
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
    return calibrating ? this.calibrate(interval, gpu, lowest, now) : this.live(interval, gpu, start, now, ctx);
  }

  private atFloor() {
    return this.budget <= this.range.floor * 1.01;
  }

  private atCeiling() {
    return this.budget >= this.range.ceiling * 0.99;
  }

  /** The level `n` steps from the current budget (dir -1 below, 1 above), or the last one there is. */
  private levelFrom(dir: -1 | 1, n: number): number {
    const side = dir < 0 ? this.levels.filter((l) => l < this.budget * 0.98).reverse() : this.levels.filter((l) => l > this.budget * 1.02);
    return side.length ? side[Math.min(n, side.length) - 1] : this.budget;
  }

  /**
   * `b` on the level ladder, never below `low`: down to the level nearest it
   * (always at least one level down), up to the highest level it reaches (or
   * nowhere, when it does not reach the next one).
   */
  private quantize(b: number, low: number): number {
    const cur = this.budget;
    let best = cur;
    if (b < cur) {
      let gap = Infinity;
      for (const l of this.levels) {
        if (l >= cur * 0.98 || l < low * 0.999) continue;
        const g = Math.abs(Math.log(l / b));
        if (g < gap) {
          gap = g;
          best = l;
        }
      }
      return best;
    }
    for (const l of this.levels) if (l > cur * 1.02 && l <= b * 1.04) best = l;
    return best;
  }

  /**
   * `belowFloor` lets the lightest tier sink toward the last-resort floor;
   * otherwise the floor holds (or wherever the budget already is under it).
   * The result lands on a level, unless `exact` puts back a budget the
   * governor had before.
   */
  private setBudget(b: number, belowFloor = false, exact = false): Decision {
    const low = belowFloor ? this.range.hardFloor : Math.min(this.range.floor, this.budget);
    if (b > this.budget && this.lastNow < this.cap.until) b = Math.max(this.budget, Math.min(b, this.cap.budget));
    const clamped = Math.min(this.range.ceiling, Math.max(low, b));
    const next = exact ? clamped : this.quantize(clamped, low);
    if (next === this.budget) return NONE;
    this.budget = next;
    this.settle = 1;
    return { kind: "budget", budget: next };
  }

  /** A budget change in the open: it restarts the slow and comfortable clocks and holds off the next step up. */
  private change(b: number, now: number, belowFloor = false, exact = false): Decision {
    const from = this.budget;
    const d = this.setBudget(b, belowFloor, exact);
    if (d.kind !== "budget") return d;
    this.changedAt = now;
    this.slowFrom = this.easyFrom = this.tierUpFrom = null;
    this.upAfter = Math.max(this.upAfter, now + (d.budget < from ? UP_AFTER_DOWN_MS : UP_COOLDOWN_MS));
    return d;
  }

  /**
   * Calibrating at the floor and still too slow: a lighter tier, or with none
   * left, fewer pixels than the floor. When the GPU timer reads quiet, fewer
   * pixels may buy nothing (a CPU limit), so that step is tested like any
   * other guess.
   */
  private belowFloor(lowest: boolean, quietGpu: boolean, interval: number, now: number): Decision {
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

  /**
   * Follows an unproven step: kept if the frames got quicker. If they did not,
   * it is the CPU: under the veil the pixels go straight back; once the garden
   * is showing they go back at the next calm moment a change is allowed, and
   * the budget is left alone for a while (longer each time).
   */
  private followCpuGuess(interval: number, now: number, live: boolean): Decision | null {
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
    this.unproven = null;
    if (live) {
      const notBefore = this.changedAt + LIVE_CHANGE_GAP_MS;
      this.restore = { to: Math.min(u.from, this.range.ceiling), notBefore, ifSlow: false };
      this.cpuBoundUntil = Math.max(now, notBefore) + this.cpuHold;
      this.cpuHold = Math.min(PROBE_WAIT_MAX_MS, this.cpuHold * 2);
      return null;
    }
    this.cpuBoundUntil = now + CPU_BOUND_HOLD_MS;
    return this.setBudget(Math.min(u.from, this.range.ceiling), true, true);
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
    const pending = this.followCpuGuess(interval, now, false);
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

  private live(interval: number, gpu: number, start: number, now: number, ctx: SampleContext): Decision {
    const { lowest, highest = false, interacting = false } = ctx;
    const timer = Number.isFinite(gpu);
    const frameSlow = interval > SLOW_MS;
    const gpuSlow = timer && (gpu > GPU_HIGH || (frameSlow && gpu >= TARGET_GPU_MS * 0.8));
    const slow = frameSlow || gpuSlow;
    const easy = !slow && interval < OK_MS + 1 && (!timer || gpu < GPU_LOW);
    // A window between slow and comfortable neither starts nor ends a slow stretch.
    if (slow) this.slowFrom ??= start;
    else if (interval < OK_MS) this.slowFrom = null;
    if (easy) this.easyFrom ??= start;
    else this.easyFrom = null;
    if (easy && timer && gpu < GPU_TIER_UP) this.tierUpFrom ??= start;
    else this.tierUpFrom = null;

    // A step up on trial that costs frames goes back down: once the gap is up,
    // and then only if the frames are still slow (P1: one change per gap).
    // The one exception is a step up that drops them under 45 fps during its
    // trial, which plainly costs too much: that goes back as soon as nobody
    // is touching the garden, unless a GPU timer says the GPU is quiet (then
    // the extra pixels are not what costs the frames, by its account).
    const p = this.probe;
    if (p) {
      const plain = (!timer || gpuSlow) && this.slowSince !== null && now - this.slowSince >= PROBE_FAIL_MS;
      const failed = plain || (this.slowFrom !== null && now - this.slowFrom >= PROBE_FAIL_MS);
      if (failed && !p.failed) {
        p.failed = true;
        this.upAfter = Math.max(this.upAfter, now + this.probeWait);
        this.probeWait = Math.min(PROBE_WAIT_MAX_MS, this.probeWait * 2);
      }
      if (plain) {
        this.probe = null;
        this.restore = { to: p.from, notBefore: now, ifSlow: false };
      } else if (failed && !this.restore) {
        this.restore = { to: p.from, notBefore: p.at + LIVE_CHANGE_GAP_MS, ifSlow: true };
      }
      if (this.probe && now - p.at > PROBE_TRIAL_MS) this.probe = null;
    }
    const pending = this.followCpuGuess(interval, now, true);
    if (pending) return pending;
    if (interacting) return NONE;
    const r = this.restore;
    if (r && now >= r.notBefore) {
      this.restore = null;
      // A failed step up whose frames have recovered since keeps its level after all.
      if (!r.ifSlow || this.slowFrom !== null) return this.change(r.to, now, true, true);
    }

    if (slow) {
      if (now < this.graceUntil || this.slowFrom === null || now - this.slowFrom < LIVE_DOWN_AFTER_MS) return NONE;
      if (now - this.changedAt < LIVE_CHANGE_GAP_MS) return NONE;
      const low = lowest ? this.range.hardFloor : this.range.floor;
      if (this.budget > low * 1.01 && now >= this.cpuBoundUntil) {
        // With a busy GPU timer, straight to the level that fits; otherwise a level (two when far too slow).
        const target = gpuSlow
          ? this.budget * Math.min(0.9, Math.max(0.45, (TARGET_GPU_MS / gpu) * 0.9))
          : this.levelFrom(-1, !timer && interval > VERY_SLOW_MS ? 2 : 1);
        const from = this.budget;
        const d = this.change(target, now, lowest);
        // Slow frames under a quiet timer: the step tests whether pixels are the limit at all.
        if (d.kind === "budget" && timer && !gpuSlow) this.unproven = { from, interval, windows: 0 };
        return d;
      }
      // No room left (the floor, or a proven CPU limit): a lighter tier, only on a sustained drop under 45 fps.
      if (!lowest && this.slowSince !== null && now - this.slowSince >= SUSTAINED_FOR_MS) {
        this.settle = 2;
        return { kind: "tier", dir: -1 };
      }
      return NONE;
    }

    if (!easy || now < this.upAfter) return NONE;
    if (this.atCeiling()) {
      if (!highest && this.tierUpFrom !== null && now - this.tierUpFrom >= this.tierUpMs) {
        this.tierUpFrom = null;
        this.settle = 2;
        return { kind: "tier", dir: 1 };
      }
      return NONE;
    }
    if (this.easyFrom === null || now - this.easyFrom < UP_AFTER_MS) return NONE;
    // One level at a time, so a step up that fails costs little; with a GPU
    // timer, only when it says that level fits with room to spare.
    const target = this.levelFrom(1, 1);
    if (timer && this.budget * (TARGET_GPU_MS / gpu) * 0.85 < target * 0.999) return NONE;
    const from = this.budget;
    const d = this.change(target, now);
    if (d.kind === "budget") this.probe = { from, at: now, failed: false };
    return d;
  }
}

/** The tier one step from `q`, within [lite, max]. */
export function stepTier(q: Quality, dir: -1 | 1, max: Quality): Quality | null {
  const i = TIERS.indexOf(q) + dir;
  if (i < 0 || i > TIERS.indexOf(max)) return null;
  return TIERS[i];
}
