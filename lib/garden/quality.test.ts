// The render budget's pure parts: the device plan, the pixel ratio a budget
// buys and its floors, the few budget levels the canvas is drawn at, and the
// governor's decisions as frames come in, calibrating under the veil and live
// once the garden is showing (where nothing may blink: rare, calm changes,
// one per gap), judged against the panel's own refresh where no GPU timer
// says how busy the frame is (iPhones and iPads at 60 and 120 Hz, a 144 Hz
// laptop in Firefox), with realistic jittered cadences as well as steady
// ones; and the store's resize and refresh rules, and the remembered tier.
import { describe, expect, it, vi } from "vitest";
import { budgetFor, classifyGpu, dprForBudget, planFor, settleRefresh, snapRefresh, type Device, type PixelBudget } from "./device";
import {
  budgetLevels,
  Governor,
  LIVE_CHANGE_GAP_MS,
  LIVE_DOWN_AFTER_MS,
  quality,
  stepTier,
  SUSTAINED_FOR_MS,
  UP_AFTER_DOWN_MS,
  UP_COOLDOWN_MS,
  type Decision,
  type SampleContext,
} from "./quality";

const device = (patch: Partial<Device>): Device => ({
  kind: "laptop",
  touch: false,
  dpr: 1,
  cores: 8,
  memory: 8,
  gpu: "",
  gpuClass: "mid",
  ...patch,
});

const LIVE: SampleContext = { calibrating: false, lowest: false };
const CALIBRATING: SampleContext = { calibrating: true, lowest: false };

/**
 * Feeds `seconds` of identical frames and returns every decision that was not
 * "none", with when it came. With `applyTiers`, a tier step is carried out as
 * the canvas does (the governor reset in the open), so it is asked for once.
 */
function feed(g: Governor, clock: { now: number }, seconds: number, frameMs: number, gpuMs: number | null, ctx = LIVE, applyTiers = false) {
  const out: Array<Decision & { at: number }> = [];
  const end = clock.now + seconds * 1000;
  while (clock.now < end) {
    clock.now += frameMs;
    const d = g.sample(frameMs, gpuMs, clock.now, ctx);
    if (d.kind !== "none") out.push({ ...d, at: clock.now });
    if (d.kind === "tier" && applyTiers) g.reset(range, g.budget, clock.now);
  }
  return out;
}
/** Feeds identical frames until the governor closes one measuring window, and returns what it decided then. */
function oneWindow(g: Governor, clock: { now: number }, frameMs: number, gpuMs: number | null, ctx = LIVE): Decision {
  const before = g.last;
  let d: Decision = { kind: "none" };
  while (g.last === before) {
    clock.now += frameMs;
    d = g.sample(frameMs, gpuMs, clock.now, ctx);
  }
  return d;
}
const kinds = (d: Decision[]) => d.map((x) => x.kind);
type Timed = Decision & { at: number };
type BudgetStep = Extract<Decision, { kind: "budget" }> & { at: number };
const budgets = (d: Timed[]) => d.filter((x): x is BudgetStep => x.kind === "budget");

describe("device plan", () => {
  it("classifies GPUs by their reported names", () => {
    expect(classifyGpu("ANGLE (AMD, AMD Radeon(TM) Graphics (0x00001638) Direct3D11 vs_5_0 ps_5_0, D3D11)")).toBe("mid");
    expect(classifyGpu("ANGLE (NVIDIA, NVIDIA GeForce RTX 3060 Laptop GPU Direct3D11)")).toBe("high");
    expect(classifyGpu("ANGLE (Apple, ANGLE Metal Renderer: Apple M2, Unspecified Version)")).toBe("high");
    expect(classifyGpu("Apple GPU")).toBe("mid");
    expect(classifyGpu("Google SwiftShader")).toBe("low");
    expect(classifyGpu("Mali-T880")).toBe("low");
  });

  it("starts phones on lite, integrated laptops on balanced and discrete ones on cinematic", () => {
    expect(planFor(device({ kind: "phone", touch: true, gpuClass: "high" })).tier).toBe("lite");
    expect(planFor(device({ gpuClass: "mid" })).tier).toBe("balanced");
    expect(planFor(device({ gpuClass: "high" })).tier).toBe("cinematic");
    expect(planFor(device({ kind: "tablet", touch: true, gpuClass: "mid" })).tier).toBe("balanced");
    expect(planFor(device({ gpuClass: "high", cores: 2 })).tier).toBe("balanced");
  });

  it("never lets the governor climb past what the GPU class allows", () => {
    expect(planFor(device({ kind: "phone", touch: true })).maxTier).toBe("lite");
    expect(planFor(device({ gpuClass: "mid" })).maxTier).toBe("balanced");
    expect(planFor(device({ gpuClass: "high" })).maxTier).toBe("cinematic");
  });

  it("floors the budget at a pixel ratio per class, not a pixel count", () => {
    // a 1440 x 900 laptop at 1.25x: 1.3 MP of CSS pixels, floored at 0.85 of them per side
    const laptop = budgetFor("laptop", "balanced", 1440, 900, 1.25);
    expect(laptop.floor).toBeCloseTo(0.85 * 0.85 * 1.296, 3);
    expect(dprForBudget(laptop.floor, 1440, 900, 1.25)).toBe(0.85);
    expect(laptop.hardFloor).toBeCloseTo(0.6 * 0.6 * 1.296, 3);
    // the 1080p party screen: its start is lifted to the floor rather than drawn soft
    const party = budgetFor("bigscreen", "balanced", 1920, 1080, 1);
    expect(party.start).toBeCloseTo(party.floor, 6);
    expect(dprForBudget(party.start, 1920, 1080, 1)).toBe(0.85);
    // an iPad at 1.0, a phone at 1.1
    expect(dprForBudget(budgetFor("tablet", "balanced", 820, 1180, 2).floor, 820, 1180, 2)).toBe(1);
    expect(dprForBudget(budgetFor("phone", "lite", 390, 844, 3).floor, 390, 844, 3)).toBe(1.1);
  });

  it("caps the ceiling at what the screen can show, and never under the floor", () => {
    // a phone at 3x is never drawn past 2x
    const phone = budgetFor("phone", "lite", 390, 844, 3);
    expect(dprForBudget(phone.ceiling, 390, 844, 3)).toBeLessThanOrEqual(2);
    // a 4K monitor at 1x: the floor is past the tier's ceiling, so the tier steps instead of going soft
    const big = budgetFor("bigscreen", "cinematic", 3840, 2160, 1);
    expect(big.ceiling).toBe(big.floor);
  });

  it("spends a pixel budget as a pixel ratio, within the screen's density and in 0.05 steps", () => {
    expect(dprForBudget(2.0, 1440, 900, 1.25)).toBe(1.25);
    expect(dprForBudget(1.0, 1440, 900, 1.25)).toBe(0.9);
    expect(dprForBudget(0.1, 1440, 900, 1.25)).toBe(0.5);
    expect(dprForBudget(0.1, 1440, 900, 1.25, 0.6)).toBe(0.6);
    expect(dprForBudget(5, 390, 844, 3)).toBe(2);
  });

  it("steps tiers within lite and the allowed maximum", () => {
    expect(stepTier("balanced", -1, "cinematic")).toBe("lite");
    expect(stepTier("lite", -1, "cinematic")).toBeNull();
    expect(stepTier("balanced", 1, "balanced")).toBeNull();
  });
});

