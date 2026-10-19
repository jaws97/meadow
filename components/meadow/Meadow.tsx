"use client";
// The /meadow shell: the full-viewport canvas (client-only, it needs WebGL and window, so next/dynamic loads it with
// ssr:false), and the HTML laid over it: the title and the count of flowers, "Find a friend" and a way back to the
// person's own garden, the visit card, the find panel and the firefly journey's pill, a one-line hint for the hand in
// use, the opening veil, and the calm notices the canvas raises (the glide fallback, the respawn fade). The
// developer readout shows only with ?dev.
//
// The opening (lib/garden/opening): a quote alone on the night sky, held until it has been read; the Meadow coming into
// focus with nothing over it for a few seconds; "Welcome back" for someone whose device holds a garden; then the
// overlay. While it holds back, the root element carries data-opening="quiet", and meadow.css keeps the bar, the hint,
// the card and the notices out of sight and out of reach until it lifts.
//
// Data: the shared snapshot is polled while the page is open (data.ts), and the session says whether this device
// holds a garden (for "This is yours", the sprinkle, and the gold ribbon on the person's own stake). A link to
// /meadow?plot=N opens beside that plant with its card.
import dynamic from "next/dynamic";
import { Suspense, useEffect, useLayoutEffect, useState, useSyncExternalStore } from "react";
import { FirstLook, QuoteMoment, WelcomeLine } from "@/components/garden/OpeningMoment";
import { DevHud, FadeVeil, MoverNotice } from "@/components/meadow/DevHud";
import { UnstuckButton } from "@/components/meadow/Unstuck";
import { loadSession, meadowData, startPolling, useMe, useMeadowData } from "@/components/meadow/data";
import { FindButton, FindFriend, JourneyPill } from "@/components/meadow/FindFriend";
import { LeafIcon } from "@/components/meadow/icons";
import { meadow } from "@/components/meadow/runtime";
import { ui, useUi } from "@/components/meadow/ui";
import { VisitCard } from "@/components/meadow/VisitCard";
import { primaryTouch } from "@/lib/garden/device";
import { opening, useOpening, VEIL_FADE_MS } from "@/lib/garden/opening";
import "@/components/meadow/meadow.css";

const MeadowCanvas = dynamic(() => import("@/components/meadow/MeadowCanvas"), { ssr: false, loading: () => null });

// The query and the primary pointer do not change while the page is open, so there is nothing to subscribe to.
const subscribeNever = () => () => {};
const readTouch = () => primaryTouch();
const serverTouch = () => null;
const readDev = () => new URLSearchParams(window.location.search).has("dev");
const serverDev = () => false;

const HINTS = {
  touch: "Tap a flower to visit. Drag to drive, pinch to zoom.",
  mouse: "Click a flower to visit. Drag to drive, scroll to zoom.",
};

function plotParam(): number | null {
  const raw = new URLSearchParams(window.location.search).get("plot");
  return raw !== null && /^\d{1,5}$/.test(raw) ? Number(raw) : null;
}

function countLine(count: number): string {
  if (count === 0) return "The first seeds are on their way";
  if (count === 1) return "1 flower growing";
  return `${count} flowers growing`;
}

function TopBar() {
  const count = useMeadowData((d) => (d.snapshot ? d.snapshot.count : null));
  const me = useMe();
  return (
    <div className="meadow-top">
      <div className="meadow-title">
        <h1>The Meadow</h1>
        {count !== null && <p>{countLine(count)}</p>}
      </div>
      <div className="meadow-actions">
        <FindButton />
        {me?.signedIn && (
          <a className="meadow-pill meadow-glass" href="/garden" aria-label="My garden">
            <LeafIcon /> <span className="hidden sm:inline">My garden</span>
          </a>
        )}
      </div>
    </div>
  );
}

/**
 * The opening's veil, up until the first frame is up with a body in it and the Meadow's plants have arrived. Usually
 * the quote moment (lib/garden/opening, components/garden/OpeningMoment): only the night sky and a quote, progress a
 * gold hairline at the very bottom, held until the quote has been read even when the Meadow is ready sooner; then the
 * breath, and the veil fades over the Meadow coming into focus. When the opening is skipped (a quote moment on this
 * device in the last ten minutes), the plain veil instead: the lantern, "Opening the Meadow" and a line, fading as soon
 * as the Meadow is ready. Both looks are in the first HTML, in one veil that stays the same element throughout, and
 * the first-look script (FirstLook) picks one before the first paint (the root element's data-veil, meadow.css) and
 * starts the quote's words then: nothing waits for the page's JavaScript to arrive.
 */
