import { describe, expect, it } from "vitest";
import {
  BLOOM_AT,
  CAPTIONS,
  CARD,
  END_AT,
  FLOWER_S,
  FLOWERS_AT,
  GATES,
  GROW_AT,
  HEADLESS_GROWTH,
  MONTAGE,
  NIGHT_AT,
  RESTORE_AT,
  RETURN_AT,
  Track,
  TRAILER_S,
  trailerAt,
  VISIT_AT,
  WATER_AT,
} from "@/components/party/trailer/script";

const GOLDEN = 17.45;
const STEP = 1 / 60;
const times = (from: number, to: number) => {
  const out: number[] = [];
  for (let t = from; t < to; t += STEP) out.push(t);
  return out;
};

describe("a track", () => {
  it("passes through its keys and holds beyond them", () => {
    const tr = new Track([
      [0, 1],
      [2, 3],
      [5, 3],
      [6, 0],
    ]);
    expect(tr.at(-1)).toBe(1);
    expect(tr.at(0)).toBe(1);
    expect(tr.at(2)).toBeCloseTo(3, 9);
    expect(tr.at(5)).toBeCloseTo(3, 9);
    expect(tr.at(9)).toBe(0);
  });

  it("never overshoots a key, so a hold stays a hold", () => {
    const tr = new Track([
      [0, 0],
      [1, 1],
      [3, 1],
      [4, 0.2],
    ]);
    for (let t = 0; t <= 4; t += 0.01) {
      expect(tr.at(t)).toBeLessThanOrEqual(1 + 1e-9);
      expect(tr.at(t)).toBeGreaterThanOrEqual(-1e-9);
    }
    for (let t = 1; t <= 3; t += 0.05) expect(tr.at(t)).toBeCloseTo(1, 9);
  });

  it("moves without jumps", () => {
    const tr = new Track([
      [0, 0],
      [1, 2],
      [4, 3],
    ]);
    let last = tr.at(0);
    for (let t = 0.001; t <= 4; t += 0.001) {
      const v = tr.at(t);
      expect(Math.abs(v - last)).toBeLessThan(0.01);
      last = v;
    }
  });
});

