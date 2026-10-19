"use client";
// The garden's sound button: a small round glass button in the top-right corner of a colleague's own garden, the name
// pill's twin (gift.css .gift-id-pill), that opens the sound panel (components/sound/SoundPanel). Its glyph is three
// soft bars, which turn gold and breathe slowly while sound plays. Nothing here starts sound by itself: sound starts
// only from a tap (or the M key), and every action that may start it (lib/sound/store's gesture actions) is called
// straight from the tap's own handler, before anything is awaited, so a phone's browser lets it play.
//
// Beside it, under the button, a small pill says what a tap would do, in two cases:
// - the sound was on when this device last left the garden: "Tap to play the live garden" for about six seconds once
//   the opening's quiet has lifted; a tap on the pill starts that sound again, a tap on the button opens the panel;
// - the browser stopped the sound (a call, the phone locked without "keep playing", a resume it refused, music the
//   phone paused, files that would not load): the button gets a gentle gold ring and the pill says "Tap to bring the
//   sound back"; a tap on the pill brings it back, and a tap on the button tries to bring it back and opens (or
//   closes) the panel as well, so the panel and its "Sound on" switch can always be reached, however stuck the sound.
//
// It lives in the garden page's own layers (sound.css .sound-corner, z 18): over the care card and the name pill,
// under the loading veil. Like the pill it holds back while the opening's peace is held (:root[data-opening="quiet"])
// and takes no focus or taps while the veil covers the garden. On a phone held sideways it moves to the bottom left,
// because the narrow care panel owns the right. The panel itself is a separate chunk, asked for once the opening has
// lifted or the moment a pointer or focus comes near the button, and it is rendered into the body (SoundPanel).
//
// A polite live region, outside the button so it is heard even while the corner is hidden, says when sound comes on
// ("Sound on: Live garden") or goes off, and passes on the store's short notices (the five-sound limit). The M key
// toggles sound anywhere on the page, except while typing or with a modifier held; while the sound is blocked its
// first press tries to bring it back, and a second within M_RETRY_MS turns it off. The garden door mounts the button
// (components/gift/GardenDoor) and decides where it shows: an own garden, or any door with ?sound=1 for testing, and
// never with ?sound=off (useSoundSwitch; the words are lib/sound/switch's). As it leaves the page it turns the sound
// off, and makes sure the phone's lock screen lets go too, so nothing plays on in a garden without the button.
import dynamic from "next/dynamic";
import { useEffect, useId, useRef, useState, useSyncExternalStore } from "react";
import { SoundGlyph } from "@/components/sound/icons";
import { uiHeld, useOpening } from "@/lib/garden/opening";
import { underVeil, useQuality } from "@/lib/garden/quality";
import { mix } from "@/lib/sound/catalog";
import { LIVE_TITLE, mixTitle, sound, soundActions, useSound, type SoundState } from "@/lib/sound/store";
import { parseSoundSwitch, type SoundSwitch } from "@/lib/sound/switch";
import type { EngineStatus } from "@/lib/sound/types";
import "@/components/sound/sound.css";

const loadPanel = () => import("@/components/sound/SoundPanel").then((m) => m.SoundPanel);
const SoundPanel = dynamic(loadPanel, { ssr: false, loading: () => null });

/** The panel's element id, for the button's aria-controls. */
const PANEL_ID = "garden-sound-panel";
/** How long the "tap to play" hint stays after a visit that ended with sound on (ms). */
const RESUME_HINT_MS = 6000;
/** How long the panel takes to fade as it closes, before it leaves the page (ms; sound.css .sound-panel closing). */
const PANEL_OUT_MS = 240;
/** How long after the opening's quiet lifts the panel's chunk is asked for, ahead of a tap (ms). */
const PANEL_PRELOAD_MS = 2500;
/** An M pressed this soon after an M that tried to bring blocked sound back turns the sound off instead (ms). */
const M_RETRY_MS = 10_000;

// ---- ?sound= ---------------------------------------------------------------------------------------------------------

// The query never changes while the page is open, so there is nothing to subscribe to.
const subscribeNever = () => () => {};
const readSoundSwitch = (): SoundSwitch => parseSoundSwitch(new URLSearchParams(window.location.search).get("sound"));
const serverSoundSwitch = (): SoundSwitch => null;

/** The address's ?sound= switch; null on the server and while hydrating, so the first render matches the HTML. */
export function useSoundSwitch(): SoundSwitch {
  return useSyncExternalStore(subscribeNever, readSoundSwitch, serverSoundSwitch);
}

// ---- words ----------------------------------------------------------------------------------------------------------

/** The person's choice, short: "Live garden", a mix's name, a single tile's name, or "3 sounds" (the store's titles). */
function chosenName(s: SoundState): string {
  if (s.mode === "live") return LIVE_TITLE;
  return mixTitle(s.layers, s.mixId) || "Garden sounds";
}

/** What a tap on the resume hint would play: "the live garden", "Monsoon evening", "Light rain", "your 3 sounds". */
function rememberedWords(s: SoundState): string {
  if (s.mode === "live" || s.layers.length === 0) return "the live garden";
  const title = mixTitle(s.layers, s.mixId);
  return s.layers.length > 1 && !(s.mixId && mix(s.mixId)) ? `your ${title}` : title;
}

/** Typing in a field (or anything editable) keeps its own M. */
function isTyping(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  if (target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement) return true;
  if (target instanceof HTMLInputElement) return !["range", "checkbox", "radio", "button", "submit", "reset"].includes(target.type);
  return false;
}

/** What the live region last said about sound being on, so it speaks only when that changes. */
type Said = "on" | "off" | "blocked";

