// The faces the bloom card is lettered in: Fraunces upright (components/gift/fonts, already on the garden page), its
// true italic for the "To" line and the sender, and Geist (the page's own) for the small print at the foot. The italic
// is loaded only by the card's sheet and never preloaded, so no page pays for it until someone sends a bloom.
//
// A canvas never redraws when a font arrives, so the sheet waits for these (loadCardFonts) before it letters the card,
// asking for the very letters it will draw: the faces are split by script, and loading the Latin one does not bring the
// rest. Fraunces has no Indic letters; those fall to the system's own (Noto on Android, the Sangam faces on an iPhone,
// Nirmala on Windows), so the stacks end in real families, not Fraunces' metric-matched fallback alone.
import { Fraunces } from "next/font/google";
import { display } from "@/components/gift/fonts";

const italicFace = Fraunces({
  subsets: ["latin"],
  style: "italic",
  axes: ["opsz"],
  preload: false,
  display: "swap",
});

const SERIF_TAIL = `"Noto Serif", Georgia, serif`;

export interface CardFonts {
  roman: string;
  italic: string;
  sans: string;
}

/** The card's font stacks, as a canvas names them. */
export function cardFonts(): CardFonts {
  let geist = "";
  try {
    geist = getComputedStyle(document.documentElement).getPropertyValue("--font-geist-sans").trim();
  } catch {
    // no page styles: the system's sans
  }
  return {
    roman: `${display.style.fontFamily}, ${SERIF_TAIL}`,
    italic: `${italicFace.style.fontFamily}, ${SERIF_TAIL}`,
    sans: `${geist ? `${geist}, ` : ""}system-ui, -apple-system, "Segoe UI", Roboto, sans-serif`,
  };
}

/**
 * Loads the faces for these very letters, for at most `ms`. True when every face that was asked for arrived; false
 * when one did not (the card is lettered anyway, and again when they come).
 */
export async function loadCardFonts(f: CardFonts, text: { roman: string; italic: string; sans: string }, ms = 2500): Promise<boolean> {
  if (typeof document === "undefined" || !document.fonts?.load) return false;
  const loads = Promise.all([
    document.fonts.load(`400 52px ${f.roman}`, text.roman || "A"),
    document.fonts.load(`italic 400 46px ${f.italic}`, text.italic || "A"),
    document.fonts.load(`400 24px ${f.sans}`, text.sans || "A"),
    document.fonts.load(`500 24px ${f.sans}`, text.sans || "A"),
  ]).then(
    (sets) => sets.every((s) => s.length > 0),
    () => false,
  );
  let timer = 0;
  const late = new Promise<boolean>((resolve) => {
    timer = window.setTimeout(() => resolve(false), ms);
  });
  const done = await Promise.race([loads, late]);
  window.clearTimeout(timer);
  return done;
}
