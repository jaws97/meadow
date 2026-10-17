"use client";
// The party screen's last line of defence. The screen runs unattended on the
// venue display, so anything that escapes its own fallbacks (the garden
// stepping aside for the panel alone, the tally holding its last number)
// lands on a calm note that reloads the page by itself after a short pause,
// keeping the address and so the party code. A default export because that
// is what the error.js file convention requires.
import { useEffect } from "react";

const RELOAD_AFTER_MS = 20_000;

export default function PartyError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  useEffect(() => {
    console.error(error);
    const t = window.setTimeout(() => window.location.reload(), RELOAD_AFTER_MS);
    return () => window.clearTimeout(t);
  }, [error]);

  return (
    <main className="fixed inset-0 flex items-center justify-center bg-[#0a0f1f] px-6 text-center select-none">
      <div className="flex flex-col items-center gap-5">
        <p className="text-[clamp(18px,1.6vw,40px)] text-white/80">The garden screen is resting for a moment.</p>
        <button
          type="button"
          className="rounded-full bg-[#fff1cf]/90 px-5 py-2 text-[clamp(14px,1vw,24px)] text-[#3b2f22] shadow-lg"
          onClick={() => retry()}
        >
          Try again
        </button>
      </div>
    </main>
  );
}
