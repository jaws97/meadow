// /meadow/garden?plot=N: a friend's garden, read-only, opened from "See their garden" on a visit card in the Meadow
// (?plot=rose is the owner's rose). The same garden scene as everyone's own /garden, showing that person's plant
// from GET /api/garden/[plot], with nothing to tend. The page is a server component for its metadata; the plot is
// read in the browser, so the shell stays static.
import type { Metadata } from "next";
import { FriendGardenView } from "@/components/meadow/FriendGarden";

export const metadata: Metadata = {
  title: "A friend's garden - Meadow",
  description: "A look at a friend's flower from the Meadow",
};

export default function FriendGardenPage() {
  return <FriendGardenView />;
}
