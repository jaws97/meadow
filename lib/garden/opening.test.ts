import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { PLANTING_CLOSES_MS } from "@/components/gift/copy";
import {
  BREATH_MS,
  DWELL_MIN_MS,
  FOCUS_DONE_MS,
  INITIAL,
  PENDING_MAX_MS,
  PLANTING_CLOSES_AT,
  PUSH,
  PUSH_MS,
  SKIP_WITHIN_MS,
  STILL_IN_MS,
  UI_AT_MS,
  UI_SETTLE_MS,
  WELCOME_AT_MS,
  WELCOME_FADE_MS,
  WELCOME_HOLD_MS,
  WORD_MS,
  WORD_STAGGER_MS,
  advance,
  arrivalMs,
  begin,
  door,
  dwellEndAt,
  dwellMs,
  firstLookQuote,
  firstLookScript,
  focusState,
  holdsReveal,
  named,
  nextDue,
  PAINT_SLACK_MS,
  painted,
  pushFactor,
  quoteInAt,
  ready,
  resume,
  shown,
  skipsQuote,
  stopPush,
  tap,
  uiHeld,
  unname,
  unready,
  welcomeState,
  wordsOf,
  type FirstLook,
  type OpeningState,
} from "./opening";
import { QUOTES, quoteOrder } from "./quotes";

const START = 1 / (1 - PUSH);

/** An opening whose quote of `words` words began at `at`. */
function quoteAt(at: number, words = 8, extra: Partial<OpeningState> = {}): OpeningState {
  return { ...begin(INITIAL, { waitForDoor: false, skip: false, reduced: false, quote: 0, words }, at), ...extra };
}

/** Runs the opening's own clock: jumps to each due moment in turn until nothing more is due (or `until`). */
function run(s: OpeningState, until = Infinity): OpeningState {
  let n = s;
  for (let i = 0; i < 50; i++) {
    const due = nextDue(n);
    if (due === null || due > until) return n;
    const next = advance(n, due);
    expect(next).not.toBe(n);
    n = next;
  }
  throw new Error("the opening never settled");
}

describe("the quote's dwell", () => {
  it("is never shorter than the minimum, and grows with the words", () => {
    expect(dwellMs(1)).toBe(DWELL_MIN_MS);
    expect(dwellMs(6)).toBe(DWELL_MIN_MS);
    expect(dwellMs(12)).toBe(12 * 300 + 1500);
    for (let w = 1; w < 30; w++) expect(dwellMs(w + 1)).toBeGreaterThanOrEqual(dwellMs(w));
  });

  it("gives every quote at least the minimum, and the long ones more", () => {
    for (const q of QUOTES) {
      const words = wordsOf(q.text).length;
      expect(words).toBeGreaterThan(0);
      expect(dwellMs(words)).toBe(Math.max(DWELL_MIN_MS, words * 300 + 1500));
    }
    // the longest quote is read for longer than the minimum
    const longest = Math.max(...QUOTES.map((q) => wordsOf(q.text).length));
    expect(dwellMs(longest)).toBe(longest * 300 + 1500);
    expect(dwellMs(longest)).toBeGreaterThan(DWELL_MIN_MS);
  });

  it("starts once the last word is in: staggered, or all at once for reduced motion", () => {
    expect(arrivalMs(1, false)).toBe(WORD_MS);
    expect(arrivalMs(10, false)).toBe(9 * WORD_STAGGER_MS + WORD_MS);
    expect(arrivalMs(10, true)).toBe(STILL_IN_MS);
    const s = quoteAt(1000, 10);
    expect(quoteInAt(s)).toBe(1000 + 9 * WORD_STAGGER_MS + WORD_MS);
    expect(dwellEndAt(s)).toBe(quoteInAt(s)! + dwellMs(10));
    expect(dwellEndAt(quoteAt(1000, 10, { reduced: true }))).toBe(1000 + STILL_IN_MS + dwellMs(10));
  });
});

