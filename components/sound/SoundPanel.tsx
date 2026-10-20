"use client";
// The sound panel, opened from the sound button (components/sound/SoundButton): everything a person can choose to hear
// in their own garden, from top to bottom:
// - the header: "Sounds", a "Sound on" switch and a way to close;
// - the live garden, the default: it follows the real Bangalore sky and weather (lib/sound/live), and says what it is
//   playing now ("dawn birds and a light breeze"). Its card works like a tile: a round play button, gold only while the
//   live garden is actually playing, and a second tap stops it;
// - the ready-made mixes (lib/sound/catalog MIXES), a row of chips;
// - the person's own mix: thirty tiles in six groups, up to five at once (music one piece at a time), each picked tile
//   with a slim level slider under it and a soft pulsing dot while its file loads;
// - the volume, a fade-out timer (15 or 30 minutes, an hour), "Keep playing when my screen locks", and the credits of
//   every recording, with its licence and source.
// Every tap that may start sound calls a gesture action of the sound store (lib/sound/store) straight from its handler,
// so the browser lets it play; the panel itself keeps no state of its own beyond a drag in progress. Each part reads
// only what it shows from the store: a slider's step re-renders that slider's own part (a tile, or the volume), not
// the panel with its thirty tiles and the credits, so the garden above keeps its frame rate while sound is adjusted.
//
// It is not a modal: the garden stays alive around it. Focus moves to its heading as it opens, Escape closes it and
// gives focus back to the sound button, and so does the close button. Rendered into the body, like the gift sheet
// (components/gift/GiftSheet), because the garden page's <main> is its own stacking context and the panel must sit
// over the care card, so it carries the display face's class itself (components/gift/fonts). Where it sits
// (sound.css): on a phone a bottom sheet over the care card, with a grab handle that a downward drag closes it by (the
// header drags it too, from anywhere but its switch and close button); on a portrait iPad the same sheet, centred; on a laptop or a landscape iPad a panel on the left, the care panel's mirror;
// on a phone held sideways a narrow panel on the left. A tap anywhere outside it closes it, except that beside a side
// panel the garden itself can be turned and looked at while listening.
import { memo, useEffect, useId, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from "react";
import { createPortal } from "react-dom";
import { display } from "@/components/gift/fonts";
import { ChevronGlyph, CloseGlyph, GroupGlyph, LiveGlyph, PauseGlyph, PlayGlyph } from "@/components/sound/icons";
import { BIRD_CALLS, GROUPS, MAX_LAYERS, MIXES, TILES, tilesIn } from "@/lib/sound/catalog";
import { CHANGES, soundFile } from "@/lib/sound/library";
import { LIVE_TITLE, soundActions, useSound } from "@/lib/sound/store";
import type { SoundFile, Tile } from "@/lib/sound/types";

/** The fade-out timer's choices, in minutes (0: off). */
const TIMERS: readonly { min: 0 | 15 | 30 | 60; label: string }[] = [
  { min: 0, label: "Off" },
  { min: 15, label: "15 min" },
  { min: 30, label: "30 min" },
  { min: 60, label: "1 hour" },
];

/** The layouts where the panel is a side panel (sound.css): a laptop or landscape iPad, and a phone held sideways. */
const SIDE_PANEL_QUERY = "(min-width: 1024px) and (orientation: landscape), (orientation: landscape) and (max-height: 540px)";
/** How far the sheet must be dragged down by its handle to close (px). */
const DRAG_CLOSE_PX = 72;
/** The store's words for the live garden ("Live garden: dawn birds and a light breeze"); the card shows what follows. */
const LIVE_PREFIX = `${LIVE_TITLE}: `;

// ---- the credits ----------------------------------------------------------------------------------------------------

const CALL_NAMES: Readonly<Record<string, string>> = {
  "call-koel": "Asian koel",
  "call-bulbul": "Red-whiskered bulbul",
  "call-magpie-robin": "Magpie-robin",
};

interface Credit {
  /** where the recording is heard in the garden */
  used: string;
  file: SoundFile;
  /** the source's site, for its link ("freesound.org") */
  site: string;
}

function siteOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "Source";
  }
}

/** Every recording the garden plays: one per recorded tile, then the live garden's bird calls. Worked out once. */
const CREDITS: readonly Credit[] = (() => {
  const byKey = new Map<string, Credit>();
  const add = (used: string, file: SoundFile) => byKey.set(file.key, { used, file, site: siteOf(file.credit.source) });
  for (const t of TILES) {
    const file = t.sound ? soundFile(t.sound) : undefined;
    if (file && !byKey.has(file.key)) add(t.label, file);
  }
  for (const key of BIRD_CALLS) {
    const file = soundFile(key);
    if (file && !byKey.has(key)) add(`${CALL_NAMES[key] ?? key}, in the live garden`, file);
  }
  return [...byKey.values()];
})();

