// robots.txt: the garden and the Meadow are open to search engines; the API and the development-only concept pages
// are not crawled. The private pages (/party, a friend's /meadow/garden) stay crawlable on purpose so a crawler can
// read their noindex tag; a page blocked here could still be listed by its address alone.
import type { MetadataRoute } from "next";
import { PUBLIC_ORIGIN } from "@/components/party/logic";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: ["/api/", "/cart-concepts", "/deer-concepts", "/lotus-concepts"],
    },
    sitemap: `${PUBLIC_ORIGIN}/sitemap.xml`,
  };
}
