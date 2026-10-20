import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
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

export const metadata: Metadata = {
  title: "Meadow",
  description: "A living garden for the Bangalore celebration",
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