describe("the ten-minute rule", () => {
  const now = 1_800_000_000_000;
  it("skips the quote after a quote moment on this device less than ten minutes ago", () => {
    expect(skipsQuote(now - 1000, now)).toBe(true);
    expect(skipsQuote(now - SKIP_WITHIN_MS + 1, now)).toBe(true);
  });

  it("shows it again from ten minutes on, the first time, and after a clock that went back", () => {
    expect(skipsQuote(now - SKIP_WITHIN_MS, now)).toBe(false);
    expect(skipsQuote(now - 3_600_000, now)).toBe(false);
    expect(skipsQuote(null, now)).toBe(false);
    expect(skipsQuote(now + 60_000, now)).toBe(false);
    expect(skipsQuote(Number.NaN, now)).toBe(false);
  });

  it("a skipped opening is the plain veil: it holds nothing and pushes nothing", () => {
    const s = begin(INITIAL, { waitForDoor: true, skip: true, reduced: false, quote: 2, words: 8 }, 0);
    expect(s.stage).toBe("skip");
    expect(holdsReveal(s)).toBe(false);
    expect(uiHeld(s)).toBe(false);
    expect(pushFactor(s, 0)).toBe(1);
    expect(nextDue(ready(s, 100))).toBeNull();
  });
});

/** What firstLookScript is run against: this device's storage, the address and whether the page can be seen. */
interface Page {
  openedAt?: string | null;
  held?: boolean;
  last?: string | null;
  hash?: string;
  search?: string;
  kept?: boolean;
  visible?: boolean;
  random?: () => number;
  /** the clock (Date.now()), when not NOW */
  now?: number;
}

/** January 2027: planting has closed. */
const NOW = 1_800_000_000_000;

/** Runs the first-look script as a browser parsing the page would, with a clock reading 1234 ms since navigation. */
function runFirstLook(page: "garden" | "meadow", p: Page = {}, env = process.env.NODE_ENV) {
  const stored: Record<string, string> = {};
  if (p.openedAt != null) stored["garden:opening-at"] = p.openedAt;
  if (p.held) stored["garden-plant:v1"] = "{}";
  if (p.last != null) stored["garden:last-quote"] = p.last;
  const attrs: Record<string, string> = {};
  const docListeners = new Map<string, () => void>();
  const winListeners = new Map<string, (e: { type: string; key?: string }) => void>();
  let clock = 1234;
  const document = {
    visibilityState: p.visible === false ? "hidden" : "visible",
    documentElement: { setAttribute: (k: string, v: string) => (attrs[k] = v) },
    addEventListener: (t: string, f: () => void) => docListeners.set(t, f),
    removeEventListener: (t: string) => docListeners.delete(t),
  };
  const window: { __openingFirst?: FirstLook } & Record<string, unknown> = {
    addEventListener: (t: string, f: (e: { type: string; key?: string }) => void) => winListeners.set(t, f),
    removeEventListener: (t: string) => winListeners.delete(t),
  };
  const localStorage = { getItem: (k: string) => (k in stored ? stored[k] : null) };
  const sessionStorage = { getItem: (k: string) => (p.kept && k === "garden-party-code:v1" ? "CODE" : null) };
  const location = { hash: p.hash ?? "", search: p.search ?? "" };
  const performance = { now: () => clock };
  const math = Object.assign(Object.create(Math), { random: p.random ?? Math.random });
  const saved = process.env.NODE_ENV;
  (process.env as Record<string, string | undefined>).NODE_ENV = env;
  const script = firstLookScript(page);
  (process.env as Record<string, string | undefined>).NODE_ENV = saved;
  new Function("localStorage", "sessionStorage", "document", "window", "location", "performance", "Math", "Date", script)(
    localStorage,
    sessionStorage,
    document,
    window,
    location,
    performance,
    math,
    { now: () => p.now ?? NOW },
  );
  return {
    attrs,
    note: window.__openingFirst!,
    docListeners,
    winListeners,
    /** the page becomes visible, later on its clock */
    show(at: number) {
      clock = at;
      document.visibilityState = "visible";
      docListeners.get("visibilitychange")?.();
    },
    /** a tap or a key, at `at` */
    act(at: number, type = "pointerdown", key?: string) {
      clock = at;
      winListeners.get(type)?.({ type, key });
    },
  };
}

