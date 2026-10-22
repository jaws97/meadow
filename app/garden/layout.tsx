// /garden's metadata: the page itself is a client component (it needs WebGL and the address), so its title,
// description and canonical address live in this layout, with the page's hidden heading and introduction and its
// structured data (app/seo.tsx), which a search engine reads where the canvas has no words. The canonical is the bare
// /garden, so a party link (?code=...) that turns up somewhere public is indexed, if at all, as the plain garden; a
// personal link's key sits in the fragment (#k=...), which never reaches a server or a link preview. The preview
// picture is the site's (app/opengraph-image.jpg).
import type { Metadata } from "next";
import { GARDEN_DESCRIPTION, GARDEN_TITLE, GardenIntro, SiteData } from "@/app/seo";

export const metadata: Metadata = {
  title: GARDEN_TITLE,
  description: GARDEN_DESCRIPTION,
  alternates: { canonical: "/garden" },
};

export default function GardenLayout({ children }: LayoutProps<"/garden">) {
  return (
    <>
      <GardenIntro />
      <SiteData />
      {children}
    </>
  );
}
