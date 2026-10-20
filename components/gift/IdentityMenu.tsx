"use client";
// Whose garden this device is showing, as a small pill in the top-left corner, and the things a colleague may need
// about it: a fresh personal garden link to open the garden on another device (POST /api/link; the newest five keep
// working), after this device switched gardens the way back to the one it showed before (POST /api/session/back),
// and, under a hairline, the picture the garden is drawn at (components/gift/PicturePicker). The fresh link opens in
// a dialog with the same panel the planting ended with. A short note ("Now showing Ravi's Marigold garden on this
// device") can hang under the pill for a few seconds after a switch. The picture has its own notes there, each once
// the opening's quiet has passed (lib/garden/picture): that a choice above Auto was too much for the device last time
// and the garden is back on Auto; that Cinematic, the default, is running slowly and Balanced or Light
// would be smoother (once a visit); and, the first time the garden opens on Cinematic by default, where to change it.
// Two colleagues can share a first name, so the menu opens on the garden's flower and day ("Night Jasmine · Day 3")
// and the way back names the other garden's flower too (lib/client/gardens).
//
// Rendered by the garden's door just before the care layer, so the pill comes first when tabbing through the page,
// and stacked in the page's own layers (gift.css .gift-id): over the care card and a plant swap's soft night, under
// the loading veil. While that veil still covers the garden (a garden link opening on a fresh device) the pill takes
// no focus or taps. Focus comes to the pill when the person has just arrived in this garden from the sheet or a dialog
// (focusOnMount, once the veil has lifted), after switching back, and when the fresh-link dialog closes (the menu item
// that opened it has gone by then).
import { useEffect, useRef, useState } from "react";
import { Dialog } from "@/components/gift/Dialog";
import { Chevron, Leaf, LinkIcon, Swap } from "@/components/gift/icons";
import { LinkPanel } from "@/components/gift/LinkPanel";
import { PicturePicker } from "@/components/gift/PicturePicker";
import { factsLine, gardenNames, useGardenFacts } from "@/lib/client/gardens";
import { ApiProblem, OFFLINE_MESSAGE, newGardenLink, switchBack, type PersonSummary } from "@/lib/client/session";
import { uiHeld, useOpening } from "@/lib/garden/opening";
import { clearFellBack, fellBackNote, introNote, markIntroduced, slowNote, usePicture } from "@/lib/garden/picture";
import { quality, useQuality } from "@/lib/garden/quality";

const possessive = (name: string) => `${name}'s`;
/** How long the note that a picture fell back to Auto stays under the pill. */
const FELL_BACK_NOTE_MS = 7000;
/** How long the notes about the default Cinematic stay: the first time it opens, and when it runs slowly. */
const INTRO_NOTE_MS = 9000;
const SLOW_NOTE_MS = 9000;
/** Cinematic by default is running slowly: the live garden under this many frames a second for this long. */
const SLOW_FPS = 40;
const SLOW_FOR_MS = 12000;

/**
 * Whether the note that Cinematic is running slowly is due: while `watch` holds (Cinematic is the default, and the
 * pill is in sight), once a visit, the live garden's frame rate (RenderBudget's stats) has stayed under SLOW_FPS for
 * SLOW_FOR_MS with the page in front. True for SLOW_NOTE_MS, then false for the rest of the visit.
 */
function useSlowNote(watch: boolean): boolean {
  const [due, setDue] = useState(false);
  const said = useRef(false);
  useEffect(() => {
    if (!watch || said.current) return;
    let since = -1;
    const off = quality.subscribe(() => {
      if (said.current) return;
      const q = quality.get();
      const fps = q.stats.fps;
      if (q.phase !== "live" || document.hidden || !(fps > 0) || fps >= SLOW_FPS) {
        since = -1;
        return;
      }
      const now = performance.now();
      if (since < 0) since = now;
      else if (now - since >= SLOW_FOR_MS) {
        said.current = true;
        setDue(true);
      }
    });
    return off;
  }, [watch]);
  useEffect(() => {
    if (!due) return;
    const t = setTimeout(() => setDue(false), SLOW_NOTE_MS);
    return () => clearTimeout(t);
  }, [due]);
  return due && watch;
}
const underVeil = (s: { veiled: boolean; phase: string }) => s.veiled && s.phase !== "revealing" && s.phase !== "live";

