// The render budget's pure parts: the device plan, the pixel ratio a budget
// buys and its floors, the few budget levels the canvas is drawn at, and the
// governor's decisions as frames come in, calibrating under the veil and live
// once the garden is showing (where nothing may blink: rare, calm changes).
import { describe, expect, it } from "vitest";
import { budgetFor, classifyGpu, dprForBudget, planFor, type Device, type PixelBudget } from "./device";
import {
  budgetLevels,
  Governor,
  LIVE_CHANGE_GAP_MS,
  LIVE_DOWN_AFTER_MS,
  stepTier,
  SUSTAINED_FOR_MS,
  SUSTAINED_SLOW_MS,
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
/** How long a step up is on trial (quality.ts PROBE_TRIAL_MS). */
const PROBE_TRIAL_S = 6;
const CALIBRATING: SampleContext = { calibrating: true, lowest: false };

/** Feeds `seconds` of identical frames and returns every decision that was not "none", with when it came. */
function feed(g: Governor, clock: { now: number }, seconds: number, frameMs: number, gpuMs: number | null, ctx = LIVE) {
  const out: Array<Decision & { at: number }> = [];
  const end = clock.now + seconds * 1000;
  while (clock.now < end) {
    clock.now += frameMs;
    const d = g.sample(frameMs, gpuMs, clock.now, ctx);
    if (d.kind !== "none") out.push({ ...d, at: clock.now });
  }
  return out;
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
    while (first.length === 0 && clock.now < 3000) first = feed(g, clock, 0.05, 21, 8, CALIBRATING);
    expect(first[0]).toMatchObject({ kind: "budget", budget: L(5) });
    // the smaller budget helped: the timer under-reads this device, so it never climbs back to where it was slow
    feed(g, clock, 30, 16.7, 6.5, CALIBRATING);
    expect(g.budget).toBeLessThan(L(6));
  });

  it("calibrating, puts the pixels back at once when a level down did not help: then it really is the CPU (P4)", () => {
    const g = new Governor(range, L(6));
    const d = feed(g, { now: 0 }, 6, 21, 8, CALIBRATING);
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

  it("calibrating, raises the budget only when the frame clock is comfortable too (P4)", () => {
    const g = new Governor(range, 1);
    feed(g, { now: 0 }, 3, 18.5, 6, CALIBRATING);
    expect(g.budget).toBeLessThanOrEqual(1);
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

  it("probes a level up after a comfortable stretch and steps straight back when the probe drops it under 45 fps", () => {
    const g = new Governor(range, L(4));
    const clock = { now: 0 };
    let up: Decision[] = [];
    while (up.length === 0 && clock.now < 20000) up = feed(g, clock, 0.1, 16.7, null);
    expect(up[0]).toMatchObject({ kind: "budget", budget: L(5) });
    const back = feed(g, clock, 4, 24, null);
    expect(back[0]).toMatchObject({ kind: "budget", budget: L(4) });
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
   * Checks a run of live decisions: two budget changes are at least the gap
   * apart, unless the slow frames were under 45 fps (`under45`) and the
   * second puts a step up straight back, the one deliberate exception; and
   * nothing steps up within the long cooldown after a step down, except to
   * put back pixels that step cut for nothing.
   */
  function expectCalm(d: Timed[], start: number, under45: boolean) {
    const changes = budgets(d);
    const before = (i: number) => (i === 0 ? start : changes[i - 1].budget);
    let lastDown = -Infinity;
    changes.forEach((c, i) => {
      const putBack = i > 0 && c.budget === before(i - 1);
      if (i > 0) {
        const prev = changes[i - 1];
        const undo = under45 && putBack && prev.budget > before(i - 1);
        if (!undo) expect(c.at - prev.at).toBeGreaterThanOrEqual(LIVE_CHANGE_GAP_MS);
      }
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
              d.push(...feed(g, clock, slowS, slowMs, timer ? slowGpu : null, ctx));
              d.push(...feed(g, clock, fastS, 12, timer ? 5 : null, ctx));
            }
            const changes = expectCalm(d, L(5), slowMs > SUSTAINED_SLOW_MS);
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

  it("deliberately puts back at once a step up that drops the frames under 45 fps during its trial", () => {
    // without a timer, or with one that reads the GPU busy: the one exception to the gap
    for (const gpu of [null, 15]) {
      const { g, clock, at } = probed(gpu);
      // 38 fps three seconds after the step up
      const d = [...feed(g, clock, 3, 16.7, gpu === null ? null : 5), ...feed(g, clock, 20, 26, gpu)];
      const back = budgets(d);
      expect(back).toHaveLength(1);
      expect(back[0].budget).toBe(L(4));
      expect(back[0].at - at).toBeLessThan(PROBE_TRIAL_S * 1000 + 1000);
    }
    // a timer that reads the GPU quiet says the extra pixels are not the cost: the gap holds
    const { g, clock, at } = probed(9);
    const back = budgets([...feed(g, clock, 3, 16.7, 5), ...feed(g, clock, 40, 26, 9)]);
    expect(back[0].budget).toBe(L(4));
    expect(back[0].at - at).toBeGreaterThanOrEqual(LIVE_CHANGE_GAP_MS);
  });

  it("counts a run of very long frames as slow instead of going blind, but not one long frame, a pause or the veil", () => {
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

    const v = new Governor(range, L(5));
    expect(feed(v, { now: 0 }, 6, 150, null, CALIBRATING)).toEqual([]);
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