describe("the first look", () => {
  const now = NOW;
  /** The first-look script run against a stored opening time and remembered plant: whether the garden got the quote look. */
  function script(openedAt: string | null, held: boolean): boolean {
    return runFirstLook("garden", { openedAt, held }).attrs["data-veil"] === "quote";
  }

  it("is the quote moment for a device that has shown its own garden or opened on a quote, the sprout for a first visit", () => {
    expect(firstLookQuote(null, false, now)).toBe(false);
    expect(firstLookQuote(null, true, now)).toBe(true);
    expect(firstLookQuote(now - 3_600_000, false, now)).toBe(true);
    // a quote moment less than ten minutes ago: the plain veil, as the opening skips its quote
    expect(firstLookQuote(now - 60_000, true, now)).toBe(false);
    expect(firstLookQuote(Number.NaN, false, now)).toBe(false);
  });

  it("is decided the same way by the inline script, as the page is parsed", () => {
    const cases: Array<[string | null, boolean]> = [
      [null, false],
      [null, true],
      [String(now - 3_600_000), false],
      [String(now - 3_600_000), true],
      [String(now - 60_000), true],
      [String(now - SKIP_WITHIN_MS), false],
      [String(now + 60_000), false],
      ["", true],
      ["junk", false],
      ["junk", true],
    ];
    for (const [stored, held] of cases) {
      const v = stored === null || stored.trim() === "" ? null : Number(stored);
      expect(script(stored, held), `${stored} ${held}`).toBe(firstLookQuote(v !== null && Number.isFinite(v) ? v : null, held, now));
    }
  });

  it("is kept by the opening: a plain first look turns into the quote moment only when the door runs the quote", () => {
    const plain = begin(INITIAL, { waitForDoor: true, skip: false, reduced: false, quote: 0, words: 5, quoteFirst: false }, 0);
    expect(plain.look).toBe("plain");
    expect(door(plain, { run: true, name: null }, 10).look).toBe("quote");
    expect(door(plain, { run: false, name: null }, 10).look).toBe("plain");
    const quote = begin(INITIAL, { waitForDoor: true, skip: false, reduced: false, quote: 0, words: 5, quoteFirst: true }, 0);
    expect(quote.look).toBe("quote");
    // the gift's still or a dialog comes over the night sky already up, and a door that never answers leaves it too
    expect(door(quote, { run: false, name: null }, 10).look).toBe("quote");
    expect(advance(ready(quote, 0), PENDING_MAX_MS).look).toBe("quote");
    expect(begin(INITIAL, { waitForDoor: true, skip: true, reduced: false, quote: 0, words: 5, quoteFirst: true }, 0).look).toBe("plain");
  });
});

