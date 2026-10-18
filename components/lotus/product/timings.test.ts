// The courtyard's moments as timings (product/timings.ts): the pour's beats and its level waiting for the water, the
// spill's threshold and its drying, the pellets, the planting's glide, and that the planting plays once per plant on a
// device, only fresh.
import { describe, expect, it } from "vitest";
import { claimGlide, GLIDE, GLIDE_KEY, glideState, PELLETS, pelletLeft, POUR, pourLevel, pourPose, since, spills, spillWet, type Memo } from "@/components/lotus/product/timings";

const memo = (): Memo & { data: Record<string, string> } => {
  const data: Record<string, string> = {};
  return { data, getItem: (k) => data[k] ?? null, setItem: (k, v) => void (data[k] = v) };
};

describe("the pour", () => {
  it("lifts, tips over the coping, pours, and is set back on its step", () => {
    expect(pourPose(-1)).toEqual({ tilt: 0, lift: 0, flow: 0 });
    expect(pourPose(0.3).tilt).toBeGreaterThan(0);
    expect(pourPose(0.3).flow).toBe(0);
    const pouring = pourPose((POUR.flowFrom + POUR.flowTo) / 2);
    expect(pouring.flow).toBe(1);
    expect(pouring.tilt).toBeGreaterThan(0.9);
    expect(pourPose(POUR.back)).toEqual({ tilt: 0, lift: 0, flow: 0 });
  });

  it("holds the drawn level until the water reaches the pond, then lets it rise", () => {
    expect(pourLevel(0.5, -8, 3.5)).toBe(-8);
    expect(pourLevel((POUR.flowFrom + POUR.flowTo) / 2, -8, 3.5)).toBeCloseTo(-2.25, 6);
    expect(pourLevel(POUR.flowTo, -8, 3.5)).toBe(3.5);
    expect(pourLevel(-1, -8, 3.5)).toBe(3.5);
  });

  it("spills only when the bucket brought the pond to its notch, and the wet stone dries", () => {
    expect(spills(20)).toBe(true);
    expect(spills(11.5)).toBe(false);
    expect(spillWet(POUR.flowTo + 1.2).spread).toBeCloseTo(1, 6);
    expect(spillWet(POUR.flowTo + 40).wet).toBe(0);
  });
});

describe("the pinch's pellets", () => {
  it("land, float, and are all taken within about half a minute", () => {
    expect(pelletLeft(0, -1)).toBe(0);
    expect(pelletLeft(0, 2)).toBe(1);
    for (let i = 0; i < PELLETS.count; i++) expect(pelletLeft(i, PELLETS.lastTaken + 1)).toBe(0);
  });
});

describe("the planting", () => {
  it("glides, sinks, lets the plant show from the landing, and fades the jar", () => {
    const start = glideState(0)!;
    expect(start.along).toBe(0);
    expect(start.plant).toBe(false);
    expect(start.jar).toBe(1);
    expect(glideState(GLIDE.arrive)!.along).toBe(1);
    expect(glideState(GLIDE.plantShows)!.plant).toBe(true);
    expect(glideState(GLIDE.jarGone)!.jar).toBe(0);
    expect(glideState(GLIDE.fade)).toBeNull();
  });

  it("plays once per plant on a device, only right after the press", () => {
    const m = memo();
    const press = 1_000_000;
    expect(claimGlide("asha", press, press + 500, m)).toBe(true);
    expect(claimGlide("asha", press, press + 900, m)).toBe(false);
    expect(JSON.parse(m.data[GLIDE_KEY]).asha).toBe(press);
    // a reload long after the press, with the planting still pending, does not replay it
    expect(claimGlide("ravi", press, press + 60_000, m)).toBe(false);
    // storage that fails lets it play
    const broken: Memo = { getItem: () => { throw new Error("blocked"); }, setItem: () => { throw new Error("blocked"); } };
    expect(claimGlide("asha", press, press + 100, broken)).toBe(true);
    expect(since(0, press)).toBe(-1);
  });
});
