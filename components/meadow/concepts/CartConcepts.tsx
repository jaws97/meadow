"use client";
// The /cart-concepts shell: the stage needs WebGL and the address, so next/dynamic loads it in the browser only
// (ssr:false is allowed only from a client component, hence this file). A warm dark floor shows while it loads.
import dynamic from "next/dynamic";

const ConceptStage = dynamic(() => import("@/components/meadow/concepts/ConceptStage"), {
  ssr: false,
  loading: () => <main className="fixed inset-0 bg-[#1a1712]" />,
});

export function CartConcepts() {
  return <ConceptStage />;
}