describe("the words in the first paint", () => {
  const anHourAgo = String(NOW - 3_600_000);
  /** A deterministic stand-in for Math.random. */
  function seeded(seed: number) {
    return () => {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      return seed / 2 ** 32;
    };
  }

  it("picks the quote exactly as quoteOrder does, never the one shown last", () => {
    for (let trial = 0; trial < 400; trial++) {
      const last = trial % 13 === 12 ? "junk" : String(trial % (QUOTES.length + 1));
      const { note } = runFirstLook("meadow", { openedAt: anHourAgo, last, random: seeded(trial + 1) });
      const parsed = Number(last);
      const expected = quoteOrder(QUOTES.length, Number.isInteger(parsed) ? parsed : null, seeded(trial + 1))[0];
      expect(note.quote, `trial ${trial}`).toBe(expected);
      if (Number.isInteger(parsed) && parsed < QUOTES.length) expect(note.quote).not.toBe(parsed);
    }
  });

  it("starts the Meadow's quote with the first paint, unless it is skipped", () => {
    const fresh = runFirstLook("meadow", { openedAt: anHourAgo });
    expect(fresh.attrs["data-veil"]).toBe("quote");
    expect(fresh.note.run).toBe(true);
    expect(fresh.note.at).toBe(1234);
    expect(fresh.attrs["data-quote"]).toBe(String(fresh.note.quote));
    // a first visit to the Meadow has the quote too
    expect(runFirstLook("meadow").note.run).toBe(true);
    const skipped = runFirstLook("meadow", { openedAt: String(NOW - 60_000) });
    expect(skipped.attrs["data-veil"]).toBe("plain");
    expect(skipped.note).toMatchObject({ run: false, skip: true, at: null });
    expect(skipped.attrs["data-quote"]).toBeUndefined();
  });

  it("starts the garden's quote only for a plain address, where the door can only run it", () => {
    const prod = (p: Page) => runFirstLook("garden", p, "production").note.run;
    expect(prod({ openedAt: anHourAgo })).toBe(true);
    expect(prod({ held: true })).toBe(true);
    // a first visit keeps the signed-off sprout, and the door decides
    expect(prod({})).toBe(false);
    // a garden link or a party code may open a dialog or the gift instead
    expect(prod({ held: true, hash: "#k=abcdefghijklmnop" })).toBe(false);
    expect(prod({ held: true, hash: "#x=1&k=abcdefghijklmnop" })).toBe(false);
    expect(prod({ held: true, search: "?code=PARTY" })).toBe(false);
    expect(prod({ held: true, search: "?a=1&link=invalid" })).toBe(false);
    expect(prod({ held: true, kept: true })).toBe(false);
    // the ten-minute rule: the plain veil, no quote
    expect(prod({ held: true, openedAt: String(NOW - 60_000) })).toBe(false);
    // other parts of the address change nothing
    expect(prod({ held: true, hash: "#top", search: "?dev" })).toBe(true);
  });

  it("while planting is open, starts the garden's quote only for a device that holds a garden (others are offered the seed)", () => {
    const season = PLANTING_CLOSES_AT - 24 * 3600_000;
    const prod = (p: Page) => runFirstLook("garden", { ...p, now: season }, "production").note.run;
    expect(prod({ held: true, openedAt: String(season - 3600_000) })).toBe(true);
    expect(prod({ openedAt: String(season - 3600_000) })).toBe(false);
    expect(PLANTING_CLOSES_AT).toBe(PLANTING_CLOSES_MS);
  });

  it("in development, starts the garden's quote only for a device that holds a garden (others are offered the gift)", () => {
    expect(runFirstLook("garden", { held: true }, "development").note.run).toBe(true);
    expect(runFirstLook("garden", { openedAt: anHourAgo }, "development").note.run).toBe(false);
  });

  it("holds the words back while the page is hidden, and starts them the moment it is seen", () => {
    const page = runFirstLook("meadow", { visible: false });
    expect(page.note.run).toBe(true);
    expect(page.note.at).toBeNull();
    expect(page.attrs["data-quote"]).toBeUndefined();
    page.show(9000);
    expect(page.note.at).toBe(9000);
    expect(page.attrs["data-quote"]).toBe(String(page.note.quote));
    expect(page.docListeners.size).toBe(0);
  });

  it("notes a tap before the page hydrates, but not a modifier key, and stops listening when the store takes over", () => {
    const page = runFirstLook("meadow");
    page.act(1500, "keydown", "Shift");
    expect(page.note.tap).toBeNull();
    page.act(1600);
    expect(page.note.tap).toBe(1600);
    page.act(1700, "keydown", "Enter");
    expect(page.note.tap).toBe(1600);
    page.note.stop();
    expect(page.winListeners.size).toBe(0);
  });

  it("is adopted by the store: the same quote, timed from when it began, with the tap", () => {
    const s = begin(INITIAL, { waitForDoor: false, skip: false, reduced: false, quote: 4, words: 6, started: true, shownAt: 300, tappedAt: 900 }, 2000);
    expect(s).toMatchObject({ stage: "quote", look: "quote", quote: 4, shownAt: 300, tappedAt: 900, awaitingDoor: false });
    expect(dwellEndAt(s)).toBe(900);
    // begun while hidden: it starts when it is seen
    const hidden = begin(INITIAL, { waitForDoor: false, skip: false, reduced: false, quote: 4, words: 6, started: true, shownAt: null, hidden: true }, 2000);
    expect(hidden.shownAt).toBeNull();
    expect(shown(hidden, 5000).shownAt).toBe(5000);
    // a tap before the words began does not count
    expect(begin(INITIAL, { waitForDoor: false, skip: false, reduced: false, quote: 4, words: 6, started: true, shownAt: 300, tappedAt: 100 }, 2000).tappedAt).toBeNull();
  });

  it("on the garden page waits for the door before the breath, at most as long as a pending opening would", () => {
    const s = begin(INITIAL, { waitForDoor: true, skip: false, reduced: false, quote: 1, words: 6, started: true, shownAt: 0, quoteFirst: true }, 50);
    expect(s.awaitingDoor).toBe(true);
    // ready a while into the dwell, so the door's bound comes after the dwell's end
    const r = ready(s, 4000);
    const end = dwellEndAt(r)!;
    expect(4000 + PENDING_MAX_MS).toBeGreaterThan(end);
    expect(advance(r, end).stage).toBe("quote");
    expect(nextDue(r)).toBe(4000 + PENDING_MAX_MS);
    // the door answers: the welcome's name, and the breath at the end of the dwell
    const named = door(r, { run: true, name: "Asha" }, 2000);
    expect(named).toMatchObject({ stage: "quote", name: "Asha", awaitingDoor: false, shownAt: 0 });
    expect(advance(named, end).stage).toBe("breath");
    // a door that never answers is not waited for past the bound
    const late = ready(s, end + 10_000);
    expect(advance(late, end + 10_000 + PENDING_MAX_MS - 1).stage).toBe("quote");
    expect(advance(late, end + 10_000 + PENDING_MAX_MS).stage).toBe("breath");
  });

  it("is withdrawn if the door leads elsewhere while it is up, keeping the night sky", () => {
    const s = begin(INITIAL, { waitForDoor: true, skip: false, reduced: false, quote: 1, words: 6, started: true, shownAt: 0, quoteFirst: true }, 50);
    const w = door(s, { run: false, name: null }, 700);
    expect(w).toMatchObject({ stage: "skip", look: "quote", withdrawnAt: 700, awaitingDoor: false });
    expect(holdsReveal(w)).toBe(false);
    // once the garden is showing, the gift or the dialog simply comes over it
    const r = ready(s, 0);
    const p = advance(advance(r, r.readyAt! + PENDING_MAX_MS + 60_000), r.readyAt! + PENDING_MAX_MS + 60_000 + BREATH_MS);
    expect(p.stage).toBe("peace");
    expect(door(p, { run: false, name: null }, p.revealAt! + 10)).toMatchObject({ stage: "peace", withdrawnAt: null, awaitingDoor: false });
  });

  it("counts the dwell from the first paint of the words, only ever later and within reason", () => {
    const s = quoteAt(1000, 8);
    expect(painted(s, 1400).shownAt).toBe(1400);
    expect(dwellEndAt(painted(s, 1400))).toBe(dwellEndAt(s)! + 400);
    expect(painted(s, 900)).toBe(s);
    expect(painted(s, Number.NaN)).toBe(s);
    expect(painted(s, Number.POSITIVE_INFINITY)).toBe(s);
    expect(painted(s, 1000 + PAINT_SLACK_MS + 1)).toBe(s);
    // not once the breath has begun, nor for a quote still waiting to be seen
    const b = advance(ready(s, 0), dwellEndAt(s)!);
    expect(painted(b, dwellEndAt(s)! + 10)).toBe(b);
    const hidden = begin(INITIAL, { waitForDoor: false, skip: false, reduced: false, quote: 0, words: 8, hidden: true }, 0);
    expect(painted(hidden, 500)).toBe(hidden);
  });

  it("has a stylesheet rule to show each quote's figure", () => {
    const css = readFileSync(join(__dirname, "../../components/garden/OpeningMoment.css"), "utf8");
    for (let i = 0; i < QUOTES.length; i++) {
      expect(css, `quote ${i}`).toContain(`:root[data-quote="${i}"] .opening-figure[data-q="${i}"]`);
    }
    expect(css).not.toContain(`:root[data-quote="${QUOTES.length}"]`);
  });
});

