"use client";
// The garden page's loading veil. It is in the page's first HTML (the route
// is prerendered), so it is on screen before any script arrives, and it
// stays up while the canvas chunk loads, the shaders compile behind it and
// the governor settles the budget (lib/garden/quality's phases). It has two
// looks, both in the first HTML, and the root element's data-veil picks one
// (LoadingVeil.css): an inline script sets it as the page is parsed, before
// the first paint (lib/garden/opening's FIRST_LOOK_SCRIPT), and the opening
// keeps it from then on.
//
// - The quote moment (OpeningMoment's QuoteMoment), for a device that has
//   shown its own garden or opened on a quote before: only the night sky and
//   a quote, with loading progress a gold hairline at the very bottom. Every
//   quote is in the first HTML; the inline script picks one and, for a plain
//   address (no garden link, no party code), starts its words with the first
//   paint, while the door is still finding out whose garden this is (the
//   visitor's own, or the showcase); otherwise the words begin once the door
//   has answered. The veil then holds
//   the garden's reveal (RenderBudget) until the quote has been read, and
//   after the breath fades over the garden coming into focus, on the
//   opening's clock rather than the governor's.
// - The plain veil, for a first visit (the party's QR code: the gift's own
//   first look comes over it) and a quote moment on this device less than
//   ten minutes ago: a seed of light on a night-garden sky, its sprout
//   swaying, a halo breathing round it and motes drifting up, over one line,
//   "The garden is waking" (WAKING_LINE, the same words the gift's first look
//   uses), and a thin vine of progress that creeps from the first paint (as
//   the quote's hairline does), fading over a second and a half into the
//   first frame. On a return visit the sky behind the sprout is the
//   garden itself, as this device last saw it (poster.ts), softly blurred, so
//   the first instant already shows the colleague's own flower. When a first
//   visit's door opens on the showcase, the sprout crosses over to the quote.
//
// The veil belongs to the first opening only. Once the garden has been seen
// it never comes back: a later tier change holds a still of the garden
// instead (frameHold.ts). The vine and the hairline creep on time alone, so a
// tier step under the veil never sends them backwards.
//
// The motion is CSS on HTML elements (LoadingVeil.css, OpeningMoment.css),
// opacity and transform only, so it runs on the compositor and never
// stutters while the main thread works. The art is drawn here, original to
// the garden.
import { useLayoutEffect, useSyncExternalStore, type CSSProperties, type ReactNode } from "react";
import { FirstLook, QuoteMoment } from "@/components/garden/OpeningMoment";
import { lookOf, readPoster } from "@/components/garden/poster";
import { opening, useOpening, VEIL_FADE_MS } from "@/lib/garden/opening";
import { garden } from "@/lib/garden/store";
import { useQuality } from "@/lib/garden/quality";
import "@/components/garden/LoadingVeil.css";

/** The one loading line, wherever the garden is loading (the gift's first look says it too). */
export const WAKING_LINE = "The garden is waking";

/** Motes: horizontal drift (px), duration and delay (s). Negative delays start them mid-flight. */
const MOTES: ReadonlyArray<[number, number, number]> = [
  [-26, 7.2, -1.1],
  [18, 6.1, -3.9],
  [-8, 8.4, -5.6],
  [34, 7.8, -0.4],
  [-38, 6.6, -2.7],
  [10, 9.1, -6.8],
  [-16, 7.5, -4.4],
];

// The remembered still never changes while the veil is up, so there is nothing to subscribe to.
const subscribeNever = () => () => {};
let posterCache: string | null | undefined;
const readPosterOnce = () => {
  if (posterCache === undefined) posterCache = readPoster(lookOf(garden.get()));
  return posterCache;
};
const serverPoster = () => null;

