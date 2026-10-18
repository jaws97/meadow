"use client";
// A quote under a loading veil's line, in the manner of a game's loading screen: one per opening, never the one
// this device opened on last time, and a second after a long wait (lib/garden/quotes). The veils are in the
// page's first HTML, so the quote is chosen on the client only: the server renders nothing and the quote fades
// in once the page has hydrated. CSS (VeilQuote.css) does the fade, so it never waits on the main thread.
import { useEffect, useState, useSyncExternalStore } from "react";
import { QUOTES, quoteOrder } from "@/lib/garden/quotes";
import "@/components/garden/VeilQuote.css";

/** How long a quote stays before the next fades in, while the veil is still up (ms). */
const QUOTE_MS = 8000;
const LAST_KEY = "garden:last-quote";

// One order per page load, shared by every veil on the page, so a veil that follows another goes on to the
// next quote instead of repeating the first.
let order: number[] | null = null;
let shown = 0;
function readOrder(): number[] {
  if (order) return order;
  let last: number | null = null;
  try {
    const v = window.localStorage.getItem(LAST_KEY);
    if (v !== null && Number.isInteger(Number(v))) last = Number(v);
  } catch {
    // storage blocked (private window): any first quote will do
  }
  order = quoteOrder(QUOTES.length, last);
  try {
    window.localStorage.setItem(LAST_KEY, String(order[0]));
  } catch {
    // nothing to remember then
  }
  return order;
}
const subscribeNever = () => () => {};
const serverOrder = () => null;

export function VeilQuote({ className }: { className?: string }) {
  const seq = useSyncExternalStore(subscribeNever, readOrder, serverOrder);
  const [step, setStep] = useState(() => shown);
  useEffect(() => {
    if (!seq) return;
    const id = window.setInterval(() => setStep((s) => s + 1), QUOTE_MS);
    return () => window.clearInterval(id);
  }, [seq]);
  useEffect(() => {
    shown = Math.max(shown, step + 1);
  }, [step]);
  if (!seq) return null;
  const q = QUOTES[seq[step % seq.length]];
  return (
    <figure key={step} className={`veil-quote${className ? ` ${className}` : ""}`}>
      <blockquote>{q.text}</blockquote>
      {q.by && <figcaption>{q.by}</figcaption>}
    </figure>
  );
}
