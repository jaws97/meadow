// /meadow: the shared Meadow, where everyone's flowers grow in rings round the owner's Enchanted Rose. Drive the
// Lantern Cart (or glide) along the paths, visit a friend's plant, share a sprinkle, find someone by name. The page
// itself is a server component, so it can carry metadata and its shell is prerendered; everything that needs WebGL,
// the address or the session runs in the client component below.
import type { Metadata } from "next";
import { Meadow } from "@/components/meadow/Meadow";

export const metadata: Metadata = {
  title: "The Meadow",
  description:
    "Everyone's flowers, growing together round the rose. Ride the lantern cart, visit a friend's flower and leave a sprinkle.",
  alternates: { canonical: "/meadow" },
};

export default function MeadowPage() {
  return <Meadow />;
}