describe("a hidden page", () => {
  it("holds the quote back until it is seen, then gives it its whole arrival and dwell", () => {
    const pending = begin(INITIAL, { waitForDoor: true, skip: false, reduced: false, quote: 0, words: 8 }, 0);
    const s = ready(door(pending, { run: true, name: null, hidden: true }, 100), 200);
    expect(s.stage).toBe("quote");
    expect(s.shownAt).toBeNull();
    expect(nextDue(s)).toBeNull();
    expect(advance(s, 60_000).stage).toBe("quote");
    expect(tap(s, 500)).toBe(s);
    const seen = shown(s, 60_000);
    expect(seen.shownAt).toBe(60_000);
    expect(dwellEndAt(seen)).toBe(60_000 + arrivalMs(8, false) + dwellMs(8));
    expect(begin(INITIAL, { waitForDoor: false, skip: false, reduced: false, quote: 0, words: 8, hidden: true }, 0).shownAt).toBeNull();
  });

  it("stops the opening's clock: the dwell, the peace and the push-in carry on from where they stood", () => {
    const s = ready(quoteAt(0, 8), 0);
    const r = resume(s, 1000, 31_000);
    expect(dwellEndAt(r)).toBe(dwellEndAt(s)! + 30_000);
    const p = run(s, dwellEndAt(s)! + BREATH_MS);
    expect(p.stage).toBe("peace");
    const at = p.revealAt! + 1000;
    const back = resume(p, at, at + 45_000);
    expect(pushFactor(back, at + 45_000)).toBeCloseTo(pushFactor(p, at));
    expect(nextDue(back)).toBe(nextDue(p)! + 45_000);
    // nothing to move once it is over, or for the plain veil
    const done = run(p);
    expect(resume(done, 0, 1000)).toBe(done);
    expect(resume(begin(INITIAL, { waitForDoor: true, skip: true, reduced: false, quote: 0, words: 8 }, 0), 0, 1000).stage).toBe("skip");
  });

  it("counts a garden that got ready while the page was hidden as ready the moment it is seen", () => {
    const pending = begin(INITIAL, { waitForDoor: true, skip: false, reduced: false, quote: 0, words: 8 }, 0);
    const s = ready(door(pending, { run: true, name: null, hidden: true }, 100), 20_000);
    const seen = shown(resume(s, 50, 60_000), 60_000);
    expect(seen.readyAt).toBe(60_000);
    expect(seen.shownAt).toBe(60_000);
    // a door that never answers gives up as long after that as ever
    const waiting = resume(ready(pending, 20_000), 50, 60_000);
    expect(advance(waiting, 60_000 + PENDING_MAX_MS - 1).stage).toBe("pending");
    expect(advance(waiting, 60_000 + PENDING_MAX_MS).stage).toBe("skip");
  });
});

