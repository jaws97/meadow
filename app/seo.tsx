// What search engines and link previews read about the site, in one place, so the page titles, the descriptions, the
// words a screen reader hears before the garden and the structured data all say the same thing. The garden and the
// Meadow are WebGL canvases with no readable words of their own, so each public page also carries a short introduction,
// hidden from the eye (Tailwind's sr-only) but read by screen readers and search engines, and the garden page carries
// schema.org data naming the site and the free app. Calm and warm, like the garden: no film or company names, no
// owner's name, no health claims. Link previews (Open Graph, X) take each page's title and description (app/layout.tsx).
import { PUBLIC_ORIGIN } from "@/components/party/logic";

/** /garden: what everyone opens first (the party's QR link, a personal garden link, a search). */
export const GARDEN_TITLE = "Meadow · Grow a flower, gift your love";
export const GARDEN_DESCRIPTION =
  "Plant a seed and care for it in the real Bangalore weather. When it blooms, gift the flower you grew to someone you love, with a message in your own words.";

/** /meadow: everyone's flowers together. */
export const MEADOW_TITLE = "The Meadow · A shared garden of flowers grown with love";
export const MEADOW_DESCRIPTION =
  "Ride the lantern cart through everyone's flowers, growing together in the real Bangalore weather. Visit a friend's bloom and leave a sprinkle.";

/**
 * /meadow/garden: a friend's garden, and also where the link sent with a bloom card opens ("...I grew for you, in the
 * Meadow"), so its preview speaks of love, never of whose flower it is.
 */
export const FRIEND_TITLE = "A flower grown with love · Meadow";
export const FRIEND_DESCRIPTION = "Someone grew this flower day by day, through the real Bangalore weather. Come and see it in their garden.";

/** The garden page's heading and introduction: it has no heading of its own until the door opens. */
export function GardenIntro() {
  return (
    <header className="sr-only">
      <h1>Meadow: grow a flower, gift your love</h1>
      <p>
        Meadow is a living garden in your browser. Choose one of eight flowers, among them a rose, a lotus, night jasmine
        and marigold, plant its seed and look after it in the real Bangalore weather: with gentle care it blooms in about two
        weeks. Then gift the flower you grew to someone you love, as a picture card with a message in your own words and a
        link to see it growing in the Meadow, where everyone&apos;s flowers grow together.
      </p>
    </header>
  );
}

/** The Meadow's introduction, beside its own heading ("The Meadow", in its top bar). */
export function MeadowIntro() {
  return (
    <p className="sr-only">
      Every flower in the Meadow was planted by someone and grows in the real Bangalore weather, in rings round the
      Enchanted Rose. Ride the lantern cart along the paths, find a friend by name, visit their flower and leave it a
      sprinkle.
    </p>
  );
}

/** schema.org data for the garden page: the site's name, and a free web app to grow and gift a flower. */
export function GardenData() {
  const data = {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "WebSite",
        "@id": `${PUBLIC_ORIGIN}/#website`,
        url: `${PUBLIC_ORIGIN}/`,
        name: "Meadow",
        description: GARDEN_DESCRIPTION,
        inLanguage: "en-IN",
      },
      {
        "@type": "WebApplication",
        "@id": `${PUBLIC_ORIGIN}/garden#app`,
        url: `${PUBLIC_ORIGIN}/garden`,
        name: "Meadow",
        description: GARDEN_DESCRIPTION,
        image: `${PUBLIC_ORIGIN}/opengraph-image.jpg`,
        applicationCategory: "LifestyleApplication",
        operatingSystem: "Any",
        browserRequirements: "Requires WebGL",
        isAccessibleForFree: true,
        offers: { "@type": "Offer", price: "0", priceCurrency: "INR" },
        inLanguage: "en-IN",
        isPartOf: { "@id": `${PUBLIC_ORIGIN}/#website` },
      },
    ],
  };
  // JSON.stringify leaves "<" as it is; escaped, no text in the data can close the script tag (Next's JSON-LD guide)
  return <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(data).replace(/</g, "\\u003c") }} />;
}
