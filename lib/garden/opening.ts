// The opening, in two beats, for someone who opens their garden (or the Meadow) after a long day: first a lift, then
// peace. Everything that takes part reads this one store instead of keeping its own timers: the garden's loading veil
// and the Meadow's (QuoteMoment, components/garden/OpeningMoment), the render governor that holds the reveal under
// the veil (components/garden/RenderBudget), both camera rigs, both canvases' focus, the welcome line, and every piece
// of UI that waits for the peace to pass.
//
// The lift: only the night sky and a quote (lib/garden/quotes), its words arriving one at a time. Once the last word
// is in, the quote is held at least long enough to be read (dwellMs), and the veil does not lift before that even when
// the garden is ready sooner; when the garden takes longer the quote simply stays. A tap, a click or a key ends the
// dwell early (the garden still waits for its own readiness). The breath: the quote rises away and fades, then a
// moment of quiet dark. The peace: the garden comes into focus, soft and dim to sharp, with a gentle push-in of the
// camera (pushFactor, cancelled the moment someone drags or zooms), and for the first seconds no UI at all; then, when
// the visitor's own garden and name are known, "Welcome back, Asha" near the top for a few seconds; then the UI. A tap
// or a click during the peace brings the UI in at once: the person wants to act.
//
// Stages, one way: unset (the prerendered page, and every route without an opening) -> pending (the garden page,
// waiting for its door to say whose garden this is) -> quote -> breath -> peace -> done; or skip, for the plain loading
// veil: a quote moment on this device less than ten minutes ago (a quick reload is not slowed), a door that leads
// elsewhere (the gift's own first look, a dialog), or a door that never answers. One opening per page load.
//
// The garden page's veil has two looks, and which one is painted first is decided before any script but an inline one
// has run (firstLookScript, as the HTML is parsed): the quote moment's night sky for a device that has shown its own
// garden or opened on a quote before, the plain veil's sprout for a first visit (the party's QR code opens as it always
// has). The door can still turn a plain first look into the quote moment (a first visit to the showcase). The Meadow's
// veil has two looks too: the quote moment, or its lantern when the quote is skipped.
//
// The words in the first paint. Every quote is in the page's HTML, hidden, and the same inline script picks this
// opening's quote (by quoteOrder's own shuffle, never the one shown last) and shows it by marking the root element
// (data-quote), so its words begin to arrive with the first paint instead of waiting for the page's JavaScript to load
// and run, seconds on a phone. It does so only where the opening will surely run the quote: on the Meadow unless it is
// skipped, and on the garden page for a device that holds a garden at a plain address (no garden link, no party code),
// whose door can only open on the colleague's own garden: a device without a garden is offered the seed (or, while
// planting asks for the party link, the showcase, which the door can still turn to the quote). It leaves a note
// for the store (window.__openingFirst) and the store adopts it as the page hydrates: the same quote, timed from when
// it began. On the garden page that quote is still waiting for the door's answer (awaitingDoor): the breath waits for
// it as a pending opening would (at most PENDING_MAX_MS after the garden is ready), the answer brings the visitor's name
// for the welcome, and in the rare case the door leads elsewhere after all (the gift, a dialog) the quote is withdrawn,
// rising away as it would in the breath, over the night sky that stays. The dwell counts from the moment the words were
// actually painted (painted()), not from when the store heard of them, so a slow page never cuts the reading short.
//
// A hidden page (opened in a background tab, or switched away from) stops the opening's clock: the quote begins to
// arrive only once it can be seen, and every moment still to come waits as long as the page was hidden, so the dwell
// counts only seconds someone could read, and the peace does not play to an empty room.
//
// The pure parts (the dwell, the skip rule, the transitions, the push) are tested in node (opening.test.ts); the store
// below schedules the next transition, writes the performance marks (opening:*), keeps the root element's
// data-opening="quiet" while the UI holds back (each overlay's stylesheet decides how it waits and how it arrives) and
// its data-veil (the look), and listens for the taps. Times are performance.now() ms.
import { useSyncExternalStore } from "react";
import { QUOTES, quoteOrder } from "@/lib/garden/quotes";

export type Stage = "unset" | "pending" | "skip" | "quote" | "breath" | "peace" | "done";

