"use client";
// The garden route: a full-viewport canvas (client-only, it needs WebGL and
// window), the loading veil that covers it until the first frame is ready,
// and a hint caption laid over it. The caption speaks to the hand in use: a
// finger swipes and pinches, a mouse or trackpad drags and scrolls, and only
// a keyboard user is told about H. The development panel shows in
// development, and in production only with ?dev, so colleagues see a clean
// garden while the owner can still tune it on the live site.
import dynamic from "next/dynamic";
import { useSyncExternalStore } from "react";
import { DevPanel } from "@/components/garden/DevPanel";
import { LoadingVeil } from "@/components/garden/LoadingVeil";
import { primaryTouch } from "@/lib/garden/device";
import { useQuality } from "@/lib/garden/quality";

// The veil covers the canvas while its chunk loads, so the fallback draws nothing.
const GardenCanvas = dynamic(() => import("@/components/garden/GardenCanvas"), { ssr: false, loading: () => null });

const IS_DEV = process.env.NODE_ENV !== "production";
// The query and the primary pointer never change while the page is open, so there is nothing to subscribe to.
const subscribeNever = () => () => {};
const readShowPanel = () => IS_DEV || new URLSearchParams(window.location.search).has("dev");
const serverShowPanel = () => IS_DEV;
const readTouch = () => primaryTouch();
const serverTouch = () => null;

function hint(touch: boolean, panel: boolean): string {
  if (touch) return "Swipe to look around, pinch to zoom";
  return `Drag to look around, scroll to zoom${panel ? ", H hides the panel" : ""}`;
}

export default function GardenPage() {
  const showPanel = useSyncExternalStore(subscribeNever, readShowPanel, serverShowPanel);
  const touch = useSyncExternalStore(subscribeNever, readTouch, serverTouch);
  // Shown once the garden is: through a later tier change it stays, since the garden never leaves the screen.
  const live = useQuality((s) => !s.veiled || s.phase === "revealing" || s.phase === "live");
  return (
    <main className="fixed inset-0 overflow-hidden bg-[#06080f]">
      <GardenCanvas />
      <LoadingVeil />
      {showPanel && <DevPanel />}
      {touch !== null && (
        // Grows a little on a big screen, so the line still reads from across a room.
        <p
          className="pointer-events-none fixed left-4 z-10 text-white/55 transition-opacity duration-1000 select-none"
          style={{
            bottom: "max(16px, env(safe-area-inset-bottom))",
            fontSize: "clamp(12px, 0.85vw, 17px)",
            opacity: live ? 1 : 0,
            textShadow: "0 1px 6px rgba(0,0,0,0.5)",
          }}
        >
          {hint(touch, showPanel)}
        </p>
      )}
    </main>
  );
}
