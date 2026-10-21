// The party trailer's score (score.ts), checked without a browser: in time and inside the trailer, in D major save for
// the one borrowed cadence, each voice in its range, a chime for every flower, the bloom's home chord, the doe's high D
// on her eyes, the title's sting as one event before the restore gate, quiet enough (a level guard on what is struck
// together), the silences really silent (nothing starts in them and a choke covers them), nothing struck just before a
// gate, the trailer's own voices used sparingly, the can's drips in order, and the recorded beds' levels.
import { describe, expect, it } from "vitest";
import {
  BED_CUES,
  bedGain,
  BORROWED,
  CALLS,
  CHIMES,
  D_MAJOR,
  FADE_FROM,
  FADE_S,
  INTRO,
  LEVELS,
  PITCHED,
  RANGE,
  SCORE,
  STRUCK,
  type Note,
  type Voice,
} from "@/components/party/trailer/score";
import {
  BLOOM_AT,
  CODA_AT,
  DIP_HOLD_TO,
  END_AT,
  GATES,
  GROW_AT,
  HELLO_AT,
  MONTAGE,
  NIGHT_AT,
  RESTORE_AT,
  RETURN_AT,
  slotAt,
  TITLE_AT,
  TRAILER_S,
  trailerAt,
  VISIT_AT,
  WATER_AT,
} from "@/components/party/trailer/script";

const D = 2;
const GOLDEN = 17.45;
const EPS = 1e-6;
/** The two silences: after the swell into the payoff, and between the last dip and the title. */
const SILENCES: readonly (readonly [number, number])[] = [
  [28.95, 29.4],
  [END_AT + 0.4, TITLE_AT],
];

const pc = (m: number) => ((m % 12) + 12) % 12;
/** Notes that sound (not a choke or a duck). */
const sounding = SCORE.filter((n) => !LEVELS.has(n.voice));
const of = (voice: Voice) => SCORE.filter((n) => n.voice === voice);
/** The choke's level at time x: the last choke at or before it (1 before any). */
const chokeAt = (x: number) => of("choke").reduce((level, n) => (n.t <= x ? n.vel : level), 1);

