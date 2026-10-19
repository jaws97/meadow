import { describe, expect, it } from "vitest";
import {
  BELL_HIGH,
  BELL_LOW,
  createComposer,
  MAX_SILENCE_S,
  PAD_HIGH,
  PAD_LOW,
  PENTATONIC,
  type BoxNote,
} from "@/lib/sound/musicBox";

const HOUR_S = 3600;
const pc = (m: number) => ((m % 12) + 12) % 12;

describe("the music box", () => {
  it("keeps every note in D major pentatonic", () => {
    for (const seed of [1, 2, 3, "garden"])
      for (const n of createComposer(seed).until(HOUR_S)) for (const m of n.midi) expect(PENTATONIC).toContain(pc(m));
  });

  it("keeps the box and the pad in gentle ranges", () => {
    for (const seed of [4, 5, 6]) {
      const notes = createComposer(seed).until(HOUR_S);
      for (const n of notes) {
        const [low, high] = n.voice === "bell" ? [BELL_LOW, BELL_HIGH] : [PAD_LOW, PAD_HIGH];
        for (const m of n.midi) {
          expect(m).toBeGreaterThanOrEqual(low);
          expect(m).toBeLessThanOrEqual(high);
        }
        expect(n.vel).toBeGreaterThan(0);
        expect(n.vel).toBeLessThanOrEqual(1);
        expect(n.dur).toBeGreaterThan(0);
      }
      const bells = notes.filter((n) => n.voice === "bell");
      // it uses most of its range over an hour, and leaps no more than a few steps
      expect(Math.min(...bells.map((n) => n.midi.at(-1)!))).toBeLessThanOrEqual(BELL_LOW + 2);
      expect(Math.max(...bells.map((n) => n.midi.at(-1)!))).toBeGreaterThanOrEqual(BELL_HIGH - 2);
      for (let i = 1; i < bells.length; i++) expect(Math.abs(bells[i].midi.at(-1)! - bells[i - 1].midi.at(-1)!)).toBeLessThanOrEqual(12);
    }
  });

  it("never falls silent for longer than a breath", () => {
    for (const seed of [7, 8, 9, 10]) {
      const notes = createComposer(seed).until(HOUR_S);
      let heardTo = 0;
      let longest = 0;
      for (const n of notes) {
        longest = Math.max(longest, n.t - heardTo);
        heardTo = Math.max(heardTo, n.t + n.dur);
      }
      expect(longest).toBeLessThanOrEqual(MAX_SILENCE_S);
      // the bells alone breathe between phrases, but never for long
      let bellTo = 0;
      let bellGap = 0;
      for (const n of notes.filter((x) => x.voice === "bell")) {
        bellGap = Math.max(bellGap, n.t - bellTo);
        bellTo = Math.max(bellTo, n.t + n.dur);
      }
      expect(bellGap).toBeGreaterThan(1);
      expect(bellGap).toBeLessThanOrEqual(MAX_SILENCE_S);
    }
  });

  it("is slow and calm: a few notes a second at most, and a pad chord every 8 to 16 s", () => {
    const notes = createComposer(11).until(HOUR_S);
    const bells = notes.filter((n) => n.voice === "bell");
    const pads = notes.filter((n) => n.voice === "pad");
    expect(bells.length / HOUR_S).toBeGreaterThan(0.5);
    expect(bells.length / HOUR_S).toBeLessThan(1.6);
    for (let i = 1; i < bells.length; i++) expect(bells[i].t - bells[i - 1].t).toBeGreaterThanOrEqual(0.37);
    for (let i = 1; i < pads.length; i++) {
      expect(pads[i].t - pads[i - 1].t).toBeGreaterThanOrEqual(8);
      expect(pads[i].t - pads[i - 1].t).toBeLessThanOrEqual(16);
    }
  });

  it("now and then strikes two notes together", () => {
    const bells = createComposer(12).until(HOUR_S).filter((n) => n.voice === "bell");
    const pairs = bells.filter((n) => n.midi.length === 2);
    expect(pairs.length / bells.length).toBeGreaterThan(0.05);
    expect(pairs.length / bells.length).toBeLessThan(0.25);
    for (const n of pairs) expect(n.midi[1] - n.midi[0]).toBeGreaterThanOrEqual(3);
  });

  it("rests each phrase on D or A", () => {
    const notes = createComposer(13).until(HOUR_S);
    const bells = notes.filter((n) => n.voice === "bell");
    let rests = 0;
    for (let i = 0; i < bells.length - 1; i++) {
      const breath = bells[i + 1].t - (bells[i].t + bells[i].dur);
      if (breath > 1) {
        rests++;
        expect([2, 9]).toContain(pc(bells[i].midi.at(-1)!));
      }
    }
    expect(rests).toBeGreaterThan(100);
  });

  it("is in time order, and the same piece for the same seed however it is asked for", () => {
    const whole = createComposer(42).until(600);
    for (let i = 1; i < whole.length; i++) expect(whole[i].t).toBeGreaterThanOrEqual(whole[i - 1].t);
    const pieces: BoxNote[] = [];
    const composer = createComposer(42);
    for (let t = 0.7; t < 600; t += 1.3) pieces.push(...composer.until(t));
    pieces.push(...composer.until(600));
    expect(pieces).toEqual(whole);
    expect(createComposer(43).until(600)).not.toEqual(whole);
  });

  it("begins softly: a pad first, then the first bell after a moment", () => {
    const [first, second] = createComposer(14).until(5);
    expect(first.voice).toBe("pad");
    expect(first.t).toBeLessThan(0.5);
    expect(second.voice).toBe("bell");
    expect(second.t).toBeGreaterThan(1);
  });
});
