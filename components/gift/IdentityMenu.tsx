"use client";
// Whose garden this device is showing, as a small pill in the top-left corner, and the two things a colleague may need
// about it: a fresh personal garden link to open the garden on another device (POST /api/link; the newest five keep
// working), and, after this device switched gardens, the way back to the one it showed before
// (POST /api/session/back). The fresh link opens in a dialog with the same panel the planting ended with. A short
// note ("Now showing Ravi's garden on this device") can hang under the pill for a few seconds after a switch.
//
// Rendered into the body, like the sheet and the dialogs, so the care layer's soft night during a plant swap (a
// body-level layer) never covers the pill or its note. Focus comes to the pill when the person has just arrived in
// this garden from the sheet or a dialog (focusOnMount), after switching back, and when the fresh-link dialog closes
// (the menu item that opened it has gone by then).
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Dialog } from "@/components/gift/Dialog";
import { display } from "@/components/gift/fonts";
import { Chevron, Leaf, LinkIcon, Swap } from "@/components/gift/icons";
import { LinkPanel } from "@/components/gift/LinkPanel";
import { ApiProblem, OFFLINE_MESSAGE, newGardenLink, switchBack, type PersonSummary } from "@/lib/client/session";

const possessive = (name: string) => `${name}'s`;

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

  useEffect(() => {
    if (focusFirst) pill.current?.focus({ preventScroll: true });
  }, [focusFirst]);

  // the menu closes on a tap outside it or Escape, and gives focus back to the pill
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

  return createPortal(
    <div className={`gift-root ${display.variable}`}>
      <div ref={root} className="gift-id">
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
          <Chevron size={16} className="gift-chevron" />
        </button>
        {open && (
          <div className="gift-id-menu" role="group" aria-label="Your garden">
            <button type="button" className="gift-id-item" onClick={makeLink} disabled={busy !== null}>
              <LinkIcon size={18} />
              {busy === "link" ? "Making a fresh link" : "Open on another device"}
            </button>
            {previous && (
              <button type="button" className="gift-id-item" onClick={goBack} disabled={busy !== null}>
                <Swap size={18} />
                {busy === "back" ? "Switching back" : `Back to ${possessive(previous.firstName)} garden`}
              </button>
            )}
            {message && (
              <p className="gift-id-msg" role="alert">
                {message}
              </p>
            )}
          </div>
        )}
        {/* a live region that stays on the page, so the note is announced when its words arrive */}
        <p className="gift-sr" role="status">
          {note && !open ? note : ""}
        </p>
        {note && !open && (
          <p className="gift-id-note" aria-hidden="true">
            {note}
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
    </div>,
    document.body,
  );
}
