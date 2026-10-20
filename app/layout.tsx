import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { PUBLIC_ORIGIN } from "@/components/party/logic";
import { SafeAnalytics } from "./analytics";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

// The link preview every page shares: the picture is app/opengraph-image.jpg (with its alt text beside it), and the
// title and description are each page's own, because neither openGraph nor twitter names them here (Next fills both
// from the page's title and description). A page that sets its own openGraph would drop the picture, so pages set
// only title and description. No og:url on purpose: a personal garden link (/garden#k=...) must open as it was sent,
// never be swapped for a canonical address by a chat app. Nothing here reads the address, so no key, party code or
// name can reach a preview.
export const metadata: Metadata = {
  metadataBase: new URL(PUBLIC_ORIGIN),
  title: "Meadow",
  description: "A living garden for the Bangalore celebration",
  applicationName: "Meadow",
  openGraph: { type: "website", siteName: "Meadow", locale: "en_IN" },
  twitter: { card: "summary_large_image" },
};

// A full-screen dark canvas: match the browser chrome to it and let the
// fixed canvas run under phone notches instead of being letterboxed.
export const viewport: Viewport = {
  themeColor: "#06080f",
  colorScheme: "dark",
  viewportFit: "cover",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    // suppressHydrationWarning: the garden page's inline script marks the root
    // with the loading veil's first look before React hydrates
    // (lib/garden/opening's FIRST_LOOK_SCRIPT)
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
      suppressHydrationWarning
    >
      <body className="min-h-full">
        {children}
        {/* scrubs the garden link's key and the party code from every address it reports (app/analytics.tsx) */}
        <SafeAnalytics />
      </body>
    </html>
  );
}
