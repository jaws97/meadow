// The web app manifest: the name, the night-blue colours and the rose-bud icons a phone uses when someone adds the
// garden to their home screen. display "browser" on purpose: an iPhone opens a "standalone" home-screen app with its
// own storage, apart from Safari's, so it would not know the garden this device already holds; in the browser it
// opens straight into that garden. The PNGs in public/icons are drawn from app/icon.svg.
import type { MetadataRoute } from "next";
import { GARDEN_DESCRIPTION } from "./seo";

export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/garden",
    name: "Meadow",
    short_name: "Meadow",
    description: GARDEN_DESCRIPTION,
    start_url: "/garden",
    scope: "/",
    display: "browser",
    background_color: "#06080f",
    theme_color: "#06080f",
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
      { src: "/icons/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