export function IdentityMenu({
  person,
  previous,
  onSwitchedBack,
  note = null,
  focusOnMount = false,
}: {
  person: PersonSummary;
  previous: PersonSummary | null;
  onSwitchedBack: (person: PersonSummary) => void;
  /** a passing note under the pill, hidden while the menu is open */
  note?: string | null;
  /** the sheet or dialog that had focus has just gone: take it */
  focusOnMount?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<"link" | "back" | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [link, setLink] = useState<string | null>(null);
  const root = useRef<HTMLDivElement>(null);
  const pill = useRef<HTMLButtonElement>(null);
  const [focusFirst] = useState(focusOnMount);
  const covered = useQuality(underVeil);
  const held = useOpening(uiHeld);
  const kind = useQuality((s) => s.device?.kind);
  const fellBack = usePicture((s) => s.fellBack);
  const cinematicByDefault = usePicture((s) => s.applies && s.byDefault && s.choice === "cinematic");
  const introduced = usePicture((s) => s.introduced);
  const inSight = !covered && !held;
  // each said once the pill is in sight; a note about a switch comes first, then the fall-back, then the slow frames
  const sayFellBack = fellBack !== null && inSight && !note;
  const saySlow = useSlowNote(cinematicByDefault && inSight) && !note && !sayFellBack;
  const sayIntro = cinematicByDefault && !introduced && inSight && !note && !sayFellBack && !saySlow;
  const shownNote = note ?? (sayFellBack ? fellBackNote(fellBack, kind) : saySlow ? slowNote(kind) : sayIntro ? introNote() : null);
  const facts = useGardenFacts(person);
  const previousFacts = useGardenFacts(previous);
  const backTo = previous ? gardenNames(previous, previousFacts, person, facts)[0] : null;
  const what = facts ? factsLine(facts) : null;

  useEffect(() => {
    if (focusFirst && !covered) pill.current?.focus({ preventScroll: true });
  }, [focusFirst, covered]);

  useEffect(() => {
    if (!sayFellBack) return;
    const t = setTimeout(() => clearFellBack(), FELL_BACK_NOTE_MS);
    return () => clearTimeout(t);
  }, [sayFellBack]);

  useEffect(() => {
    if (!sayIntro) return;
    const t = setTimeout(() => markIntroduced(), INTRO_NOTE_MS);
    return () => clearTimeout(t);
  }, [sayIntro]);

  // the menu closes on a tap outside it or Escape, and gives focus back to the pill (when Tab moves on past it, it
  // closes too, and focus stays where the person took it: onBlur below)
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      setOpen(false);
      pill.current?.focus();
    };
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  async function makeLink() {
    setBusy("link");
    setMessage(null);
    try {
      setLink(await newGardenLink());
      setOpen(false);
    } catch (err) {
      setMessage(err instanceof ApiProblem ? err.message : OFFLINE_MESSAGE);
    } finally {
      setBusy(null);
    }
  }

  async function goBack() {
    setBusy("back");
    setMessage(null);
    try {
      const back = await switchBack();
      setOpen(false);
      onSwitchedBack(back);
      // the menu item that had focus has gone with the menu
      pill.current?.focus({ preventScroll: true });
    } catch (err) {
      setMessage(err instanceof ApiProblem ? err.message : OFFLINE_MESSAGE);
    } finally {
      setBusy(null);
    }
  }

  return (
    <div
      ref={root}
      className="gift-id"
      inert={covered}
      onBlur={(e) => {
        // only a move to somewhere else on the page: a tap on the menu's own words, or leaving the window, keeps it
        const to = e.relatedTarget as Node | null;
        if (open && to && !e.currentTarget.contains(to)) setOpen(false);
      }}
    >
      <button
        ref={pill}
        type="button"
        className="gift-id-pill"
        aria-expanded={open}
        aria-haspopup="true"
        onClick={() => {
          setOpen((o) => !o);
          setMessage(null);
        }}
      >
        <Leaf size={16} />
        <span>{possessive(person.firstName)} garden</span>
        {what && <span className="gift-sr">, {what}</span>}
        <Chevron size={16} className="gift-chevron" />
      </button>
      {open && (
        <div className="gift-id-menu" role="group" aria-label="Your garden">
          {what && (
            <p className="gift-id-what" aria-hidden="true">
              {what}
            </p>
          )}
          <button type="button" className="gift-id-item" onClick={makeLink} disabled={busy !== null}>
            <LinkIcon size={18} />
            {busy === "link" ? "Making a fresh link" : "Open on another device"}
          </button>
          {previous && backTo && (
            <button type="button" className="gift-id-item" onClick={goBack} disabled={busy !== null}>
              <Swap size={18} />
              {busy === "back" ? "Switching back" : `Back to ${backTo}`}
            </button>
          )}
          {message && (
            <p className="gift-id-msg" role="alert">
              {message}
            </p>
          )}
          <div className="gift-id-sep" role="presentation" />
          <PicturePicker />
        </div>
      )}
      {/* a live region that stays on the page, so the note is announced when its words arrive */}
      <p className="gift-sr" role="status">
        {shownNote && !open ? shownNote : ""}
      </p>
      {shownNote && !open && (
        <p className="gift-id-note" aria-hidden="true">
          {shownNote}
        </p>
      )}
      {link && (
        <Dialog label="A fresh link to your garden" onClose={() => setLink(null)} returnFocus={() => pill.current}>
          <LinkPanel link={link} variant="fresh" />
          <div className="gift-dialog-actions">
            <button type="button" className="gift-primary" onClick={() => setLink(null)}>
              Done
            </button>
          </div>
        </Dialog>
      )}
    </div>
  );
}
