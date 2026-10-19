import { describe, expect, it } from "vitest";
import { brownNoise, BROWN_RMS, hz } from "@/lib/sound/engine-synth";
import { Rng } from "@/lib/plant/prng";

describe("brown noise", () => {
  it("has the level of a bed and no offset", () => {
    const rng = new Rng("brown");
    const x = brownNoise(48000 * 4, 48000, () => rng.next());
    let sum = 0;
    let power = 0;
    let peak = 0;
    for (const v of x) {
      sum += v;
      power += v * v;
      peak = Math.max(peak, Math.abs(v));
    }
    expect(Math.abs(sum / x.length)).toBeLessThan(1e-6);
    expect(Math.sqrt(power / x.length)).toBeCloseTo(BROWN_RMS, 6);
    expect(peak).toBeLessThan(0.6);
  });

  it("is warm: most of its power is low, far more than white noise's", () => {
    const rng = new Rng("warm");
    const x = brownNoise(48000 * 2, 48000, () => rng.next());
    // the power of the first difference measures the highs; for white noise it is twice the signal's power
    let power = 0;
    let diff = 0;
    for (let i = 1; i < x.length; i++) {
      power += x[i] * x[i];
      diff += (x[i] - x[i - 1]) ** 2;
    }
    expect(diff / power).toBeLessThan(0.1);
  });

  it("starts settled, not from a standstill", () => {
    const rng = new Rng("settled");
    const x = brownNoise(4800, 48000, () => rng.next());
    let early = 0;
    let late = 0;
    for (let i = 0; i < 480; i++) early += x[i] * x[i];
    for (let i = 4320; i < 4800; i++) late += x[i] * x[i];
    expect(early / late).toBeGreaterThan(0.2);
  });
});

describe("pitch", () => {
  it("puts A4 at 440 Hz and an octave at double", () => {
    expect(hz(69)).toBe(440);
    expect(hz(81)).toBeCloseTo(880, 9);
  });
});