const range: PixelBudget = { floor: 0.5, hardFloor: 0.3, start: 1, ceiling: 2 };
/** 0.3, 0.385, 0.5 (the floor), 0.65, 0.845, 1.10, 1.43, 2 */
const LEVELS = budgetLevels(range);
const L = (i: number) => LEVELS[i];
const onLevel = (b: number) => LEVELS.some((l) => Math.abs(l - b) < 1e-9);

describe("budget levels", () => {
  it("are a few fixed sizes from the last resort to the ceiling, each a real step from the next", () => {
    expect(LEVELS[0]).toBe(range.hardFloor);
    expect(LEVELS).toContain(range.floor);
    expect(LEVELS.at(-1)).toBe(range.ceiling);
    expect(LEVELS.length).toBe(8);
    for (let i = 1; i < LEVELS.length; i++) expect(LEVELS[i] / LEVELS[i - 1]).toBeGreaterThanOrEqual(1.12);
  });

  it("give a laptop no more than four sizes above its floor, each a different pixel ratio", () => {
    const laptop = budgetFor("laptop", "balanced", 1440, 900, 1.25);
    const sizes = budgetLevels(laptop).filter((l) => l >= laptop.floor);
    expect(sizes.length).toBeLessThanOrEqual(4);
    expect(new Set(sizes.map((l) => dprForBudget(l, 1440, 900, 1.25))).size).toBe(sizes.length);
  });

  it("hold every budget the governor picks, calibrating or live", () => {
    const g = new Governor(range, L(5));
    const clock = { now: 0 };
    const d = [
      ...feed(g, clock, 3, 30, 25, CALIBRATING),
      ...feed(g, clock, 3, 8, 4, CALIBRATING),
      ...feed(g, clock, 60, 25, 20),
      ...feed(g, clock, 300, 8, 4),
      ...feed(g, clock, 60, 40, null),
      ...feed(g, clock, 60, 21, 8, { calibrating: false, lowest: true }),
    ];
    const picked = budgets(d);
    expect(picked.length).toBeGreaterThan(3);
    for (const x of picked) expect(onLevel(x.budget)).toBe(true);
  });
});

