import { describe, expect, it } from "vitest";
import {
  balance,
  beyondLatin,
  cardFileName,
  cleanTo,
  clipText,
  fitMessage,
  graphemes,
  grownDays,
  grownWords,
  letterCount,
  messageParagraphs,
  senderOf,
  shareText,
  withArticle,
  wrap,
  type Measure,
} from "@/components/care/bloomCard";
import type { MeView } from "@/lib/client/plant";

/** Ten units a letter, five a space. */
const mono: Measure = (t) => graphemes(t).reduce((w, g) => w + (g === " " ? 5 : 10), 0);

describe("the card's words", () => {
  it("counts letters as a reader sees them", () => {
    expect(letterCount("Amma")).toBe(4);
    // a family emoji and a flag are one letter each; a Tamil syllable with its vowel sign is one
    expect(letterCount("👨‍👩‍👧 🇮🇳")).toBe(3);
    expect(letterCount("கொ")).toBe(1);
    expect(letterCount("  hi  ")).toBe(2);
  });

  it("names the flower with its article", () => {
    expect(withArticle("Enchanted Rose")).toBe("An Enchanted Rose");
    expect(withArticle("Island Bloom")).toBe("An Island Bloom");
    expect(withArticle("Sundrop")).toBe("A Sundrop");
    expect(withArticle("Night Jasmine")).toBe("A Night Jasmine");
  });

  it("is from the colleague's Meadow name, or a friend", () => {
    expect(senderOf({ firstName: "Lijas", showName: true })).toBe("Lijas");
    expect(senderOf({ firstName: "Lijas", showName: false })).toBe("A friend");
  });

  it("sends the living flower's link with the picture", () => {
    expect(shareText("rose", 12, "https://growmyflower.vercel.app")).toBe(
      "An Enchanted Rose I grew for you, in the Meadow. See it growing: https://growmyflower.vercel.app/meadow/garden?plot=12",
    );
    expect(shareText("marigold", 2003, "http://localhost:3000")).toBe(
      "A Marigold I grew for you, in the Meadow. See it growing: http://localhost:3000/meadow/garden?plot=2003",
    );
    expect(cardFileName("jasmine")).toBe("meadow-jasmine-bloom.jpg");
  });

  it("counts the days from planting to bloom in Bangalore's calendar", () => {
    const me = (plantedAt: string, bloomedAt: string | null, visual: object = { stage: "bloom" }) =>
      ({ plant: { plantedAt }, state: { bloomedAt }, visual }) as unknown as MeView;
    // planted at 20:00 IST on 10 Nov, bloomed at 06:00 IST on 24 Nov: day 14
    expect(grownDays(me("2026-11-10T14:30:00.000Z", "2026-11-24T00:30:00.000Z"), 0)).toBe(14);
    // planted at 23:30 IST: 23:59 IST the next evening is day 1, midnight IST day 2
    expect(grownDays(me("2026-11-10T18:00:00.000Z", "2026-11-11T18:29:00.000Z"), 0)).toBe(1);
    expect(grownDays(me("2026-11-10T18:00:00.000Z", "2026-11-11T18:30:00.000Z"), 0)).toBe(2);
    // never less than a day
    expect(grownDays(me("2026-11-10T04:00:00.000Z", "2026-11-10T08:00:00.000Z"), 0)).toBe(1);
    // a lotus flowering again counts to today
    const again = me("2026-11-10T04:00:00.000Z", "2026-11-24T04:00:00.000Z", { medium: "pond", flowers: 2 });
    expect(grownDays(again, Date.parse("2026-12-08T04:00:00.000Z"))).toBe(28);
    // and so does a bed flower's second flower; its first still counts to the day it bloomed
    const rose = (flowerOpenedAt: string) =>
      ({ plant: { plantedAt: "2026-11-10T04:00:00.000Z" }, state: { bloomedAt: "2026-11-24T00:30:00.000Z", flowerOpenedAt }, visual: { stage: "bloom" } }) as unknown as MeView;
    expect(grownDays(rose("2026-12-11T00:30:00.000Z"), Date.parse("2026-12-12T04:00:00.000Z"))).toBe(32);
    expect(grownDays(rose("2026-11-24T00:30:00.000Z"), Date.parse("2026-11-26T04:00:00.000Z"))).toBe(14);
    expect(grownWords(14)).toBe("grown in 14 days in the Meadow, Bangalore");
    expect(grownWords(1, false)).toBe("grown in a day in the Meadow");
  });

  it("tidies the name and the message", () => {
    expect(cleanTo("  Amma \n ")).toBe("Amma");
    // a family's names are never cut short (the card writes them smaller instead)
    expect(cleanTo("Amma, Appa,  Chechi and Ammu")).toBe("Amma, Appa, Chechi and Ammu");
    expect(messageParagraphs("Happy birthday Amma.\n\n\nLove   you\n")).toEqual(["Happy birthday Amma.", "Love you"]);
    expect(messageParagraphs("a\nb\nc\nd")).toEqual(["a", "b", "c d"]);
    expect(messageParagraphs("   ")).toEqual([]);
  });

  it("writes other scripts upright", () => {
    expect(beyondLatin("Amma, I grew this — for you!")).toBe(false);
    expect(beyondLatin("Café 🌸")).toBe(false);
    expect(beyondLatin("அம்மா")).toBe(true);
    expect(beyondLatin("माँ")).toBe(true);
  });
});

