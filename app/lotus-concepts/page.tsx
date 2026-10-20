// /lotus-concepts: the Lotus (the seventh species) for the owner's sign-off before anything is built into the
// product: v2, the owner's small koi pond as a stepped granite tank in the lotus garden's own South Indian courtyard
// (components/lotus/courtyard: laterite walls with a lamp niche, brass oil lamps, banana, areca and jasmine, dawn mist,
// dragonflies by day and fireflies at dusk, under the garden's own sky, sun and post-processing) with the lotus in its
// pot and three young koi, at each stage, mood and time of day; view=meadow is the Meadow's lazy river (Option A, the
// Rose Island moat: components/lotus/river), with lotus in its pockets, a slab bridge, the ring beds, ambient koi and
// the Lantern Cart for scale (cam=product, bridge, close, overview); the earlier urli on a Meadow plot is kept as
// view=plot. Every control is in the address (?stage=bloom&time=golden&mood=happy&view=pond), ?still=1 holds the
// clock, the koi, the dragonflies, the fireflies and the mist, ?koi=0 empties the water, and window.__lotusReady turns
// true once a fully compiled frame has been drawn, for scripted screenshots. A development tool only: in a production
// build the page is not found, so it never reaches colleagues (notFound() is called in the render path, as Next 16.4's
// notFound reference asks). A default export because that is what the page convention requires.
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { LotusConcepts } from "@/components/lotus/LotusConcepts";

export const metadata: Metadata = {
  title: "Lotus concepts - Meadow",
  robots: { index: false },
};

export default function LotusConceptsPage() {
  if (process.env.NODE_ENV === "production") notFound();
  return <LotusConcepts />;
}