describe("the door", () => {
  const pending = begin(INITIAL, { waitForDoor: true, skip: false, reduced: false, quote: 3, words: 9 }, 0);

  it("waits for the garden's door, holding the reveal", () => {
    expect(pending.stage).toBe("pending");
    expect(pending.shownAt).toBeNull();
    expect(holdsReveal(pending)).toBe(true);
    expect(uiHeld(pending)).toBe(true);
  });

  it("runs the quote for the visitor's own garden, with their name for the welcome", () => {
    const s = door(pending, { run: true, name: "Asha" }, 400);
    expect(s.stage).toBe("quote");
    expect(s.shownAt).toBe(400);
    expect(s.name).toBe("Asha");
  });

  it("gives way to the plain veil for the gift's first look or a dialog", () => {
    expect(door(pending, { run: false, name: null }, 400).stage).toBe("skip");
  });

  it("answers only once", () => {
    const s = door(pending, { run: true, name: null }, 400);
    expect(door(s, { run: false, name: null }, 900)).toBe(s);
  });

  it("takes the welcome back when the door leaves the garden it opened, unless it is already being said", () => {
    const s = door(pending, { run: true, name: "Asha" }, 400);
    expect(unname(s).name).toBeNull();
    const w = { ...s, welcomeInAt: 9000 };
    expect(unname(w)).toBe(w);
  });

  it("gives up on a door that never answers, a while after the garden is ready", () => {
    const s = ready(pending, 3000);
    expect(advance(s, 3000 + PENDING_MAX_MS - 1).stage).toBe("pending");
    expect(advance(s, 3000 + PENDING_MAX_MS).stage).toBe("skip");
    expect(run(s).stage).toBe("skip");
  });
});

describe("the lift and the breath", () => {
  it("holds the quote through its dwell even when the garden is ready sooner", () => {
    const s = ready(quoteAt(0, 8), 1000);
    const end = dwellEndAt(s)!;
    expect(end).toBe(7 * WORD_STAGGER_MS + WORD_MS + dwellMs(8));
    expect(advance(s, end - 1).stage).toBe("quote");
    const b = advance(s, end);
    expect(b.stage).toBe("breath");
    expect(b.breathAt).toBe(end);
    expect(holdsReveal(b)).toBe(true);
  });

  it("keeps the same quote up for as long as the garden takes", () => {
    const s = quoteAt(0, 8);
    expect(advance(s, 60_000).stage).toBe("quote");
    expect(nextDue(s)).toBeNull();
    const b = advance(ready(s, 60_000), 60_000);
    expect(b.stage).toBe("breath");
    expect(b.quote).toBe(s.quote);
  });

  it("ends the dwell at a tap, but still waits for the garden", () => {
    const tapped = tap(quoteAt(0, 8), 1200);
    expect(dwellEndAt(tapped)).toBe(1200);
    expect(advance(tapped, 5000).stage).toBe("quote");
    expect(advance(ready(tapped, 5000), 5000).stage).toBe("breath");
    // ready already: the breath begins at the tap
    expect(advance(tap(ready(quoteAt(0, 8), 800), 1200), 1200).stage).toBe("breath");
  });

  it("waits for the garden to be ready again when it has to be measured again, while the quote is up", () => {
    const s = ready(quoteAt(0, 8), 1000);
    const u = unready(s);
    expect(u.readyAt).toBeNull();
    expect(advance(u, dwellEndAt(s)! + 5000).stage).toBe("quote");
    expect(advance(ready(u, 9000), Math.max(9000, dwellEndAt(s)!)).stage).toBe("breath");
    // once the breath has begun the reveal is moments away: nothing to take back
    const b = advance(s, dwellEndAt(s)!);
    expect(unready(b)).toBe(b);
  });

  it("takes a breath of quiet dark before the garden is revealed", () => {
    const b = advance(ready(quoteAt(0, 4), 0), dwellEndAt(quoteAt(0, 4))!);
    expect(advance(b, b.breathAt! + BREATH_MS - 1).stage).toBe("breath");
    const p = advance(b, b.breathAt! + BREATH_MS);
    expect(p.stage).toBe("peace");
    expect(p.revealAt).toBe(b.breathAt! + BREATH_MS);
    expect(holdsReveal(p)).toBe(false);
    expect(uiHeld(p)).toBe(true);
  });
});