describe("wrapping the message", () => {
  it("breaks between words, never inside one that fits", () => {
    expect(wrap("I grew this for you", 95, mono)).toEqual(["I grew", "this for", "you"]);
    for (const line of wrap("a little every day, for you", 120, mono)) expect(mono(line)).toBeLessThanOrEqual(120);
  });

  it("breaks a word wider than a line between its letters", () => {
    const lines = wrap("ab abcdefghijkl cd", 60, mono);
    expect(lines.join("")).toBe("ababcdefghijklcd");
    for (const line of lines) expect(mono(line)).toBeLessThanOrEqual(60);
    // an emoji family is never split
    expect(wrap("👨‍👩‍👧👨‍👩‍👧👨‍👩‍👧", 20, mono)).toEqual(["👨‍👩‍👧👨‍👩‍👧", "👨‍👩‍👧"]);
  });

  it("balances lines so none is left with a word alone", () => {
    const text = "I grew this for you a little every day";
    const greedy = wrap(text, 300, mono);
    const even = balance(text, 300, mono);
    expect(even.length).toBe(greedy.length);
    const spread = (ls: string[]) => Math.max(...ls.map(mono)) - Math.min(...ls.map(mono));
    expect(spread(even)).toBeLessThan(spread(greedy));
  });

  it("never breaks a word to even the lines when the full width keeps it whole", () => {
    const text = "#HappyAnniversaryAmmaAppa love you both always";
    const width = 280;
    expect(wrap(text, width, mono)[0]).toBe("#HappyAnniversaryAmmaAppa");
    const even = balance(text, width, mono);
    expect(even.join(" ")).toBe(text);
    expect(even).toContain("#HappyAnniversaryAmmaAppa");
    // an emoji run kept on its line the same way
    expect(balance("🌸".repeat(25) + " love you both always", 280, mono)[0]).toBe("🌸".repeat(25));
  });

  it("cuts a run too long for its room with an ellipsis, between letters", () => {
    expect(clipText("growmyflower.vercel.app", 1000, mono)).toBe("growmyflower.vercel.app");
    const cut = clipText("meadow-git-bloom-card-jaws97s-projects.vercel.app", 200, mono);
    expect(cut.endsWith("…")).toBe(true);
    expect(mono(cut)).toBeLessThanOrEqual(200);
    expect(clipText("abc", 5, mono)).toBe("");
  });

  it("fits the message at the largest size that keeps it to a few lines", () => {
    const at = (size: number): Measure => (t) => (mono(t) * size) / 10;
    const short = fitMessage(["Happy birthday"], 900, at, { max: 60, min: 42, step: 2 }, 4);
    expect(short.size).toBe(60);
    expect(short.lines).toBe(1);
    const long = fitMessage(["word ".repeat(16).trim()], 900, at, { max: 60, min: 42, step: 2 }, 4);
    expect(long.size).toBeLessThan(60);
    expect(long.lines).toBeLessThanOrEqual(4);
    expect(long.paragraphs.flat().join(" ")).toBe("word ".repeat(16).trim());
  });
});
