"use client";
// The loading moment on the big screen: the garden's own veil (its look and
// motion from components/garden/LoadingVeil.css, the halo breathing and the
// motes rising) with a rosebud in place of the sprout and the party's words,
// since the screen shows Lijas's garden to a room rather than a colleague's
// own. It covers the canvas while the scene's chunk loads and its shaders
// compile, then fades into the first frame, and never returns. On a big
// screen it is drawn a little larger, so it does not shrink to a speck. If
// the garden cannot start at all the veil steps aside for the panel alone.
import { useParty } from "@/components/party/store";
import { OWNER } from "@/components/party/logic";
import { useQuality, type Phase } from "@/lib/garden/quality";
import "@/components/garden/LoadingVeil.css";

const LINES: Record<Phase, string> = {
  boot: "Gathering the seeds",
  compiling: "Unfurling the petals",
  warming: "Letting the light in",
  calibrating: "Letting the light in",
  revealing: "Letting the light in",
  live: "",
};

/** How far along the vine has grown, and how slowly it gets there (as the garden's veil). */
const PROGRESS: Record<Phase, [number, string]> = {
  boot: [0.18, "2.5s"],
  compiling: [0.86, "9s"],
  warming: [0.92, "0.6s"],
  calibrating: [0.97, "0.9s"],
  revealing: [1, "0.5s"],
  live: [1, "0.5s"],
};

const MOTES: ReadonlyArray<[number, number, number]> = [
  [-26, 7.2, -1.1],
  [18, 6.1, -3.9],
  [-8, 8.4, -5.6],
  [34, 7.8, -0.4],
  [-38, 6.6, -2.7],
  [10, 9.1, -6.8],
  [-16, 7.5, -4.4],
];

/** A rosebud on its stem, sepals parting: original art. */
function Bud() {
  return (
    <svg viewBox="0 0 148 148" width="148" height="148" aria-hidden="true">
      <defs>
        <radialGradient id="party-veil-bud" cx="46%" cy="34%" r="72%">
          <stop offset="0%" stopColor="#ffb0bb" />
          <stop offset="48%" stopColor="#e2324a" />
          <stop offset="100%" stopColor="#8a0f24" />
        </radialGradient>
        <linearGradient id="party-veil-leaf-l" x1="1" y1="1" x2="0" y2="0">
          <stop offset="0%" stopColor="#4f8d50" />
          <stop offset="100%" stopColor="#a9d98a" />
        </linearGradient>
        <linearGradient id="party-veil-leaf-r" x1="0" y1="1" x2="1" y2="0">
          <stop offset="0%" stopColor="#467f48" />
          <stop offset="100%" stopColor="#b7e39a" />
        </linearGradient>
        <radialGradient id="party-veil-seed" cx="45%" cy="40%" r="65%">
          <stop offset="0%" stopColor="#fff2c8" />
          <stop offset="55%" stopColor="#ffc56e" />
          <stop offset="100%" stopColor="#d9893c" />
        </radialGradient>
      </defs>
      <path d="M40 126 Q74 117 108 126" fill="none" stroke="rgba(246,234,214,0.22)" strokeWidth="1.2" strokeLinecap="round" />
      <path d="M74 120 C72.4 104 76.2 88 74 70" fill="none" stroke="#7fb466" strokeWidth="2.2" strokeLinecap="round" />
      <path d="M73.4 102 C62.5 100.5 53 94 49 83.5 C60 83 69.6 89.5 73.4 102 Z" fill="url(#party-veil-leaf-l)" />
      <path d="M72.8 101 C65.8 97 57.8 91 52.3 85" fill="none" stroke="rgba(236,248,214,0.45)" strokeWidth="0.8" strokeLinecap="round" />
      <path d="M74.8 90 C85.7 86.5 96.6 78 100 65.5 C87.6 66 78.6 74.5 74.8 90 Z" fill="url(#party-veil-leaf-r)" />
      <path d="M75.6 88.5 C83.2 82.5 91.6 75 97 68" fill="none" stroke="rgba(236,248,214,0.45)" strokeWidth="0.8" strokeLinecap="round" />
      {/* sepals, parting round the bud */}
      <path d="M74 71 C68 69 64.5 64.5 64 59 C68.5 61.5 71.5 65 74 71 Z" fill="#5f9a52" />
      <path d="M74 71 C80 69 83.5 64.5 84 59 C79.5 61.5 76.5 65 74 71 Z" fill="#5f9a52" />
      {/* the bud: an outer petal wrapped round a tighter heart */}
      <path d="M74 44 C82.5 49 84.5 60 74 70.5 C63.5 60 65.5 49 74 44 Z" fill="url(#party-veil-bud)" />
      <path d="M74.4 48.5 C79 52.5 79.6 60 75.2 66.5" fill="none" stroke="rgba(255,196,204,0.6)" strokeWidth="0.9" strokeLinecap="round" />
      <path d="M70.6 52 C68.6 56.5 69.2 62 72.4 66" fill="none" stroke="rgba(120,10,30,0.45)" strokeWidth="0.9" strokeLinecap="round" />
      <ellipse cx="74" cy="122" rx="7.5" ry="5" fill="url(#party-veil-seed)" />
    </svg>
  );
}

export function PartyVeil() {
  const phase = useQuality((s) => s.phase);
  const veiled = useQuality((s) => s.veiled);
  const settling = useQuality((s) => s.tierChanges > 0);
  const fallback = useParty((s) => s.fallback);
  if (!veiled || phase === "live" || fallback) return null;
  const [target, duration] = PROGRESS[phase];
  // the vine only ever grows, through a tier step under the veil too
  const progress = settling ? Math.max(target, PROGRESS.calibrating[0]) : target;
  const out = phase === "revealing";
  return (
    <div className={`garden-veil-veil${out ? " garden-veil-out" : ""}`} aria-hidden={out}>
      <div className="garden-veil-content">
        <div className="party-veil-zoom">
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
              <Bud />
            </div>
          </div>
          <p className="garden-veil-title">A gift from {OWNER.name}</p>
          <p key={LINES[phase]} className="garden-veil-line" role="status" aria-live="polite">
            {LINES[phase]}
          </p>
          <div className="garden-veil-track">
            <div className="garden-veil-fill" style={{ transform: `scaleX(${progress})`, ["--t" as string]: duration }} />
          </div>
        </div>
      </div>
    </div>
  );
}
