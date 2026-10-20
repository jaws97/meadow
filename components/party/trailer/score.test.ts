import { describe, expect, it } from "vitest";
import { CHIMES, D_MAJOR, FADE_FROM, FADE_S, SCORE } from "@/components/party/trailer/score";
import { BLOOM_AT, CARD, GATES, GROW_AT, NIGHT_AT, RETURN_AT, TRAILER_S, VISIT_AT, WATER_AT } from "@/components/party/trailer/script";

const D = 2;

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

  it("keeps to D major, in a gentle range", () => {
    for (const n of SCORE)
      for (const m of n.midi) {
        expect(D_MAJOR).toContain(((m % 12) + 12) % 12);
        expect(m).toBeGreaterThanOrEqual(33);
        expect(m).toBeLessThanOrEqual(90);
      }
  });

  it("chimes as each flower comes up out of the black", () => {
    for (const gate of CHIMES) expect(SCORE.some((n) => n.voice === "bell" && n.t > gate && n.t < gate + 0.6)).toBe(true);
    expect(CHIMES).toEqual(GATES.slice(0, CHIMES.length));
  });

  it("swells home into D as the bloom opens", () => {
    const home = SCORE.find((n) => n.voice === "pad" && n.midi[0] % 12 === D && n.t > BLOOM_AT && n.t < BLOOM_AT + 6);
    expect(home).toBeDefined();
    expect(home!.vel).toBe(1);
  });

  it("gives the doe her theme, ending as she looks up at the rose as the light goes", () => {
    const theme = SCORE.filter((n) => n.voice === "bell" && n.t > VISIT_AT && n.t < NIGHT_AT + 0.5);
    expect(theme.length).toBeGreaterThanOrEqual(8);
    const last = theme[theme.length - 1];
    expect(last.t).toBeGreaterThan(VISIT_AT + 10);
  });

  it("lets a few high notes fall as the can's water lands on the seed", () => {
    const drops = SCORE.filter((n) => n.voice === "bell" && n.t > WATER_AT + 2.7 && n.t < GROW_AT);
    expect(drops.length).toBeGreaterThanOrEqual(4);
    for (const n of drops) expect(n.midi[0]).toBeGreaterThanOrEqual(78);
  });

  it("comes home under the closing card and has faded by the time the panel is back", () => {
    expect(SCORE.some((n) => n.voice === "pad" && n.midi[0] % 12 === D && Math.abs(n.t - CARD.from) < 0.5)).toBe(true);
    expect(FADE_FROM).toBeGreaterThan(CARD.from);
    expect(FADE_FROM + FADE_S).toBeLessThanOrEqual(RETURN_AT + 2.5);
    expect(SCORE.every((n) => n.t < FADE_FROM)).toBe(true);
  });

  it("is quiet: never more than a few notes struck at once", () => {
    for (const n of SCORE) {
      const together = SCORE.filter((m) => m.voice === "bell" && Math.abs(m.t - n.t) < 0.05).length;
      expect(together).toBeLessThanOrEqual(2);
    }
  });
});
