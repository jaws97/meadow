"use client";
// The garden route: a full-viewport canvas (client-only, it needs WebGL and
// window), the loading veil that covers it until the first frame is ready,
// and the garden's door laid over it (components/gift/GardenDoor), which
// decides what this visitor sees: their own garden with the care layer, the
// seed Lijas is giving (from the party's QR link), or Lijas's rose as a
// showcase. The canvas starts on Lijas's Enchanted Rose in full bloom, the
// garden everyone sees first.
//
// The door shows the hint caption (components/gift/Hint) over the showcase;
// under the gift sheet there is no room, and in a colleague's own garden the
// care layer's card holds the bottom of the screen. The development panel
// shows in development, and in production only with ?dev, so colleagues see
// a clean garden while the owner can still tune it on the live site.
import dynamic from "next/dynamic";
import { useSyncExternalStore } from "react";
import { DevPanel } from "@/components/garden/DevPanel";
import { LoadingVeil } from "@/components/garden/LoadingVeil";
import { GardenDoor } from "@/components/gift/GardenDoor";
import { Hint } from "@/components/gift/Hint";

// The veil covers the canvas while its chunk loads, so the fallback draws nothing.
const GardenCanvas = dynamic(() => import("@/components/garden/GardenCanvas"), { ssr: false, loading: () => null });

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
      <LoadingVeil />
      {showPanel && <DevPanel />}
      <GardenDoor hint={<Hint panel={showPanel} />} />
    </main>
  );
}
