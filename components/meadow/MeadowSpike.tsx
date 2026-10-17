"use client";
// The /meadow-spike shell: a full-viewport, client-only canvas (it needs
// WebGL and window, so next/dynamic loads it with ssr:false inside a Suspense
// boundary), with the developer readout, the respawn veil, the glide notice
// and a one-line hint laid over it in HTML. The hint speaks to the hand in
// use: taps and pinches for a finger, clicks, the wheel and the keys for a
// mouse or trackpad.
import dynamic from "next/dynamic";
import { Suspense, useSyncExternalStore } from "react";
import { DevHud, FadeVeil, MoverNotice } from "@/components/meadow/DevHud";
import { primaryTouch } from "@/lib/garden/device";

const Loading = () => (
  <div className="absolute inset-0 flex items-center justify-center text-sm text-white/50 select-none">Opening the meadow...</div>
);

const MeadowCanvas = dynamic(() => import("@/components/meadow/MeadowCanvas"), { ssr: false, loading: Loading });

// The primary pointer does not change while the page is open, so there is nothing to subscribe to.
const subscribeNever = () => () => {};
const readTouch = () => primaryTouch();
const serverTouch = () => null;

const HINTS = {
  touch: "Tap to go, tap a glowing stake to visit, hold and drag to drive. Pinch to zoom.",
  mouse: "Click to go, click a glowing stake to visit, hold and drag to drive. Scroll to zoom. Keys: WASD or arrows, Space hops, R respawns.",
};

export function MeadowSpike() {
  const touch = useSyncExternalStore(subscribeNever, readTouch, serverTouch);
  return (
    <main className="fixed inset-0 overflow-hidden bg-[#2a3324]" style={{ touchAction: "none", WebkitTouchCallout: "none", userSelect: "none" }}>
      <Suspense fallback={<Loading />}>
        <MeadowCanvas />
      </Suspense>
      <DevHud />
      <MoverNotice />
      <FadeVeil />
      {touch !== null && (
        <p
          className="pointer-events-none fixed inset-x-0 bottom-0 z-10 px-4 text-center text-xs text-white/70 select-none"
          style={{ paddingBottom: "max(14px, env(safe-area-inset-bottom))", textShadow: "0 1px 6px rgba(0,0,0,0.45)" }}
        >
          {touch ? HINTS.touch : HINTS.mouse}
        </p>
      )}
    </main>
  );
}
