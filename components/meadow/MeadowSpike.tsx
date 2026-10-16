"use client";
// The /meadow-spike shell: a full-viewport, client-only canvas (it needs
// WebGL and window, so next/dynamic loads it with ssr:false inside a Suspense
// boundary), with the developer readout, the respawn veil and a one-line hint
// laid over it in HTML.
import dynamic from "next/dynamic";
import { Suspense } from "react";
import { DevHud, FadeVeil } from "@/components/meadow/DevHud";

const Loading = () => (
  <div className="absolute inset-0 flex items-center justify-center text-sm text-white/50 select-none">Opening the meadow...</div>
);

const MeadowCanvas = dynamic(() => import("@/components/meadow/MeadowCanvas"), { ssr: false, loading: Loading });

export function MeadowSpike() {
  return (
    <main className="fixed inset-0 overflow-hidden bg-[#2a3324]" style={{ touchAction: "none", WebkitTouchCallout: "none", userSelect: "none" }}>
      <Suspense fallback={<Loading />}>
        <MeadowCanvas />
      </Suspense>
      <DevHud />
      <FadeVeil />
      <p
        className="pointer-events-none fixed inset-x-0 bottom-0 z-10 px-4 text-center text-xs text-white/70 select-none"
        style={{ paddingBottom: "max(14px, env(safe-area-inset-bottom))", textShadow: "0 1px 6px rgba(0,0,0,0.45)" }}
      >
        Tap to go, tap a glowing stake to visit, hold and drag to drive. Pinch to zoom. Keys: WASD, Space hops, R respawns.
      </p>
    </main>
  );
}
