// /garden's metadata: the page itself is a client component (it needs WebGL and the address), so its title,
// description and canonical address live in this pass-through layout. The canonical is the bare /garden, so a party
// link (?code=...) that turns up somewhere public is indexed, if at all, as the plain garden; a personal link's key
// sits in the fragment (#k=...), which never reaches a server or a link preview. The preview picture is the root's
// (app/opengraph-image.jpg).
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Meadow",
  description:
    "Plant a seed, care for it in the real Bangalore weather, and watch it bloom in about two weeks, in a garden we share.",
  alternates: { canonical: "/garden" },
};

export default function GardenLayout({ children }: LayoutProps<"/garden">) {
  return children;
}