/** Each word's arrival: the gap between words, and how long one takes from a soft blur to sharp (ms). */
export const WORD_STAGGER_MS = 140;
export const WORD_MS = 700;
/** Reduced motion: the whole quote fades in at once, over this long. */
export const STILL_IN_MS = 700;
/** The least the quote is held once its last word is in, and the reading time per word that can lengthen it. */
export const DWELL_MIN_MS = 3500;
export const DWELL_PER_WORD_MS = 300;
export const DWELL_PAD_MS = 1500;
/** A quote moment on this device more recently than this skips the next one. */
export const SKIP_WITHIN_MS = 10 * 60_000;
/** Ready, still waiting for the garden's door: the quote is given up after this long (the plain veil lifts). */
export const PENDING_MAX_MS = 2500;
/** The breath: the quote rising away, then quiet dark before the garden comes. */
export const QUOTE_OUT_MS = 900;
export const BREATH_MS = QUOTE_OUT_MS + 400;
/** The garden coming into focus, and when the veil and the canvas's soft focus are gone (a little after). */
export const FOCUS_MS = 2200;
export const FOCUS_DONE_MS = FOCUS_MS + 200;
/** The veil's fade: with the canvas blurring into focus under it, or carrying the focus alone (the lite tier, a phone, reduced motion). */
export const VEIL_FADE_MS = { soft: 1600, plain: FOCUS_MS } as const;
/** The push-in: this much closer by the end (a share of the distance), over this long. */
export const PUSH = 0.06;
export const PUSH_MS = 4000;
/** The welcome line comes this long after the reveal, is read for this long, then fades as the UI arrives. */
export const WELCOME_AT_MS = 2800;
export const WELCOME_HOLD_MS = 2800;
export const WELCOME_FADE_MS = 900;
/** Without a welcome, the UI comes this long after the reveal. */
export const UI_AT_MS = 3000;
/** The UI's own arrival, after which the opening is over. */
export const UI_SETTLE_MS = 1000;

/** The longest the words' first paint can come after the store heard the quote began (ms): later is not waited for. */
export const PAINT_SLACK_MS = 10_000;

const LAST_QUOTE_KEY = "garden:last-quote";
const OPENED_AT_KEY = "garden:opening-at";
/** lib/client/plant's remembered plant: this device has shown its own garden (typed against it rather than imported). */
const HELD_KEY: (typeof import("@/lib/client/plant"))["LOOK_KEY"] = "garden-plant:v1";
/** lib/client/session's kept party code: this tab came from the party's QR link (typed against it rather than imported). */
const PARTY_CODE_KEY: (typeof import("@/lib/client/session"))["PARTY_CODE_KEY"] = "garden-party-code:v1";

/** The garden veil's look: the quote moment's night sky, or the plain veil's sprout (the root element's data-veil). */
export type Look = "quote" | "plain";

export interface OpeningState {
  stage: Stage;
  look: Look;
  /** The quote this opening shows (an index into QUOTES), and its words. */
  quote: number | null;
  words: number;
  /** prefers-reduced-motion: no stagger, no blur, no push-in; plain fades with the same dwell. */
  reduced: boolean;
  /**
   * The canvas may blur into focus: only on a laptop or a big screen, and not on the lite tier. Elsewhere the veil's
   * longer fade carries it alone (a filter over a live canvas is not proven smooth on a phone's or a tablet's GPU).
   */
  soft: boolean;
  /** Whose welcome it is: a first name, once the visitor's own garden is known. */
  name: string | null;
  /** When the quote began to arrive (null while the page is hidden), and when a tap ended its dwell early. */
  shownAt: number | null;
  tappedAt: number | null;
  /** The garden is ready under the veil (the governor has settled, the Meadow has its plants). */
  readyAt: number | null;
  breathAt: number | null;
  revealAt: number | null;
  focusedAt: number | null;
  welcomeInAt: number | null;
  welcomeOutAt: number | null;
  uiAt: number | null;
  doneAt: number | null;
  /** Someone dragged or zoomed: the push-in stops where it is. */
  pushStoppedAt: number | null;
  /** The quote began with the first paint (firstLookScript) and the garden's door has not answered yet. */
  awaitingDoor: boolean;
  /** The door led elsewhere after the quote had begun: it was withdrawn then. */
  withdrawnAt: number | null;
}

export const INITIAL: OpeningState = Object.freeze({
  stage: "unset",
  look: "plain",
  quote: null,
  words: 0,
  reduced: false,
  soft: true,
  name: null,
  shownAt: null,
  tappedAt: null,
  readyAt: null,
  breathAt: null,
  revealAt: null,
  focusedAt: null,
  welcomeInAt: null,
  welcomeOutAt: null,
  uiAt: null,
  doneAt: null,
  pushStoppedAt: null,
  awaitingDoor: false,
  withdrawnAt: null,
}) as OpeningState;

// ---------------------------------------------------------------------------
// The pure parts

/** The words of a quote, as the veil shows them one at a time. */
export const wordsOf = (text: string): string[] => text.trim().split(/\s+/).filter(Boolean);

/** The least time (ms) a quote of `words` words is held once its last word is in. */
export function dwellMs(words: number): number {
  return Math.max(DWELL_MIN_MS, words * DWELL_PER_WORD_MS + DWELL_PAD_MS);
}

