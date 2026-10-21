"use client";
// What the party trailer lays over the garden (components/party/trailer): the film bars, which turn the frame to
// 2.39:1 without resizing the canvas; the black that the trailer dips through; and the type, one layer above the
// black (so words stand on it and ride its dips) and below the panel. The type is a line of words in the lower third,
// each word fading and rising in as its group's bell strikes; in the montage, the flower's name under that line; the
// title on black, its letters gathering under the panel's crest; and the closing tagline, centred over the coda's
// seed (--coda-x, which the director sets on the root). The bars and the type move by CSS alone (transform and
// opacity, slow): the store only says what is on, so the overlay renders a handful of times a trailer, and every
// element stays mounted, so each fade runs from its resting state. The black is written by the director every frame,
// or eased by CSS when the trailer opens and closes. Its own component with its own store, so nothing here re-renders
// the party screen (and with it the canvas).
//
// The button that plays it shows only while the mouse is moving, like the cursor, so the unattended screen stays
// clean; the D key plays and stops it too.
import { Fragment, useCallback, type CSSProperties } from "react";
import { canPlay, toggleTrailer } from "@/components/party/trailer/control";
import {
  END_TITLE,
  LINE_OUT_S,
  LINES,
  MONTAGE,
  TAGLINE,
  TAGLINE_FADE_S,
  WORD_IN_S,
  WORD_STAGGER_S,
  type Line,
} from "@/components/party/trailer/script";
import { cover, overlayRoot, useTrailer } from "@/components/party/trailer/store";
import { SPECIES } from "@/lib/plant/species";

const v = (vars: Record<string, string>) => vars as CSSProperties;

/** The script's own timings, handed to the stylesheet, so a line is readable exactly when the script says it is. */
const TIMINGS = v({
  "--word-in": `${WORD_IN_S}s`,
  "--line-out": `${LINE_OUT_S}s`,
  "--tagline-fade": `${TAGLINE_FADE_S}s`,
});

/** The montage's names, in order, each with its own element, so one can still be fading out as the next comes in. */
const NAMES: readonly string[] = MONTAGE.map((id) => SPECIES[id].name);

/** The title's letters start this far apart (a share of the letter size, per place from the middle) and gather... */
const TITLE_GATHER_EM = 0.12;
/** ...the middle ones first, each place outward starting this much later (s). */
const TITLE_STAGGER_S = 0.06;

function round(x: number) {
  return Math.round(x * 1000) / 1000;
}

/** The title's letters (none without a title), each with where it gathers from (--dx) and when it starts (--d). */
const LETTERS = Array.from(END_TITLE ?? "").map((ch, i, all) => {
  const k = i - (all.length - 1) / 2;
  return {
    ch: ch === " " ? "\u00a0" : ch,
    style: v({ "--dx": `${round(k * TITLE_GATHER_EM)}em`, "--d": `${round(Math.abs(k) * TITLE_STAGGER_S)}s` }),
  };
});

export function TrailerOverlay() {
  const bars = useTrailer((s) => s.bars);
  const line = useTrailer((s) => s.line);
  const lineGroups = useTrailer((s) => s.lineGroups);
  const lineOn = useTrailer((s) => s.lineOn);
  const name = useTrailer((s) => s.name);
  const nameOn = useTrailer((s) => s.nameOn);
  const title = useTrailer((s) => s.title);
  const tagline = useTrailer((s) => s.tagline);
  const live = useTrailer((s) => s.phase !== "idle");
  const attachRoot = useCallback((el: HTMLDivElement | null) => {
    overlayRoot.el = el;
  }, []);
  const attach = useCallback((el: HTMLDivElement | null) => {
    cover.el = el;
  }, []);
  return (
    <div ref={attachRoot} className={`party-trailer${live ? " party-trailer-live" : ""}`} aria-hidden={!live}>
      <div className={`party-trailer-bar party-trailer-bar-top${bars ? " party-trailer-on" : ""}`} />
      <div className={`party-trailer-bar party-trailer-bar-bottom${bars ? " party-trailer-on" : ""}`} />
      <div ref={attach} className="party-trailer-cover" />
      <div className="party-trailer-type" style={TIMINGS}>
        {LINES.map((l) => (
          <TypeLine key={l.id} line={l} on={lineOn && line === l.id} groups={line === l.id ? lineGroups : 0} />
        ))}
        {NAMES.map((n, i) => (
          <p key={i} className={`party-trailer-name${nameOn && name === n ? " party-trailer-on" : ""}`}>
            {n}
          </p>
        ))}
        <div className={`party-trailer-title${title ? " party-trailer-on" : ""}`}>
          <TitleCrest alone={END_TITLE === null} />
          {END_TITLE !== null && (
            <p className="party-trailer-title-word">
              {LETTERS.map((l, i) => (
                <span key={i} className="party-trailer-letter" style={l.style}>
                  {l.ch}
                </span>
              ))}
            </p>
          )}
        </div>
        <p className="party-trailer-tagline">
          <span className={`party-trailer-tagline-text${tagline ? " party-trailer-on" : ""}`}>{TAGLINE}</span>
        </p>
      </div>
    </div>
  );
}

