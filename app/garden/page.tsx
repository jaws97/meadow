"use client";
// The garden route: a full-viewport canvas (client-only, it needs WebGL and
// window) with a hint caption laid over it. The development panel shows in
// development, and in production only with ?dev, so colleagues see a clean
// garden while the owner can still tune it on the live site.
import dynamic from "next/dynamic";
import { useSyncExternalStore } from "react";
import { DevPanel } from "@/components/garden/DevPanel";

const GardenCanvas = dynamic(() => import("@/components/garden/GardenCanvas"), {
  ssr: false,
  loading: () => (
    <div className="absolute inset-0 flex items-center justify-center text-sm text-white/40 select-none">
      Growing...
    </div>
  ),
});

const IS_DEV = process.env.NODE_ENV !== "production";
// The query never changes while the page is open, so there is nothing to subscribe to.
const subscribeNever = () => () => {};
const readShowPanel = () => IS_DEV || new URLSearchParams(window.location.search).has("dev");
const serverShowPanel = () => IS_DEV;

export default function GardenPage() {
  const showPanel = useSyncExternalStore(subscribeNever, readShowPanel, serverShowPanel);
  return (
    <main className="fixed inset-0 overflow-hidden bg-[#06080f]">
      <GardenCanvas />
      {showPanel && <DevPanel />}
      <p className="pointer-events-none fixed bottom-4 left-4 z-10 text-xs text-white/40 select-none">
        Drag to look around, scroll or pinch to zoom{showPanel ? ", H hides the panel" : ""}
      </p>
    </main>
  );
}
