"use client";
// The garden route: a full-viewport canvas (client-only, it needs WebGL and
// window) with the HTML development panel and a hint caption laid over it.
import dynamic from "next/dynamic";
import { DevPanel } from "@/components/garden/DevPanel";

const GardenCanvas = dynamic(() => import("@/components/garden/GardenCanvas"), {
  ssr: false,
  loading: () => (
    <div className="absolute inset-0 flex items-center justify-center text-sm text-white/40 select-none">
      Growing...
    </div>
  ),
});

export default function GardenPage() {
  return (
    <main className="fixed inset-0 overflow-hidden bg-[#06080f]">
      <GardenCanvas />
      <DevPanel />
      <p className="pointer-events-none fixed bottom-4 left-4 z-10 text-xs text-white/40 select-none">
        Drag to orbit, scroll or pinch to zoom, H hides the panel
      </p>
    </main>
  );
}