function MeadowVeil() {
  const stage = useOpening((s) => s.stage);
  const soft = useOpening((s) => s.soft && !s.reduced);
  const focused = useOpening((s) => s.focusedAt !== null);
  const data = useMeadowData((d) => d.status !== "loading");
  // the body's arrival is in the runtime, not React: looked at a few times a second until it is there, and drawn (the
  // canvas holds its first frame for the shader warm-up, MeadowCanvas.tsx; a hidden tab draws nothing at all)
  const [body, setBody] = useState(false);
  const [gone, setGone] = useState(false);
  const ready = body && data;
  const plainOut = stage === "skip" && ready;
  // Before the first paint after hydration, so the look and the quote it puts back on the root (React's development
  // remount clears them) never flicker.
  useLayoutEffect(() => {
    opening.begin(false);
    opening.resync();
  }, []);
  useEffect(() => {
    if (body) return;
    const id = window.setInterval(() => {
      if (!meadow.stats.loading && meadow.stats.drawn) setBody(true);
    }, 150);
    return () => window.clearInterval(id);
  }, [body]);
  useEffect(() => {
    if (ready) opening.ready();
  }, [ready]);
  useEffect(() => {
    if (!plainOut) return;
    const t = window.setTimeout(() => setGone(true), 1300);
    return () => window.clearTimeout(t);
  }, [plainOut]);

  const quoteUp = stage === "unset" || stage === "pending" || stage === "quote" || stage === "breath" || (stage === "peace" && !focused);
  if (!quoteUp && (stage !== "skip" || gone)) return null;
  const lifting = stage === "peace";
  const out = lifting || plainOut;
  return (
    <>
      <FirstLook page="meadow" />
      <div
        className={`meadow-veil${out ? " meadow-veil-out" : ""}`}
        style={stage === "skip" ? undefined : { transitionDuration: `${soft ? VEIL_FADE_MS.soft : VEIL_FADE_MS.plain}ms` }}
        aria-hidden={out}
      >
        {/* the plain look: shown by data-veil="plain" (meadow.css), easing in with the first paint */}
        <div className="meadow-veil-plain">
          <div className="meadow-veil-art">
            <div className="meadow-veil-halo" />
            <svg viewBox="0 0 120 120" width="120" height="120" aria-hidden="true">
              <defs>
                <radialGradient id="mv-glow" cx="50%" cy="45%" r="60%">
                  <stop offset="0%" stopColor="#fff2c8" />
                  <stop offset="60%" stopColor="#ffc56e" />
                  <stop offset="100%" stopColor="#d9893c" />
                </radialGradient>
              </defs>
              {/* a little lantern on its hook, the Meadow's guide light */}
              <path d="M60 22v10" stroke="#b48a4e" strokeWidth="2" strokeLinecap="round" />
              <path d="M48 40l12-8 12 8z" fill="#b48a4e" />
              <rect x="50" y="40" width="20" height="30" rx="3" fill="rgba(255,236,200,0.18)" stroke="#b48a4e" strokeWidth="1.6" />
              <ellipse cx="60" cy="56" rx="5.5" ry="7.5" fill="url(#mv-glow)" />
              <path d="M47 70h26" stroke="#b48a4e" strokeWidth="2.4" strokeLinecap="round" />
              <path d="M30 98 Q60 88 90 98" fill="none" stroke="rgba(246,234,214,0.22)" strokeWidth="1.2" strokeLinecap="round" />
            </svg>
          </div>
          <p className="meadow-veil-title">Opening the Meadow</p>
          <p className="meadow-veil-line" role="status" aria-live="polite">
            {body ? "Lighting the lanterns" : "Gathering everyone's seeds"}
          </p>
        </div>
        <QuoteMoment status="Opening the Meadow" waking="The Meadow is waking" finished={plainOut} />
      </div>
    </>
  );
}

/** The hint, until the person has found their way (it fades once a card has opened or after a while). */
function HintLine() {
  const touch = useSyncExternalStore(subscribeNever, readTouch, serverTouch);
  const card = useUi((s) => s.card);
  const journey = useUi((s) => s.journey);
  const [used, setUsed] = useState(false);
  useEffect(() => {
    if (card !== null) {
      const id = window.setTimeout(() => setUsed(true), 0);
      return () => window.clearTimeout(id);
    }
  }, [card]);
  if (touch === null) return null;
  const shown = !used && card === null && journey === null;
  return (
    <p className="meadow-hint" style={{ opacity: shown ? 1 : 0 }}>
      {touch ? HINTS.touch : HINTS.mouse}
    </p>
  );
}

export function Meadow() {
  const dev = useSyncExternalStore(subscribeNever, readDev, serverDev);
  const me = useMe();

  useEffect(() => {
    const stop = startPolling();
    void loadSession();
    return stop;
  }, []);

  // the opening's welcome, for someone whose device holds a garden (said only if the name is in by its moment)
  useEffect(() => {
    if (me?.signedIn && me.firstName) opening.named(me.firstName);
  }, [me]);

  useEffect(() => {
    meadow.myPlot = me?.signedIn && me.plot !== null ? me.plot : -1;
  }, [me]);

  // a /meadow?plot=N link opens that plant's card once the Meadow knows it (the canvas starts the cart beside it)
  useEffect(() => {
    const plot = plotParam();
    if (plot === null) return;
    const open = () => {
      const d = meadowData.get();
      if (d.status === "loading") return false;
      if (d.byPlot.has(plot)) ui.set({ card: plot });
      return true;
    };
    if (open()) return;
    const stop = meadowData.subscribe(() => {
      if (open()) stop();
    });
    return stop;
  }, []);

  return (
    <main className="meadow-root fixed inset-0 overflow-hidden bg-[#2a3324]" style={{ touchAction: "none", WebkitTouchCallout: "none", userSelect: "none" }}>
      <Suspense fallback={null}>
        <MeadowCanvas />
      </Suspense>
      <TopBar />
      <JourneyPill />
      <VisitCard />
      <FindFriend />
      <HintLine />
      {dev && <DevHud />}
      <UnstuckButton />
      <MoverNotice />
      <FadeVeil />
      <WelcomeLine />
      <MeadowVeil />
    </main>
  );
}