describe("governor with a GPU timer", () => {
  it("live: steps down only after seven seconds of slow frames, straight to the level the GPU time says fits", () => {
    const g = new Governor(range, L(5));
    const d = feed(g, { now: 0 }, 14, 25, 20);
    expect(d).toHaveLength(1);
    expect(d[0].at).toBeGreaterThanOrEqual(LIVE_DOWN_AFTER_MS);
    // 20 ms against a 12.5 ms target: two levels in one change, not two changes
    expect(d[0]).toMatchObject({ kind: "budget", budget: L(3) });
  });

  it("live: raises it to the ceiling a level at a time, after comfortable stretches a cooldown apart", () => {
    const g = new Governor(range, L(3));
    const d = budgets(feed(g, { now: 0 }, 400, 7, 4));
    expect(g.budget).toBe(2);
    // the timer says the ceiling would fit from the start, but every step up is one level, on trial
    expect(d.map((x) => x.budget)).toEqual([L(4), L(5), L(6), L(7)]);
    for (let i = 1; i < d.length; i++) expect(d[i].at - d[i - 1].at).toBeGreaterThanOrEqual(UP_COOLDOWN_MS);
  });

  it("never cuts pixels below the floor while a lighter tier is left", () => {
    const g = new Governor(range, 0.6);
    feed(g, { now: 0 }, 60, 30, 25);
    expect(g.budget).toBeGreaterThanOrEqual(0.5);
  });

  it("live at the floor: no shadow rung, a tier only after eight seconds under 45 fps", () => {
    const g = new Governor(range, 0.5);
    const clock = { now: 0 };
    g.beginGrace(0, 6000);
    expect(feed(g, clock, 5.5, 30, 25)).toEqual([]);
    const after = feed(g, clock, 12, 30, 25);
    expect(kinds(after)).not.toContain("shadows");
    expect(after[0]).toMatchObject({ kind: "tier", dir: -1 });
    expect(after[0].at).toBeGreaterThanOrEqual(SUSTAINED_FOR_MS);
  });

  it("live: a busy GPU that still holds about 50 fps never costs a tier", () => {
    const g = new Governor(range, 0.5);
    const d = feed(g, { now: 0 }, 30, 20, 18);
    expect(kinds(d)).not.toContain("tier");
  });

  it("calibrating at the floor and plainly slow, asks for a lighter tier at once (P1)", () => {
    const g = new Governor(range, 0.5);
    const d = feed(g, { now: 0 }, 3, 30, 25, CALIBRATING);
    const tier = d.find((x) => x.kind === "tier");
    expect(tier).toMatchObject({ dir: -1 });
    expect(tier!.at).toBeLessThan(2000);
  });

  it("calibrating does not mistake a falling start-up spike for a slow device", () => {
    const g = new Governor(range, 0.5);
    const clock = { now: 0 };
    const d = [
      ...feed(g, clock, 0.5, 60, 55, CALIBRATING),
      ...feed(g, clock, 0.5, 40, 36, CALIBRATING),
      ...feed(g, clock, 0.5, 28, 24, CALIBRATING),
      ...feed(g, clock, 1, 15, 10, CALIBRATING),
    ];
    expect(kinds(d)).not.toContain("tier");
  });

  it("on the lightest tier, spends fewer pixels than the floor instead, down to the last resort (P4)", () => {
    const g = new Governor(range, 0.5);
    const d = feed(g, { now: 0 }, 6, 30, 25, { calibrating: true, lowest: true });
    expect(kinds(d)).not.toContain("tier");
    expect(g.budget).toBeLessThan(0.5);
    expect(g.budget).toBeGreaterThanOrEqual(0.3);
  });

  it("calibrating, tests slow frames under a quiet timer with a level down, and keeps it when the frames speed up (P4)", () => {
    const g = new Governor(range, L(6));
    const clock = { now: 0 };
    let first: Decision[] = [];
    while (first.length === 0 && clock.now < 3000) first = feed(g, clock, 0.05, 24, 8, CALIBRATING);
    expect(first[0]).toMatchObject({ kind: "budget", budget: L(5) });
    // the smaller budget helped: the timer under-reads this device, so it never climbs back to where it was slow
    feed(g, clock, 30, 16.7, 6.5, CALIBRATING);
    expect(g.budget).toBeLessThan(L(6));
  });

  it("calibrating, puts the pixels back at once when a level down did not help: then it really is the CPU (P4)", () => {
    const g = new Governor(range, L(6));
    const d = feed(g, { now: 0 }, 6, 24, 8, CALIBRATING);
    expect(d[0]).toMatchObject({ kind: "budget", budget: L(5) });
    expect(d[1]).toMatchObject({ kind: "budget", budget: L(6) });
  });

  it("live, on the lightest tier and CPU-bound, puts back pixels cut for nothing, calmly, and does not try again soon", () => {
    const g = new Governor(range, 0.5);
    g.beginGrace(0, 0);
    const d = budgets(feed(g, { now: 0 }, 120, 34, 6, { calibrating: false, lowest: true }));
    expect(d.map((x) => x.budget)).toEqual([L(1), 0.5]);
    expect(d[1].at - d[0].at).toBeGreaterThanOrEqual(LIVE_CHANGE_GAP_MS);
    expect(g.budget).toBe(0.5);
  });

  it("calibrating, raises the budget only when the frame clock has room too (P4)", () => {
    // about 51 fps: comfortable, but with no room for more pixels whatever the timer says
    const g = new Governor(range, 1);
    feed(g, { now: 0 }, 3, 19.5, 6, CALIBRATING);
    expect(g.budget).toBeLessThanOrEqual(1);
  });

  it("calibrating above the floor, asks for a lighter tier at once when even the floor would be too slow (P1)", () => {
    // 40 ms of GPU at L(5): at the floor that is still about 18 ms, past what fits
    const g = new Governor(range, L(5));
    const d = feed(g, { now: 0 }, 3, 50, 40, CALIBRATING);
    expect(d[0]).toMatchObject({ kind: "tier", dir: -1 });
    expect(d[0].at).toBeLessThan(2000);
    // without a timer, from the frame clock as the floor would draw it
    const h = new Governor(range, L(5));
    expect(feed(h, { now: 0 }, 3, 60, null, CALIBRATING)[0]).toMatchObject({ kind: "tier", dir: -1 });
  });

  it("calibrating above the floor, steps the budget instead when the floor would hold", () => {
    // the GPU's time follows the pixels: 20 ms at L(5) is 9 ms at the floor, so fewer pixels, the same tier
    const g = new Governor(range, L(5));
    const clock = { now: 0 };
    const d: Timed[] = [];
    while (clock.now < 3000) {
      const gpu = 18.2 * g.budget;
      d.push(...feed(g, clock, 0.05, Math.max(16.7, gpu + 4), gpu, CALIBRATING));
    }
    expect(kinds(d)).not.toContain("tier");
    expect(g.budget).toBeLessThan(L(5));
    expect(g.budget).toBeGreaterThanOrEqual(range.floor);
  });

  it("takes the tier step the floor rule is still deciding on when the veil's time is up, and only then", () => {
    const g = new Governor(range, 0.5);
    const clock = { now: 0 };
    // a falling start-up spike keeps restarting the count, but every window is too slow even for the floor
    for (const ms of [70, 70, 60, 50, 42, 36]) expect(oneWindow(g, clock, ms, ms * 0.8, CALIBRATING)).toEqual({ kind: "none" });
    expect(g.wantsTier).toBe(true);
    expect(g.settleTier(false)).toMatchObject({ kind: "tier", dir: -1 });
    // nothing to decide on a garden that fits, nor on the lightest tier
    const h = new Governor(range, 0.5);
    feed(h, { now: 0 }, 2, 16.7, 6, CALIBRATING);
    expect(h.settleTier(false)).toEqual({ kind: "none" });
    expect(g.settleTier(true)).toEqual({ kind: "none" });
  });
});

describe("governor without a GPU timer", () => {
  it("live: steps down a level after seven seconds of slow frames, two when far too slow", () => {
    const g = new Governor(range, L(5));
    const d = feed(g, { now: 0 }, 10, 28, null);
    expect(d[0]).toMatchObject({ kind: "budget", budget: L(4) });
    expect(d[0].at).toBeGreaterThanOrEqual(LIVE_DOWN_AFTER_MS);
    const h = new Governor(range, L(5));
    expect(feed(h, { now: 0 }, 10, 40, null)[0]).toMatchObject({ kind: "budget", budget: L(3) });
  });

  it("probes a level up after a comfortable stretch, and puts back one that drops it under 45 fps once the gap is up", () => {
    const g = new Governor(range, L(4));
    const clock = { now: 0 };
    let up: Timed[] = [];
    while (up.length === 0 && clock.now < 20000) up = feed(g, clock, 0.1, 16.7, null);
    expect(up[0]).toMatchObject({ kind: "budget", budget: L(5) });
    const back = feed(g, clock, 32, 24, null);
    expect(back).toHaveLength(1);
    expect(back[0]).toMatchObject({ kind: "budget", budget: L(4) });
    expect(back[0].at - up[0].at).toBeGreaterThanOrEqual(LIVE_CHANGE_GAP_MS);
    // and the next probe waits the long cooldown at least
    expect(budgets(feed(g, clock, UP_AFTER_DOWN_MS / 1000 - 5, 16.7, null))).toEqual([]);
  });

  it("calibrating at the floor, steps the tier from the frame clock alone", () => {
    const g = new Governor(range, 0.5);
    const d = feed(g, { now: 0 }, 3, 30, null, CALIBRATING);
    expect(kinds(d)).toContain("tier");
  });
});

