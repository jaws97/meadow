import { describe, expect, it } from "vitest";
import { QUOTES, quoteOrder } from "./quotes";

// a small deterministic generator, so the shuffles are repeatable
function seeded(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

describe("loading quotes", () => {
  it("every quote is a finished sentence with no stray whitespace", () => {
    for (const q of QUOTES) {
      expect(q.text).toBe(q.text.trim());
      expect(q.text).toMatch(/[.!?]$/);
    }
  });

  it("an order holds every quote exactly once", () => {
    for (let seed = 1; seed < 50; seed++) {
      const order = quoteOrder(QUOTES.length, null, seeded(seed));
      expect([...order].sort((a, b) => a - b)).toEqual(QUOTES.map((_, i) => i));
    }
  });

  it("never starts on the quote the device saw first last time", () => {
    for (let last = 0; last < QUOTES.length; last++) {
      for (let seed = 1; seed < 50; seed++) {
        expect(quoteOrder(QUOTES.length, last, seeded(seed))[0]).not.toBe(last);
      }
    }
  });

  it("copes with a single quote", () => {
    expect(quoteOrder(1, 0)).toEqual([0]);
  });
});
