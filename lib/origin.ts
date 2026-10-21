// The live site's address: where the party's QR code, the bloom cards and their links, the canonical addresses, the
// sitemap and the structured data point, whatever host serves a page. growmyflower.vercel.app since 21 Oct; the old
// address, meadow-phi.vercel.app, forwards its pages here (next.config.ts). Free of imports, so next.config.ts can read it.
export const PUBLIC_ORIGIN = "https://growmyflower.vercel.app";

/** The address the garden had until 21 Oct: its pages forward to PUBLIC_ORIGIN, but for a device that holds a garden there. */
export const OLD_HOST = "meadow-phi.vercel.app";