/** How long (ms) a quote of `words` words takes to arrive: the last word fully in. */
export function arrivalMs(words: number, reduced: boolean): number {
  if (reduced) return STILL_IN_MS;
  return Math.max(0, words - 1) * WORD_STAGGER_MS + WORD_MS;
}

/** A quote moment `lastAt` (epoch ms, from this device's storage) is recent enough at `now` to skip this one. */
export function skipsQuote(lastAt: number | null, now: number): boolean {
  return lastAt !== null && Number.isFinite(lastAt) && now >= lastAt && now - lastAt < SKIP_WITHIN_MS;
}

/**
 * The garden veil's first look: the quote moment's night sky for a device that has shown its own garden (`held`) or
 * opened on a quote before (`openedAt`, epoch ms), unless that quote moment was less than ten minutes ago (the plain
 * veil then, skipsQuote); the plain veil's sprout for everyone else, so a first visit opens exactly as it always has.
 */
export function firstLookQuote(openedAt: number | null, held: boolean, now: number): boolean {
  const opened = openedAt !== null && Number.isFinite(openedAt);
  return !skipsQuote(openedAt, now) && (opened || held);
}

/** What the inline first-look script hands the store (window.__openingFirst), adopted as the page hydrates. */
export interface FirstLook {
  look: Look;
  /** a quote moment on this device less than ten minutes ago (skipsQuote) */
  skip: boolean;
  /** the quote it picked (quoteOrder's first) */
  quote: number;
  /** it started the quote: the words are arriving */
  run: boolean;
  /** when it started them (performance.now() ms), or null while the page is still hidden */
  at: number | null;
  /** a tap or a key before the page had hydrated, once the words had begun */
  tap: number | null;
  /** stops listening for the page being seen and for taps (the store takes over) */
  stop: () => void;
}

/** Keys on their own (Shift for a screenshot, say) are not someone wanting to move on. */
const MODIFIER_KEYS = ["Shift", "Control", "Alt", "Meta", "CapsLock", "Fn"] as const;

/**
 * The first look, run by the page as its HTML is parsed: an inline script before the veil, so the veil's first paint
 * already has it (Next's "preventing flash before hydration" guide). It decides the veil's look as the store would
 * (firstLookQuote on the garden page; on the Meadow the quote unless skipsQuote), sets the root element's data-veil,
 * picks the quote by quoteOrder's own shuffle and, where the opening will surely run it (see the header), starts its
 * words by setting data-quote, as soon as the page can be seen. It touches only the root element's attributes (React
 * renders no text it changes, so hydration matches), writes nothing to storage (the store remembers the quote once it
 * adopts it), and leaves everything in window.__openingFirst. opening.test.ts holds it to the store's answers.
 */
export function firstLookScript(page: "garden" | "meadow"): string {
  const k = JSON.stringify;
  // On the garden page the door can only open the colleague's own garden for a device that holds a garden, at a plain
  // address: a garden link (#k=, ?link=) or a party code (?code=, or one kept for this tab) may lead to a dialog or the
  // gift instead, and a device without a garden is offered the gift (GardenDoor's sessionDoor), planting never closing.
  const runs =
    page === "meadow"
      ? "!skip"
      : `look==="quote"&&!/[#&]k=/.test(location.hash)&&!/[?&](link|code)=/.test(location.search)&&!kept()&&held`;
  return (
    `(function(){try{` +
    `var d=document,r=d.documentElement,s=localStorage,n=Date.now(),` +
    `v=s.getItem(${k(OPENED_AT_KEY)}),a=v===null||v.trim()===""?NaN:Number(v),o=isFinite(a),` +
    `skip=o&&n>=a&&n-a<${SKIP_WITHIN_MS},held=s.getItem(${k(HELD_KEY)})!==null,` +
    (page === "garden" ? `look=!skip&&(o||held)?"quote":"plain",` : `look=skip?"plain":"quote",`) +
    `w=s.getItem(${k(LAST_QUOTE_KEY)}),last=w===null||w.trim()===""?null:Number(w),q=[],i,j,t;` +
    `if(!Number.isInteger(last))last=null;` +
    // quoteOrder (lib/garden/quotes): a Fisher-Yates shuffle that never starts on the quote shown last
    `for(i=0;i<${QUOTES.length};i++)q.push(i);` +
    `for(i=q.length-1;i>0;i--){j=Math.floor(Math.random()*(i+1));t=q[i];q[i]=q[j];q[j]=t}` +
    `if(q.length>1&&q[0]===last)q.push(q.shift());` +
    `var kept=function(){try{return sessionStorage.getItem(${k(PARTY_CODE_KEY)})!==null}catch(e){return false}},` +
    `h={look:look,skip:skip,quote:q[0],run:${runs},at:null,tap:null},` +
    `go=function(){if(h.at!==null||d.visibilityState!=="visible")return;` +
    `h.at=performance.now();r.setAttribute("data-quote",String(h.quote));d.removeEventListener("visibilitychange",go)},` +
    `mods=${k(MODIFIER_KEYS)},` +
    `act=function(e){if(h.at!==null&&h.tap===null&&!(e.type==="keydown"&&mods.indexOf(e.key)>=0))h.tap=performance.now()};` +
    `h.stop=function(){d.removeEventListener("visibilitychange",go);` +
    `window.removeEventListener("pointerdown",act,true);window.removeEventListener("keydown",act,true)};` +
    `r.setAttribute("data-veil",look);` +
    `if(h.run){go();if(h.at===null)d.addEventListener("visibilitychange",go);` +
    `window.addEventListener("pointerdown",act,true);window.addEventListener("keydown",act,true)}` +
    `window.__openingFirst=h` +
    `}catch(e){}})()`
  );
}

