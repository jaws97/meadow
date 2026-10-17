// The render budget's pure parts: the device plan, the pixel ratio a budget
// buys and its floors, and the governor's decisions as frames come in.
import { describe, expect, it } from "vitest";
import { budgetFor, classifyGpu, dprForBudget, planFor, type Device, type PixelBudget } from "./device";
import { Governor, stepTier, type Decision, type SampleContext } from "./quality";

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

describe("governor with a GPU timer", () => {
  it("lowers the budget in proportion when the GPU is over target", () => {
    const g = new Governor(range, 1);
    const d = feed(g, { now: 0 }, 3, 25, 20);
    expect(d[0]).toMatchObject({ kind: "budget", budget: expect.closeTo(0.68, 1) });
    expect(g.budget).toBeLessThan(1);
  });

  it("raises it after a sustained stretch of headroom, and not past the ceiling", () => {
    const g = new Governor(range, 1);
    feed(g, { now: 0 }, 30, 7, 4);
    expect(g.budget).toBe(2);
  });

  it("never cuts pixels below the floor while a lighter tier is left", () => {
    const g = new Governor(range, 0.6);
    feed(g, { now: 0 }, 20, 30, 25);
    expect(g.budget).toBeGreaterThanOrEqual(0.5);
  });

  it("live at the floor: the shadow rung after the grace period, a tier only after eight seconds under 45 fps", () => {
    const g = new Governor(range, 0.5);
    const clock = { now: 0 };
    g.beginGrace(0, 6000);
    expect(feed(g, clock, 5.5, 30, 25)).toEqual([]);
    const after = feed(g, clock, 12, 30, 25);
    expect(after[0]).toMatchObject({ kind: "shadows", every: 2 });
    const tier = after.find((x) => x.kind === "tier");
    expect(tier).toMatchObject({ dir: -1 });
    expect(tier!.at).toBeGreaterThanOrEqual(8000);
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

  it("tests slow frames under a quiet timer with a smaller budget, and keeps it when the frames speed up (P4)", () => {
    const g = new Governor(range, 1.2);
    const clock = { now: 0 };
    const first = feed(g, clock, 1.6, 21, 8);
    expect(first[0]).toMatchObject({ kind: "budget", budget: expect.closeTo(1.02, 2) });
    // the smaller budget helped: the timer under-reads this device, so it never climbs back to where it was slow
    feed(g, clock, 30, 16.7, 6.5);
    expect(g.budget).toBeLessThan(1.2);
  });

  it("puts the pixels back when a smaller budget did not help: then it really is the CPU (P4)", () => {
    const g = new Governor(range, 1.2);
    const clock = { now: 0 };
    const d = feed(g, clock, 6, 21, 8);
    expect(d[0]).toMatchObject({ kind: "budget", budget: expect.closeTo(1.02, 2) });
    expect(d[1]).toMatchObject({ kind: "budget", budget: expect.closeTo(1.2, 2) });
  });

  it("on the lightest tier and CPU-bound, does not sink to the last resort for nothing", () => {
    const g = new Governor(range, 0.5);
    const clock = { now: 0 };
    g.beginGrace(0, 0);
    feed(g, clock, 30, 34, 6, { calibrating: false, lowest: true });
    expect(g.budget).toBeGreaterThanOrEqual(0.5 * 0.85 - 1e-9);
  });

  it("calibrating, raises the budget only when the frame clock is comfortable too (P4)", () => {
    const g = new Governor(range, 1);
    feed(g, { now: 0 }, 3, 18.5, 6, CALIBRATING);
    expect(g.budget).toBeLessThanOrEqual(1);
  });
});

describe("governor without a GPU timer", () => {
  it("steps down on slow frames", () => {
    const g = new Governor(range, 1);
    const d = feed(g, { now: 0 }, 4, 28, null);
    expect(d[0]).toMatchObject({ kind: "budget", budget: 0.8 });
  });

  it("probes upward after a comfortable stretch and steps back when the probe costs frames", () => {
    const g = new Governor(range, 1);
    const clock = { now: 0 };
    let up: Decision[] = [];
    while (up.length === 0 && clock.now < 20000) up = feed(g, clock, 0.1, 16.7, null);
    expect(up[0]).toMatchObject({ kind: "budget", budget: expect.closeTo(1.12, 2) });
    const back = feed(g, clock, 4, 24, null);
    expect(back[0]).toMatchObject({ kind: "budget", budget: 1 });
  });

  it("calibrating at the floor, steps the tier from the frame clock alone", () => {
    const g = new Governor(range, 0.5);
    const d = feed(g, { now: 0 }, 3, 30, null, CALIBRATING);
    expect(kinds(d)).toContain("tier");
  });
});