describe("governor once the garden is showing (P1: nothing blinks)", () => {
  /**
   * Checks a run of live decisions: any two changes (budget or tier) are at
   * least the gap apart, undos included, with no exception; and nothing
   * steps up within the long cooldown after a step down, except to put back
   * pixels that step cut for nothing.
   */
  function expectCalm(d: Timed[], start: number) {
    for (let i = 1; i < d.length; i++) expect(d[i].at - d[i - 1].at).toBeGreaterThanOrEqual(LIVE_CHANGE_GAP_MS);
    const changes = budgets(d);
    const before = (i: number) => (i === 0 ? start : changes[i - 1].budget);
    let lastDown = -Infinity;
    changes.forEach((c, i) => {
      const putBack = i > 0 && c.budget === before(i - 1);
      if (c.budget < before(i)) lastDown = c.at;
      else if (!putBack) expect(c.at - lastDown).toBeGreaterThanOrEqual(UP_AFTER_DOWN_MS);
    });
    return changes;
  }

  it("never see-saws: slow and fast stretches in turn give at most one change per gap", () => {
    const patterns: Array<[number, number]> = [
      [0.75, 0.75],
      [3, 3],
      [5, 4],
      [12, 12],
      [20, 20],
    ];
    // slow under 45 fps (a busy GPU, or a quiet timer), and slow but over 45 fps
    const slows: Array<[number, number]> = [
      [30, 22],
      [30, 7],
      [24, 10],
      [20.5, 16],
      [20.5, 9],
    ];
    for (const [slowS, fastS] of patterns) {
      for (const [slowMs, slowGpu] of slows) {
        for (const timer of [true, false]) {
          for (const lowest of [false, true]) {
            const g = new Governor(range, L(5));
            const clock = { now: 0 };
            g.beginGrace(0, 6000);
            const ctx: SampleContext = { calibrating: false, lowest };
            const d: Timed[] = [];
            while (clock.now < 300000) {
              d.push(...feed(g, clock, slowS, slowMs, timer ? slowGpu : null, ctx, true));
              d.push(...feed(g, clock, fastS, 12, timer ? 5 : null, ctx, true));
            }
            const changes = expectCalm(d, L(5));
            expect(changes.length).toBeLessThanOrEqual(300000 / LIVE_CHANGE_GAP_MS);
            // stretches too short to prove anything change nothing at all
            if (slowS < LIVE_DOWN_AFTER_MS / 1000 && fastS < 10) expect(changes).toEqual([]);
          }
        }
      }
    }
  });

  /** A governor that has just stepped up a level from L(4) on comfortable frames, and when. */
  function probed(gpu: number | null) {
    const g = new Governor(range, L(4));
    const clock = { now: 0 };
    let up: Timed[] = [];
    while (up.length === 0 && clock.now < 30000) up = feed(g, clock, 0.1, 16.7, gpu === null ? null : 5);
    expect(up[0]).toMatchObject({ kind: "budget", budget: L(5) });
    return { g, clock, at: up[0].at };
  }

  it("puts back a step up that turns the frames slow three seconds later only once the gap is up", () => {
    for (const gpu of [null, 9]) {
      const { g, clock, at } = probed(gpu);
      // comfortable for three seconds, then slow (about 49 fps) for good
      const d = [...feed(g, clock, 3, 16.7, gpu === null ? null : 5), ...feed(g, clock, 40, 20.5, gpu)];
      const back = budgets(d);
      expect(back).toHaveLength(1);
      expect(back[0].budget).toBe(L(4));
      expect(back[0].at - at).toBeGreaterThanOrEqual(LIVE_CHANGE_GAP_MS);
    }
  });

  it("keeps a step up whose slow frames passed before the gap was up", () => {
    for (const gpu of [null, 9]) {
      const { g, clock } = probed(gpu);
      const easy = gpu === null ? null : 5;
      const d = [...feed(g, clock, 3, 16.7, easy), ...feed(g, clock, 4, 20.5, gpu), ...feed(g, clock, 40, 16.7, easy)];
      expect(budgets(d)).toEqual([]);
      expect(g.budget).toBe(L(5));
    }
  });

  it("puts back a step up that drops the frames under 45 fps only once the gap is up, and changes nothing else in that window", () => {
    // without a timer, with one that reads the GPU busy, or one that reads it quiet: no exception to the gap
    for (const gpu of [null, 15, 9]) {
      const { g, clock, at } = probed(gpu);
      // 38 fps three seconds after the step up, for good: two freezes five seconds apart would be the blink
      const d = [...feed(g, clock, 3, 16.7, gpu === null ? null : 5), ...feed(g, clock, 60, 26, gpu)];
      expect(d.length).toBeGreaterThanOrEqual(1);
      expect(d[0]).toMatchObject({ kind: "budget", budget: L(4) });
      expect(d[0].at - at).toBeGreaterThanOrEqual(LIVE_CHANGE_GAP_MS);
      expect(d[0].at - at).toBeLessThan(LIVE_CHANGE_GAP_MS + 2000);
      // whatever follows (a further step down, still slow) waits a whole gap after the undo
      for (let i = 1; i < d.length; i++) expect(d[i].at - d[i - 1].at).toBeGreaterThanOrEqual(LIVE_CHANGE_GAP_MS);
    }
  });

  it("keeps a step up that only costs a little (still comfortable at 50 fps or better)", () => {
    for (const gpu of [null, 8]) {
      const { g, clock } = probed(gpu);
      expect(budgets(feed(g, clock, 60, 19.2, gpu))).toEqual([]);
      expect(g.budget).toBe(L(5));
    }
  });

  it("counts a run of very long frames as slow instead of going blind, but not one long frame, a pause or start-up work", () => {
    const g = new Governor(range, L(5));
    const d = budgets(feed(g, { now: 0 }, 30, 150, null));
    expect(d[0].budget).toBeLessThan(L(5));

    const h = new Governor(range, L(5));
    const clock = { now: 0 };
    const out: Timed[] = [];
    for (let i = 0; i < 40; i++) {
      out.push(...feed(h, clock, 2, 16.7, null));
      for (const ms of [200, 3000]) {
        clock.now += ms;
        const x = h.sample(ms, null, clock.now, LIVE);
        if (x.kind !== "none") out.push({ ...x, at: clock.now });
      }
    }
    expect(budgets(out).filter((x) => x.budget < L(5))).toEqual([]);

    // under the veil a few long frames at a time are start-up work
    const v = new Governor(range, L(5));
    const vc = { now: 0 };
    const veiled: Timed[] = [];
    for (let i = 0; i < 10; i++) veiled.push(...feed(v, vc, 0.6, 150, null, CALIBRATING), ...feed(v, vc, 0.4, 16.7, 6, CALIBRATING));
    expect(kinds(veiled)).not.toContain("tier");
    expect(budgets(veiled).filter((x) => x.budget < L(5))).toEqual([]);
    // but seconds of them are the device at a crawl: the tier steps there, before the veil lifts (P1)
    const w = new Governor(range, L(5));
    const crawl = feed(w, { now: 0 }, 6, 150, null, CALIBRATING);
    expect(crawl[0]).toMatchObject({ kind: "tier", dir: -1 });
    expect(crawl[0].at).toBeLessThan(5000);
    // even when frames so slow form only a window or two before the veil's time is up: the veil waits for the step, then takes it
    const x = new Governor(range, 0.5);
    const xc = { now: 0 };
    expect(feed(x, xc, 2.5, 190, null, CALIBRATING)).toEqual([]);
    expect(x.wantsTier).toBe(true);
    expect(x.settleTier(false)).toMatchObject({ kind: "tier", dir: -1 });
    expect(x.settleTier(true)).toEqual({ kind: "none" });
  });

  it("under the veil, measures a garden crawling at 100-200 ms a frame with a quick one now and then, and steps its tier before the reveal", () => {
    // frames logged under the veil after the first draw, on a laptop sharing its GPU with a heavy page
    const logged = [35, 24, 25, 18, 14, 17, 17, 18, 135, 134, 155, 112, 103, 125, 100, 143, 64, 17, 16, 145, 206, 160, 162, 107, 93, 106, 127];
    const crawl = logged.slice(8);
    const g = new Governor(range, 0.5);
    const clock = { now: 0 };
    const out: Timed[] = [];
    // as the canvas does: up to 2.5 s, or 4 s while the governor wants a tier step, which it then takes
    for (let i = 0; clock.now < 4000; i++) {
      const ms = i < logged.length ? logged[i] : crawl[(i - logged.length) % crawl.length];
      clock.now += ms;
      const d = g.sample(ms, null, clock.now, CALIBRATING);
      if (d.kind !== "none") out.push({ ...d, at: clock.now });
      if (out.length || (clock.now > 2500 && !g.wantsTier)) break;
    }
    const step = out[0] ?? g.settleTier(false);
    expect(step).toMatchObject({ kind: "tier", dir: -1 });
  });

  it("never steps up, or down, while someone is touching the garden; it waits until they stop", () => {
    const touching: SampleContext = { calibrating: false, lowest: false, interacting: true };
    const g = new Governor(range, L(3));
    const clock = { now: 0 };
    expect(feed(g, clock, 120, 12, 4, touching)).toEqual([]);
    const after = budgets(feed(g, clock, 2, 12, 4));
    expect(after[0].budget).toBeGreaterThan(L(3));

    const h = new Governor(range, L(3));
    expect(feed(h, { now: 0 }, 120, 16.7, null, touching)).toEqual([]);

    const s = new Governor(range, L(5));
    const sc = { now: 0 };
    expect(feed(s, sc, 30, 30, 25, touching)).toEqual([]);
    const later = budgets(feed(s, sc, 2, 30, 25));
    expect(later[0].budget).toBeLessThan(L(5));
  });

  it("never opens on an undo: a pixel test the veil lifted on keeps its cut", () => {
    // on the lightest tier at its floor, a cut below it is tested; the veil lifts before the test is decided
    const g = new Governor(range, 0.5);
    const clock = { now: 0 };
    let cut: Decision = { kind: "none" };
    while (cut.kind === "none" && clock.now < 10000) cut = oneWindow(g, clock, 34, null, { calibrating: true, lowest: true });
    expect(cut).toMatchObject({ kind: "budget" });
    g.beginGrace(clock.now, 6000);
    const d = feed(g, clock, 20, 34, null, { calibrating: false, lowest: true });
    expect(budgets(d).filter((x) => x.budget > (cut as { budget: number }).budget)).toEqual([]);
  });

  it("counts a tier change in the gap like any other change", () => {
    const g = new Governor(range, 0.5);
    const clock = { now: 0 };
    g.beginGrace(0, 0);
    const d = feed(g, clock, 120, 30, 25);
    expect(d[0]).toMatchObject({ kind: "tier", dir: -1 });
    // the canvas applies it and resets the governor in the open
    g.reset(range, L(3), clock.now);
    const after = feed(g, clock, 120, 30, 25);
    expect(after[0].at - d[0].at).toBeGreaterThanOrEqual(LIVE_CHANGE_GAP_MS);
  });

  it("has no shadow-cadence rung: every decision is a budget level or a tier", () => {
    for (const lowest of [false, true]) {
      for (const gpu of [25, 6, null]) {
        const g = new Governor(range, 0.5);
        g.beginGrace(0, 0);
        const d = feed(g, { now: 0 }, 120, 30, gpu, { calibrating: false, lowest });
        for (const x of d) expect(["budget", "tier"]).toContain(x.kind);
        if (!lowest) expect(d[0]).toMatchObject({ kind: "tier", dir: -1 });
      }
    }
  });
});

