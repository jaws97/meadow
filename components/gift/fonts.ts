// The display face for the gift flow's headings: Fraunces, a soft, warm serif with an optical-size axis, so large
// titles and small card names each get the right cut. Self-hosted by next/font at build time (no request leaves for
// Google) and swapped in when ready. Applied as the --font-display variable on the gift layers (gift.css).
import { Fraunces } from "next/font/google";

export const display = Fraunces({
  subsets: ["latin"],
  axes: ["SOFT", "opsz"],
  variable: "--font-display",
  display: "swap",
});
