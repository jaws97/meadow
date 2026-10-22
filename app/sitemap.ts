// sitemap.xml: the three public pages, the welcome page (the site's readable front door), the garden (the rose in
// bloom, and the seed gift) and the shared Meadow. The party screen, friends' gardens, the concept pages and the API
// are left out.
import type { MetadataRoute } from "next";
import { PUBLIC_ORIGIN } from "@/components/party/logic";

export default function sitemap(): MetadataRoute.Sitemap {
  return [
    { url: `${PUBLIC_ORIGIN}/`, changeFrequency: "weekly", priority: 1 },
    { url: `${PUBLIC_ORIGIN}/garden`, changeFrequency: "daily", priority: 0.9 },
    { url: `${PUBLIC_ORIGIN}/meadow`, changeFrequency: "daily", priority: 0.8 },
  ];
}