/**
 * Frames on a vsynced panel of `hz` with no GPU timer (Safari on iPhone and
 * iPad, Firefox): each frame costs `work(budget)` ms and is shown at the next
 * refresh, so the interval is a whole number of refreshes.
 */
function onPanel(g: Governor, clock: { now: number }, seconds: number, hz: number, work: (budget: number) => number, ctx = LIVE) {
  const out: Timed[] = [];
  const vsync = 1000 / hz;
  const end = clock.now + seconds * 1000;
  while (clock.now < end) {
    const ms = Math.max(1, Math.ceil(work(g.budget) / vsync - 1e-6)) * vsync;
    clock.now += ms;
    const d = g.sample(ms, null, clock.now, ctx);
    if (d.kind !== "none") out.push({ ...d, at: clock.now });
  }
  return out;
}
/** A frame whose cost is mostly pixels: `base` ms plus `perMp` ms per megapixel of budget. */
const pixelBound = (base: number, perMp: number) => (b: number) => base + perMp * b;
/** A frame whose cost fewer pixels do not touch (the CPU, or a GPU busy with something else). */
const cpuBound = (ms: number) => () => ms;
const PHONE: SampleContext = { calibrating: false, lowest: true, highest: true };

/** A governor told the panel's rate, as the page measures it at startup, a moment after the reveal. */
function onScreen(hz: number, budget = L(5)) {
  const g = new Governor(range, budget);
  g.setRefresh(hz);
  g.beginGrace(0, 6000);
  return g;
}

