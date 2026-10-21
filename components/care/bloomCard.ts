// The bloom card's words (components/care/BloomSheet draws them, drawCard lays them out): who the card is from, how long
// the flower took to grow, the line and the link that go with the picture, the file's name, and how a message is
// cleaned, counted and wrapped onto the card. Pure, so it is tested without a browser.
//
// Names and messages may be in any script and may hold emoji, so they are counted and split by grapheme (what a person
// sees as one letter), never by UTF-16 unit: a Tamil syllable or a family emoji is one letter here, as it is to its
// writer. The message is soft-limited: past MESSAGE_MAX letters the counter says so and Send waits, nothing is cut off
// under the person's fingers (an Indic keyboard composes whole words at a time). The "To" name is never cut either: the
// card writes it smaller to fit, and says when it is too long to (drawCard).
import { istDayOf } from "@/lib/client/gardens";
import type { MeView } from "@/lib/client/plant";
import { SPECIES, type SpeciesId } from "@/lib/plant/species";
import { isPondVisual } from "@/lib/sim";

export const MESSAGE_MAX = 140;
/** At most this many paragraphs (line breaks the person typed); more run on into the last. */
const PARAGRAPHS = 3;

let graphemeSeg: Intl.Segmenter | null | undefined;

/** The letters of a string as a reader sees them. */
export function graphemes(s: string): string[] {
  if (graphemeSeg === undefined) graphemeSeg = typeof Intl !== "undefined" && "Segmenter" in Intl ? new Intl.Segmenter(undefined, { granularity: "grapheme" }) : null;
  return graphemeSeg ? Array.from(graphemeSeg.segment(s), (g) => g.segment) : Array.from(s);
}

export function letterCount(s: string): number {
  return graphemes(s.trim()).length;
}

/** "An Enchanted Rose", "A Sundrop". */
export function withArticle(name: string): string {
  return `${/^[aeiou]/i.test(name) ? "An" : "A"} ${name}`;
}

/** Who the card is from: the name the colleague goes by in the Meadow, or "A friend" if they keep it private. */
export function senderOf(person: MeView["person"]): string {
  return person.showName ? person.firstName : "A friend";
}

/** Text from a field, as the card writes it: composed (NFC), single spaces, no edges. */
function tidy(s: string): string {
  return s.normalize("NFC").replace(/\s+/g, " ").trim();
}

/** The "To" line's name as the card writes it. */
export function cleanTo(s: string): string {
  return tidy(s);
}

/** The message as paragraphs: the person's own line breaks kept (blank lines dropped), at most three. */
export function messageParagraphs(s: string): string[] {
  const parts = s.normalize("NFC").split(/\n+/).map(tidy).filter(Boolean);
  if (parts.length <= PARAGRAPHS) return parts;
  return [...parts.slice(0, PARAGRAPHS - 1), parts.slice(PARAGRAPHS - 1).join(" ")];
}

/** Holds letters of a script the card's display face does not have (drawn upright, never in a faked italic). */
export function beyondLatin(s: string): boolean {
  return /[^\p{Script=Latin}\p{Script=Common}\p{Script=Inherited}]/u.test(s);
}

/**
 * How many days the flower took: from the day it was planted to the day it bloomed, in Bangalore's calendar days (the
 * "Day N" its care card showed that day). A flower after the first (a lotus's, or a bed flower's) counts to today.
 * Never less than one.
 */
export function grownDays(me: Pick<MeView, "plant" | "state" | "visual">, nowMs: number): number {
  const planted = istDayOf(Date.parse(me.plant.plantedAt));
  const later = me.state.flowerOpenedAt;
  const again = isPondVisual(me.visual) ? me.visual.flowers > 1 : !!later && later !== me.state.bloomedAt;
  const until = !again && me.state.bloomedAt ? Date.parse(me.state.bloomedAt) : nowMs;
  return Math.max(1, istDayOf(until) - planted);
}

/** The card's foot: "grown in 14 days in the Meadow, Bangalore". */
export function grownWords(days: number, place = true): string {
  return `grown in ${days === 1 ? "a day" : `${days} days`} in the Meadow${place ? ", Bangalore" : ""}`;
}

