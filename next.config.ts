import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  async redirects() {
    return [
      { source: "/", destination: "/garden", permanent: false },
      // The Lantern Cart's old test bed grew into the real Meadow. The query (e.g. ?mover=) carries over on its own.
      { source: "/meadow-spike", destination: "/meadow", permanent: true },
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
