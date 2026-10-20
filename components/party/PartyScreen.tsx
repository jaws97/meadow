"use client";
// The party's big screen (/party?code=...): Lijas's Enchanted Rose garden in
// full bloom at golden hour, filling a 1080p or 4K venue screen driven by a
// laptop, with the gift panel (GiftPanel) beside it and a small museum-style
// caption. Nothing on it needs a hand: the camera moves by itself, the tally
// updates by itself, the cursor hides when the mouse rests, and the laptop is
// asked not to sleep (Screen Wake Lock). It makes no sound.
//
// Hidden keys for the operator: H shows or hides the panel (the rose glides
// back to the middle), T starts or stops the slow tour, F toggles full
// screen, D plays or stops the trailer (components/party/trailer: the seed,
// the rose growing through a day, the doe, night and the other flowers, in
// the live garden, about a minute and a half), which a button in the
// corner also plays while the mouse moves; it has music written for it
// (trailer/score.ts), which M mutes and `?music=off` leaves out. While it
// plays H, T and F wait.
// `?panel=off` and `?tour=on` set the opening state, and `?hour=21.5`
// lights the garden at another hour for a rehearsal (logic.ts showcaseHour).
//
// The showcase is staged in the garden's store before the canvas's chunk
// arrives: Lijas's seed, the rose, full grown and in bloom, the clock held at
// golden hour, clear and dry, so the opening compiles exactly what is shown.
// If the 3D garden cannot start (no WebGL, or it fails) the panel stands
// alone on a quiet backdrop, and the QR code is always there.
import { catchError, type ErrorInfo } from "next/error";
import dynamic from "next/dynamic";
import { useEffect, useLayoutEffect, useState, useSyncExternalStore } from "react";
import { GiftPanel } from "@/components/party/GiftPanel";
import { OWNER, readPartyCode, readSwitch, type PartyCode } from "@/components/party/logic";
import { PartyVeil } from "@/components/party/PartyVeil";
import { stageShowcase } from "@/components/party/showcase";
import { party, useParty } from "@/components/party/store";
import { stopTrailer, toggleTrailer } from "@/components/party/trailer/control";
import { music } from "@/components/party/trailer/music";
import { trailer } from "@/components/party/trailer/store";
import { TrailerButton, TrailerOverlay } from "@/components/party/trailer/TrailerOverlay";
import { useQuality } from "@/lib/garden/quality";
import { SPECIES } from "@/lib/plant/species";
import "@/components/party/party.css";

// The veil covers the canvas while its chunk loads, so the fallback draws nothing.
const PartyCanvas = dynamic(() => import("@/components/party/PartyCanvas"), { ssr: false, loading: () => null });

/** The panel shows by this long after opening even if the garden is still settling, so the QR code is never held back. */
const PANEL_DEADLINE_MS = 30_000;
/** The cursor hides after the mouse has rested this long. */
const CURSOR_REST_MS = 2500;
/** How long an operator's key note stays in the corner. */
const NOTE_MS = 2400;

// The address never changes while the screen is open, so there is nothing to subscribe to.
const subscribeNever = () => () => {};
let codeCache: { search: string; code: PartyCode } | null = null;
const readCode = (): PartyCode => {
  const search = window.location.search;
  if (codeCache?.search !== search) codeCache = { search, code: readPartyCode(search) };
  return codeCache.code;
};
const serverCode = (): PartyCode | null => null;

function SceneFailed({ error }: { error: unknown }) {
  useEffect(() => {
    console.error("[party] the garden could not start; showing the panel alone", error);
    party.set({ fallback: true });
    // a trailer playing over it ends (its bars and black go; the fallback shows the panel at once)
    stopTrailer();
  }, [error]);
  return null;
}

/** Catches a garden that cannot start (no WebGL, a lost context, a failed chunk) so the panel carries on. */
const SceneBoundary = catchError((_props: object, { error }: ErrorInfo) => <SceneFailed error={error} />);

function toggleFullscreen() {
  try {
    if (document.fullscreenElement) void document.exitFullscreen();
    else void document.documentElement.requestFullscreen?.();
  } catch {
    // some browsers refuse full screen outside a direct click; F11 still works
  }
}

