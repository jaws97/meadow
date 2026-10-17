// /party: the big-screen mode for the celebration on 10 Nov, shown on the
// venue screen from a laptop: Lijas's Enchanted Rose garden with the gift
// panel and its QR code (components/party/PartyScreen). Open it as
// /party?code=<party code>; the code is read in the browser and never lives
// in the code base. The page itself is a server component so it can carry
// metadata and the panel's display face; everything below it is client-side,
// so the route prerenders as a static shell. Kept out of search engines: the
// QR link it shows is meant for the room.
import type { Metadata } from "next";
import { Cormorant_Garamond } from "next/font/google";
import { PartyScreen } from "@/components/party/PartyScreen";

const display = Cormorant_Garamond({
  variable: "--font-party-display",
  subsets: ["latin"],
  weight: ["500", "600"],
  style: ["normal", "italic"],
});

export const metadata: Metadata = {
  title: "Party screen - Disney Garden",
  description: "The celebration's big screen: the Enchanted Rose and the seed gift QR code",
  robots: { index: false, follow: false },
};

export default function PartyPage() {
  return <PartyScreen className={display.variable} />;
}