/** When the quote's last word is in, or null before it has begun. */
export function quoteInAt(s: OpeningState): number | null {
  return s.shownAt === null ? null : s.shownAt + arrivalMs(s.words, s.reduced);
}

/** When the dwell is over: its full length after the last word, or the tap that ended it sooner. */
export function dwellEndAt(s: OpeningState): number | null {
  const inAt = quoteInAt(s);
  if (inAt === null) return null;
  const full = inAt + dwellMs(s.words);
  return s.tappedAt === null ? full : Math.min(full, s.tappedAt);
}

/** The veil stays up (and the garden's reveal waits) while the opening is still before its peace. */
export const holdsReveal = (s: OpeningState): boolean => s.stage === "pending" || s.stage === "quote" || s.stage === "breath";

/** The UI holds back: through the veil, and the peace until its time. */
export const uiHeld = (s: OpeningState): boolean => holdsReveal(s) || (s.stage === "peace" && s.uiAt === null);

/** The quote moment's veil is (or was) on screen: not the plain loading veil. */
export const quoteRuns = (s: OpeningState): boolean => s.stage !== "unset" && s.stage !== "skip";

/** The welcome line: coming in, going out, or not there. */
export function welcomeState(s: OpeningState): "in" | "out" | null {
  if (s.welcomeInAt === null || s.doneAt !== null) return null;
  return s.welcomeOutAt === null ? "in" : "out";
}

/** The canvas's focus: soft under the veil through the breath, coming into focus over the peace's first seconds. */
export function focusState(s: OpeningState): "soft" | "focus" | null {
  if (!s.soft || s.reduced) return null;
  if (s.stage === "breath") return "soft";
  if (s.stage === "peace" && s.focusedAt === null) return "focus";
  return null;
}

const smooth = (t: number) => {
  const x = Math.min(1, Math.max(0, t));
  return x * x * (3 - 2 * x);
};

/** How much farther than its framing the camera stands: the push-in's start under the veil, easing to 1 over the peace. */
export function pushFactor(s: OpeningState, now: number): number {
  if (s.reduced || !quoteRuns(s)) return 1;
  const start = 1 / (1 - PUSH);
  if (s.revealAt === null) return start;
  const at = Math.min(now, s.pushStoppedAt ?? Infinity);
  return 1 + (start - 1) * (1 - smooth((at - s.revealAt) / PUSH_MS));
}

/** Moves the opening on to whatever is due at `now` (any number of steps). */
export function advance(s: OpeningState, now: number): OpeningState {
  let n = s;
  for (;;) {
    const next = step(n, now);
    if (next === n) return n;
    n = next;
  }
}

function step(s: OpeningState, now: number): OpeningState {
  switch (s.stage) {
    case "pending":
      return s.readyAt !== null && now >= s.readyAt + PENDING_MAX_MS ? { ...s, stage: "skip" } : s;
    case "quote": {
      const end = dwellEndAt(s);
      if (end === null || s.readyAt === null || now < end) return s;
      // a quote begun with the first paint waits for the garden's door as a pending opening would, and no longer
      if (s.awaitingDoor && now < s.readyAt + PENDING_MAX_MS) return s;
      return { ...s, stage: "breath", breathAt: now };
    }
    case "breath":
      return s.breathAt !== null && now >= s.breathAt + BREATH_MS ? { ...s, stage: "peace", revealAt: now } : s;
    case "peace": {
      const r = s.revealAt ?? now;
      if (s.focusedAt === null && now >= r + FOCUS_DONE_MS) return { ...s, focusedAt: now };
      if (s.uiAt === null) {
        if (s.welcomeInAt === null && s.name !== null && now >= r + WELCOME_AT_MS) return { ...s, welcomeInAt: now };
        if (s.welcomeInAt !== null && now >= s.welcomeInAt + WELCOME_HOLD_MS) return { ...s, uiAt: now, welcomeOutAt: now };
        if (s.welcomeInAt === null && s.name === null && now >= r + UI_AT_MS) return { ...s, uiAt: now };
        return s;
      }
      const over = s.focusedAt !== null && now >= s.uiAt + UI_SETTLE_MS && (s.welcomeOutAt === null || now >= s.welcomeOutAt + WELCOME_FADE_MS);
      return over ? { ...s, stage: "done", doneAt: now } : s;
    }
    default:
      return s;
  }
}

