// The bloom card, design A, "the window": the photograph of the flower to the card's edges, and the words written into
// the dusk at its foot. 1080 x 1350, the portrait shape chats and Instagram show whole.
//
//   To Amma,                              Fraunces italic, gold
//   I grew this for you, a little         Fraunces, the card's ink; as large as fits in four lines (60 px down to 42),
//   every day. Happy birthday.            each paragraph balanced so no word is left alone
//   Lijas                                 italic, gold: the colleague's Meadow name, or "A friend"
//   ───────────────────────────────────
//   Enchanted Rose · grown in 14 days in the Meadow, Bangalore        meadow-phi.vercel.app
//
// The words are laid out from the foot up (layoutCard, pure and tested with a stand-in measure), and the dusk's
// gradient follows the top of the words, so a long message never sits on the bare photograph. A message that will not
// fit in four lines is written smaller, down to six lines at 34 px; past that (140 wide letters, or emoji) it would
// climb over the flower, and the layout says so (overflow), as it does for a "To" name too long for one line at 30 px:
// the sheet then asks for fewer words rather than sending a crowded card. Letters in a script
// Fraunces lacks are drawn upright from the system's own faces (a faked italic of Tamil or Devanagari reads badly).
import { beyondLatin, clipText, fitMessage, grownWords, type Measure } from "@/components/care/bloomCard";
import type { CardFonts } from "@/components/care/cardFonts";

export const CARD_W = 1080;
export const CARD_H = 1350;

const INK = "#f6ead6";
const INK_2 = "rgba(246, 234, 214, 0.78)";
const INK_3 = "rgba(246, 234, 214, 0.58)";
const GOLD = "#f2cd8e";
const RULE = "rgba(242, 205, 142, 0.3)";

const PAD_X = 76;
const PAD_FOOT = 66;
const WIDTH = CARD_W - 2 * PAD_X;
const GAP = 24;
const ITALIC = { size: 46, lead: 1.2 };
const MESSAGE = { max: 60, min: 42, floor: 34, step: 2, lines: 4, most: 6, lead: 1.26, leadWide: 1.45 };
const TO_MIN = 30;
const FOOT = { size: 24, small: 21, lead: 1.35, above: 28, gap: 32 };

export interface CardWords {
  /** the "To" line's name, or "" for none */
  to: string;
  paragraphs: string[];
  from: string;
  species: string;
  days: number;
  domain: string;
}

/** Measures for each face at a size. */
export interface CardMeasures {
  roman: (size: number) => Measure;
  italic: (size: number, upright: boolean) => Measure;
  sans: (size: number, weight: 400 | 500) => Measure;
}

export interface Lettering {
  text: string;
  x: number;
  /** baseline */
  y: number;
  size: number;
  face: "roman" | "italic" | "sans";
  weight: 400 | 500;
  colour: string;
  align: "left" | "right";
}

export interface CardLayout {
  lines: Lettering[];
  rule: { y: number };
  /** where the words begin: the dusk deepens from above it */
  top: number;
  messageSize: number;
  /** words that do not fit as the card is designed: a message past six lines at its smallest, a name past one line */
  overflow: { message: boolean; to: boolean };
}

/** A line's baseline inside its line box. */
const baseline = (top: number, size: number, lead: number) => top + (size * lead) / 2 + size * 0.33;

