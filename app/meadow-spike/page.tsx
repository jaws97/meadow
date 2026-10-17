"use client";
// /meadow-spike: the Lantern Cart's old test bed, now grown into the real Meadow. Old links (and ?mover= for
// testing) carry on to /meadow with their query intact. A default export because that is what the page convention
// requires.
import { useEffect } from "react";

export default function MeadowSpikePage() {
  useEffect(() => {
    window.location.replace(`/meadow${window.location.search}`);
  }, []);
  return (
    <main className="fixed inset-0 flex items-center justify-center bg-[#2a3324] text-sm text-white/60 select-none">
      Opening the Meadow
    </main>
  );
}
