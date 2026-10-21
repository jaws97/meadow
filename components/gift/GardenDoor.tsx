"use client";
// Who has come through the garden's door, and what they see over the live garden:
// - a personal garden link (/garden#k=..., taken out of the address bar as the page loads, or when it is pasted into
//   an open page, lib/client/session.ts) is exchanged for this device's session; if the device already shows someone
//   else's garden, the person is asked before switching (and can switch back later), with both gardens named by
//   their flower so two colleagues with one first name are told apart ("Open Priya's Night Jasmine garden here?",
//   lib/client/gardens); a replaced link is explained, never an error page;
// - someone whose device already holds a garden goes straight to it, with the care layer and the identity pill (and
//   if that session ends while the garden is open, the care layer says so and the door explains in a dialog);
// - anyone else is given the seed (since 21 Oct, party link or not: the QR link's ?code=... rides along and spares the
//   party's seeds the limits on strangers' plantings; planting never closes), unless planting asks for the party link
//   again (MEADOW_PLANTING=party, which GET /api/session reports): then someone without it sees Lijas's rose with a
//   gentle line about the link.
// The decision needs the server (the session cookie is httpOnly), so the first render, which is also the prerendered
// HTML, shows only the loading veil, and the door opens once GET /api/session answers (asked as the page script
// loads, lib/client/session.ts, so the answer is usually in by the time the page hydrates). That first answer also
// starts the page's opening (lib/garden/opening): the quote moment for a colleague's own garden (with "Welcome back"
// once it is showing, unless the door has left that garden by then) and for the showcase, which then needs no still of
// the rose; the gift's own first look and the dialogs skip it, over whichever loading veil was painted first. Until
// the opening's peace has passed, the pill, the care card and the showcase caption hold back (gift.css, CareLayer.css).
//
// The care layer mounts only once the colleague is in their own garden ("Go to my garden", a returning visit, an
// opened link): Lijas's rose stays behind the planting moment and the link sheet, and the care layer's plant swap (a
// soft night over the whole page while the new plant is built) happens after the sheet has gone. A note about a
// switch waits until that night has lifted (settle.ts), and focus lands on the name pill whenever the person arrives
// in a garden from the sheet or a dialog, so a keyboard or screen reader is never left on the page itself. The pill is
// rendered before the care layer, so it also comes first when tabbing.
//
// A colleague's own garden (flower bed or lotus courtyard alike) also has the sound button in its top-right corner
// (components/sound/SoundButton), rendered between the pill and the care layer so it comes between them when tabbing.
// It never starts sound by itself, and its panel loads only when it is needed. For testing, ?sound=1 shows it in any
// door; ?sound=off never shows it.
import dynamic from "next/dynamic";
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { Dialog } from "@/components/gift/Dialog";
import { display } from "@/components/gift/fonts";
import { GiftFlow } from "@/components/gift/GiftFlow";
import { GiftVeil } from "@/components/gift/GiftVeil";
import { IdentityMenu } from "@/components/gift/IdentityMenu";
import { Showcase } from "@/components/gift/Showcase";
import { afterGardenSettles } from "@/components/gift/settle";
import { SoundButton, useSoundSwitch } from "@/components/sound/SoundButton";
import { gardenName, gardenNames, knownFacts, lookUpGarden, type GardenFacts } from "@/lib/client/gardens";
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
import { opening, quoteRuns, useOpening } from "@/lib/garden/opening";
import "@/components/gift/gift.css";

// Only a signed-in visitor needs the care layer, so the party's first-time visitors download it only once their seed
// is in (fetched then, behind the planting moment, so it is ready for "Go to my garden").
const loadCareLayer = () => import("@/components/care/CareLayer").then((m) => m.CareLayer);
const CareLayer = dynamic(loadCareLayer, { ssr: false, loading: () => null });
// lib/client/plant's event name, typed against it rather than imported, so that module still loads with the care layer
const SIGNED_OUT_EVENT: (typeof import("@/lib/client/plant"))["SIGNED_OUT_EVENT"] = "garden:signed-out";