describe("the peace", () => {
  /** The moment the garden is revealed, for a quote shown at 0 and a garden ready at once. */
  const revealed = (extra: Partial<OpeningState> = {}) => {
    const s = ready(quoteAt(0, 8, extra), 0);
    return advance(advance(s, dwellEndAt(s)!), dwellEndAt(s)! + BREATH_MS);
  };

  it("shows no UI at first, then the welcome, then the UI as the welcome fades", () => {
    const p = revealed({ name: "Asha" });
    const r = p.revealAt!;
    expect(uiHeld(advance(p, r + WELCOME_AT_MS - 1))).toBe(true);
    expect(welcomeState(advance(p, r + WELCOME_AT_MS - 1))).toBeNull();
    const w = advance(p, r + WELCOME_AT_MS);
    expect(welcomeState(w)).toBe("in");
    expect(uiHeld(w)).toBe(true);
    const u = advance(w, r + WELCOME_AT_MS + WELCOME_HOLD_MS);
    expect(u.uiAt).toBe(r + WELCOME_AT_MS + WELCOME_HOLD_MS);
    expect(welcomeState(u)).toBe("out");
    expect(uiHeld(u)).toBe(false);
    const done = run(p);
    expect(done.stage).toBe("done");
    expect(done.doneAt).toBe(Math.max(u.uiAt! + UI_SETTLE_MS, u.welcomeOutAt! + WELCOME_FADE_MS));
    expect(welcomeState(done)).toBeNull();
  });

  it("without a name (the showcase, someone without a garden) brings the UI after the quiet, with no welcome", () => {
    const p = revealed();
    const r = p.revealAt!;
    expect(uiHeld(advance(p, r + UI_AT_MS - 1))).toBe(true);
    const u = advance(p, r + UI_AT_MS);
    expect(u.uiAt).toBe(r + UI_AT_MS);
    expect(u.welcomeInAt).toBeNull();
    const done = run(p);
    expect(done.stage).toBe("done");
    expect(done.welcomeInAt).toBeNull();
  });

  it("brings the UI in at once for a tap, and then says no welcome", () => {
    const p = revealed({ name: "Asha" });
    const r = p.revealAt!;
    const t = tap(p, r + 1000);
    expect(t.uiAt).toBe(r + 1000);
    expect(uiHeld(t)).toBe(false);
    expect(advance(t, r + WELCOME_AT_MS + 10).welcomeInAt).toBeNull();
    expect(run(t).stage).toBe("done");
  });

  it("puts a showing welcome away for a tap", () => {
    const w = advance(revealed({ name: "Asha" }), revealed().revealAt! + WELCOME_AT_MS);
    const t = tap(w, w.welcomeInAt! + 500);
    expect(t.uiAt).toBe(w.welcomeInAt! + 500);
    expect(welcomeState(t)).toBe("out");
  });

  it("says the welcome for a name that arrives in time, and not after the UI", () => {
    const p = revealed();
    const r = p.revealAt!;
    const early = advance(named(p, "Ravi"), r + WELCOME_AT_MS + 100);
    expect(welcomeState(early)).toBe("in");
    const late = advance(p, r + UI_AT_MS);
    expect(named(late, "Ravi")).toBe(late);
  });

  it("is in focus a little after the focus time, and the canvas filter goes then", () => {
    const p = revealed();
    expect(focusState(p)).toBe("focus");
    const f = advance(p, p.revealAt! + FOCUS_DONE_MS);
    expect(f.focusedAt).toBe(p.revealAt! + FOCUS_DONE_MS);
    expect(focusState(f)).toBeNull();
  });
});