describe("governor against the panel's own rate, without a GPU timer", () => {
  it("snaps a measured frame interval to a standard refresh rate", () => {
    expect(snapRefresh(16.7)).toBe(60);
    expect(snapRefresh(16.2)).toBe(60);
    expect(snapRefresh(8.33)).toBe(120);
    expect(snapRefresh(6.94)).toBe(144);
    expect(snapRefresh(11.1)).toBe(90);
    expect(snapRefresh(33.4)).toBe(30);
  });

  it("144 Hz laptop: a steady 48 fps (every third refresh) is comfortable, so nothing changes for ten minutes", () => {
    for (const ctx of [LIVE, { ...LIVE, lowest: true }]) {
      // pixels (fewer would reach 72 fps) or not: 48 fps is smooth enough either way, never worth a cut
      for (const work of [pixelBound(4, 10), cpuBound(15)]) {
        const g = onScreen(144);
        expect(onPanel(g, { now: 0 }, 600, 144, work, ctx)).toEqual([]);
        expect(g.budget).toBe(L(5));
      }
    }
    // the same with a GPU timer that reads quiet
    const t = onScreen(144);
    expect(feed(t, { now: 0 }, 600, 1000 / 48, 9)).toEqual([]);
  });

  it("144 Hz laptop: at 36 fps that fewer pixels do not help, one cut, the pixels back after the gap, then no more cuts", () => {
    const g = onScreen(144);
    const d = onPanel(g, { now: 0 }, 600, 144, cpuBound(26), { ...LIVE, lowest: true });
    expect(d.map((x) => x.kind === "budget" && x.budget)).toEqual([L(4), L(5)]);
    expect(d[1].at - d[0].at).toBeGreaterThanOrEqual(LIVE_CHANGE_GAP_MS);
    expect(g.budget).toBe(L(5));
    // with a lighter tier left, that is what it asks for next, a gap after the pixels went back
    const h = onScreen(144);
    const e = onPanel(h, { now: 0 }, 120, 144, cpuBound(26));
    expect(kinds(e.slice(0, 3))).toEqual(["budget", "budget", "tier"]);
    expect(e[2].at - e[1].at).toBeGreaterThanOrEqual(LIVE_CHANGE_GAP_MS);
  });

  it("144 Hz laptop: at 36 fps where pixels are the cost, steps down once and keeps the level that holds 48", () => {
    const g = onScreen(144);
    const d = onPanel(g, { now: 0 }, 600, 144, pixelBound(2, 20), { ...LIVE, lowest: true });
    expect(budgets(d).map((x) => x.budget)).toEqual([L(4)]);
  });

  it("144 Hz laptop: climbs from 72 fps a level at a time, and backs off a level that drops it to 48", () => {
    // 72 fps (every second refresh) up to L(5); L(6) costs 15.3 ms, which lands on every third refresh (48 fps)
    const g = onScreen(144, L(3));
    const d = onPanel(g, { now: 0 }, 900, 144, pixelBound(1, 10), { ...LIVE, lowest: true });
    for (let i = 1; i < d.length; i++) expect(d[i].at - d[i - 1].at).toBeGreaterThanOrEqual(LIVE_CHANGE_GAP_MS);
    const ups = budgets(d).filter((x) => x.budget === L(6)).map((x) => x.at);
    expect(budgets(d)[0].budget).toBe(L(4));
    // a few probes of L(6) in a quarter of an hour, further and further apart, each undone
    expect(ups.length).toBeGreaterThanOrEqual(1);
    expect(ups.length).toBeLessThanOrEqual(3);
    for (let i = 2; i < ups.length; i++) expect(ups[i] - ups[i - 1]).toBeGreaterThan(ups[i - 1] - ups[i - 2]);
    expect(g.budget).toBe(L(5));
  });

  it("60 Hz iPhone: holding 60 fps it climbs carefully, and a probe that halves the frame rate goes back after the gap", () => {
    // L(3) to L(5) hold 60; L(6) needs 18.3 ms and drops to 30 fps
    const g = onScreen(60, L(3));
    const d = onPanel(g, { now: 0 }, 900, 60, pixelBound(4, 10), PHONE);
    for (let i = 1; i < d.length; i++) expect(d[i].at - d[i - 1].at).toBeGreaterThanOrEqual(LIVE_CHANGE_GAP_MS);
    const b = budgets(d);
    expect(b.slice(0, 2).map((x) => x.budget)).toEqual([L(4), L(5)]);
    // every probe of L(6) is undone, a gap later, and there are only a few of them
    const probes = b.filter((x) => x.budget === L(6));
    expect(probes.length).toBeGreaterThanOrEqual(1);
    expect(probes.length).toBeLessThanOrEqual(3);
    for (const p of probes) {
      const undo = b.find((x) => x.at > p.at);
      expect(undo?.budget).toBe(L(5));
      expect(undo!.at - p.at).toBeGreaterThanOrEqual(LIVE_CHANGE_GAP_MS);
    }
    expect(g.budget).toBe(L(5));
  });

  it("60 Hz iPhone: at 30 fps that fewer pixels do not help, one cut and the pixels back, never down to the last resort", () => {
    // 30 fps is far too slow, so the one cut is two levels; then ten minutes without another
    const g = onScreen(60);
    const d = onPanel(g, { now: 0 }, 600, 60, cpuBound(20), PHONE);
    expect(budgets(d).map((x) => x.budget)).toEqual([L(3), L(5)]);
    expect(d[1].at - d[0].at).toBeGreaterThanOrEqual(LIVE_CHANGE_GAP_MS);
    expect(g.budget).toBe(L(5));
  });

  it("60 Hz iPhone: a hitch now and then does not make a cut that bought nothing look as if it helped", () => {
    // 30 fps that pixels do not touch, with a 110 ms hitch every 2.5 seconds
    const g = onScreen(60);
    const clock = { now: 0 };
    const d: Timed[] = [];
    for (let n = 0; clock.now < 300000; n++) {
      const ms = n % 75 === 74 ? 110 : 1000 / 30;
      clock.now += ms;
      const x = g.sample(ms, null, clock.now, PHONE);
      if (x.kind !== "none") d.push({ ...x, at: clock.now });
    }
    expect(budgets(d).map((x) => x.budget)).toEqual([L(3), L(5)]);
  });

  it("60 Hz iPhone: at 30 fps where pixels are the cost, steps down to where it holds 60, and probes back up only rarely", () => {
    // 20.9 ms at L(5) shows at 30 fps; L(3) costs 14 ms and holds 60, L(4) costs 17 ms and does not
    const g = onScreen(60);
    const d = onPanel(g, { now: 0 }, 600, 60, pixelBound(4, 15.4), PHONE);
    for (let i = 1; i < d.length; i++) expect(d[i].at - d[i - 1].at).toBeGreaterThanOrEqual(LIVE_CHANGE_GAP_MS);
    const b = budgets(d).map((x) => x.budget);
    expect(b[0]).toBe(L(3));
    expect(b.filter((x) => x === L(4)).length).toBeLessThanOrEqual(3);
    expect(g.budget).toBe(L(3));
  });

  it("120 Hz iPad: 60 fps (every second refresh) is comfortable; at 40 fps where pixels are the cost it steps down to 60 and stays", () => {
    // 60 fps is never cut (with pixels free, it may even climb)
    const g = onScreen(120);
    expect(budgets(onPanel(g, { now: 0 }, 300, 120, cpuBound(12), PHONE)).filter((x) => x.budget < L(5))).toEqual([]);
    // 19.5 ms at L(5) shows every third refresh (40 fps); L(4) costs 15.7 ms and shows at 60
    const h = onScreen(120);
    const d = onPanel(h, { now: 0 }, 900, 120, pixelBound(3, 15), PHONE);
    for (let i = 1; i < d.length; i++) expect(d[i].at - d[i - 1].at).toBeGreaterThanOrEqual(LIVE_CHANGE_GAP_MS);
    expect(budgets(d)[0].budget).toBe(L(4));
    // careful climbing back: at most a few probes in a quarter of an hour, each undone
    expect(budgets(d).filter((x) => x.budget === L(5)).length).toBeLessThanOrEqual(3);
    expect(h.budget).toBe(L(4));
  });

  it("30 Hz Low Power Mode iPhone: a steady 30 fps is all the panel gives, so it is not slow", () => {
    const g = onScreen(30);
    expect(budgets(onPanel(g, { now: 0 }, 300, 30, cpuBound(20), PHONE)).filter((x) => x.budget < L(5))).toEqual([]);
    expect(g.budget).toBeGreaterThanOrEqual(L(5));
    // told 60 Hz, the same frames would read as far too slow
    const h = onScreen(60);
    expect(budgets(onPanel(h, { now: 0 }, 60, 30, cpuBound(20), PHONE))[0].budget).toBeLessThan(L(5));
  });

  it("corrects a panel measured too slow from its own frames, which never come quicker than it refreshes", () => {
    const g = onScreen(30);
    onPanel(g, { now: 0 }, 5, 60, cpuBound(8), PHONE);
    expect(g.refreshHz).toBe(60);
    const h = onScreen(60);
    onPanel(h, { now: 0 }, 5, 144, cpuBound(5), PHONE);
    expect(h.refreshHz).toBe(144);
    // a slow garden never lowers it
    const s = onScreen(60);
    onPanel(s, { now: 0 }, 5, 60, cpuBound(30), PHONE);
    expect(s.refreshHz).toBe(60);
  });
});

