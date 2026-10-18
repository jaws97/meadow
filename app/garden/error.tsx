"use client";
// The garden's last line of defence. Anything that escapes the canvas's own fallbacks (the courtyard's chunk is asked
// for again and then let go inside the scene, components/garden/Scene.tsx) lands here instead of Next's blank error
// page: a calm night with one line and a way back in. Opening the page afresh is what recovers a lost graphics context
// or a chunk that would not load, so that is what the button does. A default export because that is what the error.js
// file convention requires.
import { useEffect } from "react";

export default function GardenError({ error }: { error: Error & { digest?: string }; retry: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <main className="fixed inset-0 flex items-center justify-center bg-[#06080f] px-6 text-center select-none">
      <div className="flex flex-col items-center gap-4">
        <p className="text-sm text-white/75">The garden is resting for a moment.</p>
        <button
          type="button"
          className="rounded-full bg-[#fff1cf]/90 px-4 py-2 text-sm text-[#3b2f22] shadow-lg"
          onClick={() => window.location.reload()}
        >
          Open the garden again
        </button>
      </div>
    </main>
  );
}
