import { describe, expect, it } from "vitest";
import {
  BED_LOOP,
  equalPowerCurve,
  MIN_SHOT_REST_S,
  NOISE_LOOP,
  nextSegment,
  pickOffset,
  positionAt,
  segmentBounds,
  shotGap,
  type LoopOptions,
  type Segment,
} from "@/lib/sound/loopPlan";
import { Rng } from "@/lib/plant/prng";

const BED: LoopOptions = { ...BED_LOOP, fileS: 50 };
const NOISE: LoopOptions = { ...NOISE_LOOP, fileS: 12 };

/** Two chains of a pseudo-stereo bed, planned the way the engine does: each new segment knows the other chain's. */
function plan(o: LoopOptions, seed: string, until: number): Segment[][] {
  const rng = new Rng(seed);
  const random = () => rng.next();
  const chains: Segment[][] = [[], []];
  for (const [i, chain] of chains.entries()) chain.push(nextSegment(o, random, null, chains[1 - i], 0));
  for (;;) {
    // extend whichever chain's latest segment starts first, as the engine's lookahead would
    const i = chains[0].at(-1)!.at <= chains[1].at(-1)!.at ? 0 : 1;
    const last = chains[i].at(-1)!;
    if (last.at > until) break;
    chains[i].push(nextSegment(o, random, last, chains[1 - i]));
  }
  return chains;
}

describe("a bed's segments", () => {
  it("cover time continuously, each crossfading into the next", () => {
    for (const o of [BED, NOISE])
      for (const seed of ["a", "b", "c", "d"])
        for (const chain of plan(o, seed, 3600)) {
          expect(chain[0].at).toBe(0);
          for (let n = 1; n < chain.length; n++) {
            const prev = chain[n - 1];
            const seg = chain[n];
            // the next starts exactly as the previous begins to fade out, and fades in over the same span
            expect(seg.at).toBeCloseTo(prev.at + prev.duration - prev.fadeOut, 9);
            expect(seg.fadeIn).toBeCloseTo(prev.fadeOut, 9);
            expect(seg.at).toBeGreaterThan(prev.at);
          }
        }
  });

  it("stay inside the recording, away from its faded ends, and within their lengths", () => {
    const { min, max } = segmentBounds(BED);
    expect(min).toBe(20);
    expect(max).toBeGreaterThanOrEqual(35);
    expect(max).toBeLessThanOrEqual(45);
    for (const o of [BED, NOISE]) {
      const bounds = segmentBounds(o);
      for (const chain of plan(o, "inside", 3600))
        for (const s of chain) {
          expect(s.offset).toBeGreaterThanOrEqual(o.edgeS - 1e-9);
          expect(s.offset + s.duration).toBeLessThanOrEqual(o.fileS - o.edgeS + 1e-9);
          expect(s.duration).toBeGreaterThanOrEqual(bounds.min - 1e-9);
          expect(s.duration).toBeLessThanOrEqual(bounds.max + 1e-9);
          expect(s.fadeIn + s.fadeOut).toBeLessThan(s.duration);
          expect(s.fadeOut).toBeLessThanOrEqual(o.fadeS);
        }
    }
  });

  it("start at places that vary, so the seams never repeat", () => {
    const [left] = plan(BED, "vary", 3600);
    // a seam joins the place one segment fades out from to the place the next fades in from
    const seams = left.slice(1).map((s, n) => `${positionAt(left[n], s.at).toFixed(2)}>${s.offset.toFixed(2)}`);
    expect(new Set(seams).size).toBe(seams.length);
    const spread = Math.max(...left.map((s) => s.offset)) - Math.min(...left.map((s) => s.offset));
    expect(spread).toBeGreaterThan(8);
  });

  it("never overlap another copy of the same recording too closely, which would comb", () => {
    for (const o of [BED, NOISE])
      for (const seed of ["x", "y", "z"]) {
        const segs = plan(o, seed, 3600).flat();
        let pairs = 0;
        for (let i = 0; i < segs.length; i++)
          for (let j = i + 1; j < segs.length; j++) {
            const a = segs[i];
            const b = segs[j];
            const from = Math.max(a.at, b.at);
            if (from >= Math.min(a.at + a.duration, b.at + b.duration)) continue;
            pairs++;
            expect(Math.abs(positionAt(a, from) - positionAt(b, from))).toBeGreaterThanOrEqual(o.minGapS - 1e-9);
          }
        expect(pairs).toBeGreaterThan(100);
      }
  });

  it("keep to their bounds when a buffer is too short to vary much", () => {
    const tiny: LoopOptions = { ...NOISE_LOOP, fileS: 6 };
    const { min, max } = segmentBounds(tiny);
    expect(min).toBeLessThanOrEqual(max);
    expect(max).toBeLessThanOrEqual(6);
  });
});

describe("picking an offset", () => {
  it("keeps clear of the places to avoid when it can", () => {
    const rng = new Rng("pick");
    for (let i = 0; i < 500; i++) {
      const x = pickOffset(0, 20, [5, 12], 3, () => rng.next());
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThanOrEqual(20);
      expect(Math.abs(x - 5)).toBeGreaterThanOrEqual(3);
      expect(Math.abs(x - 12)).toBeGreaterThanOrEqual(3);
    }
  });

  it("takes the farthest place when nowhere is clear", () => {
    expect(pickOffset(0, 4, [0, 4], 3, () => 0.5)).toBe(2);
    expect(pickOffset(3, 3, [1], 3, () => 0.5)).toBe(3);
  });
});

describe("the equal-power crossfade", () => {
  it("keeps the power of the two sounds together level", () => {
    const fadeIn = equalPowerCurve("in");
    const fadeOut = equalPowerCurve("out");
    expect(fadeIn.length).toBe(fadeOut.length);
    expect(fadeIn[0]).toBeCloseTo(0, 6);
    expect(fadeIn[fadeIn.length - 1]).toBeCloseTo(1, 6);
    expect(fadeOut[0]).toBeCloseTo(1, 6);
    expect(fadeOut[fadeOut.length - 1]).toBeCloseTo(0, 6);
    for (let i = 0; i < fadeIn.length; i++) expect(fadeIn[i] ** 2 + fadeOut[i] ** 2).toBeCloseTo(1, 5);
  });

  it("rises and falls without a step", () => {
    const fadeIn = equalPowerCurve("in", 32);
    for (let i = 1; i < fadeIn.length; i++) {
      expect(fadeIn[i]).toBeGreaterThan(fadeIn[i - 1]);
      expect(fadeIn[i] - fadeIn[i - 1]).toBeLessThan(0.06);
    }
  });
});

describe("the bird calls", () => {
  it("rest at least a moment after each call, and none come when none are wanted", () => {
    const rng = new Rng("rest");
    for (let i = 0; i < 1000; i++) expect(shotGap(3, 10, () => rng.next())).toBeGreaterThanOrEqual(MIN_SHOT_REST_S);
    expect(shotGap(0, 10, () => 0.5)).toBe(Infinity);
  });

  it("come at about the rate asked, one at a time", () => {
    const rng = new Rng("rate");
    const callS = 8;
    for (const perMinute of [1, 2, 3]) {
      let t = 0;
      let calls = 0;
      while (t < 600 * 60) {
        t += callS + shotGap(perMinute, callS, () => rng.next());
        calls++;
      }
      expect(calls / 600).toBeGreaterThan(perMinute * 0.92);
      expect(calls / 600).toBeLessThan(perMinute * 1.08);
    }
  });
});
