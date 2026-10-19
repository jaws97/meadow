import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  async redirects() {
    return [
      { source: "/", destination: "/garden", permanent: false },
      // The Lantern Cart's old test bed grew into the real Meadow. The query (e.g. ?mover=) carries over on its own.
      { source: "/meadow-spike", destination: "/meadow", permanent: true },
    ];
  },
  async headers() {
    return [
      // The garden's sounds (lib/sound/library) are named with a hash of their content (rain-light.afd05529.m4a), so a
      // changed file is a new name: a phone keeps each one for good and never fetches a bed it already has again. Only
      // the hashed names, so CREDITS.md beside them is not frozen.
      {
        source: "/garden/sounds/:file([a-z0-9-]+\\.[0-9a-f]{8}\\.m4a)",
        headers: [{ key: "Cache-Control", value: "public, max-age=31536000, immutable" }],
      },
    ];
  },
  /* config options here */
  cacheComponents: true,
  partialPrefetching: true,
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
