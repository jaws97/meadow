"use client";
// Who has come through the garden's door, and what they see over the live garden:
// - a personal garden link (/garden#k=..., taken out of the address bar as the page loads, or when it is pasted into
//   an open page, lib/client/session.ts) is exchanged for this device's session; if the device already shows someone
//   else's garden, the person is asked
//   before switching (and can switch back later); a replaced link is explained, never an error page;
// - someone whose device already holds a garden goes straight to it, with the care layer and the identity pill (and
//   if that session ends while the garden is open, the care layer says so and the door explains in a dialog);
// - someone with the party code (the QR link, ?code=...; none is needed on a development server) is given the seed;
// - anyone else sees Lijas's rose with a gentle line about the party.
// The decision needs the server (the session cookie is httpOnly), so the first render, which is also the prerendered
// HTML, shows only the loading veil, and the door opens once GET /api/session answers (asked as the page script
// loads, lib/client/session.ts, so the answer is usually in by the time the page hydrates).
//
// The care layer mounts only once the colleague is in their own garden ("Go to my garden", a returning visit, an
// opened link): Lijas's rose stays behind the planting moment and the link sheet, and the care layer's plant swap (a
// soft night over the whole page while the new plant is built) happens after the sheet has gone. A note about a
// switch waits until that night has lifted (settle.ts), and focus lands on the name pill whenever the person arrives
// in a garden from the sheet or a dialog, so a keyboard or screen reader is never left on the page itself.
import dynamic from "next/dynamic";
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { Dialog } from "@/components/gift/Dialog";
import { display } from "@/components/gift/fonts";
import { GiftFlow } from "@/components/gift/GiftFlow";
import { GiftVeil } from "@/components/gift/GiftVeil";
import { IdentityMenu } from "@/components/gift/IdentityMenu";
import { Showcase } from "@/components/gift/Showcase";
import { afterGardenSettles } from "@/components/gift/settle";
import {
  ApiProblem,
  OFFLINE_MESSAGE,
  capturePartyCode,
  forgetGardenLink,
  forgetPartyCode,
  getSession,
  openGardenLink,
  takeGardenLink,
  takeLinkFromHashChange,
  takeSessionAhead,
  type PersonSummary,
  type SeedResult,
  type TakenLink,
} from "@/lib/client/session";
import "@/components/gift/gift.css";

// Only a signed-in visitor needs the care layer, so the party's first-time visitors download it only once their seed
// is in (fetched then, behind the planting moment, so it is ready for "Go to my garden").
const loadCareLayer = () => import("@/components/care/CareLayer").then((m) => m.CareLayer);
const CareLayer = dynamic(loadCareLayer, { ssr: false, loading: () => null });
// lib/client/plant's event name, typed against it rather than imported, so that module still loads with the care layer
const SIGNED_OUT_EVENT: (typeof import("@/lib/client/plant"))["SIGNED_OUT_EVENT"] = "garden:signed-out";

/**
 * A development server has no party code configured, so the gift is offered without one; there ?as=showcase shows
 * what a visitor without a code sees on the live site.
 */
const IS_DEV = process.env.NODE_ENV !== "production";
const PLANT_WITHOUT_CODE = IS_DEV && !(typeof window !== "undefined" && new URLSearchParams(window.location.search).get("as") === "showcase");

type Door =
  | { mode: "resolving" }
  | { mode: "switch"; token: string; current: PersonSummary; target: PersonSummary; message: string; busy: boolean; problem: string | null }
  | { mode: "notice"; title: string; message: string; retryToken: string | null }
  | { mode: "gift"; partyCode: string | null }
  /** focus: the person arrived here from the sheet or a dialog, so focus goes to the name pill */
  | { mode: "garden"; person: PersonSummary; previous: PersonSummary | null; focus?: boolean }
  | { mode: "showcase" };

const personKey = (p: PersonSummary) => `${p.firstName}:${p.plot ?? "-"}`;

/** Where someone without a link to open goes: their own garden, the gift, or the showcase. */
async function sessionDoor(): Promise<Door> {
  try {
    // the first time, the answer the page asked for as it loaded
    const s = await (takeSessionAhead() ?? getSession());
    if (s.signedIn && s.person) {
      // a device that holds a garden has no use for the party code: not kept, and out of the address bar
      forgetPartyCode();
      return { mode: "garden", person: s.person, previous: s.previous };
    }
  } catch {
    // the server could not say: offer what the address says, and planting will tell if this device has a garden
  }
  const partyCode = capturePartyCode();
  if (partyCode !== null || PLANT_WITHOUT_CODE) return { mode: "gift", partyCode };
  return { mode: "showcase" };
}

