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
// care layer's card holds the bottom of the screen. Everything over the canvas
// stacks inside the page: a plant swap's soft night (z 12), the care card
// (15), the name pill (17), the loading veil (20), then the gift's still and
// sheet; dialogs go to the body, over all of it. The opening's welcome line
// (OpeningMoment) comes after the veil has gone, when nothing else is shown. The development panel
// shows in development, and in production only with ?dev, so colleagues see
// a clean garden while the owner can still tune it on the live site.
import dynamic from "next/dynamic";
import { useSyncExternalStore } from "react";
import { DevPanel } from "@/components/garden/DevPanel";
import { LoadingVeil } from "@/components/garden/LoadingVeil";
import { WelcomeLine } from "@/components/garden/OpeningMoment";
import { GardenDoor } from "@/components/gift/GardenDoor";
import { Hint } from "@/components/gift/Hint";
import { preloadRememberedCourtyard } from "@/components/lotus/product/preload";

// The veil covers the canvas while its chunk loads, so the fallback draws nothing.
const GardenCanvas = dynamic(() => import("@/components/garden/GardenCanvas"), { ssr: false, loading: () => null });
// A device that last showed a lotus asks for its courtyard's chunk now, beside the canvas's own.
if (typeof window !== "undefined") preloadRememberedCourtyard();

const IS_DEV = process.env.NODE_ENV !== "production";
// The query never changes while the page is open, so there is nothing to subscribe to.
const subscribeNever = () => () => {};
const readShowPanel = () => IS_DEV || new URLSearchParams(window.location.search).has("dev");
const serverShowPanel = () => IS_DEV;

export default function GardenPage() {
  const showPanel = useSyncExternalStore(subscribeNever, readShowPanel, serverShowPanel);
  return (
    // data-garden-layers: the care layer's soft night during a plant swap goes in here, under the card and the pill
    <main className="fixed inset-0 overflow-hidden bg-[#06080f]" data-garden-layers="">
      <GardenCanvas />
      <LoadingVeil />
      <WelcomeLine />
      {showPanel && <DevPanel />}
      <GardenDoor hint={<Hint panel={showPanel} />} />
    </main>
  );
}