/** The next moment (ms) something is due, or null when only an outside event can move the opening on. */
export function nextDue(s: OpeningState): number | null {
  const due: number[] = [];
  switch (s.stage) {
    case "pending":
      if (s.readyAt !== null) due.push(s.readyAt + PENDING_MAX_MS);
      break;
    case "quote": {
      const end = dwellEndAt(s);
      if (end !== null && s.readyAt !== null) due.push(s.awaitingDoor ? Math.max(end, s.readyAt + PENDING_MAX_MS) : end);
      break;
    }
    case "breath":
      if (s.breathAt !== null) due.push(s.breathAt + BREATH_MS);
      break;
    case "peace": {
      const r = s.revealAt ?? 0;
      if (s.focusedAt === null) due.push(r + FOCUS_DONE_MS);
      if (s.uiAt === null) {
        if (s.welcomeInAt !== null) due.push(s.welcomeInAt + WELCOME_HOLD_MS);
        else due.push(r + (s.name !== null ? WELCOME_AT_MS : UI_AT_MS));
      } else {
        // done once everything has finished: the UI's arrival, the welcome's fade and the focus
        const faded = s.welcomeOutAt === null ? 0 : s.welcomeOutAt + WELCOME_FADE_MS;
        due.push(Math.max(s.uiAt + UI_SETTLE_MS, faded, s.focusedAt ?? r + FOCUS_DONE_MS));
      }
      break;
    }
  }
  return due.length ? Math.min(...due) : null;
}

/**
 * The page's opening begins: `waitForDoor` keeps it pending until the garden's door says whose garden this is, in the
 * look painted first (`quoteFirst`, firstLookQuote). On a hidden page the quote waits to begin until it is seen (shown).
 * `started`: the first-look script began the quote with the first paint, at `shownAt` (null while the page is hidden),
 * with a tap at `tappedAt` before the page hydrated; on the garden page it still waits for the door (awaitingDoor).
 */
export function begin(
  s: OpeningState,
  o: {
    waitForDoor: boolean;
    skip: boolean;
    reduced: boolean;
    quote: number;
    words: number;
    quoteFirst?: boolean;
    hidden?: boolean;
    started?: boolean;
    shownAt?: number | null;
    tappedAt?: number | null;
  },
  now: number,
): OpeningState {
  if (s.stage !== "unset") return s;
  const base = { ...s, reduced: o.reduced, quote: o.quote, words: o.words };
  if (o.skip) return { ...base, stage: "skip", look: "plain" };
  if (o.started) {
    const shownAt = o.shownAt ?? (o.hidden ? null : now);
    const tappedAt = shownAt !== null && o.tappedAt != null && o.tappedAt >= shownAt ? o.tappedAt : null;
    return { ...base, stage: "quote", look: "quote", shownAt, tappedAt, awaitingDoor: o.waitForDoor };
  }
  if (o.waitForDoor) return { ...base, stage: "pending", look: o.quoteFirst ? "quote" : "plain" };
  return { ...base, stage: "quote", look: "quote", shownAt: o.hidden ? null : now };
}

/**
 * The door has answered: the visitor's own garden (with their name for the welcome) or the showcase run the quote,
 * in the quote moment's look whatever was painted first. Anything else skips it and keeps the look it has: a night
 * sky already up stays up under the gift's still or a dialog, rather than a sprout arriving behind them. A quote the
 * first paint began (awaitingDoor) takes the name, or is withdrawn if it is still up (and left alone if the garden is
 * already showing: the gift or the dialog simply comes over it).
 */
export function door(s: OpeningState, d: { run: boolean; name: string | null; hidden?: boolean }, now: number): OpeningState {
  if (s.stage === "pending") {
    return d.run ? { ...s, stage: "quote", look: "quote", shownAt: d.hidden ? null : now, name: d.name } : { ...s, stage: "skip" };
  }
  if (!s.awaitingDoor) return s;
  if (d.run) return { ...s, awaitingDoor: false, name: s.uiAt === null && s.stage !== "done" ? d.name : s.name };
  if (s.stage === "quote") return { ...s, awaitingDoor: false, stage: "skip", withdrawnAt: now };
  return { ...s, awaitingDoor: false };
}

/**
 * The words were first painted at `at` (when their animations started, on the same clock as performance.now()): the
 * quote counts from then, so a page too busy to paint never cuts the signed-off reading short. Only ever later, only
 * while the quote is up, and never more than PAINT_SLACK_MS after the store heard of it.
 */