/** A seeded random source, so a jittered cadence is the same on every run. */
function seeded(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}
/** 60 Hz frames that each miss a refresh (shown at 30 fps) with chance `p`: 48 fps on average at a quarter. */
const drops = (p: number) => (r: () => number) => (r() < p ? 2 : 1) * (1000 / 60);
/** Drops in runs (a garbage collection, the compositor), at the same average rate. */
const bursts = (p: number) => {
  let on = false;
  return (r: () => number) => {
    if (on) on = r() >= 0.25;
    else on = r() < (p / (1 - p)) * 0.25;
    return (on ? 2 : 1) * (1000 / 60);
  };
};
/** A frame costing `ms` give or take three, shown at the next refresh of a `hz` panel. */
const costly = (hz: number, ms: number) => (r: () => number) => {
  const x = ms + 6 * (r() + r() + r() - 1.5);
  return Math.max(1, Math.ceil(x / (1000 / hz))) * (1000 / hz);
};
/** Feeds a jittered cadence for `seconds` and returns every decision that was not "none". */
function jitter(g: Governor, clock: { now: number }, seconds: number, frame: (r: () => number) => number, r: () => number, ctx = PHONE) {
  const out: Timed[] = [];
  const end = clock.now + seconds * 1000;
  while (clock.now < end) {
    const ms = frame(r);
    clock.now += ms;
    const d = g.sample(ms, null, clock.now, ctx);
    if (d.kind !== "none") out.push({ ...d, at: clock.now });
  }
  return out;
}

describe("governor with jittered frames and no GPU timer (P1: no cut that buys nothing)", () => {
  it("60 Hz iPhone or iPad: 48-49 fps made of one- and two-refresh frames is never cut in ten minutes", () => {
    for (const p of [0.22, 0.25]) {
      for (let seed = 1; seed <= 10; seed++) {
        const g = onScreen(60);
        expect(budgets(jitter(g, { now: 0 }, 600, drops(p), seeded(seed))).filter((x) => x.budget < L(5))).toEqual([]);
      }
    }
  });

  it("60 Hz: drops in runs at 50 fps on average are never cut either", () => {
    for (let seed = 1; seed <= 10; seed++) {
      const g = onScreen(60);
      expect(budgets(jitter(g, { now: 0 }, 600, bursts(0.2), seeded(seed))).filter((x) => x.budget < L(5))).toEqual([]);
    }
  });

  it("120 Hz iPad and 144 Hz laptop: a frame cost wandering about 48 fps is never cut", () => {
    for (const [hz, ms] of [
      [120, 16.5],
      [144, 17],
    ]) {
      for (let seed = 1; seed <= 10; seed++) {
        const g = onScreen(hz);
        expect(budgets(jitter(g, { now: 0 }, 600, costly(hz, ms), seeded(seed))).filter((x) => x.budget < L(5))).toEqual([]);
      }
    }
  });

  it("but a noisy cadence that really is slow (about 43 fps) is still cut, within half a minute of the grace", () => {
    for (let seed = 1; seed <= 10; seed++) {
      const g = onScreen(60);
      const d = budgets(jitter(g, { now: 0 }, 60, drops(0.4), seeded(seed)));
      expect(d[0].budget).toBeLessThan(L(5));
      expect(d[0].at).toBeLessThan(6000 + 30000);
    }
  });

  it("the reveal's start-up frames start no clock: a slow first six seconds, then a steady 48, changes nothing", () => {
    // what a capped 48 fps garden drew in the seconds after its reveal, then every third refresh of a 144 Hz panel
    for (const hz of [144, 60]) {
      const g = onScreen(hz);
      const clock = { now: 0 };
      const d: Timed[] = [];
      for (const fps of [27, 42, 45, 44, 43, 36]) d.push(...feed(g, clock, 1, 1000 / fps, null, PHONE));
      d.push(...(hz === 144 ? feed(g, clock, 120, 3000 / 144, null, PHONE) : jitter(g, clock, 120, drops(0.25), seeded(7))));
      expect(budgets(d)).toEqual([]);
    }
    // and seven seconds at 40 fps across the end of the grace, then 50 fps
    const h = onScreen(60);
    const clock = { now: 0 };
    expect([...feed(h, clock, 9, 25, null, PHONE), ...feed(h, clock, 120, 20, null, PHONE)]).toEqual([]);
  });

  it("the grace lasts until the frames settle, but never more than twice as long", () => {
    // frames still falling away in steps after the grace: no clock starts until they agree
    const g = onScreen(60);
    const clock = { now: 0 };
    const d: Timed[] = [];
    for (const ms of [40, 34, 29, 25, 22, 20, 18, 16.7]) d.push(...feed(g, clock, 1.5, ms, null, PHONE));
    d.push(...feed(g, clock, 60, 16.7, null, PHONE));
    expect(budgets(d).filter((x) => x.budget < L(5))).toEqual([]);
    // a device that never settles is judged from twice the grace on
    const h = onScreen(60);
    const hc = { now: 0 };
    const e: Timed[] = [];
    while (hc.now < 40000) e.push(...feed(h, hc, 0.75, 28, null, PHONE), ...feed(h, hc, 0.75, 40, null, PHONE));
    expect(budgets(e)[0].at).toBeGreaterThanOrEqual(12000 + LIVE_DOWN_AFTER_MS);
  });
});

