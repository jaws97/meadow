import { describe, expect, it } from "vitest";
import { graphemes, type Measure } from "@/components/care/bloomCard";
import { CARD_H, CARD_W, layoutCard, type CardMeasures, type CardWords } from "@/components/care/drawCard";

/** A stand-in face: each letter half its size wide, a space a quarter (a little wider for the sans, bolder for 500). */
const at = (size: number, k = 0.5): Measure => (t) => graphemes(t).reduce((w, g) => w + (g === " " ? size * 0.25 : size * k), 0);
const m: CardMeasures = { roman: (s) => at(s), italic: (s) => at(s), sans: (s, weight) => at(s, weight === 500 ? 0.58 : 0.52) };

const words = (over: Partial<CardWords> = {}): CardWords => ({
  to: "Amma",
  paragraphs: ["I grew this for you, a little every day. Happy birthday."],
  from: "Lijas",
  species: "Enchanted Rose",
  days: 14,
  domain: "meadow-phi.vercel.app",
  ...over,
});

describe("the card's words", () => {
  it("reads top to bottom: to whom, the message, the sender, the rule, the foot", () => {
    const l = layoutCard(words(), m);
    const ys = (text: string) => l.lines.find((x) => x.text === text)?.y ?? NaN;
    const message = l.lines.filter((x) => x.face === "roman" && x.colour === "#f6ead6");
    expect(ys("To Amma,")).toBeLessThan(message[0].y);
    expect(message[message.length - 1].y).toBeLessThan(ys("Lijas"));
    expect(ys("Lijas")).toBeLessThan(l.rule.y);
    expect(l.rule.y).toBeLessThan(ys("meadow-phi.vercel.app"));
    // within the card, the words in its lower half, the foot clear of the edge
    for (const x of l.lines) {
      expect(x.y).toBeGreaterThan(CARD_H / 2);
      expect(x.y).toBeLessThan(CARD_H - 50);
    }
    expect(l.top).toBeGreaterThan(CARD_H * 0.55);
  });

  it("keeps every line inside the margins", () => {
    const l = layoutCard(words({ paragraphs: ["Thank you for every evening you sat with me while this grew. It opened today, and I thought of you first. I hope it makes you smile"] }), m);
    for (const x of l.lines) {
      const face = x.face === "sans" ? m.sans(x.size, x.weight) : m.roman(x.size);
      if (x.align === "left") expect(x.x + face(x.text)).toBeLessThanOrEqual(CARD_W - 76 + 0.5);
      else expect(x.x - face(x.text)).toBeGreaterThanOrEqual(76 - 0.5);
    }
  });

  it("writes a long message smaller, and a short one large", () => {
    const short = layoutCard(words({ paragraphs: ["Happy birthday!"] }), m);
    const long = layoutCard(words({ paragraphs: ["word ".repeat(26).trim()] }), m);
    expect(short.messageSize).toBe(60);
    expect(long.messageSize).toBeLessThan(60);
    expect(long.messageSize).toBeGreaterThanOrEqual(42);
    // the dusk rises with the words
    expect(long.top).toBeLessThan(short.top);
  });

  it("writes up to six lines smaller, and says when even that would climb over the flower", () => {
    const six = layoutCard(words({ paragraphs: ["word ".repeat(60).trim()] }), m);
    expect(six.overflow.message).toBe(false);
    expect(six.messageSize).toBeLessThan(42);
    expect(six.top).toBeGreaterThan(CARD_H * 0.5);
    const wide = (s: number): Measure => (t) => graphemes(t).length * s * 1.2;
    const emoji = layoutCard(words({ paragraphs: ["🌸".repeat(140)] }), { ...m, roman: wide });
    expect(emoji.overflow.message).toBe(true);
    expect(layoutCard(words(), m).overflow).toEqual({ message: false, to: false });
  });

  it("writes a long name smaller on one line, and says when it cannot", () => {
    const family = layoutCard(words({ to: "Amma, Appa, Chechi and Ammu" }), m);
    const line = family.lines.find((x) => x.text === "To Amma, Appa, Chechi and Ammu,");
    expect(line).toBeDefined();
    expect(family.overflow.to).toBe(false);
    // a name too long for 46 px is written smaller, within the margins, and close above the message
    const long = layoutCard(words({ to: "A".repeat(50) }), m);
    const to = long.lines.find((x) => x.text.startsWith("To "));
    expect(to?.size).toBeLessThan(46);
    expect(to?.size).toBeGreaterThanOrEqual(30);
    expect(m.italic(to?.size ?? 0, false)(to?.text ?? "")).toBeLessThanOrEqual(CARD_W - 152);
    expect(long.overflow.to).toBe(false);
    const first = long.lines.find((x) => x.face === "roman" && x.colour === "#f6ead6");
    const short = layoutCard(words(), m);
    const gap = (l: typeof short) => (l.lines.find((x) => x.face === "roman" && x.colour === "#f6ead6")?.y ?? 0) - (l.lines.find((x) => x.text.startsWith("To "))?.y ?? 0);
    expect(gap(long)).toBeLessThanOrEqual(gap(short) + 0.5);
    expect(first).toBeDefined();
    expect(layoutCard(words({ to: "A".repeat(90) }), m).overflow.to).toBe(true);
  });

  it("cuts a long host short rather than writing it over the foot's words", () => {
    const l = layoutCard(words({ domain: "meadow-git-bloom-card-a-very-long-preview-name-jaws97s-projects.vercel.app" }), m);
    const domain = l.lines.find((x) => x.align === "right");
    expect(domain?.text.endsWith("…")).toBe(true);
    const left = l.lines.filter((x) => x.face === "sans" && x.align === "left");
    const end = Math.max(...left.map((x) => x.x + m.sans(x.size, x.weight)(x.text)));
    expect(end).toBeLessThanOrEqual((domain?.x ?? 0) - m.sans(domain?.size ?? 21, 400)(domain?.text ?? "") + 0.5);
  });

  it("leaves out an empty To line and an empty message", () => {
    const l = layoutCard(words({ to: "", paragraphs: [] }), m);
    expect(l.lines.some((x) => x.text.startsWith("To "))).toBe(false);
    expect(l.lines.filter((x) => x.face !== "sans").map((x) => x.text)).toEqual(["Lijas"]);
  });

  it("writes Indic names upright, and keeps the foot's Bangalore when a smaller size makes room", () => {
    const l = layoutCard(words({ to: "அம்மா", from: "பிரியா" }), m);
    expect(l.lines.find((x) => x.text === "To அம்மா,")?.face).toBe("roman");
    expect(l.lines.find((x) => x.text === "பிரியா")?.face).toBe("roman");
    expect(layoutCard(words({ from: "Priya" }), m).lines.find((x) => x.text === "Priya")?.face).toBe("italic");
    const foot = l.lines.find((x) => x.text.startsWith(" · grown"));
    expect(foot?.text).toBe(" · grown in 14 days in the Meadow, Bangalore");
  });
});
