"use client";
// The first look for someone who has never been here: a still of Lijas's rose garden, rendered from the real scene
// and shipped with the site (public/gift), laid softly blurred over the loading veil while the live garden builds
// behind it, so the gift is offered over the flower from the first instant instead of over a loading screen, with the
// garden's one loading line (LoadingVeil's WAKING_LINE) and a thin vine of progress. When the garden is ready
// (lib/garden/quality's reveal, the same moment the loading veil lifts) it fades into the live canvas.
//
// One still per screen shape (tall phone, portrait tablet, landscape) and per light (day, dusk, night by Bangalore's
// clock, poster.ts lightNow), so the still and the live garden agree. It only mounts after the page has decided this
// visitor has no garden yet; a returning colleague gets the loading veil and their own remembered still instead.
import Image from "next/image";
import { useEffect, useState } from "react";
import { WAKING_LINE } from "@/components/garden/LoadingVeil";
import { lightNow } from "@/components/garden/poster";
import { VeilQuote } from "@/components/garden/VeilQuote";
import { quality, useQuality, type Phase } from "@/lib/garden/quality";

const isLive = (s: { veiled: boolean; phase: Phase }) => !s.veiled || s.phase === "revealing" || s.phase === "live";

/** How far along the thin line has grown, as the loading veil's vine does (LoadingVeil.tsx). */
const PROGRESS: Record<Phase, [number, string]> = {
  boot: [0.25, "2.5s"],
  compiling: [0.86, "9s"],
  warming: [0.92, "0.6s"],
  calibrating: [0.97, "0.9s"],
  revealing: [1, "0.5s"],
  live: [1, "0.5s"],
};

function shapeNow(): "phone" | "tablet" | "wide" {
  const aspect = window.innerWidth / Math.max(1, window.innerHeight);
  if (aspect < 0.62) return "phone";
  if (aspect < 1.05) return "tablet";
  return "wide";
}

export function GiftVeil() {
  const live = useQuality(isLive);
  const phase = useQuality((s) => s.phase);
  // read once: the veil is up for seconds, and a still that changed under the person would flicker
  const [still] = useState(() => (isLive(quality.get()) ? null : `/gift/poster-${shapeNow()}-${lightNow()}.webp`));
  const [gone, setGone] = useState(still === null);

  useEffect(() => {
    if (!live || gone) return;
    const t = setTimeout(() => setGone(true), 1600);
    return () => clearTimeout(t);
  }, [live, gone]);

  if (gone || !still) return null;
  const [progress, duration] = PROGRESS[phase];
  return (
    <div className={`gift-veil${live ? " gift-veil-out" : ""}`} aria-hidden="true">
      <div className="gift-veil-still">
        <Image src={still} alt="" fill unoptimized fetchPriority="high" sizes="100vw" style={{ objectFit: "cover" }} />
      </div>
      <div className="gift-veil-status">
        <span>{WAKING_LINE}</span>
        <div className="gift-veil-track">
          <div className="gift-veil-fill" style={{ transform: `scaleX(${progress})`, ["--t" as string]: duration }} />
        </div>
        <VeilQuote />
      </div>
    </div>
  );
}