export function painted(s: OpeningState, at: number): OpeningState {
  if (s.stage !== "quote" || s.shownAt === null || !Number.isFinite(at)) return s;
  return at > s.shownAt && at <= s.shownAt + PAINT_SLACK_MS ? { ...s, shownAt: at } : s;
}

/** The page is seen: a quote held back while it was hidden begins to arrive. */
export function shown(s: OpeningState, now: number): OpeningState {
  return s.stage === "quote" && s.shownAt === null ? { ...s, shownAt: now } : s;
}

const TIMES = [
  "shownAt",
  "tappedAt",
  "readyAt",
  "breathAt",
  "revealAt",
  "focusedAt",
  "welcomeInAt",
  "welcomeOutAt",
  "uiAt",
  "doneAt",
  "pushStoppedAt",
] as const satisfies ReadonlyArray<keyof OpeningState>;

/**
 * The page was hidden from `from` until `to`: the opening's clock stood still meanwhile, so every moment it had noted
 * moves on by as long, and one noted while hidden (the garden getting ready) counts as now.
 */
export function resume(s: OpeningState, from: number, to: number): OpeningState {
  if (!(to > from) || !(holdsReveal(s) || s.stage === "peace")) return s;
  const n = { ...s };
  for (const k of TIMES) {
    const t = n[k];
    if (t !== null) n[k] = Math.min(t, from) + (to - from);
  }
  return n;
}

/** The garden is ready under the veil. */
export function ready(s: OpeningState, now: number): OpeningState {
  return s.readyAt === null ? { ...s, readyAt: now } : s;
}

/** The garden has to be measured again under the veil (its canvas resized): while the quote is up, the breath waits. */
export function unready(s: OpeningState): OpeningState {
  return (s.stage === "pending" || s.stage === "quote") && s.readyAt !== null ? { ...s, readyAt: null } : s;
}

/** A tap, a click or a key: ends the dwell during the quote; brings the UI in at once during the peace. */
export function tap(s: OpeningState, now: number): OpeningState {
  if (s.stage === "quote" && s.shownAt !== null && s.tappedAt === null) return { ...s, tappedAt: now };
  if (s.stage === "peace" && s.uiAt === null) return { ...s, uiAt: now, welcomeOutAt: s.welcomeInAt !== null ? now : null };
  return s;
}

/** The visitor's name arrived (the Meadow learns it from the session): in time for the welcome, it is said. */
export function named(s: OpeningState, name: string): OpeningState {
  if (s.name !== null || s.uiAt !== null || s.stage === "done" || s.stage === "skip") return s;
  return { ...s, name };
}

/** The garden the door opened is no longer the one showing (its session ended, another link): no welcome is said. */
export function unname(s: OpeningState): OpeningState {
  return s.name !== null && s.welcomeInAt === null ? { ...s, name: null } : s;
}

/** Someone dragged or zoomed: the push-in stops where it is (only once the garden is showing). */
export function stopPush(s: OpeningState, now: number): OpeningState {
  if (s.pushStoppedAt !== null || (s.stage !== "peace" && s.stage !== "done")) return s;
  return { ...s, pushStoppedAt: now };
}

// ---------------------------------------------------------------------------
// The store

let state: OpeningState = INITIAL;
const listeners = new Set<() => void>();
let timer = 0;
/** A door that answered before the opening began (it applies once it does). */
let earlyDoor: { run: boolean; name: string | null } | null = null;
/** Since when the page has been hidden (the opening's clock stands still meanwhile), or null while it is seen. */
let hiddenAt: number | null = null;

const MARKS: Array<[keyof OpeningState, string]> = [
  ["shownAt", "quote"],
  ["readyAt", "ready"],
  ["breathAt", "breath"],
  ["revealAt", "reveal"],
  ["focusedAt", "focused"],
  ["welcomeInAt", "welcome-in"],
  ["welcomeOutAt", "welcome-out"],
  ["uiAt", "ui"],
  ["doneAt", "done"],
];

function mark(name: string, startTime?: number) {
  try {
    performance.mark(`opening:${name}`, startTime === undefined ? undefined : { startTime });
  } catch {
    // marks are a measuring aid only
  }
}

function marksFor(prev: OpeningState, next: OpeningState) {
  if (prev.stage !== next.stage && (next.stage === "pending" || next.stage === "skip")) mark(next.stage);
  for (const [key, name] of MARKS) {
    if (prev[key] === null && next[key] !== null) mark(name, next[key] as number);
  }
  // the moments the store never waits for, marked once they are known
  const inAt = quoteInAt(next);
  if (prev.shownAt === null && inAt !== null) mark("quote-in", inAt);
  if (prev.shownAt !== null && next.shownAt !== null && next.shownAt !== prev.shownAt) mark("quote-painted", next.shownAt);
  if (prev.withdrawnAt === null && next.withdrawnAt !== null) mark("quote-withdrawn", next.withdrawnAt);
  if (prev.stage === "quote" && next.stage === "breath") mark(next.tappedAt !== null ? "dwell-tapped" : "dwell-end", dwellEndAt(next) ?? undefined);
}

