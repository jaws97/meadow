"use client";
// The /meadow shell: the full-viewport canvas (client-only, it needs WebGL and window, so next/dynamic loads it with
// ssr:false), and the HTML laid over it: the title and the count of flowers, "Find a friend" and a way back to the
// person's own garden, the visit card, the find panel and the firefly journey's pill, a one-line hint for the hand in
// use, the opening veil, and the calm notices the canvas raises (the glide fallback, the respawn fade). The
// developer readout shows only with ?dev.
//
// Data: the shared snapshot is polled while the page is open (data.ts), and the session says whether this device
// holds a garden (for "This is yours", the sprinkle, and the gold ribbon on the person's own stake). A link to
// /meadow?plot=N opens beside that plant with its card.
import dynamic from "next/dynamic";
import { Suspense, useEffect, useState, useSyncExternalStore } from "react";
import { DevHud, FadeVeil, MoverNotice } from "@/components/meadow/DevHud";
import { UnstuckButton } from "@/components/meadow/Unstuck";
import { loadSession, meadowData, startPolling, useMe, useMeadowData } from "@/components/meadow/data";
import { FindButton, FindFriend, JourneyPill } from "@/components/meadow/FindFriend";
import { LeafIcon } from "@/components/meadow/icons";
import { meadow } from "@/components/meadow/runtime";
import { ui, useUi } from "@/components/meadow/ui";
import { VisitCard } from "@/components/meadow/VisitCard";
import { primaryTouch } from "@/lib/garden/device";
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

/** The opening: a warm veil until the first frame is up with a body in it and the Meadow's plants have arrived. */
function MeadowVeil() {
  const [phase, setPhase] = useState<"up" | "out" | "gone">("up");
  const status = useMeadowData((d) => d.status);
  const [line, setLine] = useState("Gathering everyone's seeds");
  useEffect(() => {
    if (phase !== "up") return;
    const id = window.setInterval(() => {
      if (!meadow.stats.loading) setLine("Lighting the lanterns");
      if (!meadow.stats.loading && status !== "loading") {
        setPhase("out");
        window.setTimeout(() => setPhase("gone"), 1300);
      }
    }, 150);
    return () => window.clearInterval(id);
  }, [phase, status]);
  if (phase === "gone") return null;
  return (
    <div className={`meadow-veil${phase === "out" ? " meadow-veil-out" : ""}`} aria-hidden={phase === "out"}>
      <div>
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
          {line}
        </p>
      </div>
    </div>
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
      <MeadowVeil />
    </main>
  );
}