function Sprout() {
  return (
    <svg viewBox="0 0 148 148" width="148" height="148" aria-hidden="true">
      <defs>
        <radialGradient id="veil-seed" cx="45%" cy="40%" r="65%">
          <stop offset="0%" stopColor="#fff2c8" />
          <stop offset="55%" stopColor="#ffc56e" />
          <stop offset="100%" stopColor="#d9893c" />
        </radialGradient>
        <linearGradient id="veil-leaf-l" x1="1" y1="1" x2="0" y2="0">
          <stop offset="0%" stopColor="#5f9f5a" />
          <stop offset="100%" stopColor="#a9d98a" />
        </linearGradient>
        <linearGradient id="veil-leaf-r" x1="0" y1="1" x2="1" y2="0">
          <stop offset="0%" stopColor="#4f8d50" />
          <stop offset="100%" stopColor="#b7e39a" />
        </linearGradient>
        <radialGradient id="veil-bud" cx="50%" cy="35%" r="70%">
          <stop offset="0%" stopColor="#ffe0c2" />
          <stop offset="60%" stopColor="#f6a481" />
          <stop offset="100%" stopColor="#d9705a" />
        </radialGradient>
      </defs>
      {/* the soil line */}
      <path d="M40 126 Q74 117 108 126" fill="none" stroke="rgba(246,234,214,0.22)" strokeWidth="1.2" strokeLinecap="round" />
      {/* stem */}
      <path d="M74 119 C72.6 105 76.4 92 74 76" fill="none" stroke="#8fc271" strokeWidth="2.2" strokeLinecap="round" />
      {/* leaves, each with a pale midrib */}
      <path d="M73.6 99 C63 97.5 53.5 91 49.5 80.5 C60.5 80 70 86.5 73.6 99 Z" fill="url(#veil-leaf-l)" />
      <path d="M73 98 C66 94 58 88 52.5 82" fill="none" stroke="rgba(236,248,214,0.45)" strokeWidth="0.8" strokeLinecap="round" />
      <path d="M74.6 88 C85.5 84.5 96.5 76 100 63.5 C87.5 64 78.5 72.5 74.6 88 Z" fill="url(#veil-leaf-r)" />
      <path d="M75.4 86.5 C83 80.5 91.5 73 97 66" fill="none" stroke="rgba(236,248,214,0.45)" strokeWidth="0.8" strokeLinecap="round" />
      {/* a closed bud, the promise of the flower */}
      <path d="M74 64 C79.5 68.5 79.8 75 74 78.5 C68.2 75 68.5 68.5 74 64 Z" fill="url(#veil-bud)" />
      {/* the seed of light it grew from */}
      <ellipse cx="74" cy="121.5" rx="7.5" ry="5" fill="url(#veil-seed)" />
    </svg>
  );
}

/** The plain veil's sprout, its one line and its vine of progress (`finished`: drawn to its end as the veil lifts). */
function PlainLook({ finished }: { finished: boolean }) {
  return (
    <div className="garden-veil-content">
      <div className="garden-veil-art">
        <div className="garden-veil-halo" />
        {MOTES.map(([dx, d, delay], i) => (
          <span
            key={i}
            className="garden-veil-mote"
            style={{ ["--dx" as string]: `${dx}px`, ["--d" as string]: `${d}s`, ["--delay" as string]: `${delay}s` }}
          />
        ))}
        <div className="garden-veil-sprout">
          <Sprout />
        </div>
      </div>
      <p className="garden-veil-title" role="status">
        {WAKING_LINE}
      </p>
      <div className={`garden-veil-track${finished ? " garden-veil-finished" : ""}`}>
        <div className="garden-veil-fill" />
        <div className="garden-veil-end" />
      </div>
    </div>
  );
}

export function LoadingVeil() {
  const phase = useQuality((s) => s.phase);
  const veiled = useQuality((s) => s.veiled);
  const stage = useOpening((s) => s.stage);
  const look = useOpening((s) => s.look);
  const soft = useOpening((s) => s.soft && !s.reduced);
  const focused = useOpening((s) => s.focusedAt !== null);
  const poster = useSyncExternalStore(subscribeNever, readPosterOnce, serverPoster);
  // The opening begins once the page has hydrated (adopting a quote the first paint began), and waits for the door to
  // say whose garden this is. Before the first paint after hydration, so the look and the quote it puts back on the
  // root (React's development remount clears them) never flicker.
  useLayoutEffect(() => {
    opening.begin(true);
    opening.resync();
  }, []);

  // The veil's element and its two looks stay the same elements from the first HTML on, so a change of look crosses
  // over (LoadingVeil.css) and nothing already painted starts again.
  let veil: ReactNode = null;
  if (stage === "quote" || stage === "breath" || (stage === "peace" && !focused)) {
    // The quote moment, until the garden is in focus behind it: the opening's clock, not the governor's. A sprout
    // that was showing fades out as the quote arrives.
    const lifting = stage === "peace";
    const fade = { transitionDuration: `${soft ? VEIL_FADE_MS.soft : VEIL_FADE_MS.plain}ms` } as CSSProperties;
    veil = (
      <div className={`garden-veil-veil${lifting ? " garden-veil-out" : ""}`} style={fade} aria-hidden={lifting}>
        {null}
        {stage === "quote" && <PlainLook finished={false} />}
        <QuoteMoment status={WAKING_LINE} />
      </div>
    );
  } else if (stage === "unset" || stage === "pending" || (stage === "skip" && veiled && phase !== "live")) {
    // Waiting for the door, or the opening skipped: whichever look was painted first stays, fading on the
    // governor's reveal (a skip after a door that never answered keeps the night sky, with no sprout arriving).
    const out = stage === "skip" && phase === "revealing";
    const still = poster !== null && look === "plain" && stage !== "unset" ? poster : null;
    veil = (
      <div className={`garden-veil-veil${still ? " garden-veil-has-poster" : ""}${out ? " garden-veil-out" : ""}`} aria-hidden={out}>
        {still && <div className="garden-veil-poster" style={{ backgroundImage: `url(${still})` }} />}
        <PlainLook finished={out} />
        <QuoteMoment status={WAKING_LINE} finished={out} />
      </div>
    );
  }
  return (
    <>
      <FirstLook page="garden" />
      {veil}
    </>
  );
}