export function SoundButton() {
  const status = useSound((s) => s.status);
  const open = useSound((s) => s.panelOpen);
  const resumeHint = useSound((s) => s.resumeHint);
  const notice = useSound((s) => s.notice);
  const name = useSound(chosenName);
  const remembered = useSound(rememberedWords);
  const held = useOpening(uiHeld);
  const covered = useQuality(underVeil);
  const button = useRef<HTMLButtonElement>(null);
  const nudgeId = useId();

  const blocked = status === "blocked";
  const heard = status === "playing" || status === "starting";
  // nothing beside the button while the opening holds back or the veil covers the garden, or over the open panel
  const quiet = held || covered;
  const resuming = resumeHint && !heard && !blocked && !open && !quiet;
  const nudge = open || quiet ? null : blocked ? "Tap to bring the sound back" : resuming ? `Tap to play ${remembered}` : null;

  // the pill keeps its last words while it fades out
  const [nudgeText, setNudgeText] = useState(nudge);
  if (nudge !== null && nudge !== nudgeText) setNudgeText(nudge);

  // the panel stays on the page for its closing fade
  const [panelShown, setPanelShown] = useState(open);
  if (open && !panelShown) setPanelShown(true);
  useEffect(() => {
    if (open || !panelShown) return;
    const t = setTimeout(() => setPanelShown(false), PANEL_OUT_MS);
    return () => clearTimeout(t);
  }, [open, panelShown]);

  // The live region: "Sound on: Live garden" when sound comes on, "Sound off" when it goes, a word when the browser
  // stops it, and the store's notices. Worked out as the status changes (state from the previous render), so each
  // change is said once; a notice repeated word for word is still said again (a trailing no-break space alternates).
  const [seen, setSeen] = useState<{ status: EngineStatus; notice: string | null; said: Said }>({ status, notice, said: "off" });
  const [spoken, setSpoken] = useState("");
  if (status !== seen.status || notice !== seen.notice) {
    let said = seen.said;
    let words: string | null = null;
    if (status !== seen.status) {
      if (status === "playing" && said !== "on") [said, words] = ["on", `Sound on: ${name}`];
      else if (status === "idle" && said !== "off") [said, words] = ["off", "Sound off"];
      else if (status === "blocked" && said !== "blocked") [said, words] = ["blocked", "The sound has paused. Tap the sound button to bring it back."];
    }
    if (notice !== null && notice !== seen.notice) words = notice;
    setSeen({ status, notice, said });
    if (words !== null) setSpoken(words === spoken.trimEnd() && !spoken.endsWith(" ") ? `${words} ` : words);
  }

  useEffect(() => {
    soundActions.preloadEngine();
    return () => {
      // The door has left the garden (its session ended, say), and no button is left to stop the sound with. With
      // sound off, stop only makes sure the engine and the lock screen have let go, and keeps a remembered "sound was
      // on" (React's development double mount comes through here too).
      if (sound.get().panelOpen) soundActions.closePanel();
      soundActions.stop();
    };
  }, []);

  // the panel's chunk, ahead of the first tap, once the garden is showing
  useEffect(() => {
    if (quiet) return;
    const t = setTimeout(() => void loadPanel().catch(() => {}), PANEL_PRELOAD_MS);
    return () => clearTimeout(t);
  }, [quiet]);

  // the resume hint has had its moment
  useEffect(() => {
    if (!resuming) return;
    const t = setTimeout(() => soundActions.dismissResumeHint(), RESUME_HINT_MS);
    return () => clearTimeout(t);
  }, [resuming]);

  // M turns sound on and off (a gesture: keydown lets a browser start sound). When the browser stopped the sound, the
  // first M tries to bring it back; if it is still stopped, the next M turns it off rather than trying for ever.
  const mResumedAt = useRef(-Infinity);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.repeat || e.isComposing) return;
      if (e.ctrlKey || e.metaKey || e.altKey || e.shiftKey) return;
      if (e.key !== "m" && e.key !== "M") return;
      if (isTyping(e.target)) return;
      if (sound.get().status === "blocked" && e.timeStamp - mResumedAt.current > M_RETRY_MS) {
        mResumedAt.current = e.timeStamp;
        soundActions.resume();
      } else {
        soundActions.toggle();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  const preload = () => void loadPanel().catch(() => {});

  return (
    <div className="sound-root">
      <div className="sound-corner" inert={covered}>
        <button
          ref={button}
          type="button"
          className="sound-btn"
          data-state={status}
          aria-label="Garden sounds"
          aria-expanded={open}
          aria-controls={PANEL_ID}
          aria-describedby={blocked && nudge ? nudgeId : undefined}
          onPointerEnter={preload}
          onPointerDown={preload}
          onFocus={preload}
          onClick={() => {
            // a gesture: when the browser stopped the sound this tap may bring it back, and it still opens or closes
            // the panel, so its switch can be reached even while the sound stays stuck
            if (sound.get().status === "blocked") soundActions.resume();
            else if (sound.get().resumeHint) soundActions.dismissResumeHint();
            soundActions.togglePanel();
          }}
        >
          <SoundGlyph />
        </button>
        {nudgeText !== null && (
          <button
            type="button"
            id={nudgeId}
            className="sound-nudge"
            data-shown={nudge !== null ? "" : undefined}
            data-tone={blocked ? "blocked" : undefined}
            onClick={() => {
              // a gesture, straight from the tap
              if (sound.get().status === "blocked") soundActions.resume();
              else soundActions.start();
            }}
          >
            {nudgeText}
          </button>
        )}
      </div>
      {panelShown && <SoundPanel id={PANEL_ID} closing={!open} returnFocus={() => button.current} />}
      {/* a live region that stays on the page (and in sight of a screen reader while the corner is hidden) */}
      <p className="sound-sr" role="status">
        {spoken}
      </p>
    </div>
  );
}