/** The living flower's page, read-only, which anyone can open. */
export function flowerLink(plot: number, origin: string): string {
  return `${origin}/meadow/garden?plot=${plot}`;
}

/** The line that goes with the picture. */
export function shareText(species: SpeciesId, plot: number, origin: string): string {
  return `${withArticle(SPECIES[species].name)} I grew for you, in the Meadow. See it growing: ${flowerLink(plot, origin)}`;
}

/** The picture's file name: plain ASCII, with no name or message in it (recipients see it in mail and chats). */
export function cardFileName(species: SpeciesId): string {
  return `meadow-${species}-bloom.jpg`;
}

// ---- wrapping -----------------------------------------------------------------------------------------------------

/** Text cut short with an ellipsis, between letters, to fit `width`. */
export function clipText(text: string, width: number, measure: Measure): string {
  if (measure(text) <= width) return text;
  const gs = graphemes(text);
  while (gs.length > 0 && measure(`${gs.join("").trimEnd()}…`) > width) gs.pop();
  return gs.length > 0 ? `${gs.join("").trimEnd()}…` : "";
}

/** The width of a run of text in the font being laid out. */
export type Measure = (text: string) => number;

/** Pieces a line may break after: each word with the space that follows it. */
function units(text: string): string[] {
  return text.split(/(?<=\s)/u).filter(Boolean);
}

/** A word too wide for any line, broken between its letters. */
function breakWord(word: string, width: number, measure: Measure): string[] {
  const out: string[] = [];
  let line = "";
  for (const g of graphemes(word)) {
    if (line && measure(line + g) > width) {
      out.push(line);
      line = g;
    } else line += g;
  }
  if (line) out.push(line);
  return out;
}

/** Greedy lines of at most `width`. */
export function wrap(text: string, width: number, measure: Measure): string[] {
  const lines: string[] = [];
  let line = "";
  for (const u of units(text)) {
    const next = line + u;
    if (measure(next.trimEnd()) <= width) {
      line = next;
      continue;
    }
    if (line.trim()) lines.push(line.trimEnd());
    if (measure(u.trimEnd()) <= width) line = u;
    else {
      const parts = breakWord(u.trimEnd(), width, measure);
      lines.push(...parts.slice(0, -1));
      line = (parts[parts.length - 1] ?? "") + (/\s$/u.test(u) ? " " : "");
    }
  }
  if (line.trim()) lines.push(line.trimEnd());
  return lines;
}

/**
 * As few lines as `wrap` gives, made as even as they can be, so no word sits alone on the last. Never narrower than the
 * widest word that fits a full line, so evening the lines never breaks a word the full width keeps whole.
 */
export function balance(text: string, width: number, measure: Measure): string[] {
  const lines = wrap(text, width, measure);
  if (lines.length < 2) return lines;
  let widest = 0;
  for (const u of units(text)) {
    const w = measure(u.trimEnd());
    if (w <= width && w > widest) widest = w;
  }
  let lo = Math.max(width * 0.5, widest);
  let hi = width;
  for (let i = 0; i < 12; i++) {
    const mid = (lo + hi) / 2;
    if (wrap(text, mid, measure).length > lines.length) lo = mid;
    else hi = mid;
  }
  return wrap(text, hi, measure);
}

export interface FittedMessage {
  size: number;
  /** lines, paragraph by paragraph */
  paragraphs: string[][];
  lines: number;
}

/**
 * The message at the largest size from `max` down to `min` (in `step`s) whose lines fit in `maxLines`, each paragraph
 * balanced; if none does, the smallest size, however many lines it takes (`lines` says).
 */
export function fitMessage(
  paragraphs: string[],
  width: number,
  measureAt: (size: number) => Measure,
  sizes: { max: number; min: number; step: number },
  maxLines: number,
): FittedMessage {
  let fitted: FittedMessage = { size: sizes.max, paragraphs: [], lines: 0 };
  for (let size = sizes.max; size >= sizes.min - 1e-6; size -= sizes.step) {
    const measure = measureAt(size);
    const laid = paragraphs.map((p) => balance(p, width, measure));
    const lines = laid.reduce((n, l) => n + l.length, 0);
    fitted = { size, paragraphs: laid, lines };
    if (lines <= maxLines) return fitted;
  }
  return fitted;
}
