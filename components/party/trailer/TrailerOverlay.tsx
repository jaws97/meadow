"use client";
// What the party trailer lays over the garden (components/party/trailer): the film bars, which turn the frame to
// 2.39:1 without resizing the canvas; the caption in the lower bar (a short line, and a flower's name under it in the
// montage); the black that the trailer dips through; and the closing card on it. The bars and captions move by CSS
// alone (transform and opacity, slow); the black is written by the director every frame, or eased by CSS when the
// trailer opens and closes. Its own component with its own store, so nothing here re-renders the party screen (and
// with it the canvas).
//
// The button that plays it shows only while the mouse is moving, like the cursor, so the unattended screen stays
// clean; the D key plays and stops it too.
import { useCallback } from "react";
import { canPlay, toggleTrailer } from "@/components/party/trailer/control";
import { CARD } from "@/components/party/trailer/script";
import { cover, useTrailer } from "@/components/party/trailer/store";

export function TrailerOverlay() {
  const bars = useTrailer((s) => s.bars);
  const caption = useTrailer((s) => s.caption);
  const captionOn = useTrailer((s) => s.captionOn);
  const sub = useTrailer((s) => s.sub);
  const subOn = useTrailer((s) => s.subOn);
  const card = useTrailer((s) => s.card);
  const playing = useTrailer((s) => s.phase !== "idle");
  const attach = useCallback((el: HTMLDivElement | null) => {
    cover.el = el;
  }, []);
  return (
    <div className="party-trailer" aria-hidden={!playing}>
      <div className={`party-trailer-bar party-trailer-bar-top${bars ? " party-trailer-on" : ""}`} />
      <div className={`party-trailer-bar party-trailer-bar-bottom${bars ? " party-trailer-on" : ""}`} />
      <div ref={attach} className="party-trailer-cover" />
      <div className="party-trailer-captions">
        <p className={`party-trailer-caption${captionOn ? " party-trailer-on" : ""}`}>{caption}</p>
        <p className={`party-trailer-sub${subOn ? " party-trailer-on" : ""}`}>{sub}</p>
      </div>
      <p className={`party-trailer-card${card ? " party-trailer-on" : ""}`}>{CARD.title}</p>
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