describe("the trailer", () => {
  it("runs a little over a minute, its beats in order", () => {
    expect([WATER_AT, GROW_AT, BLOOM_AT, VISIT_AT, NIGHT_AT, FLOWERS_AT, END_AT, RESTORE_AT, RETURN_AT, TRAILER_S]).toEqual(
      [WATER_AT, GROW_AT, BLOOM_AT, VISIT_AT, NIGHT_AT, FLOWERS_AT, END_AT, RESTORE_AT, RETURN_AT, TRAILER_S].sort((a, b) => a - b),
    );
    expect(TRAILER_S).toBeGreaterThan(64);
    expect(TRAILER_S).toBeLessThan(75);
  });

  it("gives the seed its first drink from the can before it grows, and dries it with the passing day", () => {
    expect(trailerAt(WATER_AT - 0.1, GOLDEN).water).toBe(-1);
    expect(trailerAt(WATER_AT + 1, GOLDEN).water).toBeCloseTo(1, 9);
    // the can plays at its own pace through the carry and the pour, still a seed in its mound
    for (const t of times(WATER_AT, GROW_AT)) {
      expect(trailerAt(t + STEP, GOLDEN).water - trailerAt(t, GOLDEN).water).toBeCloseTo(STEP, 6);
      expect(trailerAt(t, GOLDEN).growth).toBeLessThan(HEADLESS_GROWTH);
    }
    // once the can is home, the wet it left hurries on with the time-lapse and is gone well before the bloom
    expect(trailerAt(BLOOM_AT, GOLDEN).water).toBeGreaterThan(60);
    expect(trailerAt(RESTORE_AT, GOLDEN).water).toBe(-1);
  });

  it("opens on the seed alone: no head before the growing beat", () => {
    for (const t of times(0, GROW_AT)) expect(trailerAt(t, GOLDEN).growth).toBeLessThan(HEADLESS_GROWTH);
    expect(trailerAt(0, GOLDEN).growth).toBe(0);
  });

  it("only ever grows, and blooms in the golden hour", () => {
    let last = -1;
    for (const t of times(0, RESTORE_AT)) {
      const f = trailerAt(t, GOLDEN);
      expect(f.growth).toBeGreaterThanOrEqual(last - 1e-9);
      last = f.growth;
    }
    expect(trailerAt(BLOOM_AT - 1, GOLDEN).bloom).toBe(0);
    expect(trailerAt(BLOOM_AT + 12, GOLDEN).bloom).toBeCloseTo(1, 6);
    expect(trailerAt(BLOOM_AT + 12, GOLDEN).growth).toBeCloseTo(1, 6);
  });

  it("keeps the hour inside one day, from dawn through golden hour to night", () => {
    for (const t of times(0, TRAILER_S)) {
      const h = trailerAt(t, GOLDEN).hour;
      expect(h).toBeGreaterThanOrEqual(0);
      expect(h).toBeLessThan(24);
    }
    expect(trailerAt(0, GOLDEN).hour).toBeLessThan(6.5);
    expect(Math.abs(trailerAt(VISIT_AT + 8, GOLDEN).hour - GOLDEN)).toBeLessThan(0.25);
    expect(trailerAt(FLOWERS_AT, GOLDEN).hour).toBeGreaterThan(GOLDEN + 1.5);
  });

  it("rains for a while as the rose grows, and is dry for the bloom", () => {
    const rainy = times(GROW_AT, BLOOM_AT).filter((t) => trailerAt(t, GOLDEN).rain > 0.3);
    expect(rainy.length * STEP).toBeGreaterThan(3);
    for (const t of times(BLOOM_AT, TRAILER_S)) expect(trailerAt(t, GOLDEN).rain).toBe(0);
  });

  it("changes the flower only under black, at its gate", () => {
    let last = trailerAt(0, GOLDEN).species;
    for (const t of times(0, TRAILER_S)) {
      const f = trailerAt(t, GOLDEN);
      if (f.species !== last) {
        expect(f.cover).toBeCloseTo(1, 3);
        expect(GATES.some((g) => Math.abs(g - t) < 2 * STEP)).toBe(true);
      }
      last = f.species;
    }
    for (const g of GATES) expect(trailerAt(g, GOLDEN).cover).toBeCloseTo(1, 6);
  });

  it("shows each of the other flowers in turn, and the rose again at the end", () => {
    expect(trailerAt(FLOWERS_AT - 1, GOLDEN).species).toBe("rose");
    MONTAGE.forEach((id, i) => expect(trailerAt(FLOWERS_AT + i * FLOWER_S + FLOWER_S / 2, GOLDEN).species).toBe(id));
    expect(MONTAGE).not.toContain("rose");
    expect(trailerAt(RESTORE_AT + 0.1, GOLDEN).species).toBe("rose");
    expect(trailerAt(RESTORE_AT + 0.1, GOLDEN).restored).toBe(true);
  });

  it("names each flower while it is shown", () => {
    MONTAGE.forEach((_, i) => {
      const f = trailerAt(FLOWERS_AT + i * FLOWER_S + FLOWER_S * 0.6, GOLDEN);
      expect(f.sub).not.toBeNull();
      expect(f.cover).toBeLessThan(0.05);
    });
  });

  it("opens and ends on black, and is clear for every caption", () => {
    expect(trailerAt(0, GOLDEN).cover).toBe(1);
    expect(trailerAt(RESTORE_AT, GOLDEN).cover).toBeCloseTo(1, 6);
    expect(trailerAt(TRAILER_S, GOLDEN).cover).toBe(0);
    for (const c of CAPTIONS) for (const t of times(c.from, c.to)) {
      const f = trailerAt(t, GOLDEN);
      // the montage's caption runs through its dips
      if (c.from < FLOWERS_AT) expect(f.cover).toBeLessThan(0.02);
    }
    for (const t of times(CARD.from, CARD.to)) expect(trailerAt(t, GOLDEN).cover).toBeCloseTo(1, 3);
  });

  it("never shows two captions at once", () => {
    const sorted = [...CAPTIONS].sort((a, b) => a.from - b.from);
    for (let i = 1; i < sorted.length; i++) expect(sorted[i].from).toBeGreaterThan(sorted[i - 1].to);
    for (const c of sorted) expect(c.to).toBeGreaterThan(c.from);
  });

  it("brings the doe in for the golden hour and the dusk only, and takes her away under black", () => {
    for (const t of times(0, TRAILER_S)) expect(trailerAt(t, GOLDEN).doe).toBe(t >= VISIT_AT && t < GATES[0]);
    expect(trailerAt(GATES[0], GOLDEN).cover).toBeCloseTo(1, 6);
  });

  it("pulls focus to the doe after she has arrived, and back to the flower", () => {
    expect(trailerAt(VISIT_AT + 5, GOLDEN).rack).toBe(0);
    expect(trailerAt(VISIT_AT + 8.5, GOLDEN).rack).toBeCloseTo(1, 6);
    expect(trailerAt(VISIT_AT + 12, GOLDEN).rack).toBe(0);
  });

  it("keeps its shots inside the dressed garden", () => {
    for (const t of times(0, TRAILER_S)) {
      const s = trailerAt(t, GOLDEN).shot;
      expect(Math.abs(s.yaw)).toBeLessThan(0.5);
      expect(s.dolly).toBeGreaterThan(0.25);
      expect(s.dolly).toBeLessThan(1.1);
      expect(s.focus).toBeGreaterThanOrEqual(0);
      expect(s.focus).toBeLessThanOrEqual(1);
      expect(s.lift).toBeGreaterThan(-0.1);
      expect(s.lift).toBeLessThan(0.3);
    }
  });

  it("hands the screen back: the bars go and the panel returns at the end", () => {
    expect(trailerAt(RETURN_AT - 0.1, GOLDEN).bars).toBe(true);
    expect(trailerAt(RETURN_AT - 0.1, GOLDEN).panel).toBe(false);
    expect(trailerAt(RETURN_AT, GOLDEN).bars).toBe(false);
    expect(trailerAt(RETURN_AT, GOLDEN).panel).toBe(true);
  });

  it("lights a rehearsal day as it will the party night", () => {
    const party = trailerAt(VISIT_AT + 8, 17.45);
    const october = trailerAt(VISIT_AT + 8, 17.58);
    expect(october.hour - party.hour).toBeCloseTo(0.13, 6);
  });
});
