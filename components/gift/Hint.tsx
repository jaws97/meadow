"use client";
// The one-line hint over a garden that is free to explore. It speaks to the hand in use: a finger swipes and pinches,
// a mouse or trackpad drags and scrolls, and only a keyboard user with the development panel is told about H. It
// fades in once the garden shows (and stays through a later tier change, since the garden never leaves the screen),
// and grows a little on a big screen so it still reads from across a room (gift.css .gift-hint).
import { useSyncExternalStore } from "react";
import { primaryTouch } from "@/lib/garden/device";
import { useQuality } from "@/lib/garden/quality";

// The primary pointer never changes while the page is open, so there is nothing to subscribe to.
const subscribeNever = () => () => {};
const readTouch = () => primaryTouch();
const serverTouch = () => null;

function hintText(touch: boolean, panel: boolean): string {
  if (touch) return "Swipe to look around, pinch to zoom";
  return `Drag to look around, scroll to zoom${panel ? ", H hides the panel" : ""}`;
}

export function Hint({ panel }: { panel: boolean }) {
  const touch = useSyncExternalStore(subscribeNever, readTouch, serverTouch);
  const live = useQuality((s) => !s.veiled || s.phase === "revealing" || s.phase === "live");
  if (touch === null) return null;
  return (
    <p className="gift-hint" style={{ opacity: live ? 1 : 0 }}>
      {hintText(touch, panel)}
    </p>
  );
}
