"use client";
// The Meadow's last line of defence. Anything that escapes the canvas's own fallbacks (MeadowCanvas swaps to the
// glider when physics fails to load, start or keep up) lands here instead of Next's blank error page: the page
// quietly reopens with the physics-free glider. If the glider itself is what failed, a calm note offers another try
// rather than an error. A default export because that is what the error.js file convention requires.
import { useEffect, useState } from "react";

const onGlider = () => new URLSearchParams(window.location.search).get("mover") === "glide";

export default function MeadowError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  const [reopening, setReopening] = useState(true);
  useEffect(() => {
    console.error(error);
    if (onGlider()) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- the glider failed too: show the note instead of looping
      setReopening(false);
      return;
    }
    const url = new URL(window.location.href);
    url.searchParams.set("mover", "glide");
    window.location.replace(url.toString());
  }, [error]);

  return (
    <main className="fixed inset-0 flex items-center justify-center bg-[#2a3324] px-6 text-center select-none">
      {reopening ? (
        <p className="text-sm text-white/60">Opening the Meadow</p>
      ) : (
        <div className="flex flex-col items-center gap-4">
          <p className="text-sm text-white/75">The Meadow is resting for a moment.</p>
          <button type="button" className="rounded-full bg-[#fff1cf]/90 px-4 py-2 text-sm text-[#3b2f22] shadow-lg" onClick={() => retry()}>
            Try again
          </button>
        </div>
      )}
    </main>
  );
}