describe("the trailer's music", () => {
  it("is in time order and inside the trailer", () => {
    for (let i = 1; i < SCORE.length; i++) expect(SCORE[i].t).toBeGreaterThanOrEqual(SCORE[i - 1].t);
    for (const n of SCORE) {
      expect(n.t).toBeGreaterThanOrEqual(0);
      expect(n.t).toBeLessThan(TRAILER_S);
      expect(n.dur).toBeGreaterThan(0);
      expect(n.vel).toBeGreaterThan(0);
      expect(n.vel).toBeLessThanOrEqual(1);
    }
  });

  it("keeps to D major, borrowing C, F and B flat only under the sundrop, each voice in its range", () => {
    for (const n of SCORE) {
      if (!PITCHED.has(n.voice)) {
        expect(n.midi).toEqual([]);
        continue;
      }
      expect(n.midi.length).toBeGreaterThan(0);
      const range = RANGE[n.voice];
      for (const m of n.midi) {
        if (BORROWED.includes(pc(m))) {
          expect(n.t).toBeGreaterThanOrEqual(GATES[4]);
          expect(n.t).toBeLessThanOrEqual(END_AT + 0.4);
        } else expect(D_MAJOR).toContain(pc(m));
        if (range) {
          expect(m).toBeGreaterThanOrEqual(range[0]);
          expect(m).toBeLessThanOrEqual(range[1]);
        }
      }
    }
    // the pad takes up to eight notes
    for (const n of of("pad")) expect(n.midi.length).toBeLessThanOrEqual(8);
  });

  it("winds the music box under the first black, and strikes its first note with the picture", () => {
    expect(INTRO.clicks.length).toBe(9);
    expect(INTRO.padVel).toBeCloseTo(0.35, 9);
    expect("bell" in INTRO).toBe(false);
    expect(of("bell")[0].t).toBeCloseTo(0.4, 9);
  });

  it("chimes as each flower comes up out of the black", () => {
    for (const gate of CHIMES) expect(SCORE.some((n) => n.voice === "bell" && n.t > gate && n.t < gate + 0.6)).toBe(true);
    expect(CHIMES).toEqual(GATES.slice(0, 5));
    expect(CHIMES.length).toBe(MONTAGE.length);
  });

  it("swells home into D as the bloom opens", () => {
    const home = SCORE.find((n) => n.voice === "pad" && n.midi[0] % 12 === D && n.t > BLOOM_AT && n.t < BLOOM_AT + 6);
    expect(home).toBeDefined();
    expect(home!.vel).toBe(1);
  });

  it("lets a few high notes fall as the can's water lands on the seed", () => {
    const drops = SCORE.filter((n) => n.voice === "bell" && n.t > WATER_AT + 2.7 && n.t < GROW_AT);
    expect(drops.length).toBeGreaterThanOrEqual(4);
    for (const n of drops) expect(n.midi[0]).toBeGreaterThanOrEqual(78);
  });

  it("gives the doe her theme, its high D landing as the focus arrives on her eyes", () => {
    const theme = SCORE.filter((n) => n.voice === "bell" && n.t > VISIT_AT && n.t < NIGHT_AT + 0.5);
    expect(theme.length).toBeGreaterThanOrEqual(8);
    let full = NaN;
    for (let t = VISIT_AT; t < NIGHT_AT; t += 0.005)
      if (trailerAt(t, GOLDEN).dof.rack >= 0.999) {
        full = t;
        break;
      }
    expect(Number.isFinite(full)).toBe(true);
    expect(theme.some((n) => n.midi[0] === 86 && Math.abs(n.t - full) <= 0.2)).toBe(true);
  });

  it("comes home under the title in one event, before the restore gate can split it", () => {
    expect(SCORE.some((n) => n.voice === "pad" && n.midi[0] % 12 === D && n.t === TITLE_AT)).toBe(true);
    const sting = SCORE.filter((n) => Math.abs(n.t - TITLE_AT) <= 0.02);
    const voices = new Set(sting.map((n) => n.voice));
    for (const v of ["pad", "bass", "boom", "bell", "shimmer", "choke", "duck"] as const) expect(voices.has(v)).toBe(true);
    expect(sting.filter((n) => n.voice === "bell").length).toBe(4);
    expect(TITLE_AT).toBeLessThan(RESTORE_AT - 0.3);
    expect(FADE_FROM).toBeGreaterThan(HELLO_AT + 0.5);
  });

  it("has faded by the time the panel is back, with nothing after the fade begins", () => {
    expect(FADE_FROM + FADE_S).toBeLessThanOrEqual(RETURN_AT + 2.5);
    expect(SCORE.every((n) => n.t < FADE_FROM)).toBe(true);
    expect(CALLS.every((c) => c.t < FADE_FROM)).toBe(true);
  });

  it("is quiet: what is struck together stays soft, and never more than two bells at once but the title's chord", () => {
    const struck = SCORE.filter((n) => STRUCK.has(n.voice));
    for (const n of struck) {
      const together = struck.filter((m) => m.t >= n.t && m.t < n.t + 0.05);
      expect(together.reduce((sum, m) => sum + m.vel, 0)).toBeLessThanOrEqual(1.6 + EPS);
      const bells = together.filter((m) => m.voice === "bell").length;
      expect(bells).toBeLessThanOrEqual(Math.abs(n.t - TITLE_AT) <= 0.02 ? 4 : 2);
    }
  });

  it("strikes nothing in the moment before a gate, and schedules nothing under the restore's hold", () => {
    for (const gate of GATES) for (const n of sounding) expect(n.t > gate - 0.25 && n.t < gate).toBe(false);
    for (const n of SCORE) expect(n.t > RESTORE_AT - 0.3 && n.t < CODA_AT).toBe(false);
    for (const c of CALLS) expect(c.t > RESTORE_AT - 0.3 && c.t < CODA_AT).toBe(false);
  });

  it("keeps its silences: nothing starts in them, and a choke covers them", () => {
    for (const [from, to] of SILENCES) {
      for (const n of sounding) expect(n.t > from + EPS && n.t < to - EPS).toBe(false);
      for (let x = from + 0.005; x < to - 0.02; x += 0.005) expect(chokeAt(x)).toBeLessThan(1);
      expect(chokeAt(to)).toBe(1);
    }
    // the chokes go down and come back in pairs, and nothing is choked at the end
    expect(of("choke").map((n) => n.vel < 1)).toEqual([true, false, true, false]);
  });

  it("uses its own voices sparingly: two soft booms, a slow heartbeat, a gesture into only some dips", () => {
    const booms = of("boom");
    expect(booms.map((n) => n.t)).toEqual([29.4, TITLE_AT]);
    for (const n of booms) expect(n.vel).toBeLessThanOrEqual(0.35);
    const pulses = of("pulse");
    for (let i = 1; i < pulses.length; i++) expect(pulses[i].t - pulses[i - 1].t).toBeGreaterThanOrEqual(0.7 - EPS);
    // which dips a riser, swell or whoosh peaks into: montage dips 0..4, and the end
    const dips = [...MONTAGE.map((_, i) => [slotAt(i), slotAt(i) + DIP_HOLD_TO] as const), [END_AT, END_AT + 0.4] as const];
    const gestures = SCORE.filter((n) => n.voice === "riser" || n.voice === "swell" || n.voice === "whoosh");
    const carried: (Voice | null)[] = dips.map(([from, to]) => {
      const g = gestures.find((n: Note) => n.t + n.dur >= from - EPS && n.t + n.dur <= to + 0.05);
      return g ? g.voice : null;
    });
    carried.forEach((kind, i) => {
      if (kind !== null) expect([0, 2, dips.length - 1]).toContain(i);
      if (i > 0 && kind !== null) expect(carried[i - 1]).not.toBe(kind);
    });
    expect(carried.filter((k) => k !== null).length).toBe(3);
  });

  it("sounds each of the can's last drips in order as it lands", () => {
    const drips = SCORE.filter((n) => n.drip !== undefined);
    expect(drips.map((n) => n.drip)).toEqual([0, 1, 2, 3]);
    for (const n of drips) {
      expect(n.voice).toBe("bell");
      expect(n.t).toBeGreaterThanOrEqual(12.5);
      expect(n.t).toBeLessThanOrEqual(14.6);
    }
  });

  it("keeps the recorded beds under the music, and out of the silences", () => {
    for (let t = -1; t < TRAILER_S + 1; t += 0.01)
      for (const cue of BED_CUES) {
        // at the strongest the frame could ask: the most wind, rain and night
        const g = bedGain(cue, t, 1.8, 1, 1);
        expect(g).toBeGreaterThanOrEqual(0);
        expect(g).toBeLessThanOrEqual(0.6);
        if (SILENCES.some(([from, to]) => t >= from + EPS && t <= to - 0.01 - EPS)) expect(g).toBe(0);
      }
    // at the real frame's wind and rain the shower and the leaves follow the picture
    const f = trailerAt(17.5, GOLDEN);
    const rain = BED_CUES.find((c) => c.key === "rain-light")!;
    expect(bedGain(rain, 17.5, f.wind, f.rain, 0)).toBeCloseTo(0.5 * f.rain, 9);
    for (const c of CALLS) {
      expect(c.vel).toBeLessThanOrEqual(0.6);
      expect(c.to).toBeGreaterThan(c.from);
      expect(SILENCES.some(([from, to]) => c.t > from && c.t < to)).toBe(false);
    }
  });
});
