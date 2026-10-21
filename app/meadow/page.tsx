// /meadow: the shared Meadow, where everyone's flowers grow in rings round the owner's Enchanted Rose. Drive the
// Lantern Cart (or glide) along the paths, visit a friend's plant, share a sprinkle, find someone by name. The page
// itself is a server component, so it can carry metadata and its shell is prerendered; everything that needs WebGL,
// the address or the session runs in the client component below. The hidden introduction (app/seo.tsx) gives search
// engines and screen readers the words the canvas has not.
import type { Metadata } from "next";
import { MEADOW_DESCRIPTION, MEADOW_TITLE, MeadowIntro } from "@/app/seo";
import { Meadow } from "@/components/meadow/Meadow";

export const metadata: Metadata = {
  title: MEADOW_TITLE,
  description: MEADOW_DESCRIPTION,
  alternates: { canonical: "/meadow" },
};

export default function MeadowPage() {
  return (
    <>
      <Meadow />
      <MeadowIntro />
    </>
  );
}
