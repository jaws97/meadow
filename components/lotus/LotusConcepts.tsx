"use client";
// The /lotus-concepts shell: the stage needs WebGL and the address, so next/dynamic loads it in the browser only
// (ssr:false is allowed only from a client component, hence this file; Next 16.4's lazy-loading guide). The garden's
// dark floor shows while it loads.
import dynamic from "next/dynamic";

const LotusStage = dynamic(() => import("@/components/lotus/LotusStage"), {
  ssr: false,
  loading: () => <main className="fixed inset-0 bg-[#06080f]" />,
});

export function LotusConcepts() {
  return <LotusStage />;
}
