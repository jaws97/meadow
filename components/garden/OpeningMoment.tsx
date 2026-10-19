"use client";
// The opening's own pieces on screen (lib/garden/opening): the quote moment the garden's loading veil and the
// Meadow's hold, the first-look script that starts it, the welcome line, and the canvas's focus. The veils are in the
// page's first HTML, and so is every quote, each hidden until the root element's data-quote names it: the first-look
// script (FirstLook, run as the HTML is parsed) picks the quote and starts its words with the first paint where the
// opening will surely run it, and the store sets data-quote itself otherwise (a first visit's door opening on the
// showcase, a page opened in the background once it is seen). The quote goes into the veil's status line once the
// store has it, so a screen reader says it.
//
// The quote is the hero: a large italic serif, centred, its words arriving one at a time (each a soft, blurred copy
// melting into the sharp word), a thin gold rule drawing under it, and the attribution, where there is one, in small
// spaced caps. Loading progress is a gold hairline at the very bottom of the screen that creeps from the first paint,
// slowing as it goes, and is drawn to its end as the quote leaves. So that the wait never reads as a stuck page, a few
// fireflies in the Meadow's own colours drift slowly and glow on the night sky, clear of the words, from the first
// paint until the breath; and if the garden is still not ready once the quote has been read, "The garden is waking"
// appears in small spaced capitals under the rule. The breath takes it all up and away. CSS (OpeningMoment.css) does
// every motion with opacity and transform alone, so the compositor runs it while the main thread builds the garden (a
// blur animated word by word could not be, and froze on a busy phone); the store only says which beat it is.
import { Fragment, useLayoutEffect, useRef, type CSSProperties, type ReactNode } from "react";
import {
  arrivalMs,
  dwellMs,
  firstLookScript,
  focusState,
  opening,
  quoteRuns,
  useOpening,
  welcomeState,
  WORD_MS,
  WORD_STAGGER_MS,
  wordsOf,
} from "@/lib/garden/opening";
import { QUOTES } from "@/lib/garden/quotes";
import "@/components/garden/OpeningMoment.css";

/** How long after its words begin a quote's waking line appears, if the garden is still not ready: once it has been read. */
const WAKING_AFTER_MS = 1200;

/**
 * Every quote's figure, built once: the same elements on the server and in the browser, so the words the first paint
 * started keep arriving through hydration. Each word is a sharp span over an aria-hidden blurred twin (the whole
 * quote is read from the status line instead). The waking line under the rule shows the words the veil gives it
 * (--waking) a little after the quote's own dwell would end (--wait-at), on the same clock as its words; the breath,
 * when the garden is ready sooner, takes it away before it has appeared.
 */
const FIGURES: readonly ReactNode[] = QUOTES.map((q, i) => {
  const words = wordsOf(q.text);
  const n = words.length;
  const timing = {
    "--n": n,
    "--stagger": `${WORD_STAGGER_MS}ms`,
    "--word": `${WORD_MS}ms`,
    "--wait-at": `${arrivalMs(n, false) + dwellMs(n) + WAKING_AFTER_MS}ms`,
    "--wait-at-still": `${arrivalMs(n, true) + dwellMs(n) + WAKING_AFTER_MS}ms`,
  } as CSSProperties;
  return (
    <figure key={i} className="opening-figure" data-q={i} style={timing}>
      <blockquote>
        <span aria-hidden="true">
          {words.map((w, j) => (
            <Fragment key={j}>
              <span className="opening-word" style={{ "--i": j } as CSSProperties}>
                <span className="opening-word-sharp">{w}</span>
                <span className="opening-word-soft">{w}</span>
              </span>
              {j < words.length - 1 ? " " : null}
            </Fragment>
          ))}
        </span>
      </blockquote>
      <span className="opening-rule" aria-hidden="true" />
      {q.by && <figcaption aria-hidden="true">{q.by}</figcaption>}
      <span className="opening-waking" aria-hidden="true" />
    </figure>
  );
});

type Firefly = readonly [x: number, y: number, swayX: 16 | 22 | 28, swayY: 10 | 16 | 22, xs: number, ys: number, blinks: number, phase: number, size: number, colour: string];

/** The Meadow's own firefly colours (FireflyTrolley's jar): gold, lime and green, as "r g b". */
const GOLD = "255 217 106";
const LIME = "234 245 110";
const GREEN = "216 240 112";

/**
 * The fireflies, placed clear of the quote's band: low over the horizon and high in the sky (the first nine, all that
 * a phone shows), and on wide screens a few more beside the quote's column. Each sways on two slow, unequal swings
 * across and up and down, so its path never repeats or stops at a corner, and glows and dims on its own beat, two or
 * three bright at any moment; the negative phase starts each one mid-flight. [left %, top %, sway across px, sway up
 * px, seconds across, seconds up, seconds a blink, phase s, size px, colour]
 */
const FIREFLIES: readonly Firefly[] = [
  [14, 82, 22, 16, 9.5, 7.1, 5.8, -3.1, 16, GOLD],
  [31, 90, 28, 10, 11.2, 8.3, 7.4, -11.6, 14, LIME],
  [58, 86, 16, 22, 8.7, 10.4, 6.3, -7.9, 18, GOLD],
  [79, 78, 22, 16, 12.1, 7.7, 8.1, -15.2, 15, GREEN],
  [91, 92, 16, 10, 7.9, 9.6, 5.2, -4.4, 13, GOLD],
  [44, 76, 22, 10, 10.6, 8.8, 6.9, -19.3, 12, GOLD],
  [8, 12, 16, 16, 11.8, 9.1, 8.6, -9.7, 12, LIME],
  [88, 9, 22, 10, 9.2, 10.9, 7.1, -13.8, 13, GOLD],
  [67, 95, 22, 10, 8.4, 7.4, 6.0, -1.6, 16, GOLD],
  [6, 46, 16, 22, 10.2, 8.1, 7.8, -6.2, 14, GREEN],
  [94, 38, 16, 22, 9.6, 11.3, 6.6, -17.4, 15, GOLD],
  [12, 62, 16, 16, 11.5, 9.3, 5.9, -12.3, 13, GOLD],
  [90, 64, 16, 22, 8.9, 10.1, 8.9, -21, 12, LIME],
];