describe("tiers once the garden is showing", () => {
  it("never climbs a tier in the open: room for the next one is only noted, for the next visit", () => {
    // lite after a veiled step down, at its ceiling, the GPU timer far under target
    const g = new Governor(range, range.ceiling);
    g.slowTierUp();
    g.beginGrace(0, 6000);
    const d = feed(g, { now: 0 }, 300, 1000 / 72, 4);
    expect(kinds(d)).not.toContain("tier");
    expect(g.roomAbove).toBe(true);
    // nothing to note on the highest tier, nor without a timer to vouch for the room
    const h = new Governor(range, range.ceiling);
    feed(h, { now: 0 }, 300, 1000 / 72, 4, { calibrating: false, lowest: false, highest: true });
    expect(h.roomAbove).toBe(false);
    const n = new Governor(range, range.ceiling);
    feed(n, { now: 0 }, 300, 1000 / 72, null);
    expect(n.roomAbove).toBe(false);
  });

  it("forgets that room after a step down", () => {
    const g = new Governor(range, range.ceiling);
    const clock = { now: 0 };
    feed(g, clock, 60, 1000 / 72, 4);
    expect(g.roomAbove).toBe(true);
    feed(g, clock, 40, 30, 25);
    expect(g.budget).toBeLessThan(range.ceiling);
    expect(g.roomAbove).toBe(false);
  });
});

describe("the render budget store", () => {
  it("keeps a budget below the floor at its pixel ratio when the window shrinks", () => {
    const laptop: Device = device({ kind: "laptop", dpr: 1 });
    const r = budgetFor("laptop", "lite", 1440, 900, 1);
    const below = budgetLevels(r).filter((l) => l < r.floor).at(-1)!;
    quality.set({ device: laptop, tier: "lite", css: [1440, 900], range: r, budget: below });
    const dpr = quality.get().dpr;
    expect(dpr).toBeLessThan(0.85);
    quality.setCss(1152, 810);
    expect(quality.get().budget).toBeLessThan(quality.get().range.floor);
    expect(quality.get().dpr).toBe(dpr);
    // and back
    quality.setCss(1440, 900);
    expect(quality.get().budget).toBeCloseTo(below, 6);
    // a budget at the floor stays at the floor
    quality.set({ budget: r.floor });
    quality.setCss(1152, 810);
    expect(quality.get().budget).toBeCloseTo(quality.get().range.floor, 6);
  });

  it("believes a 30 Hz panel only when two readings agree, otherwise counts it as 60 Hz", () => {
    expect(settleRefresh(30, 30)).toBe(30);
    expect(settleRefresh(30, 60)).toBe(60);
    expect(settleRefresh(30, 120)).toBe(120);
    expect(settleRefresh(30, 72)).toBe(72);
  });

  it("never takes the panel for slower than frames already seen prove it", () => {
    const g = onScreen(60);
    onPanel(g, { now: 0 }, 5, 60, cpuBound(8), PHONE);
    g.setRefresh(30);
    expect(g.refreshHz).toBe(60);
  });
});

describe("the remembered tier", () => {
  /** device.ts with fresh module state, as on a new visit; `store` is the browser storage that carries over between visits. */
  async function visit(store: Map<string, string>) {
    vi.resetModules();
    vi.stubGlobal("window", {
      localStorage: {
        getItem: (k: string) => store.get(k) ?? null,
        setItem: (k: string, v: string) => void store.set(k, v),
      },
    });
    return import("./device");
  }

  it("opens the next visit one tier up once room was found, but tries that climb at most once a week", async () => {
    const store = new Map<string, string>();
    const d = device({ gpuClass: "mid" });
    // visit 1 settled on lite and found room for balanced: the next visit opens on balanced
    let dev = await visit(store);
    dev.rememberTier(d, "lite");
    dev.rememberTier(d, "lite", "balanced");
    dev.rememberTier(d, "lite", "balanced");
    expect(dev.recallTier(d, "balanced")).toBe("balanced");
    // visit 2 stepped back down to lite under the veil, then found room again: it stays on lite this week
    dev = await visit(store);
    dev.rememberTier(d, "lite");
    dev.rememberTier(d, "lite", "balanced");
    expect(dev.recallTier(d, "balanced")).toBe("lite");
    // a week on, it may try again
    const s = JSON.parse(store.get("garden-tier:v1")!);
    store.set("garden-tier:v1", JSON.stringify({ ...s, climbedAt: Date.now() - 8 * 24 * 3600 * 1000 }));
    dev = await visit(store);
    dev.rememberTier(d, "lite", "balanced");
    expect(dev.recallTier(d, "balanced")).toBe("balanced");
    vi.unstubAllGlobals();
  });
});
