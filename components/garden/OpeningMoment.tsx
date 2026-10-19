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
// slowing as it goes, and is drawn to its end as the quote leaves. The breath takes the quote up and away. CSS
// (OpeningMoment.css) does every motion with opacity and transform alone, so the compositor runs it while the main
// thread builds the garden (a blur animated word by word could not be, and froze on a busy phone); the store only says
// which beat it is.
import { Fragment, useLayoutEffect, useRef, type CSSProperties, type ReactNode } from "react";
import { firstLookScript, focusState, opening, quoteRuns, useOpening, welcomeState, WORD_MS, WORD_STAGGER_MS, wordsOf } from "@/lib/garden/opening";
import { QUOTES } from "@/lib/garden/quotes";
import "@/components/garden/OpeningMoment.css";

/**
 * Every quote's figure, built once: the same elements on the server and in the browser, so the words the first paint
 * started keep arriving through hydration. Each word is a sharp span over an aria-hidden blurred twin (the whole
 * quote is read from the status line instead).
 */
const FIGURES: readonly ReactNode[] = QUOTES.map((q, i) => {
  const words = wordsOf(q.text);
  const timing = { "--n": words.length, "--stagger": `${WORD_STAGGER_MS}ms`, "--word": `${WORD_MS}ms` } as CSSProperties;
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
    </figure>
  );
});

/**
 * The quote moment, inside a veil: every quote's figure (the one data-quote names shows), the hairline and a status for
 * screen readers. `finished` draws the hairline to its end (the plain veil lifting over a quote look); it is drawn to
 * its end as the quote leaves in any case.
 */
export function QuoteMoment({ status, finished = false }: { status: string; finished?: boolean }) {
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
    <div ref={root} className={`opening-quote${leaving ? " opening-quote-leaving" : ""}${withdrawn ? " opening-quote-withdrawn" : ""}`}>
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
