import { describe, expect, it } from "vitest";
import { advanceFades, chooseNear, FADE_SECONDS, nearRange, screenHeight, type LevelOptions } from "@/components/meadow/lod/levels";

const OPTS: LevelOptions = { enterPx: 90, leavePx: 75, maxNear: 3 };

function run(px: number[], near: number[], opts = OPTS, inView = px.map(() => 1)): number[] {
  const n = new Uint8Array(near);
  chooseNear(Float32Array.from(px), Uint8Array.from(inView), n, px.length, opts, { order: [] });
  return Array.from(n);
}

describe("chooseNear", () => {
  it("brings a plant near only past enterPx", () => {
    expect(run([89, 90, 120], [0, 0, 0])).toEqual([0, 1, 1]);
  });

  it("keeps a near plant until it is shorter than leavePx (no flicker at the boundary)", () => {
    expect(run([80, 76, 74.9], [1, 1, 1])).toEqual([1, 1, 0]);
    // the same heights do not bring a far plant near
    expect(run([80, 76, 74.9], [0, 0, 0])).toEqual([0, 0, 0]);
  });

  it("caps the near plants, tallest first", () => {
    expect(run([100, 200, 150, 120, 95], [0, 0, 0, 0, 0])).toEqual([0, 1, 1, 1, 0]);
  });

  it("lets a near plant hold its place against a newcomer of about its size", () => {
    // 100 is near; 110 is new and only 10% taller, so it waits
    expect(run([300, 200, 100, 110], [1, 1, 1, 0])).toEqual([1, 1, 1, 0]);
    // a much taller newcomer takes the place
    expect(run([300, 200, 100, 180], [1, 1, 1, 0])).toEqual([1, 1, 0, 1]);
  });

  it("sends plants well out of view (0 px) back to pictures", () => {
    expect(run([0, 0], [1, 1])).toEqual([0, 0]);
  });

  it("brings a plant near only in view, but keeps a near one just out of view (no flicker at the frame's edge)", () => {
    expect(run([120, 120], [0, 1], OPTS, [0, 0])).toEqual([0, 1]);
  });

  it("gives the near places to plants in view first", () => {
    // four contenders for three places: the one out of view yields to a shorter one in view
    expect(run([200, 150, 120, 130], [1, 1, 1, 0], OPTS, [0, 1, 1, 1])).toEqual([0, 1, 1, 1]);
  });
});

describe("nearRange", () => {
  it("splits a plant's steps between its picture, its light plant and the full plant, covering them once", () => {
    expect(nearRange(0, 0)).toEqual([0, 0]);
    expect(nearRange(1, 0)).toEqual([0, 1]);
    expect(nearRange(0.5, 0)).toEqual([0, 0.5]);
    // a visited plant halfway through its handover: the full plant below 0.5, the light plant above
    expect(nearRange(1, 0.5)).toEqual([0.5, 1]);
    // ...and a visited plant still far off: the full plant below 0.25, the picture above
    expect(nearRange(0, 0.25)).toEqual([0.25, 0.25]);
    expect(nearRange(1, 1)).toEqual([1, 1]);
  });
});

describe("advanceFades", () => {
  it("dissolves toward the level over FADE_SECONDS and stops there", () => {
    const fade = new Float32Array([0, 1]);
    const near = new Uint8Array([1, 0]);
    const ready = new Uint8Array([1, 1]);
    expect(advanceFades(fade, near, ready, 2, FADE_SECONDS / 2)).toBe(true);
    expect(fade[0]).toBeCloseTo(0.5);
    expect(fade[1]).toBeCloseTo(0.5);
    advanceFades(fade, near, ready, 2, FADE_SECONDS);
    expect(Array.from(fade)).toEqual([1, 0]);
    expect(advanceFades(fade, near, ready, 2, 0.1)).toBe(false);
  });

  it("holds a plant at its picture until its light plant is built", () => {
    const fade = new Float32Array([0]);
    expect(advanceFades(fade, new Uint8Array([1]), new Uint8Array([0]), 1, 1)).toBe(false);
    expect(fade[0]).toBe(0);
  });

  it("never jumps on a long frame", () => {
    const fade = new Float32Array([0.2]);
    advanceFades(fade, new Uint8Array([1]), new Uint8Array([1]), 1, 10);
    expect(fade[0]).toBe(1);
  });
});

describe("screenHeight", () => {
  it("scales with distance and the focal length", () => {
    expect(screenHeight(1, 10, 1000)).toBe(100);
    expect(screenHeight(1, 20, 1000)).toBe(50);
    expect(screenHeight(1, 0, 1000)).toBe(0);
  });
});