describe("the whole sequence", () => {
  it("runs on its own clock from the quote to done, in order", () => {
    const s = ready(quoteAt(500, 12, { name: "Asha" }), 2000);
    const done = run(s);
    const t = done;
    expect(t.stage).toBe("done");
    const order = [quoteInAt(t)!, t.breathAt!, t.revealAt!, t.welcomeInAt!, t.uiAt!, t.doneAt!];
    for (let i = 1; i < order.length; i++) expect(order[i]).toBeGreaterThan(order[i - 1]);
    expect(t.breathAt).toBe(dwellEndAt(s));
    expect(t.revealAt! - t.breathAt!).toBe(BREATH_MS);
    expect(t.welcomeInAt! - t.revealAt!).toBe(WELCOME_AT_MS);
    expect(t.welcomeOutAt).toBe(t.uiAt);
  });

  it("always reaches done, whatever the taps, names and loading times, and every due moment moves it on", () => {
    let seed = 7;
    const rand = () => {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      return seed / 2 ** 32;
    };
    for (let trial = 0; trial < 300; trial++) {
      const words = 3 + Math.floor(rand() * 13);
      const events: Array<[number, (s: OpeningState, t: number) => OpeningState]> = [[rand() * 15000, (s, t) => ready(s, t)]];
      if (rand() < 0.4) events.push([rand() * 6000, (s, t) => tap(s, t)]);
      if (rand() < 0.4) events.push([rand() * 25000, (s, t) => tap(s, t)]);
      if (rand() < 0.3) events.push([rand() * 25000, (s) => named(s, "Asha")]);
      events.sort((a, b) => a[0] - b[0]);
      let s = quoteAt(0, words, rand() < 0.5 ? { name: "Ravi" } : {});
      for (const [at, f] of events) {
        s = run(s, at);
        s = advance(f(s, at), at);
      }
      const done = run(s);
      expect(done.stage).toBe("done");
      expect(done.breathAt!).toBeGreaterThanOrEqual(dwellEndAt(done)!);
      expect(done.breathAt!).toBeGreaterThanOrEqual(done.readyAt!);
      expect(done.uiAt!).toBeGreaterThanOrEqual(done.revealAt!);
      if (done.welcomeInAt !== null) expect(done.welcomeInAt).toBeLessThan(done.uiAt!);
    }
  });

  it("is never held by a route without an opening", () => {
    expect(holdsReveal(INITIAL)).toBe(false);
    expect(uiHeld(INITIAL)).toBe(false);
    expect(pushFactor(INITIAL, 1000)).toBe(1);
    expect(focusState(INITIAL)).toBeNull();
    expect(nextDue(INITIAL)).toBeNull();
  });

  it("begins only once", () => {
    const s = quoteAt(0);
    expect(begin(s, { waitForDoor: true, skip: true, reduced: false, quote: 1, words: 3 }, 50)).toBe(s);
  });
});

describe("the push-in", () => {
  const p = (() => {
    const s = ready(quoteAt(0, 4), 0);
    return advance(advance(s, dwellEndAt(s)!), dwellEndAt(s)! + BREATH_MS);
  })();
  const r = p.revealAt!;

  it("waits a little farther back under the veil and eases in to the framing over the peace", () => {
    expect(pushFactor(quoteAt(0), 0)).toBeCloseTo(START);
    expect(pushFactor(p, r)).toBeCloseTo(START);
    expect(pushFactor(p, r + PUSH_MS / 2)).toBeCloseTo(1 + (START - 1) / 2);
    expect(pushFactor(p, r + PUSH_MS)).toBe(1);
    expect(pushFactor(p, r + PUSH_MS * 3)).toBe(1);
    // about six per cent closer, start to end
    expect(1 / START).toBeCloseTo(1 - PUSH);
  });

  it("stops where it is for a drag or a zoom, and only once the garden shows", () => {
    expect(stopPush(quoteAt(0), 100).pushStoppedAt).toBeNull();
    const stopped = stopPush(p, r + 1000);
    expect(pushFactor(stopped, r + 3000)).toBeCloseTo(pushFactor(p, r + 1000));
    expect(stopPush(stopped, r + 2000)).toBe(stopped);
  });

  it("never moves for reduced motion, and nothing blurs", () => {
    const still = { ...p, reduced: true };
    expect(pushFactor(still, r)).toBe(1);
    expect(focusState(still)).toBeNull();
    expect(focusState({ ...p, soft: false })).toBeNull();
  });

  it("softens the canvas only under the veil's breath, then brings it into focus", () => {
    const s = ready(quoteAt(0, 4), 0);
    const b = advance(s, dwellEndAt(s)!);
    expect(focusState(s)).toBeNull();
    expect(focusState(b)).toBe("soft");
    expect(focusState(p)).toBe("focus");
  });
});
