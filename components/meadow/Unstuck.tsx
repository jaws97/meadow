"use client";
// "Unstuck": offered when the cart has tried to move for a few seconds without getting anywhere (the controller
// sets meadow.stuck). A tap moves it back onto the nearest path behind a warm fade. It polls the runtime four
// times a second, so it costs the render loop nothing.
import { useEffect, useState } from "react";
import { meadow } from "@/components/meadow/runtime";

export function UnstuckButton() {
  const [stuck, setStuck] = useState(false);
  useEffect(() => {
    const id = window.setInterval(() => setStuck(meadow.stuck), 250);
    return () => window.clearInterval(id);
  }, []);
  if (!stuck) return null;
  return (
    <button
      type="button"
      className="fixed left-1/2 z-20 -translate-x-1/2 rounded-full bg-[#fff1cf]/90 px-4 py-2 text-sm text-[#3b2f22] shadow-lg"
      style={{ bottom: "max(52px, calc(env(safe-area-inset-bottom) + 44px))" }}
      onClick={() => (meadow.requests.unstuck = true)}
    >
      Unstuck
    </button>
  );
}
