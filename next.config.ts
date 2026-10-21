import type { NextConfig } from "next";
import { OLD_HOST, PUBLIC_ORIGIN } from "./lib/origin";

/**
 * The pages the old address forwards to the new one. Its API, its scripts and its pictures stay served where they are,
 * so a page still open there keeps working, and old link previews keep their picture.
 */
const FORWARDED_PAGES = ["/", "/garden", "/meadow", "/meadow/garden", "/party"];
/** lib/server/session-rules SESSION_COOKIE: a device holding a garden on the old address (lib/origin.test.ts). */
const SESSION_COOKIE_NAME = "meadow_session";

const nextConfig: NextConfig = {
  async redirects() {
    return [
      // The garden's old address (until 21 Oct, lib/origin) forwards its pages to the new one, with the path and the
      // query (and a personal link's #k= key, which the browser carries across), for search engines and anyone arriving
      // fresh. A device that already holds a garden there stays, so its garden is never lost; its cards and the links it
      // shares point at the new address all the same.
      ...FORWARDED_PAGES.map((source) => ({
        source,
        has: [{ type: "host" as const, value: OLD_HOST }],
        missing: [{ type: "cookie" as const, key: SESSION_COOKIE_NAME }],
        destination: `${PUBLIC_ORIGIN}${source}`,
        permanent: true,
      })),
      // The root forwards to the garden, except for Google's site verifier, which looks for Search Console's tag
      // (app/layout.tsx) on the property's own home page; it gets the root's plain page, which carries the tag.
      {
        source: "/",
        missing: [{ type: "header" as const, key: "user-agent", value: ".*Google-Site-Verification.*" }],
        destination: "/garden",
        permanent: false,
      },
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
