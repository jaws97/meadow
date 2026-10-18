"use client";
// The opening's own pieces on screen (lib/garden/opening): the quote moment the garden's loading veil and the
// Meadow's hold, the welcome line, and the canvas's focus. The veils are in the page's first HTML, and the quote is
// chosen on the client only, so the prerendered veil is the night sky and the hairline alone, and the words begin to
// arrive once the page has hydrated (on the garden page once its door has said whose garden this is) and can be
// seen. The quote goes into the veil's status line as it begins, so a screen reader says it.
//
// The quote is the hero: a large italic serif in the Meadow's display stack, centred, its words arriving one at a time
// (each from a slight blur to sharp), a thin gold rule drawing under it, and the attribution, where there is one, in
// small spaced caps. Loading progress is only a gold hairline at the very bottom of the screen. The breath takes the
// quote up and away. CSS (OpeningMoment.css) does every motion, on the compositor, so nothing waits on the main
// thread while the garden builds; the store only says which beat it is.
import { Fragment, type CSSProperties } from "react";
import { focusState, quoteRuns, useOpening, welcomeState, WORD_MS, WORD_STAGGER_MS, wordsOf } from "@/lib/garden/opening";
import { QUOTES } from "@/lib/garden/quotes";
import "@/components/garden/OpeningMoment.css";

/** The quote moment, inside a veil: the quote (once the opening has one to show), the hairline and a status for screen readers. */
export function QuoteMoment({ status, progress, duration }: { status: string; progress: number; duration: string }) {
  const stage = useOpening((s) => s.stage);
  const index = useOpening((s) => s.quote);
  const reduced = useOpening((s) => s.reduced);
  const begun = useOpening((s) => s.shownAt !== null);
  const shown = index !== null && begun && (stage === "quote" || stage === "breath" || stage === "peace");
  const leaving = stage === "breath" || stage === "peace";
  const q = shown ? QUOTES[index] : null;
  const words = q ? wordsOf(q.text) : [];
  const timing = { "--n": words.length, "--stagger": `${WORD_STAGGER_MS}ms`, "--word": `${WORD_MS}ms` } as CSSProperties;
  return (
    <div className={`opening-quote${leaving ? " opening-quote-leaving" : ""}${reduced ? " opening-quote-still" : ""}`}>
      {q && (
        <figure className="opening-figure" style={timing}>
          {/* read from the status line below, so a screen reader says it once, as it arrives */}
          <blockquote>
            <span aria-hidden="true">
              {words.map((w, i) => (
                <Fragment key={i}>
                  <span className="opening-word" style={{ "--i": i } as CSSProperties}>
                    {w}
                  </span>
                  {i < words.length - 1 ? " " : null}
                </Fragment>
              ))}
            </span>
          </blockquote>
          <span className="opening-rule" aria-hidden="true" />
          {q.by && <figcaption aria-hidden="true">{q.by}</figcaption>}
        </figure>
      )}
      <div className="opening-hairline" aria-hidden="true">
        <div className="opening-hairline-fill" style={{ transform: `scaleX(${progress})`, ["--t" as string]: duration }} />
      </div>
      <p className="opening-sr" role="status">
        {q ? `${q.text}${q.by ? ` (${q.by})` : ""}` : status}
      </p>
    </div>
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