/**
 * The root element's data-opening="quiet" while the UI holds back, its data-veil (the veil's look) once the opening has
 * begun, and its data-quote (the quote whose figure shows: OpeningMoment.css) from the moment the quote begins until
 * the opening is over; until the opening begins they are whatever firstLookScript set as the page was parsed. Set
 * again on every change, as React's development remount clears what it did not render on the root.
 */
function syncRoot(s: OpeningState) {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  if (uiHeld(s)) root.dataset.opening = "quiet";
  else if (root.dataset.opening !== undefined) delete root.dataset.opening;
  if (s.stage === "unset") return;
  if (root.dataset.veil !== s.look) root.dataset.veil = s.look;
  const figure = s.quote !== null && s.stage !== "done" && (s.shownAt !== null || s.withdrawnAt !== null) ? String(s.quote) : null;
  if (figure === null) {
    if (root.dataset.quote !== undefined) delete root.dataset.quote;
  } else if (root.dataset.quote !== figure) root.dataset.quote = figure;
}

/** The first-look script's note, taken once: it stops listening, and the store takes over from here. */
function takeFirstLook(): FirstLook | null {
  const w = window as unknown as { __openingFirst?: Partial<FirstLook> };
  const h = w.__openingFirst;
  delete w.__openingFirst;
  if (!h || typeof h !== "object") return null;
  try {
    h.stop?.();
  } catch {
    // nothing left to stop
  }
  const time = (t: unknown) => (typeof t === "number" && Number.isFinite(t) ? t : null);
  if ((h.look !== "quote" && h.look !== "plain") || typeof h.skip !== "boolean" || typeof h.run !== "boolean") return null;
  if (typeof h.quote !== "number" || !Number.isInteger(h.quote) || h.quote < 0 || h.quote >= QUOTES.length) return null;
  return { look: h.look, skip: h.skip, quote: h.quote, run: h.run, at: time(h.at), tap: time(h.tap), stop: () => {} };
}

const ACT_EVENTS = ["pointerdown", "keydown", "wheel"] as const;
let listening = false;

/** A key on its own (Shift for a screenshot, say) is not someone wanting to move on. */
const MODIFIERS = new Set(["Shift", "Control", "Alt", "Meta", "CapsLock", "Fn"]);

function onAct(e: Event) {
  if (e.type === "keydown" && MODIFIERS.has((e as KeyboardEvent).key)) return;
  // a wheel counts during the peace only (zooming in is acting), never as a tap that ends the quote
  if (e.type === "wheel" && state.stage !== "peace") return;
  apply((s, now) => tap(s, now));
}

function syncListeners(s: OpeningState) {
  if (typeof window === "undefined") return;
  const want = s.stage === "quote" || (s.stage === "peace" && s.uiAt === null);
  if (want === listening) return;
  listening = want;
  for (const type of ACT_EVENTS) {
    if (want) window.addEventListener(type, onAct, { capture: true, passive: true });
    else window.removeEventListener(type, onAct, { capture: true });
  }
}

function schedule(s: OpeningState) {
  if (typeof window === "undefined") return;
  window.clearTimeout(timer);
  // nothing is due while the page is hidden: the clock moves on from where it stood once it is seen again
  if (hiddenAt !== null) return;
  const due = nextDue(s);
  if (due === null) return;
  // a millisecond late rather than early: a timer that fires before its moment would find nothing due yet
  timer = window.setTimeout(() => apply((x) => x), Math.max(0, due - performance.now()) + 1);
}

function apply(f: (s: OpeningState, now: number) => OpeningState) {
  const now = performance.now();
  // a hidden page still takes what happens (the garden ready, its door), but its clock moves nothing on
  const next = hiddenAt === null ? advance(f(state, now), now) : f(state, now);
  if (next !== state) {
    const prev = state;
    state = next;
    marksFor(prev, next);
    syncRoot(next);
    syncListeners(next);
    if (prev.shownAt === null && next.shownAt !== null) remember(next);
    listeners.forEach((l) => l());
  }
  // always, so a timer that found nothing due (a clock that ran early) is set again
  schedule(state);
}

/** Hidden, the opening's clock stands still; seen again, it moves on by however long that was (resume). */
function onVisibility() {
  const now = performance.now();
  if (document.hidden) {
    hiddenAt ??= now;
    window.clearTimeout(timer);
    return;
  }
  if (hiddenAt === null) return;
  const from = hiddenAt;
  hiddenAt = null;
  apply((s) => shown(resume(s, from, now), now));
}

