import { withBotId } from "botid/next/config";
import type { NextConfig } from "next";
import { MOVE_PAGES, OLD_HOST, PUBLIC_ORIGIN } from "./lib/origin";

/**
 * The pages the old address forwards to the new one. Its API, its scripts and its pictures stay served where they are,
 * so a page still open there keeps working, and old link previews keep their picture.
 */
const FORWARDED_PAGES = ["/", "/garden", "/meadow", "/meadow/garden", "/party"];
/** lib/server/session-rules SESSION_COOKIE: a device holding a garden on the old address (lib/origin.test.ts). */
const SESSION_COOKIE_NAME = "meadow_session";

/**
 * Sent with every page and API answer. No other site may show Meadow inside its own (frame-ancestors and the older
 * X-Frame-Options), so no page can lay an invisible garden under someone's tap on "Sign out other devices", a switch or
 * Google sign-in; the page's address may never be re-based, plugins never run, and forms post only here. A file is
 * read only as the type it is sent as; other sites learn the origin alone, never a page's path; a window this site opens
 * (or that opens it) shares nothing with it; and the browser features Meadow never uses stay off (fullscreen for the
 * party screen, the share sheet and the clipboard stay on).
 *
 * Which scripts may run is not limited here: Next.js's own inline scripts would need a fresh nonce on every request,
 * which would end the pages that are prepared ahead of time (cacheComponents) and touch the opening's first-paint
 * script (lib/garden/opening). A later step, after the party.
 */
const SECURITY_HEADERS = [
  { key: "Content-Security-Policy", value: "frame-ancestors 'none'; base-uri 'self'; object-src 'none'; form-action 'self'" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=(), payment=(), usb=(), serial=(), hid=(), bluetooth=(), midi=(), display-capture=()",
  },
];

const nextConfig: NextConfig = {
  async redirects() {
    return [
      // The garden's old address (until 21 Oct, lib/origin) forwards its pages to the new one, with the path and the
      // query (and a personal link's #k= key, which the browser carries across), for search engines and anyone arriving
      // fresh. A device that already holds a garden there is carried across with it instead: its garden pages go
      // through /api/move (lib/server/move.ts), which swaps the old address's cookie for a fresh personal link to the
      // new address's garden; its other pages stay served there until then.
      ...MOVE_PAGES.map((source) => ({
        source,
        has: [
          { type: "host" as const, value: OLD_HOST },
          { type: "cookie" as const, key: SESSION_COOKIE_NAME },
        ],
        destination: `/api/move?to=${encodeURIComponent(source)}`,
        permanent: false,
      })),
      ...FORWARDED_PAGES.map((source) => ({
        source,
        has: [{ type: "host" as const, value: OLD_HOST }],
        missing: [{ type: "cookie" as const, key: SESSION_COOKIE_NAME }],
        destination: `${PUBLIC_ORIGIN}${source}`,
        permanent: true,
      })),
      // The root is the welcome page (app/page.tsx), the site's readable front door for a search or a shared address.
      // A device that already holds a garden (the session cookie) goes straight from the root to its garden instead.
      {
        source: "/",
        has: [{ type: "cookie" as const, key: SESSION_COOKIE_NAME }],
        destination: "/garden",
        permanent: false,
      },
      // The Lantern Cart's old test bed grew into the real Meadow. The query (e.g. ?mover=) carries over on its own.
      { source: "/meadow-spike", destination: "/meadow", permanent: true },
    ];
  },
  async headers() {
    return [
      { source: "/:path*", headers: SECURITY_HEADERS },
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

// Vercel BotID (lib/server/bot.ts, instrumentation-client.ts): its challenge and its check are served from this site's
// own address through two rewrites, and its own frame there may be shown by this site alone (its header rule comes
// after SECURITY_HEADERS, so it wins on that path).
export default withBotId(nextConfig);