/** The words on the card, from the foot up. */
export function layoutCard(w: CardWords, m: CardMeasures): CardLayout {
  const lines: Lettering[] = [];
  // the foot: the flower, how long it took, and the garden's address at the right (Bangalore kept if a smaller size
  // makes room for it)
  const fits = (size: number, words: string) =>
    m.sans(size, 500)(w.species) + m.sans(size, 400)(` · ${words}`) + FOOT.gap + m.sans(size, 400)(w.domain) <= WIDTH;
  const choices: [number, string][] = [
    [FOOT.size, grownWords(w.days)],
    [FOOT.small, grownWords(w.days)],
    [FOOT.size, grownWords(w.days, false)],
    [FOOT.small, grownWords(w.days, false)],
  ];
  const chosen = choices.find(([size, words]) => fits(size, words));
  const [footSize, grown] = chosen ?? choices[choices.length - 1];
  // a host too long for the foot (a Preview's) is cut short rather than written over the words beside it
  const room = WIDTH - FOOT.gap - m.sans(footSize, 500)(w.species) - m.sans(footSize, 400)(` · ${grown}`);
  const domain = chosen ? w.domain : clipText(w.domain, Math.max(0, room), m.sans(footSize, 400));
  const footBox = footSize * FOOT.lead;
  const footTop = CARD_H - PAD_FOOT - footBox;
  const fy = baseline(footTop, footSize, FOOT.lead);
  lines.push({ text: w.species, x: PAD_X, y: fy, size: footSize, face: "sans", weight: 500, colour: INK_2, align: "left" });
  lines.push({
    text: ` · ${grown}`,
    x: PAD_X + m.sans(footSize, 500)(w.species),
    y: fy,
    size: footSize,
    face: "sans",
    weight: 400,
    colour: INK_3,
    align: "left",
  });
  lines.push({ text: domain, x: CARD_W - PAD_X, y: fy, size: footSize, face: "sans", weight: 400, colour: INK_3, align: "right" });
  const ruleY = footTop - FOOT.above;
  let bottom = ruleY - FOOT.above;

  // the sender
  const fromUpright = beyondLatin(w.from);
  const italicBox = ITALIC.size * ITALIC.lead;
  bottom -= italicBox;
  lines.push({
    text: w.from,
    x: PAD_X,
    y: baseline(bottom, ITALIC.size, ITALIC.lead),
    size: ITALIC.size,
    face: fromUpright ? "roman" : "italic",
    weight: 400,
    colour: GOLD,
    align: "left",
  });

  // the message, as large as fits in four lines, else smaller in up to six
  let fitted = fitMessage(w.paragraphs, WIDTH, m.roman, MESSAGE, MESSAGE.lines);
  if (fitted.lines > MESSAGE.lines) fitted = fitMessage(w.paragraphs, WIDTH, m.roman, { max: MESSAGE.min, min: MESSAGE.floor, step: MESSAGE.step }, MESSAGE.most);
  const wide = w.paragraphs.some(beyondLatin);
  const lead = wide ? MESSAGE.leadWide : MESSAGE.lead;
  const msgBox = fitted.size * lead;
  const msg = fitted.paragraphs.flat();
  if (msg.length > 0) {
    bottom -= GAP + msg.length * msgBox;
    msg.forEach((text, i) =>
      lines.push({
        text,
        x: PAD_X,
        y: baseline(bottom + i * msgBox, fitted.size, lead),
        size: fitted.size,
        face: "roman",
        weight: 400,
        colour: INK,
        align: "left",
      }),
    );
  }

  // to whom, shrunk to one line if a long name needs it
  let toOver = false;
  if (w.to) {
    const text = `To ${w.to},`;
    const upright = beyondLatin(w.to);
    let size = ITALIC.size;
    while (size > TO_MIN && m.italic(size, upright)(text) > WIDTH) size -= 2;
    toOver = m.italic(size, upright)(text) > WIDTH;
    bottom -= GAP + italicBox;
    // a smaller name sits at the foot of its line's room, close to the words it introduces
    const y = baseline(bottom + italicBox - size * ITALIC.lead, size, ITALIC.lead);
    lines.push({ text, x: PAD_X, y, size, face: upright ? "roman" : "italic", weight: 400, colour: GOLD, align: "left" });
  }
  return { lines, rule: { y: ruleY }, top: bottom, messageSize: fitted.size, overflow: { message: fitted.lines > MESSAGE.most, to: toOver } };
}

const fontOf = (l: Pick<Lettering, "face" | "size" | "weight">, f: CardFonts) =>
  l.face === "italic" ? `italic 400 ${l.size}px ${f.italic}` : l.face === "roman" ? `400 ${l.size}px ${f.roman}` : `${l.weight} ${l.size}px ${f.sans}`;

/** Measures on this canvas, in the card's faces. */
export function canvasMeasures(ctx: CanvasRenderingContext2D, f: CardFonts): CardMeasures {
  const at = (font: string): Measure => (text) => {
    ctx.font = font;
    return ctx.measureText(text).width;
  };
  return {
    roman: (size) => at(fontOf({ face: "roman", size, weight: 400 }, f)),
    italic: (size, upright) => at(fontOf({ face: upright ? "roman" : "italic", size, weight: 400 }, f)),
    sans: (size, weight) => at(fontOf({ face: "sans", size, weight }, f)),
  };
}

/** Paints the card: the photograph (or, while it is being taken, the dusk alone), the dusk at its foot, the words. */
export function drawCard(ctx: CanvasRenderingContext2D, photo: CanvasImageSource | null, w: CardWords, f: CardFonts): CardLayout {
  const c = ctx.canvas;
  if (c.width !== CARD_W || c.height !== CARD_H) {
    c.width = CARD_W;
    c.height = CARD_H;
  }
  ctx.save();
  ctx.globalAlpha = 1;
  if (photo) ctx.drawImage(photo, 0, 0, CARD_W, CARD_H);
  else {
    const g = ctx.createLinearGradient(0, 0, 0, CARD_H);
    g.addColorStop(0, "#3a2a1c");
    g.addColorStop(0.55, "#22180f");
    g.addColorStop(1, "#15100c");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, CARD_W, CARD_H);
  }
  const layout = layoutCard(w, canvasMeasures(ctx, f));

  // the dusk, from a little above the words to the foot
  const from = layout.top - 325;
  const span = CARD_H - from;
  const stop = (y: number) => Math.min(1, Math.max(0, (y - from) / span));
  const shade = ctx.createLinearGradient(0, from, 0, CARD_H);
  shade.addColorStop(0, "rgba(18, 12, 8, 0)");
  shade.addColorStop(stop(layout.top - 136), "rgba(18, 12, 8, 0.25)");
  shade.addColorStop(stop(layout.top + 134), "rgba(18, 12, 8, 0.78)");
  shade.addColorStop(1, "rgba(18, 12, 8, 0.94)");
  ctx.fillStyle = shade;
  ctx.fillRect(0, Math.max(0, from), CARD_W, CARD_H - Math.max(0, from));

  ctx.fillStyle = RULE;
  ctx.fillRect(PAD_X, Math.round(layout.rule.y), WIDTH, 2);

  ctx.textBaseline = "alphabetic";
  for (const l of layout.lines) {
    ctx.font = fontOf(l, f);
    ctx.textAlign = l.align;
    ctx.fillStyle = l.colour;
    ctx.fillText(l.text, l.x, l.y);
  }
  ctx.restore();
  return layout;
}
