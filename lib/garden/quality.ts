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
// (RenderBudget, frameHold.ts), and changes are rare: never two within thirty
// seconds, never while someone is touching the screen, a step down only after
// seven seconds of slow frames, and a step up only one level at a time, after
// a long comfortable stretch and a cooldown, longer after a step down, so the
// budget cannot see-saw. Those clocks start once the reveal's grace is over
// (and its frames have settled): the first seconds of a live garden are
// start-up work, not the device. A slow stretch is judged whole, on its
// average and most of its windows, never on its first and last: a cadence
// hovering about the line (a mix of one- and two-refresh frames at 48 fps)
// is not slow. A step up that turns the frames uncomfortable goes back, but
// only once its thirty seconds are up (and only if they are still
// uncomfortable then), and that undo is the only change in its window: two
// freezes a few seconds apart read worse than half a minute of a heavier
// frame. The quality tier is heavy: it rebuilds the garden's geometry and
// recompiles its shaders. Under the opening veil the governor steps it as
// soon as the floor is proven too slow, or plainly would be (the frames as
// the floor would draw them, were every millisecond paid per pixel, which
// flatters it), and if the veil's time runs out while that is still being
// decided, the step is taken then, still veiled: the right tier is found
// before anyone sees the garden. Once the garden is showing it only ever
// steps down, on a sustained drop (under 45 fps for eight seconds, with the
// budget already at its floor) while nobody is touching the screen, and then
// behind the held frame too, never the veil. It never climbs a tier in the
// open (the new tier's compile would freeze the picture for seconds); room
// for the next tier up is noted instead (`roomAbove`), and the next visit
// opens on it, under the veil (device.rememberTier).
//
// Smoothness is judged against an absolute line, not the panel's top rate:
// 50 fps or better is comfortable on any panel of 60 Hz or more (a steady 48
// on a 144 Hz laptop, every third refresh, is near enough to leave alone;
// chasing 144 would only cost pixels), and within a tenth of the panel's own
// rate on a slower one (an iPhone in Low Power Mode draws at 30). Slow is a
// margin under that (46 fps); a step up wants the frames near 60 (or the
// panel's rate). The panel's rate is measured at startup (device.
// measureRefresh) and corrected upward from the frames, which can never come
// quicker than it refreshes. A startup reading of 30 Hz is only believed
// when a second reading, once the garden is live, agrees (a page loading
// under a busy GPU can pace itself like Low Power Mode); until then, and
// otherwise, the panel counts as 60 Hz.
//
// Measurement: where the browser offers a GPU timer (Chromium on desktop) the
// governor reads how long the GPU spent on each frame, which says how much
// headroom there is even on a 60 Hz screen where every frame takes 16.7 ms.
// The timer only wraps the post chain's draw, though, and misses compositing,
// the final upscale and other pages sharing the GPU, so the frame clock has
// the last word. Every cut of pixels the timer does not vouch for (a quiet
// timer, or none: Safari on iPhone and iPad, Firefox) is a guess, tested: if
// fewer pixels bought no quicker frames the limit is the CPU, the pixels go
// back (at once under the veil, at the next allowed moment once the garden
// is showing) and the governor stops cutting until the frames get materially
// slower than they were then. Without a timer it also probes upward now and
// then, stepping back and waiting longer each time a probe fails.
//
// Opening sequence (`phase`): boot (page and chunk loading) -> compiling
// (shaders compiling in parallel, then a few small pre-draws, nothing on
// screen) -> warming (the first frame drawn) -> calibrating (a second or so of
// frames to settle the budget) -> revealing (the veil, or a held frame, fades)
// -> live. The first opening runs under the loading veil (`veiled`); a tier
// change once the garden is live runs the same sequence behind a held frame,
// briefly (RenderBudget caps that freeze).
import { useSyncExternalStore } from "react";
import {
  budgetFor,
  dprForBudget,
  LAST_DPR,
  measureRefresh,
  settleRefresh,
  snapRefresh,
  TIERS,
  type Device,
  type PixelBudget,
  type QualityPlan,
} from "@/lib/garden/device";
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
  /** The panel's refresh rate (Hz), measured at startup (device.measureRefresh); 60 until then, and while a 30 Hz reading awaits its second (confirmRefresh). */
  refreshHz: number;
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
  refreshHz: 60,
  pinned: false,
  auto: true,
  tierChanges: 0,
  stats: { fps: 0, frameMs: 0, gpuMs: 0, timer: false },
};
const serverState = state;
const listeners = new Set<() => void>();
/** A startup refresh reading under 55 Hz, waiting for a second one once the garden is live (confirmRefresh). */
let bootHz: number | null = null;

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
  /** Called once with the device's plan, before the canvas mounts; the panel's refresh is measured meanwhile. */
  init(device: Device, plan: QualityPlan, opts: { pinned: boolean; auto: boolean }) {
    const css: readonly [number, number] = [window.innerWidth || 1280, window.innerHeight || 800];
    const range = budgetFor(device.kind, plan.tier, css[0], css[1], device.dpr);
    quality.set({ device, plan, tier: plan.tier, css, range, budget: nearestLevel(range, range.start), pinned: opts.pinned, auto: opts.auto });
    bootHz = null;
    measureRefresh((hz) => {
      if (hz < 55) bootHz = hz;
      else quality.set({ refreshHz: hz });
    });
  },
  /**
   * Once the garden is live: a startup reading under 55 Hz is measured again,
   * and believed only if the second reading agrees (device.settleRefresh).
   */
  confirmRefresh() {
    if (bootHz === null) return;
    const boot = bootHz;
    bootHz = null;
    measureRefresh((hz) => quality.set({ refreshHz: settleRefresh(boot, hz) }));
  },
  /**
   * The canvas's CSS size changed; only a real change re-renders the canvas.
   * The floor and ceiling follow the new size, and the budget keeps its pixel
   * ratio as far as the new range (and its levels) allow, a budget already
   * under the floor (the lightest tier's last resort) included; the canvas
   * resizes anyway, so the level moves with it.
   */
  setCss(w: number, h: number) {
    const [ow, oh] = state.css;
    if (w === ow && h === oh) return;
    const css: readonly [number, number] = [w, h];
    const range = rangeFor({ ...state, css }, state.tier);
    const scaled = state.budget * ((w * h) / Math.max(1, ow * oh));
    const low = Math.min(range.floor, Math.max(range.hardFloor, scaled));
    quality.set({ css, range, budget: nearestLevel(range, clampTo(range, scaled, low)) });
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
 * The absolute comfortable line (see the header): 50 fps on a panel of 60 Hz
 * or more, a tenth under the panel's rate on a slower one. Slow is this far
 * under it (46 fps), and a step up wants the frames at EASY_FPS (or a tenth
 * under a slower panel's rate). On a 120 or 144 Hz panel a frame that just
 * misses a vsync waits for the next one, so a GPU time under target can still
 * land slow; slow frames with a busy GPU count as GPU-bound for that reason.
 */
export const COMFORT_FPS = 50;
const SLOW_MARGIN = 0.92;
const EASY_FPS = 54;
/** Without a GPU timer to size the step, frames this much slower than slow (about 34 fps) step down two levels at once. */
const VERY_SLOW = 1.33;
/**
 * A frame longer than HITCH_MS and HITCH_RATIO times its neighbours' median
 * (the last CRAWL_SPAN frames) is a hitch (a buffer reallocation, a garbage
 * collection), not load; but once the garden is showing, this many in a row
 * are the device (or a GPU it shares) at a crawl, and count. Under the veil
 * the first frames' long ones are start-up work (draw variants, uploads), so
 * there it takes a longer run. A long frame among long ones is no hitch but
 * the pace: a garden crawling at 100 to 200 ms a frame, with a quick one now
 * and then, is measured as it is rather than half thrown away, and the veil
 * waits for its tier step. Longer than the pause is a hidden tab, never a
 * frame.
 */
const HITCH_MS = 120;
const HITCH_RATIO = 3;
const CRAWL_SPAN = 9;
const CRAWL_RUN = 4;
const CRAWL_RUN_VEILED = 6;
const PAUSE_MS = 1000;
/** Once the garden is showing, a tier changes only after this long under 45 fps (P1: no visible restarts). */
export const SUSTAINED_SLOW_MS = 1000 / 45;
export const SUSTAINED_FOR_MS = 8000;
/**
 * Once the garden is showing (P1: nothing blinks): slow frames for this long
 * before the budget steps down, never two changes closer together than the
 * gap (an undo included: it waits its turn and is the only change in its
 * window), and no step up for the cooldown after any change, longer after a
 * step down, so the budget cannot see-saw.
 */
export const LIVE_DOWN_AFTER_MS = 7000;
export const LIVE_CHANGE_GAP_MS = 30000;
export const UP_COOLDOWN_MS = 45000;
export const UP_AFTER_DOWN_MS = 90000;
/**
 * A stretch counts as slow (or uncomfortable) only when this share of its
 * windows is, and its frames are on average: a 750 ms window of a cadence
 * mixing one- and two-refresh frames is about six per cent noisy, more than
 * the margin between 48 fps and the slow line, so single windows decide
 * nothing.
 */
const STRETCH_SHARE = 0.75;
/** The live windows kept for judging stretches (the longest is SUSTAINED_FOR_MS). */
const SEEN_MS = 10000;
/** The reveal's grace stretches, while the frames have not yet settled, to at most this many times its length. */
const GRACE_SETTLE_MAX = 2;
/** A step up also needs this long of comfortable frames, and a tier up this long with the GPU far under target. */
const UP_AFTER_MS = 10000;
const TIER_UP_AFTER_MS = 10000;
const TIER_UP_AFTER_DOWN_MS = 30000;
/**
 * A step up is on trial this long: frames under the comfortable line for
 * PROBE_FAIL_MS fail it (it goes back once the gap is up), and the next one
 * waits PROBE_WAIT_MS, doubling with each failure up to the maximum: a probe
 * that fails costs two visible changes, so a level that keeps failing is
 * tried only a few times an hour.
 */
const PROBE_TRIAL_MS = 6000;
const PROBE_FAIL_MS = 2000;
const PROBE_WAIT_MS = 180000;
const PROBE_WAIT_MAX_MS = 600000;
/** A guess at a CPU limit tests itself with a budget step this size, and is given this many windows to pay off (live, longer ones: a few more). */
const UNPROVEN_STEP = 0.85;
const UNPROVEN_WINDOWS = 2;
const UNPROVEN_WINDOWS_LIVE = 3;
/** How long a proven CPU limit stops the governor from cutting pixels that will not help (live: from the restore, doubling each time). */
const CPU_BOUND_HOLD_MS = 20000;
const CPU_BOUND_LIVE_MS = 120000;
/**
 * After that hold, cutting resumes only once the frames are this much slower
 * than when the limit was proven (something changed), or after this much
 * longer (a driver, a thermal state or another tab has moved on).
 */
const CPU_PROOF_SLOWER = 1.12;
const CPU_PROOF_FORGET_MS = 600000;

interface Window {
  start: number;
  frames: number[];
  gpu: number[];
}

/** A measured live window, kept a few seconds for judging stretches whole. */
interface Seen {
  start: number;
  end: number;
  frames: number;
  /** Mean frame interval (ms), and the GPU's median (NaN without a timer). */
  interval: number;
  gpu: number;
  /** Slow by the frame clock, or by a busy GPU timer (which then vouches for pixels being the cost). */
  slow: boolean;
  vouched: boolean;
  /** Under the comfortable line, or vouched. */
  dull: boolean;
}

/**
 * The live windows of a stretch: their frame-weighted mean interval, that
 * mean less two standard errors of it (from how much the windows differ:
 * a steady cadence proves itself in a few seconds, a noisy one hovering
 * about a line needs far longer), and the share of them that `f` holds for.
 */
interface Stretch {
  windows: Seen[];
  mean: number;
  surely: number;
  share(f: (w: Seen) => boolean): number;
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
/** Windows (of a quarter second while calibrating), or as long in time, before the floor rule may step a tier under the veil. */
const FLOOR_RULE_AFTER = 3;
const FLOOR_RULE_AFTER_MS = 750;

export interface SampleContext {
  /** Under the veil or a held frame: short windows, bold steps, and a tier step as soon as the floor is too slow. */
  calibrating: boolean;
  /** No tier to step down to (lite, a pinned tier, or the session's tier changes spent): spend pixels below the floor instead. */
  lowest: boolean;
  /** No tier to step up to: the governor notes no room for one (roomAbove). */
  highest?: boolean;
  /** Someone touched the garden in the last few seconds: once it is showing, nothing changes until they stop. */
  interacting?: boolean;
}

/**
 * Pure decision logic, fed one frame at a time; the canvas component applies
 * what it decides. Calibrating, it waits for the frame times to settle before
 * moving the budget, so a start-up spike is not mistaken for the device's
 * speed, except that frames too slow even at the floor (there already, or by
 * projection) for two windows running, and not getting better, ask for a
 * lighter tier at once. Live, once the reveal's grace is over, it changes
 * rarely and only while nobody is touching the garden: the budget down a
 * level (or to the level the GPU timer says fits) after a sustained slow
 * stretch, a tier down only on a sustained, interval-measured drop with the
 * budget at its floor, and the budget up a level only after a comfortable
 * stretch and a cooldown, on trial. A tier up it only notes (roomAbove).
 */
export class Governor {
  budget: number;
  private range: PixelBudget;
  private levels: number[];
  private win: Window = { start: -1, frames: [], gpu: [] };
  private windows = 0;
  private settle = 1;
  /** The panel's refresh period (ms): told at startup (setRefresh), corrected from the frames; and the quickest typical frame seen. */
  private panelMs = 1000 / 60;
  private quickest = Infinity;
  /** Calibrating, too slow even at the floor: windows in a row, and the last one's interval. */
  private floorSlow = 0;
  private floorPrev = Infinity;
  /**
   * Live: the windows since the clocks last restarted (at the grace's end and
   * at every change), the last SEEN_MS of them, and when the first began.
   */
  private seen: Seen[] = [];
  private seenFrom = Infinity;
  /** Live: since when every window has been comfortable, and comfortable with the GPU far under target at the ceiling. */
  private easyFrom: number | null = null;
  private tierUpFrom: number | null = null;
  /**
   * Live: the GPU timer has read far under target at the ceiling for a long
   * stretch, so the next tier up would fit. Never climbed in the open (its
   * compile would freeze the picture); the canvas remembers it for the next
   * visit's opening instead.
   */
  roomAbove = false;
  /** Live: the last budget or tier change, and the time before which nothing steps up. */
  private changedAt = -Infinity;
  private upAfter = -Infinity;
  /** A step up on trial, and how long the wait after the next failed one is. */
  private probe: { from: number; at: number } | null = null;
  private probeWait = PROBE_WAIT_MS;
  /**
   * A budget to go back to, not before `notBefore` and once nobody is
   * touching the garden (a failed probe, or pixels cut for nothing);
   * `ifStill` drops it when the frames are comfortable again by then.
   */
  private restore: { to: number; notBefore: number; ifStill: boolean } | null = null;
  /**
   * A budget step testing whether slow frames the GPU timer does not vouch
   * for are really a pixel cost: the budget it came from, the frame interval
   * before it (a median of windows, so one hitch does not flatter the cut),
   * the windows measured since, and how many it waits for.
   */
  private unproven: { from: number; interval: number; after: number[]; windows: number } | null = null;
  /** The last few windows' frame intervals. */
  private intervals: number[] = [];
  private cpuBoundUntil = -Infinity;
  private cpuHold = CPU_BOUND_LIVE_MS;
  /** Live: the frame interval at which fewer pixels were last proven not to help, and when that is forgotten. */
  private cpuProof = { interval: 0, until: -Infinity };
  /** A budget where frames were proven slow despite a quiet timer: raises stop short of it for a while. */
  private cap = { budget: Infinity, until: -Infinity };
  private tierUpMs = TIER_UP_AFTER_MS;
  private recent: number[] = [];
  /** Hitches in a row (see CRAWL_RUN), the last few frames (CRAWL_SPAN), and when the first window since the last reset began. */
  private hitches = 0;
  private recentFrames: number[] = [];
  private firstWin = -1;
  private lastNow = 0;
  /** The reveal's grace: until `graceUntil`, and past it until the frames settle, at most until `graceCap`. */
  private graceUntil = -Infinity;
  private graceCap = -Infinity;
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
    this.firstWin = -1;
    this.recentFrames = [];
    this.floorSlow = 0;
    this.floorPrev = Infinity;
    this.forget();
    this.roomAbove = false;
    this.unproven = null;
    this.probe = null;
    this.restore = null;
    // A new tier costs the CPU differently: what was proven about the old one no longer holds.
    this.cpuProof = { interval: 0, until: -Infinity };
    this.recent = [];
    this.intervals = [];
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

  /** The panel's refresh rate as measured; never slower than frames already seen prove it, and the frames can still correct it upward. */
  setRefresh(hz: number) {
    if (!(hz > 0)) return;
    this.panelMs = 1000 / hz;
    if (this.quickest < this.panelMs * 0.85) this.panelMs = 1000 / snapRefresh(this.quickest);
  }

  get refreshHz(): number {
    return Math.round(1000 / this.panelMs);
  }

  /** Frame intervals (ms) on this panel: comfortable, slow, and easy enough to try a level up (see COMFORT_FPS). */
  private get comfortMs(): number {
    return 1000 / Math.min(COMFORT_FPS, (1000 / this.panelMs) * 0.9);
  }

  get slowMs(): number {
    return this.comfortMs / SLOW_MARGIN;
  }

  private get easyMs(): number {
    return 1000 / Math.min(EASY_FPS, (1000 / this.panelMs) * 0.9);
  }

  /** Under 45 fps, or slow on a panel too slow to reach it. */
  private get sustainedMs(): number {
    return Math.max(SUSTAINED_SLOW_MS, this.slowMs * 1.02);
  }

  /** Frozen (?governor=off): the budget stays where the page put it, whatever was decided. */
  hold(budget: number) {
    this.budget = budget;
  }

  /**
   * The garden is being revealed: its first frames are start-up work, so
   * nothing counts until `ms` from `now` (longer while the frames have not
   * settled, up to GRACE_SETTLE_MAX times as long), and every live clock
   * starts from there; no step up for the cooldown either. A pixel test
   * begun under the veil and not yet decided ends here with its cut kept:
   * its undo must not be the first thing anyone sees.
   */
  beginGrace(now: number, ms: number) {
    this.graceUntil = now + ms;
    this.graceCap = now + ms * GRACE_SETTLE_MAX;
    this.upAfter = Math.max(this.upAfter, now + UP_COOLDOWN_MS);
    this.unproven = null;
    this.forget();
  }

  /** After a tier step down, a step back up needs a long, convincing stretch. */
  slowTierUp() {
    this.tierUpMs = TIER_UP_AFTER_DOWN_MS;
  }

  /**
   * Calibrating, too slow even at the floor, or crawling (a run of frames so
   * long that measuring windows barely form before the veil's time is up):
   * worth waiting a little longer under the veil for the tier step.
   */
  get wantsTier(): boolean {
    return this.floorSlow > 0 || this.hitches >= CRAWL_RUN_VEILED || this.crawling;
  }

  /** The last few frames' median is past HITCH_MS. */
  private get crawling(): boolean {
    return this.recentFrames.length >= CRAWL_SPAN && median(this.recentFrames) > HITCH_MS;
  }

  /**
   * The veil's time is up while the floor rule is still counting (the last
   * window was too slow even for the floor, but it has not yet seen two in a
   * row), or the frames are still crawling: the lighter tier it was about to
   * ask for is asked for now, still under the veil, rather than as a visible
   * change after it lifts (P1).
   */
  settleTier(lowest: boolean): Decision {
    if (lowest || !this.wantsTier) return NONE;
    this.floorSlow = 0;
    this.floorPrev = Infinity;
    this.settle = 2;
    return { kind: "tier", dir: -1 };
  }

  sample(frameMs: number, gpuMs: number | null, now: number, ctx: SampleContext = { calibrating: false, lowest: false }): Decision {
    if (frameMs > PAUSE_MS || frameMs <= 0) return NONE;
    const { calibrating, lowest } = ctx;
    this.recentFrames.push(frameMs);
    if (this.recentFrames.length > CRAWL_SPAN) this.recentFrames.shift();
    if (frameMs <= HITCH_MS || frameMs <= HITCH_RATIO * median(this.recentFrames)) this.hitches = 0;
    else if (++this.hitches < (calibrating ? CRAWL_RUN_VEILED : CRAWL_RUN)) return NONE;
    this.lastNow = now;
    const w = this.win;
    if (w.start < 0) w.start = now;
    w.frames.push(frameMs);
    if (gpuMs !== null && Number.isFinite(gpuMs)) w.gpu.push(gpuMs);
    const span = calibrating ? 250 : 750;
    if (now - w.start < span || w.frames.length < (calibrating ? 6 : 20)) return NONE;

    const interval = mean(w.frames);
    const gpu = w.gpu.length >= w.frames.length / 3 ? median(w.gpu) : NaN;
    // Frames never come quicker than the panel refreshes: half of them doing so means a faster panel than measured.
    const typical = median(w.frames);
    this.quickest = Math.min(this.quickest, typical);
    if (typical < this.panelMs * 0.85) this.panelMs = 1000 / snapRefresh(typical);
    const start = w.start;
    const frames = w.frames.length;
    this.win = { start: now, frames: [], gpu: [] };
    if (this.windows++ === 0) this.firstWin = start;
    this.last = { frameMs: interval, gpuMs: gpu, fps: 1000 / interval };
    this.recent.push(Number.isFinite(gpu) ? gpu : interval);
    if (this.recent.length > STABLE_WINDOWS) this.recent.shift();
    this.intervals.push(interval);
    if (this.intervals.length > STABLE_WINDOWS) this.intervals.shift();
    this.stable =
      this.recent.length === STABLE_WINDOWS && Math.max(...this.recent) <= STABLE_SPREAD * Math.min(...this.recent);
    if (calibrating) this.forget();
    if (this.settle > 0) {
      this.settle--;
      return NONE;
    }
    return calibrating ? this.calibrate(interval, gpu, lowest, now) : this.live({ start, end: now, frames, interval, gpu }, ctx);
  }

  /** Restarts the live clocks: the stretches seen so far, and the comfortable ones. */
  private forget() {
    this.seen = [];
    this.seenFrom = Infinity;
    this.easyFrom = this.tierUpFrom = null;
  }

  /**
   * The live windows of the last `ms`, or null while the windows since the
   * clocks last restarted do not cover that long yet.
   */
  private over(ms: number, now: number): Stretch | null {
    if (now - this.seenFrom < ms) return null;
    const windows = this.seen.filter((w) => w.end > now - ms);
    if (windows.length === 0) return null;
    let frames = 0;
    let total = 0;
    for (const w of windows) {
      frames += w.frames;
      total += w.frames * w.interval;
    }
    const n = windows.length;
    const m = mean(windows.map((w) => w.interval));
    const se = n > 1 ? Math.sqrt(windows.reduce((a, w) => a + (w.interval - m) ** 2, 0) / (n - 1) / n) : 0;
    const avg = total / frames;
    return { windows, mean: avg, surely: avg - 2 * se, share: (f) => windows.filter(f).length / n };
  }

  /** The last PROBE_FAIL_MS under the comfortable line, on average and in most windows (or a busy GPU timer in most). */
  private uncomfortable(now: number): boolean {
    const s = this.over(PROBE_FAIL_MS, now);
    if (!s || s.share((w) => w.dull) < STRETCH_SHARE) return false;
    return s.mean > this.comfortMs || s.share((w) => w.vouched) >= STRETCH_SHARE;
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
    this.forget();
    if (d.budget < from) this.roomAbove = false;
    this.upAfter = Math.max(this.upAfter, now + (d.budget < from ? UP_AFTER_DOWN_MS : UP_COOLDOWN_MS));
    return d;
  }

  /**
   * Calibrating and too slow even at the floor: a lighter tier, or with none
   * left, fewer pixels than the floor. Unless a busy GPU timer vouches for
   * the pixels being the cost, fewer may buy nothing (a CPU limit), so that
   * step is tested like any other guess.
   */
  private belowFloor(lowest: boolean, untested: boolean, now: number): Decision {
    if (!lowest) {
      this.settle = 2;
      return { kind: "tier", dir: -1 };
    }
    if (untested) return this.testCpuGuess(now, true) ?? NONE;
    return this.setBudget(this.budget * UNPROVEN_STEP, true);
  }

  /**
   * Slow frames the GPU timer does not vouch for (it reads quiet, or there is
   * none). The timer misses compositing and the upscale, and the frame clock
   * alone cannot tell pixels from the CPU, so a pixel limit is only a guess
   * until fewer pixels have paid off: step the budget down by `step` and
   * watch the frame interval. Returns null when the guess is not worth
   * testing.
   */
  private testCpuGuess(now: number, belowFloor: boolean, step = UNPROVEN_STEP): Decision | null {
    if (now < this.cpuBoundUntil) return null;
    const from = this.budget;
    const d = this.setBudget(this.budget * step, belowFloor);
    if (d.kind !== "budget") return null;
    this.beginTest(from);
    return d;
  }

  /** A cut from `from` is on test: the frames before it are the last few windows' median, unless the stretch that asked for it gives one. */
  private beginTest(from: number, interval = median(this.intervals), windows = UNPROVEN_WINDOWS) {
    this.unproven = { from, interval, after: [], windows };
  }

  /**
   * Follows an unproven step: kept if the frames got quicker over the windows
   * since. If they did not, it is the CPU: under the veil the pixels go
   * straight back; once the garden is showing they go back at the next calm
   * moment a change is allowed, the budget is left alone for a while (longer
   * each time), and after that it is cut again only once the frames are
   * materially slower than they were.
   */
  private followCpuGuess(interval: number, now: number, live: boolean): Decision | null {
    const u = this.unproven;
    if (!u) return null;
    u.after.push(interval);
    if (u.after.length < u.windows) return NONE;
    this.unproven = null;
    if (mean(u.after) < u.interval * 0.92) {
      // Fewer pixels did help, so the timer (if any) under-reads this device: no climbing back to where it was slow.
      this.cap = { budget: u.from * 0.95, until: now + CPU_BOUND_HOLD_MS * 3 };
      return null;
    }
    if (live) {
      const notBefore = this.changedAt + LIVE_CHANGE_GAP_MS;
      this.restore = { to: Math.min(u.from, this.range.ceiling), notBefore, ifStill: false };
      this.cpuBoundUntil = Math.max(now, notBefore) + this.cpuHold;
      this.cpuHold = Math.min(PROBE_WAIT_MAX_MS, this.cpuHold * 2);
      this.cpuProof = { interval: u.interval, until: this.cpuBoundUntil + CPU_PROOF_FORGET_MS };
      return null;
    }
    this.cpuBoundUntil = now + CPU_BOUND_HOLD_MS;
    return this.setBudget(Math.min(u.from, this.range.ceiling), true, true);
  }

  /** Live: fewer pixels may still help (no proven CPU limit stands, or the frames have got materially slower since). */
  private mayCut(interval: number, now: number): boolean {
    if (now < this.cpuBoundUntil) return false;
    return now >= this.cpuProof.until || interval > this.cpuProof.interval * CPU_PROOF_SLOWER;
  }

  private calibrate(interval: number, gpu: number, lowest: boolean, now: number): Decision {
    const timer = Number.isFinite(gpu);
    const slowMs = this.slowMs;
    const gpuSlow = timer && gpu > GPU_HIGH;
    const frameSlow = interval > slowMs;
    const cpuBound = now < this.cpuBoundUntil;
    // P1: too slow even at the floor, so a lighter tier now, under the veil,
    // rather than a visible change ten seconds after it lifts. At the floor
    // (or proven CPU-bound) that is the frames as they are; above it, the
    // frames as the floor would draw them were every millisecond paid per
    // pixel, which flatters the floor, so only a plainly hopeless garden
    // skips the budget steps. A falling start-up spike is not a plateau, so
    // the count restarts while it improves. With no lighter tier, fewer
    // pixels, unless the limit is the CPU and pixels would not help; and then
    // without the hurry, only once the frames have settled, since start-up
    // work alone must not push the lightest tier below its floor.
    const f = Math.min(1, this.range.floor / this.budget);
    let hopeless: boolean;
    if (lowest) hopeless = this.atFloor() && (gpuSlow || frameSlow);
    else if (this.atFloor() || cpuBound) hopeless = gpuSlow || frameSlow;
    else if (timer) hopeless = gpu * f > GPU_HIGH || (frameSlow && gpu * f >= TARGET_GPU_MS * 0.8 && interval * f > slowMs);
    else hopeless = interval * f > slowMs;
    // The warm-up is a few windows or as long in time: slow frames form windows slowly, and a crawl needs none.
    const ready = lowest
      ? this.stable
      : this.windows >= FLOOR_RULE_AFTER || now - this.firstWin >= FLOOR_RULE_AFTER_MS || interval > HITCH_MS;
    if (hopeless && ready && !(lowest && cpuBound)) {
      const improving = this.floorSlow > 0 && interval < this.floorPrev * 0.9;
      this.floorSlow = improving ? 1 : this.floorSlow + 1;
      this.floorPrev = interval;
      if (this.floorSlow >= 2) {
        this.floorSlow = 0;
        this.floorPrev = Infinity;
        return this.belowFloor(lowest, !gpuSlow, now);
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
    // Slow frames no busy timer vouches for: a guess, tested (a bold one without a timer to size it).
    if (frameSlow) return (timer ? this.testCpuGuess(now, lowest) : this.testCpuGuess(now, false, 0.7)) ?? NONE;
    // P4: a raise needs a comfortable frame clock as well as a quiet GPU timer.
    if (timer && gpu < GPU_LOW && interval < this.easyMs && !this.atCeiling()) {
      const k = Math.min(1.6, Math.max(1.06, (TARGET_GPU_MS / gpu) * 0.85));
      return this.setBudget(this.budget * k);
    }
    return NONE;
  }

  private live(win: { start: number; end: number; frames: number; interval: number; gpu: number }, ctx: SampleContext): Decision {
    const { lowest, highest = false, interacting = false } = ctx;
    const { start, end: now, interval, gpu } = win;
    // The reveal's grace: its windows are start-up work, not the device, so
    // they start no clock (P1: a cut timed by them buys nothing and comes
    // back thirty seconds later, two freezes for nothing).
    if (start < this.graceUntil || (!this.stable && now < this.graceCap)) {
      this.forget();
      return NONE;
    }
    const timer = Number.isFinite(gpu);
    const slowMs = this.slowMs;
    const comfortMs = this.comfortMs;
    const frameSlow = interval > slowMs;
    // A busy GPU timer vouches for pixels being the cost.
    const vouched = timer && (gpu > GPU_HIGH || (frameSlow && gpu >= TARGET_GPU_MS * 0.8));
    const easy = interval < this.easyMs && (!timer || gpu < GPU_LOW);
    if (this.seen.length === 0) this.seenFrom = start;
    this.seen.push({ ...win, slow: frameSlow || vouched, vouched, dull: interval > comfortMs || vouched });
    while (this.seen.length > 1 && this.seen[0].end < now - SEEN_MS) this.seen.shift();
    if (easy) this.easyFrom ??= start;
    else this.easyFrom = null;
    // Room for the next tier: noted, never climbed in the open (see roomAbove).
    if (easy && timer && gpu < GPU_TIER_UP && this.atCeiling()) this.tierUpFrom ??= start;
    else this.tierUpFrom = null;
    if (!highest && this.tierUpFrom !== null && now - this.tierUpFrom >= this.tierUpMs) this.roomAbove = true;

    // A step up on trial that turns the frames uncomfortable goes back, but
    // only once its gap is up, and then only if they are still uncomfortable;
    // that undo is the next change and the only one in its window (P1: at
    // most one visible change per gap). The next step up waits twice as long.
    const p = this.probe;
    if (p) {
      if (this.uncomfortable(now)) {
        this.probe = null;
        this.upAfter = Math.max(this.upAfter, now + this.probeWait);
        this.probeWait = Math.min(PROBE_WAIT_MAX_MS, this.probeWait * 2);
        this.restore = { to: p.from, notBefore: p.at + LIVE_CHANGE_GAP_MS, ifStill: true };
      } else if (now - p.at > PROBE_TRIAL_MS) this.probe = null;
    }
    const pending = this.followCpuGuess(interval, now, true);
    if (pending) return pending;
    if (interacting) return NONE;
    const r = this.restore;
    if (r && now >= r.notBefore) {
      this.restore = null;
      // A failed step up whose frames have recovered since keeps its level after all.
      if (!r.ifStill || this.uncomfortable(now)) return this.change(r.to, now, true, true);
    }
    // A pending undo holds every other change back until it has had its turn.
    if (this.restore) return NONE;

    // A slow stretch, judged whole: most of its windows slow, and its frames
    // surely slow on average (or a busy GPU timer in most of them).
    const s = this.over(LIVE_DOWN_AFTER_MS, now);
    const busy = s !== null && s.share((w) => w.vouched) >= STRETCH_SHARE;
    if (s && s.share((w) => w.slow) >= STRETCH_SHARE && (busy || s.surely > slowMs)) {
      if (now - this.changedAt < LIVE_CHANGE_GAP_MS) return NONE;
      const low = lowest ? this.range.hardFloor : this.range.floor;
      if (this.budget > low * 1.01 && this.mayCut(s.mean, now)) {
        // With a busy GPU timer, straight to the level that fits; otherwise a level (two when far too slow).
        const gpuMs = median(s.windows.map((w) => w.gpu).filter(Number.isFinite));
        const target = busy
          ? this.budget * Math.min(0.9, Math.max(0.45, (TARGET_GPU_MS / gpuMs) * 0.9))
          : this.levelFrom(-1, !timer && s.mean > slowMs * VERY_SLOW ? 2 : 1);
        const from = this.budget;
        const d = this.change(target, now, lowest);
        // No busy timer vouches for this cut (a quiet one, or none): it tests whether pixels are the limit at all.
        if (d.kind === "budget" && !busy) this.beginTest(from, median(s.windows.map((w) => w.interval)), UNPROVEN_WINDOWS_LIVE);
        return d;
      }
      // No room left (the floor, or a proven CPU limit): a lighter tier, only on a sustained drop under 45 fps.
      const sustained = this.sustainedMs;
      const t = this.over(SUSTAINED_FOR_MS, now);
      if (!lowest && t && t.surely > sustained && t.share((w) => w.interval > sustained) >= STRETCH_SHARE) {
        this.settle = 2;
        return { kind: "tier", dir: -1 };
      }
      return NONE;
    }

    if (!easy || now < this.upAfter || this.atCeiling()) return NONE;
    if (this.easyFrom === null || now - this.easyFrom < UP_AFTER_MS) return NONE;
    // One level at a time, so a step up that fails costs little; with a GPU
    // timer, only when it says that level fits with room to spare.
    const target = this.levelFrom(1, 1);
    if (timer && this.budget * (TARGET_GPU_MS / gpu) * 0.85 < target * 0.999) return NONE;
    const from = this.budget;
    const d = this.change(target, now);
    if (d.kind === "budget") this.probe = { from, at: now };
    return d;
  }
}

/** The tier one step from `q`, within [lite, max]. */
export function stepTier(q: Quality, dir: -1 | 1, max: Quality): Quality | null {
  const i = TIERS.indexOf(q) + dir;
  if (i < 0 || i > TIERS.indexOf(max)) return null;
  return TIERS[i];
}