/** Keeps the laptop driving the venue screen awake while the page is showing. */
function useWakeLock() {
  useEffect(() => {
    if (!("wakeLock" in navigator)) return;
    let lock: WakeLockSentinel | null = null;
    let gone = false;
    const acquire = async () => {
      if (gone || document.visibilityState !== "visible" || (lock && !lock.released)) return;
      try {
        lock = await navigator.wakeLock.request("screen");
      } catch {
        // refused (battery saver, policy): the screen may sleep, nothing else changes
      }
    };
    const onVisible = () => void acquire();
    void acquire();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      gone = true;
      document.removeEventListener("visibilitychange", onVisible);
      void lock?.release().catch(() => {});
    };
  }, []);
}

/** True once the mouse has rested for a moment: the cursor then hides. */
function useRestingCursor(): boolean {
  const [resting, setResting] = useState(false);
  useEffect(() => {
    let timer = window.setTimeout(() => setResting(true), CURSOR_REST_MS);
    const onMove = () => {
      setResting(false);
      window.clearTimeout(timer);
      timer = window.setTimeout(() => setResting(true), CURSOR_REST_MS);
    };
    window.addEventListener("pointermove", onMove, { passive: true });
    window.addEventListener("pointerdown", onMove, { passive: true });
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerdown", onMove);
    };
  }, []);
  return resting;
}

export function PartyScreen({ className = "" }: { className?: string }) {
  const code = useSyncExternalStore(subscribeNever, readCode, serverCode);
  const panelOn = useParty((s) => s.panel);
  const fallback = useParty((s) => s.fallback);
  const live = useQuality((s) => !s.veiled || s.phase === "revealing" || s.phase === "live");
  const showing = useQuality((s) => s.phase === "live");
  const [late, setLate] = useState(false);
  const [note, setNote] = useState<{ text: string; at: number } | null>(null);
  const resting = useRestingCursor();
  useWakeLock();

  // Stage the showcase before the canvas's chunk arrives (see the header).
  useLayoutEffect(() => {
    const search = window.location.search;
    stageShowcase(search);
    music.setEnabled(readSwitch(search, "music") ?? true);
    party.set({ panel: readSwitch(search, "panel") ?? true, tour: readSwitch(search, "tour") ?? false });
  }, []);

  useEffect(() => {
    const t = window.setTimeout(() => setLate(true), PANEL_DEADLINE_MS);
    return () => window.clearTimeout(t);
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.repeat || e.ctrlKey || e.metaKey || e.altKey) return;
      const key = e.key.toLowerCase();
      if (key === "d") {
        toggleTrailer();
        return;
      }
      if (key === "m") {
        music.setMuted(!music.muted);
        // over the trailer the screen stays clean; the change is heard
        if (trailer.get().phase === "idle") setNote({ text: music.muted ? "Trailer music off" : "Trailer music on", at: performance.now() });
        return;
      }
      // the trailer has the screen
      if (trailer.get().phase !== "idle") return;
      if (key === "h") {
        const panel = !party.get().panel;
        party.set({ panel });
        setNote({ text: panel ? "Panel shown" : "Panel hidden", at: performance.now() });
      } else if (key === "t") {
        const tour = !party.get().tour;
        party.set({ tour });
        setNote({ text: tour ? "Slow tour on" : "Slow tour off", at: performance.now() });
      } else if (key === "f") {
        toggleFullscreen();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    if (!note) return;
    const t = window.setTimeout(() => setNote(null), NOTE_MS);
    return () => window.clearTimeout(t);
  }, [note]);

  const ready = live || fallback || late;
  // with no garden the panel always shows, whatever a trailer had asked
  const showPanel = ready && (panelOn || fallback) && code !== null;
  const showCaption = live && !fallback && panelOn;

  return (
    <main className={`party-root${fallback ? " party-root-fallback" : ""} ${className}`} data-resting={resting || undefined}>
      {!fallback && (
        <SceneBoundary>
          <PartyCanvas />
        </SceneBoundary>
      )}
      <PartyVeil />
      <TrailerOverlay />
      <GiftPanel code={code} show={showPanel} />
      <div className={`party-caption${showCaption ? " party-caption-on" : ""}`} aria-hidden={!showCaption}>
        <p className="party-caption-title">The {SPECIES[OWNER.species].name}</p>
        <p className="party-caption-sub">In full bloom</p>
      </div>
      <TrailerButton awake={!resting} live={showing && !fallback} />
      {note && (
        <p key={note.at} className="party-note" role="status">
          {note.text}
        </p>
      )}
    </main>
  );
}
