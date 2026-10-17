"use client";
// Vercel Web Analytics, with every reported address scrubbed before it leaves the browser: the URL fragment is
// dropped (a personal garden link carries its key there, /garden#k=..., and the garden page removes it as it loads;
// this is the second lock), and so is the party code from the QR link (?code=...), which analytics has no use for.
// The other query parameters are kept exactly as written. A client wrapper because the root layout is a server
// component and cannot hand <Analytics> a function.
import { Analytics, type BeforeSendEvent } from "@vercel/analytics/next";

function isCode(segment: string): boolean {
  const key = segment.split("=")[0];
  try {
    return decodeURIComponent(key) === "code";
  } catch {
    return key === "code";
  }
}

/** The address without its fragment and without ?code=. */
function scrubUrl(url: string): string {
  const base = url.split("#")[0];
  const q = base.indexOf("?");
  if (q < 0) return base;
  const kept = base.slice(q + 1).split("&").filter((s) => s !== "" && !isCode(s));
  return base.slice(0, q) + (kept.length > 0 ? `?${kept.join("&")}` : "");
}

const scrub = (event: BeforeSendEvent): BeforeSendEvent => ({ ...event, url: scrubUrl(event.url) });

export function SafeAnalytics() {
  return <Analytics beforeSend={scrub} />;
}
