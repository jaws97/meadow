// /meadow-spike: a playable test bed for the Meadow explorer's Lantern Cart on
// Rapier physics, built to answer "does a physics cart feel good and run well
// on phones?" before the go/no-go. Not final art. The page itself is a server
// component (so it can carry metadata); the canvas behind it is client-only.
import type { Metadata } from "next";
import { MeadowSpike } from "@/components/meadow/MeadowSpike";

export const metadata: Metadata = {
  title: "Meadow spike - Disney Garden",
  description: "Lantern Cart physics test bed",
};

export default function MeadowSpikePage() {
  return <MeadowSpike />;
}