/** "10:45 pm", on this device's clock. */
function clockTime(ms: number): string {
  const d = new Date(ms);
  const h = d.getHours();
  return `${h % 12 || 12}:${String(d.getMinutes()).padStart(2, "0")} ${h < 12 ? "am" : "pm"}`;
}

/**
 * Close the panel; when focus was inside it (or nowhere), give it back to the sound button. A tap on the garden
 * outside closes it without moving focus.
 */
function closePanel(panel: HTMLElement | null, button: HTMLElement | null | undefined, refocus: boolean) {
  soundActions.closePanel();
  const active = document.activeElement;
  if (refocus && (active === null || active === document.body || panel?.contains(active))) button?.focus({ preventScroll: true });
}

// ---- pieces ---------------------------------------------------------------------------------------------------------

/** A slim slider, 0..1: a 3 px track that fills gold to the thumb, in a 44 px tall hit area. */
function Level({
  label,
  value,
  onChange,
  className,
}: {
  label: string;
  value: number;
  onChange: (value: number) => void;
  className?: string;
}) {
  const percent = Math.round(Math.max(0, Math.min(1, value)) * 100);
  return (
    <input
      type="range"
      className={className ? `sound-range ${className}` : "sound-range"}
      min={0}
      max={1}
      step={0.01}
      value={value}
      aria-label={label}
      aria-valuetext={`${percent} percent`}
      style={{ "--sound-fill": `${percent}%` } as CSSProperties}
      onChange={(e) => onChange(Number(e.currentTarget.value))}
    />
  );
}

/**
 * One tile: its button (a gesture), and once picked, its level slider underneath, apart from the button. It reads its
 * own level and loading dot from the store, so a step of its slider re-renders it alone.
 */
const TileCell = memo(function TileCell({ t }: { t: Tile }) {
  const level = useSound((s) => (s.mode === "mix" ? s.layers.find((l) => l.key === t.key)?.level : undefined));
  const loading = useSound((s) => s.loading.includes(t.key));
  const picked = level !== undefined;
  return (
    <div className="sound-tile" data-on={picked ? "" : undefined}>
      <button
        type="button"
        className="sound-tile-btn"
        aria-pressed={picked}
        aria-busy={loading || undefined}
        title={t.hint}
        onClick={() => soundActions.toggleTile(t.key)}
      >
        <GroupGlyph group={t.group} size={22} />
        <span className="sound-tile-label">{t.label}</span>
        {loading && <span className="sound-tile-dot" aria-hidden="true" />}
      </button>
      {level !== undefined && (
        <Level className="sound-level" label={`${t.label} level`} value={level} onChange={(v) => soundActions.setLevel(t.key, v)} />
      )}
    </div>
  );
});

/** "2 of 5" while the person's own mix plays, else how many may play at once. */
function MixCount() {
  const count = useSound((s) => (s.mode === "mix" ? s.layers.length : 0));
  return <span className="sound-count">{count > 0 ? `${count} of ${MAX_LAYERS}` : `Up to ${MAX_LAYERS} at once`}</span>;
}

/** The thirty tiles, in their six groups; fixed, so it renders once and each tile follows the store by itself. */
const TileGroups = memo(function TileGroups({ ids }: { ids: string }) {
  return GROUPS.map((g) => (
    <div key={g.key} className="sound-group" role="group" aria-labelledby={`${ids}-${g.key}`}>
      <h4 id={`${ids}-${g.key}`} className="sound-label">
        {g.label}
        {g.exclusive && <span className="sound-label-note">One at a time</span>}
      </h4>
      <div className="sound-tiles">
        {tilesIn(g.key).map((t) => (
          <TileCell key={t.key} t={t} />
        ))}
      </div>
    </div>
  ));
});

/** The volume, with its own reading of the store, so a drag of it re-renders only this. */
function VolumeSection({ ids }: { ids: string }) {
  const volume = useSound((s) => s.volume);
  return (
    <section className="sound-section" aria-labelledby={`${ids}-volume`}>
      <div className="sound-heading-row">
        <h3 id={`${ids}-volume`} className="sound-heading">
          Volume
        </h3>
        <span className="sound-count" aria-hidden="true">
          {Math.round(volume * 100)}%
        </span>
      </div>
      <Level label="Volume" value={volume} onChange={(v) => soundActions.setVolume(v)} />
    </section>
  );
}