/**
 * One line of words. While it is on, its first `groups` reveal groups show, each word a little after the one before
 * it in its group; when it goes off it fades as a whole with its words still up, and they go back down only once the
 * line is unseen (another line, or the next run).
 */
function TypeLine({ line, on, groups }: { line: Line; on: boolean; groups: number }) {
  return (
    <p className={`party-trailer-line${on ? " party-trailer-on" : ""}`}>
      {line.groups.map((g, gi) =>
        g.words.map((word, wi) => (
          <Fragment key={`${gi}-${wi}`}>
            {(gi > 0 || wi > 0) && " "}
            <span
              className={`party-trailer-word${gi < groups ? " party-trailer-on" : ""}`}
              style={v({ "--d": `${round(wi * WORD_STAGGER_S)}s` })}
            >
              {word}
            </span>
          </Fragment>
        )),
      )}
    </p>
  );
}

/**
 * The panel's crest (GiftPanel's rosebud on a fine gold rule), with its own gradient ids, drawn as two layers on the
 * same box: the rules, which open from the middle, and the bud, which fades in. Each layer is an element of its own, so
 * both move on the compositor. The rules' gradients are in the drawing's own units: a gradient measured on a line's
 * box (which has no height) is not drawn at all.
 */
function TitleCrest({ alone }: { alone: boolean }) {
  return (
    <div className={`party-trailer-crest${alone ? " party-trailer-crest-alone" : ""}`} aria-hidden="true">
      <svg className="party-trailer-crest-rules" viewBox="0 0 220 26">
        <defs>
          <linearGradient id="party-trailer-crest-l" gradientUnits="userSpaceOnUse" x1="6" x2="88" y1="0" y2="0">
            <stop offset="0" stopColor="#e8c480" stopOpacity="0" />
            <stop offset="1" stopColor="#e8c480" stopOpacity="0.75" />
          </linearGradient>
          <linearGradient id="party-trailer-crest-r" gradientUnits="userSpaceOnUse" x1="214" x2="132" y1="0" y2="0">
            <stop offset="0" stopColor="#e8c480" stopOpacity="0" />
            <stop offset="1" stopColor="#e8c480" stopOpacity="0.75" />
          </linearGradient>
        </defs>
        <path d="M6 15.5 H88" stroke="url(#party-trailer-crest-l)" strokeWidth="1" />
        <path d="M132 15.5 H214" stroke="url(#party-trailer-crest-r)" strokeWidth="1" />
      </svg>
      <svg className="party-trailer-crest-bud" viewBox="0 0 220 26">
        <defs>
          <radialGradient id="party-trailer-crest-bud" cx="50%" cy="38%" r="70%">
            <stop offset="0" stopColor="#ff8a9a" />
            <stop offset="0.6" stopColor="#d61f36" />
            <stop offset="1" stopColor="#8e0f24" />
          </radialGradient>
        </defs>
        <path d="M110 24 V16" stroke="#c9a866" strokeWidth="1" strokeLinecap="round" />
        <path d="M109.6 19 C102.5 19.4 96.5 16.8 93 12.4 C100.6 11.6 106.6 14.4 109.6 19 Z" fill="#c9a866" opacity="0.9" />
        <path d="M110.4 19 C117.5 19.4 123.5 16.8 127 12.4 C119.4 11.6 113.4 14.4 110.4 19 Z" fill="#c9a866" opacity="0.9" />
        <path d="M110 2.6 C115.4 5.4 116 11.6 110 16.4 C104 11.6 104.6 5.4 110 2.6 Z" fill="url(#party-trailer-crest-bud)" />
        <path d="M110.2 5.4 C112.6 7.6 112.8 11.4 110.4 14.6" fill="none" stroke="#ffc2cb" strokeWidth="0.8" strokeLinecap="round" opacity="0.7" />
      </svg>
    </div>
  );
}

/** Plays or stops the trailer; shown while the mouse moves and the garden is showing. */
export function TrailerButton({ awake, live }: { awake: boolean; live: boolean }) {
  const phase = useTrailer((s) => s.phase);
  const idle = phase === "idle";
  const shown = awake && live && phase !== "closing";
  return (
    <button
      type="button"
      className={`party-trailer-button${shown ? " party-trailer-on" : ""}`}
      tabIndex={shown ? 0 : -1}
      aria-hidden={!shown}
      onClick={(e) => {
        // so Space or Enter cannot press it again behind the trailer
        e.currentTarget.blur();
        // the second click of a double-click must not stop what the first started (a key press has detail 0)
        if (e.detail > 1) return;
        if (!idle || canPlay()) toggleTrailer();
      }}
    >
      <span className="party-trailer-glyph" aria-hidden>
        {idle ? "▶" : "■"}
      </span>
      {idle ? "Play the trailer" : "Stop the trailer"}
    </button>
  );
}
