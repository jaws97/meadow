"use client";
// The loading moment: a seed of light on a night-garden sky, its sprout
// swaying, a halo breathing round it and motes drifting up, over a line that
// says what the garden is doing. It is in the page's first HTML (the route
// is prerendered), so it is on screen before any script arrives, and it
// stays up while the canvas chunk loads, the shaders compile behind it and
// the governor settles the budget (lib/garden/quality's phases). Then it
// fades over a second and a half into the first frame.
//
// On a return visit the sky behind the sprout is the garden itself, as this
// device last saw it (poster.ts), softly blurred, so the first instant
// already shows the colleague's own flower and the live canvas comes into
// focus over it as the veil lifts.
//
// The veil belongs to the first opening only. Once the garden has been seen
// it never comes back: a later tier change holds a still of the garden
// instead (frameHold.ts). If the governor steps the tier while the veil is
// still up, the line says the garden is settling for this screen and the
// vine never grows backwards.
//
// The motion is CSS on HTML elements (LoadingVeil.css), transform and
// opacity only, so it runs on the compositor and never stutters while the
// main thread works. The art is drawn here, original to the garden.
import { useSyncExternalStore } from "react";
import { lookOf, readPoster } from "@/components/garden/poster";
import { garden } from "@/lib/garden/store";
import { useQuality, type Phase } from "@/lib/garden/quality";
import "@/components/garden/LoadingVeil.css";

const LINES: Record<Phase, string> = {
  boot: "Gathering the seeds",
  compiling: "Unfurling the leaves",
  warming: "Letting the light in",
  calibrating: "Letting the light in",
  revealing: "Letting the light in",
  live: "",
};
const SETTLING = "Settling the garden for this screen";

/** How far along the vine has grown, and how slowly it gets there (compiling has no progress to report, so it creeps). */
const PROGRESS: Record<Phase, [number, string]> = {
  boot: [0.18, "2.5s"],
  compiling: [0.86, "9s"],
  warming: [0.92, "0.6s"],
  calibrating: [0.97, "0.9s"],
  revealing: [1, "0.5s"],
  live: [1, "0.5s"],
};

/** Motes: horizontal drift (px), duration and delay (s). Negative delays start them mid-flight. */
const MOTES: ReadonlyArray<[number, number, number]> = [
  [-26, 7.2, -1.1],
  [18, 6.1, -3.9],
  [-8, 8.4, -5.6],
  [34, 7.8, -0.4],
  [-38, 6.6, -2.7],
  [10, 9.1, -6.8],
  [-16, 7.5, -4.4],
];

// The remembered still never changes while the veil is up, so there is nothing to subscribe to.
const subscribeNever = () => () => {};
let posterCache: string | null | undefined;
const readPosterOnce = () => {
  if (posterCache === undefined) posterCache = readPoster(lookOf(garden.get()));
  return posterCache;
};
const serverPoster = () => null;

function Sprout() {
  return (
    <svg viewBox="0 0 148 148" width="148" height="148" aria-hidden="true">
      <defs>
        <radialGradient id="veil-seed" cx="45%" cy="40%" r="65%">
          <stop offset="0%" stopColor="#fff2c8" />
          <stop offset="55%" stopColor="#ffc56e" />
          <stop offset="100%" stopColor="#d9893c" />
        </radialGradient>
        <linearGradient id="veil-leaf-l" x1="1" y1="1" x2="0" y2="0">
          <stop offset="0%" stopColor="#5f9f5a" />
          <stop offset="100%" stopColor="#a9d98a" />
        </linearGradient>
        <linearGradient id="veil-leaf-r" x1="0" y1="1" x2="1" y2="0">
          <stop offset="0%" stopColor="#4f8d50" />
          <stop offset="100%" stopColor="#b7e39a" />
        </linearGradient>
        <radialGradient id="veil-bud" cx="50%" cy="35%" r="70%">
          <stop offset="0%" stopColor="#ffe0c2" />
          <stop offset="60%" stopColor="#f6a481" />
          <stop offset="100%" stopColor="#d9705a" />
        </radialGradient>
      </defs>
      {/* the soil line */}
      <path d="M40 126 Q74 117 108 126" fill="none" stroke="rgba(246,234,214,0.22)" strokeWidth="1.2" strokeLinecap="round" />
      {/* stem */}
      <path d="M74 119 C72.6 105 76.4 92 74 76" fill="none" stroke="#8fc271" strokeWidth="2.2" strokeLinecap="round" />
      {/* leaves, each with a pale midrib */}
      <path d="M73.6 99 C63 97.5 53.5 91 49.5 80.5 C60.5 80 70 86.5 73.6 99 Z" fill="url(#veil-leaf-l)" />
      <path d="M73 98 C66 94 58 88 52.5 82" fill="none" stroke="rgba(236,248,214,0.45)" strokeWidth="0.8" strokeLinecap="round" />
      <path d="M74.6 88 C85.5 84.5 96.5 76 100 63.5 C87.5 64 78.5 72.5 74.6 88 Z" fill="url(#veil-leaf-r)" />
      <path d="M75.4 86.5 C83 80.5 91.5 73 97 66" fill="none" stroke="rgba(236,248,214,0.45)" strokeWidth="0.8" strokeLinecap="round" />
      {/* a closed bud, the promise of the flower */}
      <path d="M74 64 C79.5 68.5 79.8 75 74 78.5 C68.2 75 68.5 68.5 74 64 Z" fill="url(#veil-bud)" />
      {/* the seed of light it grew from */}
      <ellipse cx="74" cy="121.5" rx="7.5" ry="5" fill="url(#veil-seed)" />
    </svg>
  );
}

export function LoadingVeil() {
  const phase = useQuality((s) => s.phase);
  const veiled = useQuality((s) => s.veiled);
  const settling = useQuality((s) => s.tierChanges > 0);
  const poster = useSyncExternalStore(subscribeNever, readPosterOnce, serverPoster);
  if (!veiled || phase === "live") return null;
  const [target, duration] = PROGRESS[phase];
  // The vine only ever grows: a tier step under the veil (which comes from
  // calibrating) re-runs the opening phases, and the bar holds where it was.
  const progress = settling ? Math.max(target, PROGRESS.calibrating[0]) : target;
  const out = phase === "revealing";
  const line = settling && phase !== "revealing" ? SETTLING : LINES[phase];
  return (
    <div className={`garden-veil-veil${poster ? " garden-veil-has-poster" : ""}${out ? " garden-veil-out" : ""}`} aria-hidden={out}>
      {poster && <div className="garden-veil-poster" style={{ backgroundImage: `url(${poster})` }} />}
      <div className="garden-veil-content">
        <div className="garden-veil-art">
          <div className="garden-veil-halo" />
          {MOTES.map(([dx, d, delay], i) => (
            <span
              key={i}
              className="garden-veil-mote"
              style={{ ["--dx" as string]: `${dx}px`, ["--d" as string]: `${d}s`, ["--delay" as string]: `${delay}s` }}
            />
          ))}
          <div className="garden-veil-sprout">
            <Sprout />
          </div>
        </div>
        <p className="garden-veil-title">{poster ? "Welcome back to your garden" : "Your garden is waking"}</p>
        <p key={line} className="garden-veil-line" role="status" aria-live="polite">
          {line}
        </p>
        <div className="garden-veil-track">
          <div className="garden-veil-fill" style={{ transform: `scaleX(${progress})`, ["--t" as string]: duration }} />
        </div>
      </div>
    </div>
  );
}