/** Every recording's credit, its licence and its source; it never changes, so it renders once. */
const Credits = memo(function Credits() {
  return (
    <details className="sound-credits">
      <summary>
        <span>Sound credits</span>
        <ChevronGlyph />
      </summary>
      <ul className="sound-credit-list">
        {CREDITS.map(({ used, file, site }) => (
          <li key={file.key}>
            <span className="sound-credit-used">{used}</span>
            {`“${file.credit.title}” by ${file.credit.author}. `}
            <a href={file.credit.licenseUrl} target="_blank" rel="noreferrer">
              {file.credit.license}
            </a>
            {" · "}
            <a href={file.credit.source} target="_blank" rel="noreferrer">
              {site}
            </a>
          </li>
        ))}
      </ul>
      <p className="sound-fine">{CHANGES}</p>
      <p className="sound-fine">The music box and soft noise are made on your device.</p>
    </details>
  );
});

// ---- the panel ------------------------------------------------------------------------------------------------------

export function SoundPanel({
  id,
  closing,
  returnFocus,
}: {
  /** the element id the sound button's aria-controls names */
  id: string;
  /** the panel is fading out after it was closed: no longer interactive */
  closing: boolean;
  /** the sound button, for focus when the panel closes */
  returnFocus: () => HTMLElement | null;
}) {
  const status = useSound((s) => s.status);
  const mode = useSound((s) => s.mode);
  const mixId = useSound((s) => s.mixId);
  const timerMin = useSound((s) => s.timerMin);
  const timerEndsAt = useSound((s) => s.timerEndsAt);
  const background = useSound((s) => s.background);
  const nowPlaying = useSound((s) => s.nowPlaying);
  const notice = useSound((s) => s.notice);
  const panel = useRef<HTMLElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const back = useRef(returnFocus);
  const drag = useRef<{ pointer: number; y: number; dy: number } | null>(null);
  const ids = useId();

  // the notice keeps its words while it fades out
  const [noticeText, setNoticeText] = useState(notice);
  if (notice !== null && notice !== noticeText) setNoticeText(notice);

  useEffect(() => {
    back.current = returnFocus;
  });

  // focus to the heading as the panel opens (or opens again while it was still fading out, perhaps from a drag)
  useEffect(() => {
    if (closing) return;
    panel.current?.style.removeProperty("transform");
    heading.current?.focus({ preventScroll: true });
  }, [closing]);

  // Escape closes it from anywhere on the page. A tap outside it closes it too (the sound button toggles it by itself),
  // except, on the side panels, a touch on the garden itself: that turns the garden, to look at it while listening.
  useEffect(() => {
    if (closing) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented) return;
      closePanel(panel.current, back.current(), true);
    };
    const onDown = (e: PointerEvent) => {
      const target = e.target as Node | null;
      if (!target || panel.current?.contains(target)) return;
      if (target instanceof Element && target.closest(".sound-corner")) return;
      if (target instanceof HTMLCanvasElement && window.matchMedia(SIDE_PANEL_QUERY).matches) return;
      closePanel(panel.current, back.current(), false);
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onDown);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onDown);
    };
  }, [closing]);

  // The sheet follows a finger dragging its handle or its header down (transform only), and closes past
  // DRAG_CLOSE_PX. Not from the header's switch or close button, which keep their taps, nor on a side panel.
  const onGrabDown = (e: ReactPointerEvent<HTMLElement>) => {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    if (e.target instanceof Element && e.target.closest("button, input, label, a")) return;
    if (window.matchMedia(SIDE_PANEL_QUERY).matches) return;
    drag.current = { pointer: e.pointerId, y: e.clientY, dy: 0 };
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      // a pointer the browser no longer tracks: the drag still follows it while it stays on the handle
    }
    panel.current?.style.setProperty("transition", "none");
  };
  const onGrabMove = (e: ReactPointerEvent<HTMLElement>) => {
    const d = drag.current;
    if (!d || d.pointer !== e.pointerId || !panel.current) return;
    d.dy = Math.max(0, e.clientY - d.y);
    panel.current.style.transform = d.dy > 0 ? `translate3d(0, ${d.dy}px, 0)` : "";
  };
  const onGrabEnd = (e: ReactPointerEvent<HTMLElement>) => {
    const d = drag.current;
    if (!d || d.pointer !== e.pointerId) return;
    drag.current = null;
    const el = panel.current;
    if (!el) return;
    el.style.removeProperty("transition");
    // past the line it fades where the finger left it; short of it, it eases back up (sound.css transition)
    if (e.type === "pointerup" && d.dy > DRAG_CLOSE_PX) closePanel(el, back.current(), true);
    else el.style.transform = "";
  };

  const on = status !== "idle";
  const live = mode === "live";
  // the card lights up only while the live garden is really playing, as a tile does, so a silent garden invites a tap
  const livePlaying = live && (status === "playing" || status === "starting");
  const liveWords = livePlaying && nowPlaying.startsWith(LIVE_PREFIX) ? nowPlaying.slice(LIVE_PREFIX.length) : null;

  return createPortal(
    <div className={`sound-root ${display.variable}`}>
      <div className="sound-dock">
        <section
          ref={panel}
          id={id}
          className="sound-panel"
          role="dialog"
          aria-label="Garden sounds"
          data-state={closing ? "closing" : "open"}
          inert={closing}
        >
          <div
            className="sound-grab"
            aria-hidden="true"
            onPointerDown={onGrabDown}
            onPointerMove={onGrabMove}
            onPointerUp={onGrabEnd}
            onPointerCancel={onGrabEnd}
          >
            <span className="sound-grab-bar" />
          </div>

          <header
            className="sound-head"
            onPointerDown={onGrabDown}
            onPointerMove={onGrabMove}
            onPointerUp={onGrabEnd}
            onPointerCancel={onGrabEnd}
          >
            <h2 ref={heading} className="sound-title" tabIndex={-1}>
              Sounds
            </h2>
            <label className="sound-switch">
              <span className="sound-switch-text">Sound on</span>
              <input type="checkbox" role="switch" checked={on} onChange={() => soundActions.toggle()} />
              <span className="sound-switch-track" aria-hidden="true" />
            </label>
            <button type="button" className="sound-close" aria-label="Close sounds" onClick={() => closePanel(panel.current, back.current(), true)}>
              <CloseGlyph />
            </button>
          </header>

          <div className="sound-body">
            {status === "blocked" && (
              <div className="sound-blocked">
                <p>Your device paused the sound.</p>
                <button type="button" className="sound-chip" data-tone="gold" onClick={() => soundActions.resume()}>
                  Bring it back
                </button>
              </div>
            )}

            <button
              type="button"
              className="sound-live"
              aria-pressed={livePlaying}
              onClick={() => (livePlaying ? soundActions.stop() : soundActions.chooseLive())}
            >
              <span className="sound-live-icon">
                <LiveGlyph />
              </span>
              <span className="sound-live-text">
                <span className="sound-live-title">Live garden</span>
                <span className="sound-live-line">Follows your garden: birds at dawn, rain when it really rains, crickets at night.</span>
                {liveWords && <span className="sound-live-now">Now: {liveWords}</span>}
              </span>
              <span className="sound-live-play" aria-hidden="true">
                {livePlaying ? <PauseGlyph /> : <PlayGlyph />}
              </span>
            </button>

            <section className="sound-section" aria-labelledby={`${ids}-mixes`}>
              <h3 id={`${ids}-mixes`} className="sound-heading">
                Mixes
              </h3>
              <div className="sound-mixes">
                {MIXES.map((m) => (
                  <button
                    key={m.id}
                    type="button"
                    className="sound-chip"
                    aria-pressed={mode === "mix" && mixId === m.id}
                    onClick={() => soundActions.applyMix(m.id)}
                  >
                    {m.label}
                  </button>
                ))}
              </div>
            </section>

            <section className="sound-section" aria-labelledby={`${ids}-own`}>
              <div className="sound-heading-row">
                <h3 id={`${ids}-own`} className="sound-heading">
                  Your own mix
                </h3>
                <MixCount />
              </div>
              <TileGroups ids={ids} />
            </section>

            <VolumeSection ids={ids} />

            <section className="sound-section" aria-labelledby={`${ids}-fade`}>
              <h3 id={`${ids}-fade`} className="sound-heading">
                Fade out
              </h3>
              <div className="sound-timers" role="group" aria-labelledby={`${ids}-fade`}>
                {TIMERS.map((t) => (
                  <button key={t.min} type="button" className="sound-chip" aria-pressed={timerMin === t.min} onClick={() => soundActions.setTimer(t.min)}>
                    {t.label}
                  </button>
                ))}
              </div>
              {timerEndsAt !== null && <p className="sound-fine">Fades out at {clockTime(timerEndsAt)}</p>}
            </section>

            <label className="sound-switch sound-switch-row">
              <span className="sound-switch-text">
                <span id={`${ids}-bg`}>Keep playing when my screen locks</span>
                <span id={`${ids}-bg-hint`} className="sound-fine">
                  For listening as you rest. Uses more battery.
                </span>
              </span>
              <input
                type="checkbox"
                role="switch"
                checked={background}
                aria-labelledby={`${ids}-bg`}
                aria-describedby={`${ids}-bg-hint`}
                onChange={(e) => soundActions.setBackground(e.currentTarget.checked)}
              />
              <span className="sound-switch-track" aria-hidden="true" />
            </label>

            <Credits />

            {/* the store's notices, in sight wherever the panel is scrolled (the sound button's live region says them) */}
            {noticeText !== null && (
              <p className="sound-notice" aria-hidden="true" data-shown={notice !== null ? "" : undefined}>
                {noticeText}
              </p>
            )}
          </div>
        </section>
      </div>
    </div>,
    document.body,
  );
}
