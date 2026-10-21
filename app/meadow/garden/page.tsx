// /meadow/garden?plot=N: a friend's garden, read-only, opened from "See their garden" on a visit card in the Meadow
// (?plot=rose is the owner's rose). The same garden scene as everyone's own /garden, showing that person's plant
// from GET /api/garden/[plot], with nothing to tend. The page is a server component for its metadata; the plot is
// read in the browser, so the shell stays static.
import type { Metadata } from "next";
import { FRIEND_DESCRIPTION, FRIEND_TITLE } from "@/app/seo";
import { FriendGardenView } from "@/components/meadow/FriendGarden";

// Kept out of search engines: each address is one person's garden. The preview stays general (no name, no plot), and
// speaks of love, since this is also where a bloom card's link opens for the person it was sent to.
export const metadata: Metadata = {
  title: FRIEND_TITLE,
  description: FRIEND_DESCRIPTION,
  robots: { index: false, follow: true },
};

export default function FriendGardenPage() {
  return <FriendGardenView />;
}