/** The same door, with focus for the name pill when it is a garden (the sheet or a dialog that had focus is gone). */
const withFocus = (next: Promise<Door>): Promise<Door> => next.then((d) => (d.mode === "garden" ? { ...d, focus: true } : d));

/** After a link opened: the garden it opened, and the one "switch back" would return to. */
async function gardenAfterLink(person: PersonSummary, previous: PersonSummary | null): Promise<Door> {
  try {
    const s = await getSession();
    if (s.signedIn && s.person) return { mode: "garden", person: s.person, previous: s.previous };
  } catch {
    // keep what the link answer said
  }
  return { mode: "garden", person, previous };
}

async function linkDoor(token: string): Promise<Door> {
  try {
    const r = await openGardenLink(token);
    if (r.kind === "open") {
      forgetGardenLink();
      return gardenAfterLink(r.person, null);
    }
    if (r.kind === "switch_needed") {
      return { mode: "switch", token, current: r.current, target: r.target, message: r.message, busy: false, problem: null };
    }
    forgetGardenLink();
    return { mode: "notice", title: "This garden link has been replaced", message: r.message, retryToken: null };
  } catch (err) {
    return {
      mode: "notice",
      title: "Your garden link did not open just now",
      message: err instanceof ApiProblem ? err.message : OFFLINE_MESSAGE,
      retryToken: token,
    };
  }
}

async function doorFor(link: TakenLink): Promise<Door> {
  if (link.token) return linkDoor(link.token);
  if (link.incomplete) {
    forgetGardenLink();
    return {
      mode: "notice",
      title: "That garden link looks incomplete",
      message: "Part of it may have been lost when it was copied. Copy the whole link and open it again.",
      retryToken: null,
    };
  }
  return sessionDoor();
}

// One answer per page load, even when React runs the effect twice in development.
let opening: Promise<Door> | null = null;

/** How long a note about a switch stays under the pill, once the new garden is showing. */
const NOTE_MS = 5000;