/**
 * A development server always offers the gift (its seeds are practice ones); there ?as=showcase shows what a visitor
 * without the party link sees on the live site when planting asks for the link again.
 */
const IS_DEV = process.env.NODE_ENV !== "production";
const AS_SHOWCASE = IS_DEV && typeof window !== "undefined" && new URLSearchParams(window.location.search).get("as") === "showcase";

type Door =
  | { mode: "resolving" }
  | {
      mode: "switch";
      token: string;
      current: PersonSummary;
      target: PersonSummary;
      /** each garden's flower and day, when they could be found in a moment (null: the first name alone) */
      currentFacts: GardenFacts | null;
      targetFacts: GardenFacts | null;
      busy: boolean;
      problem: string | null;
    }
  | { mode: "notice"; title: string; message: string; retryToken: string | null }
  | { mode: "gift"; partyCode: string | null }
  /** focus: the person arrived here from the sheet or a dialog, so focus goes to the name pill */
  | { mode: "garden"; person: PersonSummary; previous: PersonSummary | null; focus?: boolean }
  | { mode: "showcase" };

const personKey = (p: PersonSummary) => `${p.firstName}:${p.plot ?? "-"}`;

/** Where someone without a link to open goes: their own garden, the gift, or the showcase. */
async function sessionDoor(): Promise<Door> {
  // whether someone without the party link may plant: yes, unless the server says planting asks for the link again
  let plantingOpen = true;
  try {
    // the first time, the answer the page asked for as it loaded
    const s = await (takeSessionAhead() ?? getSession());
    if (s.signedIn && s.person) {
      // a device that holds a garden has no use for the party code: not kept, and out of the address bar
      forgetPartyCode();
      return { mode: "garden", person: s.person, previous: s.previous };
    }
    plantingOpen = s.plantingOpen !== false;
  } catch {
    // the server could not say: offer what the address says, and planting will tell if this device has a garden
  }
  const partyCode = capturePartyCode();
  if (AS_SHOWCASE) return { mode: "showcase" };
  if (partyCode !== null || plantingOpen || IS_DEV) return { mode: "gift", partyCode };
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
      // both gardens by their flower before asking (a moment at most; lookUpGarden gives up after a couple of seconds)
      const [currentFacts, targetFacts] = await Promise.all([lookUpGarden(r.current), lookUpGarden(r.target)]);
      return { mode: "switch", token, current: r.current, target: r.target, currentFacts, targetFacts, busy: false, problem: null };
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
let arriving: Promise<Door> | null = null;

/**
 * The first answer also decides the page's opening (lib/garden/opening): the quote moment for the visitor's own garden
 * (with their name for the welcome) and for the showcase; the plain loading veil for the gift's own first look and for
 * a dialog at the door.
 */
function openingFor(d: Door) {
  if (d.mode === "garden") opening.door({ run: true, name: d.person.firstName });
  else opening.door({ run: d.mode === "showcase", name: null });
}

/** How long a note about a switch stays under the pill, once the new garden is showing. */
const NOTE_MS = 5000;

export function GardenDoor({ hint }: { hint: ReactNode }) {
  const [door, setDoor] = useState<Door>({ mode: "resolving" });
  // a note waits for the garden it is about (afterGardenSettles), then shows for NOTE_MS
  const [pendingNote, setPendingNote] = useState<{ text: string; person: PersonSummary } | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const quoteMoment = useOpening(quoteRuns);
  const soundSwitch = useSoundSwitch();
  const showSound = soundSwitch !== "off" && (door.mode === "garden" || soundSwitch === "on");

  useEffect(() => {
    let live = true;
    arriving ??= doorFor(takeGardenLink());
    arriving.then((d) => {
      openingFor(d);
      if (live) setDoor(d);
    });
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

  // The welcome is for the garden the door first opened: once the door shows anything else (the dialog for an ended
  // session, a pasted link resolving), it is not said.
  useEffect(() => {
    if (door.mode !== "garden") opening.unname();
  }, [door.mode]);

  // The care layer found that this device no longer holds the garden it was showing (its session ended, say by a
  // reset from another device). The door takes the event, so the name pill goes and the explanation is the door's own
  // dialog rather than the care layer's fallback card.
  const shownName = door.mode === "garden" ? door.person.firstName : null;
  const shownPlot = door.mode === "garden" ? door.person.plot : null;
  useEffect(() => {
    if (shownName === null) return;
    const onSignedOut = (e: Event) => {
      e.preventDefault();
      const firstName = (e as CustomEvent<{ firstName?: string | null } | null>).detail?.firstName ?? shownName;
      const garden = { firstName, plot: shownPlot };
      setToast(null);
      setPendingNote(null);
      setDoor({
        mode: "notice",
        title: `This device no longer holds ${gardenName(garden, knownFacts(garden))}`,
        message: "Open your newest garden link on this device to come back to it.",
        retryToken: null,
      });
    };
    window.addEventListener(SIGNED_OUT_EVENT, onSignedOut);
    return () => window.removeEventListener(SIGNED_OUT_EVENT, onSignedOut);
  }, [shownName, shownPlot]);

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
        if (next.mode === "garden") {
          const facts = next.person.plot === d.target.plot ? d.targetFacts : knownFacts(next.person);
          note(`Now showing ${gardenName(next.person, facts)} on this device.`, next.person);
        }
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
      {/* the name pill first, so it comes before the care buttons when tabbing (its layer is set in gift.css) */}
      {door.mode === "garden" && (
        <IdentityMenu
          person={door.person}
          previous={door.previous}
          focusOnMount={door.focus === true}
          onSwitchedBack={(person) => {
            setDoor({ mode: "garden", person, previous: null });
            note(`Back in ${gardenName(person, knownFacts(person))}.`, person);
          }}
          note={toast}
        />
      )}

      {/* the garden's sounds: top right, after the pill and before the care buttons when tabbing (sound.css) */}
      {showSound && <SoundButton />}

      {/* keyed by whose garden it is, so a switch starts the care layer afresh for the new plant */}
      {door.mode === "garden" && <CareLayer key={personKey(door.person)} />}

      {/* the gift's own first look; the showcase too, unless it opens on the quote moment (lib/garden/opening) */}
      {(door.mode === "gift" || (door.mode === "showcase" && !quoteMoment)) && <GiftVeil />}

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

      {door.mode === "switch" && (
        <SwitchDialog
          door={door}
          onConfirm={() => confirmSwitch(door)}
          onStay={() => {
            forgetGardenLink();
            go(withFocus(sessionDoor()));
          }}
        />
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

/**
 * "Open Priya's Night Jasmine garden here? This device is showing Priya's Marigold garden." Both gardens by their
 * flower (and their day too when the name and flower are shared), or by the first name alone when the flower could not
 * be found.
 */
function SwitchDialog({
  door,
  onConfirm,
  onStay,
}: {
  door: Extract<Door, { mode: "switch" }>;
  onConfirm: () => void;
  onStay: () => void;
}) {
  const [target, current] = gardenNames(door.target, door.targetFacts, door.current, door.currentFacts);
  return (
    <Dialog label="Switch gardens on this device">
      <h2 className="gift-title gift-title-sm">{`Open ${target} here?`}</h2>
      <p className="gift-text">{`This device is showing ${current}. You can switch back afterwards.`}</p>
      {door.problem && (
        <p className="gift-error" role="alert">
          {door.problem}
        </p>
      )}
      <div className="gift-dialog-actions">
        <button type="button" className="gift-primary" disabled={door.busy} onClick={onConfirm}>
          {door.busy ? "Opening the garden" : `Open ${target}`}
        </button>
        <button type="button" className="gift-secondary" disabled={door.busy} onClick={onStay}>
          {`Stay with ${current}`}
        </button>
      </div>
    </Dialog>
  );
}