function readStored(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    // storage blocked (a private window): nothing remembered
    return null;
  }
}

function store(key: string, value: string) {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // nothing to remember then
  }
}

/**
 * The quote has begun on a page someone can see: remember which (the next opening starts elsewhere) and when (a quick
 * reload skips it).
 */
function remember(s: OpeningState) {
  if (s.quote === null) return;
  store(LAST_QUOTE_KEY, String(s.quote));
  store(OPENED_AT_KEY, String(Date.now()));
}

export const opening = {
  get: () => state,
  subscribe(l: () => void) {
    listeners.add(l);
    return () => {
      listeners.delete(l);
    };
  },
  /**
   * The page's veil has mounted: the opening begins, once per page load. The quote is chosen here, on the client
   * (the veil is in the page's first HTML, so the server never picks one).
   */
  begin(waitForDoor: boolean) {
    if (state.stage !== "unset") return;
    // Dev-only handle for measuring the opening from the console.
    if (process.env.NODE_ENV !== "production") (window as unknown as { __gardenOpening?: unknown }).__gardenOpening = opening;
    const asNumber = (v: string | null) => (v === null || v.trim() === "" ? null : Number(v));
    const lastQuote = asNumber(readStored(LAST_QUOTE_KEY));
    const lastAt = asNumber(readStored(OPENED_AT_KEY));
    const openedAt = lastAt !== null && Number.isFinite(lastAt) ? lastAt : null;
    const last = lastQuote !== null && Number.isInteger(lastQuote) ? lastQuote : null;
    const reduced = typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const today = Date.now();
    hiddenAt = document.hidden ? performance.now() : null;
    document.addEventListener("visibilitychange", onVisibility);
    // The first-look script's decisions stand (the page has painted them): the same quote, the same skip (read before
    // anything was written, so the ten-minute boundary cannot fall between the two), and a quote it began, from when.
    // Without its note (a soft navigation here, a blocked script) the store decides as the page loads.
    const first = takeFirstLook();
    const quote = first ? first.quote : quoteOrder(QUOTES.length, last)[0];
    const o = {
      waitForDoor,
      skip: first ? first.skip : skipsQuote(openedAt, today),
      quoteFirst: first ? first.look === "quote" : firstLookQuote(openedAt, readStored(HELD_KEY) !== null, today),
      hidden: hiddenAt !== null,
      reduced,
      quote,
      words: wordsOf(QUOTES[quote].text).length,
      started: first?.run ?? false,
      shownAt: first?.at ?? null,
      tappedAt: first?.tap ?? null,
    };
    apply((s, now) => begin(s, o, now));
    if (earlyDoor) {
      const d = earlyDoor;
      earlyDoor = null;
      opening.door(d);
    }
  },
  /** The garden's door has answered (the first time only): run the quote for the visitor's own garden or the showcase. */
  door(d: { run: boolean; name: string | null }) {
    if (state.stage === "unset") {
      earlyDoor ??= d;
      return;
    }
    apply((s, now) => door(s, { ...d, hidden: hiddenAt !== null }, now));
  },
  ready: () => apply((s, now) => ready(s, now)),
  /** The quote's words were first painted at `at` (OpeningMoment's QuoteMoment): its dwell counts from then. */
  painted: (at: number) => apply((s) => painted(s, at)),
  /** Puts the root element's attributes back as the opening has them (after React's development remount). */
  resync: () => syncRoot(state),
  /**
   * The settled garden has to be measured again (its canvas resized while it waited): true when the breath now waits
   * for the next ready(), which it can while the quote is still up; false once the breath has begun.
   */
  unready() {
    apply((s) => unready(s));
    return state.readyAt === null;
  },
  named: (name: string) => apply((s) => named(s, name)),
  /** The door has left the garden it first opened: no welcome then. */
  unname: () => apply((s) => unname(s)),
  /** Someone dragged or zoomed (the camera rigs may call it every frame: it does nothing once stopped, or before the peace). */
  stopPush() {
    if (state.pushStoppedAt !== null || (state.stage !== "peace" && state.stage !== "done")) return;
    apply((s, now) => stopPush(s, now));
  },
  /** Whether the canvas may blur into focus (OpeningState.soft). */
  setSoft(soft: boolean) {
    if (state.soft === soft || state.revealAt !== null) return;
    apply((s) => ({ ...s, soft }));
  },
  /** The push-in's factor now (read by the camera rigs every frame). */
  push: (now: number) => pushFactor(state, now),
  holdsReveal: () => holdsReveal(state),
};

export function useOpening<T>(selector: (s: OpeningState) => T): T {
  return useSyncExternalStore(
    opening.subscribe,
    () => selector(state),
    () => selector(INITIAL),
  );
}