export function GardenDoor({ hint }: { hint: ReactNode }) {
  const [door, setDoor] = useState<Door>({ mode: "resolving" });
  // a note waits for the garden it is about (afterGardenSettles), then shows for NOTE_MS
  const [pendingNote, setPendingNote] = useState<{ text: string; person: PersonSummary } | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    opening ??= doorFor(takeGardenLink());
    opening.then((d) => live && setDoor(d));
    // a garden link pasted into this open page changes only the fragment, so no reload brings it to the door
    const onHash = () => {
      const link = takeLinkFromHashChange();
      if (!link) return;
      setDoor({ mode: "resolving" });
      doorFor(link).then((d) => live && setDoor(d));
    };
    window.addEventListener("hashchange", onHash);
    return () => {
      live = false;
      window.removeEventListener("hashchange", onHash);
    };
  }, []);

  // The care layer found that this device no longer holds the garden it was showing (its session ended, say by a
  // reset from another device). The door takes the event, so the name pill goes and the explanation is the door's own
  // dialog rather than the care layer's fallback card.
  const gardenName = door.mode === "garden" ? door.person.firstName : null;
  useEffect(() => {
    if (gardenName === null) return;
    const onSignedOut = (e: Event) => {
      e.preventDefault();
      const name = (e as CustomEvent<{ firstName?: string | null } | null>).detail?.firstName ?? gardenName;
      setToast(null);
      setPendingNote(null);
      setDoor({
        mode: "notice",
        title: `This device no longer holds ${name}'s garden`,
        message: "Open your newest garden link on this device to come back to it.",
        retryToken: null,
      });
    };
    window.addEventListener(SIGNED_OUT_EVENT, onSignedOut);
    return () => window.removeEventListener(SIGNED_OUT_EVENT, onSignedOut);
  }, [gardenName]);

  useEffect(() => {
    if (!pendingNote) return;
    return afterGardenSettles(pendingNote.person, () => {
      setPendingNote(null);
      setToast(pendingNote.text);
    });
  }, [pendingNote]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), NOTE_MS);
    return () => clearTimeout(t);
  }, [toast]);

  const note = useCallback((text: string, person: PersonSummary) => {
    setToast(null);
    setPendingNote({ text, person });
  }, []);

  const go = useCallback((next: Promise<Door>) => {
    next.then(setDoor);
  }, []);

  // the seed is in: fetch the care layer now, so it is ready when the colleague steps into their garden
  const onPlanted = useCallback(() => {
    void loadCareLayer().catch(() => {});
  }, []);

  const enterGarden = useCallback((result: SeedResult) => {
    setDoor({ mode: "garden", person: { firstName: result.me.person.firstName, plot: result.me.plant.plot }, previous: null, focus: true });
  }, []);

  async function confirmSwitch(d: Extract<Door, { mode: "switch" }>) {
    setDoor({ ...d, busy: true, problem: null });
    try {
      const r = await openGardenLink(d.token, true);
      if (r.kind === "open") {
        forgetGardenLink();
        const next = await gardenAfterLink(r.person, d.current);
        setDoor(next.mode === "garden" ? { ...next, focus: true } : next);
        if (next.mode === "garden") note(`Now showing ${next.person.firstName}'s garden on this device.`, next.person);
        return;
      }
      if (r.kind === "invalid") {
        forgetGardenLink();
        setDoor({ mode: "notice", title: "This garden link has been replaced", message: r.message, retryToken: null });
        return;
      }
      setDoor({ ...d, busy: false, problem: r.message });
    } catch (err) {
      setDoor({ ...d, busy: false, problem: err instanceof ApiProblem ? err.message : OFFLINE_MESSAGE });
    }
  }

  return (
    <div className={`gift-root ${display.variable}`}>
      {/* keyed by whose garden it is, so a switch starts the care layer afresh for the new plant */}
      {door.mode === "garden" && <CareLayer key={personKey(door.person)} />}

      {(door.mode === "gift" || door.mode === "showcase") && <GiftVeil />}

      {door.mode === "gift" && (
        <GiftFlow
          partyCode={door.partyCode}
          onPlanted={onPlanted}
          onEnterGarden={enterGarden}
          onAlreadyPlanted={() => go(withFocus(sessionDoor()))}
        />
      )}

      {door.mode === "showcase" && (
        <>
          <Showcase />
          {hint}
        </>
      )}

      {/* no hint caption here: the care layer's card holds the bottom of the screen */}
      {door.mode === "garden" && (
        <IdentityMenu
          person={door.person}
          previous={door.previous}
          focusOnMount={door.focus === true}
          onSwitchedBack={(person) => {
            setDoor({ mode: "garden", person, previous: null });
            note(`Back in ${person.firstName}'s garden.`, person);
          }}
          note={toast}
        />
      )}

      {door.mode === "switch" && (
        <Dialog label="Switch gardens on this device">
          <h2 className="gift-title gift-title-sm">{`Open ${door.target.firstName}'s garden here?`}</h2>
          <p className="gift-text">{door.message}</p>
          {door.problem && (
            <p className="gift-error" role="alert">
              {door.problem}
            </p>
          )}
          <div className="gift-dialog-actions">
            <button type="button" className="gift-primary" disabled={door.busy} onClick={() => confirmSwitch(door)}>
              {door.busy ? "Opening the garden" : `Open ${door.target.firstName}'s garden`}
            </button>
            <button
              type="button"
              className="gift-secondary"
              disabled={door.busy}
              onClick={() => {
                forgetGardenLink();
                go(withFocus(sessionDoor()));
              }}
            >
              {`Stay with ${door.current.firstName}'s garden`}
            </button>
          </div>
        </Dialog>
      )}

      {door.mode === "notice" && (
        <Dialog
          label={door.title}
          onClose={() => {
            forgetGardenLink();
            go(withFocus(sessionDoor()));
          }}
        >
          <h2 className="gift-title gift-title-sm">{door.title}</h2>
          <p className="gift-text">{door.message}</p>
          <div className="gift-dialog-actions">
            {door.retryToken && (
              <button type="button" className="gift-primary" onClick={() => go(withFocus(linkDoor(door.retryToken as string)))}>
                Try again
              </button>
            )}
            <button
              type="button"
              className={door.retryToken ? "gift-secondary" : "gift-primary"}
              onClick={() => {
                forgetGardenLink();
                go(withFocus(sessionDoor()));
              }}
            >
              Continue to the garden
            </button>
          </div>
        </Dialog>
      )}
    </div>
  );
}