const seconds = (s: number) => `${Number(s.toFixed(2))}s`;

/** The night sky's fireflies, built once (the same elements on the server and in the browser, moving from the first paint). */
const SKY = (
  <div className="opening-sky" aria-hidden="true">
    {FIREFLIES.map(([x, y, swayX, swayY, xs, ys, blinks, phase, size, colour], i) => (
      <div
        key={i}
        className={`opening-ff-x opening-ff-x${swayX}`}
        style={{ left: `${x}%`, top: `${y}%`, animationDuration: seconds(xs), animationDelay: seconds(phase) }}
      >
        <div className={`opening-ff-y opening-ff-y${swayY}`} style={{ animationDuration: seconds(ys), animationDelay: seconds(phase * 0.6) }}>
          <i
            className="opening-ff"
            style={{ "--s": `${size}px`, "--c": colour, animationDuration: seconds(blinks), animationDelay: seconds(phase * 0.7) } as CSSProperties}
          />
        </div>
      </div>
    ))}
  </div>
);

/**
 * The quote moment, inside a veil: the fireflies, every quote's figure (the one data-quote names shows), the hairline
 * and a status for screen readers. `waking` is the line shown under the rule if the wait outlasts the reading (the
 * status line already says it for a screen reader). `finished` draws the hairline to its end (the plain veil lifting
 * over a quote look); it is drawn to its end as the quote leaves in any case.
 */
export function QuoteMoment({ status, waking, finished = false }: { status: string; waking: string; finished?: boolean }) {
  const stage = useOpening((s) => s.stage);
  const index = useOpening((s) => s.quote);
  const begun = useOpening((s) => s.shownAt !== null);
  const withdrawn = useOpening((s) => s.withdrawnAt !== null);
  const shown = index !== null && begun && (stage === "quote" || stage === "breath" || stage === "peace");
  const leaving = stage === "breath" || stage === "peace";
  const q = shown ? QUOTES[index] : null;
  const root = useRef<HTMLDivElement>(null);

  // The reading time counts from the first paint of the words, not from when the store heard of them: their
  // animations' start (document timeline time, the same clock as performance.now()), once they have one.
  const reading = index !== null && begun && stage === "quote";
  useLayoutEffect(() => {
    if (!reading) return;
    const figure = root.current?.querySelector<HTMLElement>(`.opening-figure[data-q="${index}"]`);
    if (!figure || typeof figure.getAnimations !== "function") return;
    const animations = figure.getAnimations({ subtree: true });
    if (animations.length === 0) return;
    let live = true;
    void Promise.all(animations.map((a) => a.ready.catch(() => a))).then(() => {
      if (!live) return;
      const starts = animations.map((a) => Number(a.startTime)).filter((t) => Number.isFinite(t));
      if (starts.length > 0) opening.painted(Math.min(...starts));
    });
    return () => {
      live = false;
    };
  }, [reading, index]);

  return (
    <div
      ref={root}
      className={`opening-quote${leaving ? " opening-quote-leaving" : ""}${withdrawn ? " opening-quote-withdrawn" : ""}`}
      style={{ "--waking": JSON.stringify(waking) } as CSSProperties}
    >
      {SKY}
      {FIGURES}
      <div className={`opening-hairline${leaving || finished ? " opening-hairline-finished" : ""}`} aria-hidden="true">
        <div className="opening-hairline-fill" />
        <div className="opening-hairline-end" />
      </div>
      <p className="opening-sr" role="status">
        {q ? `${q.text}${q.by ? ` (${q.by})` : ""}` : status}
      </p>
    </div>
  );
}

/**
 * The first look, set on the root element as the page's HTML is parsed (it comes before the veil, so the veil's first
 * paint has it, the first words included). Rendered in the browser its type is text/plain, so React never warns of a
 * script it would not run (the type differs from the server's, hence suppressHydrationWarning), as in Next's
 * "preventing flash" guide.
 */
export function FirstLook({ page }: { page: "garden" | "meadow" }) {
  return (
    <script
      type={typeof window === "undefined" ? "text/javascript" : "text/plain"}
      suppressHydrationWarning
      dangerouslySetInnerHTML={{ __html: firstLookScript(page) }}
    />
  );
}

/**
 * "Welcome back, Asha", near the top, a few seconds into the peace: only when the visitor's own garden and name are
 * known (never for the showcase, or someone without a garden). The words go into a live region that was already on
 * the page, so a screen reader says them as they arrive.
 */
export function WelcomeLine() {
  const runs = useOpening(quoteRuns);
  const name = useOpening((s) => s.name);
  const state = useOpening(welcomeState);
  if (!runs || name === null) return null;
  const line = `Welcome back, ${name}`;
  return (
    <>
      <p className="opening-sr" role="status">
        {state === "in" ? line : ""}
      </p>
      {state && (
        <p className={`opening-welcome${state === "out" ? " opening-welcome-out" : ""}`} aria-hidden="true">
          {line}
        </p>
      )}
    </>
  );
}

/** The canvas's class while it comes into focus (soft under the veil through the breath, then sharpening), or undefined. */
export function useOpeningFocus(): string | undefined {
  const focus = useOpening(focusState);
  return focus === null ? undefined : `opening-canvas-${focus}`;
}
