// The live site's address: where the party's QR code, the bloom cards and their links, the canonical addresses, the
// sitemap and the structured data point, whatever host serves a page. growmyflower.vercel.app since 21 Oct; the old
// address, meadow-phi.vercel.app, forwards its pages here (next.config.ts). Free of imports, so next.config.ts can read it.
export const PUBLIC_ORIGIN = "https://growmyflower.vercel.app";

/**
 * The address the garden had until 21 Oct: its pages forward to PUBLIC_ORIGIN, and a device that holds a garden there
 * is carried across with it (lib/server/move.ts).
 */
export const OLD_HOST = "meadow-phi.vercel.app";

/** The old address's pages that carry a garden across: the garden and the root that forwards to it. */
export const MOVE_PAGES: readonly string[] = ["/", "/garden"];
