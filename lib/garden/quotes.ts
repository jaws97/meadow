// The lines the opening's quote moment shows (lib/garden/opening, components/garden/OpeningMoment), one per opening and
// never swapped mid-read: Lijas's picks on nature, nourishment and patience, for someone arriving after a long day.
// Some are lines from Disney films and the rest are plain sayings; by Lijas's choice the quotes show alone, with no
// character or film names, as the app keeps film names off the public site.

export interface Quote {
  text: string;
  by?: string;
}

export const QUOTES: readonly Quote[] = Object.freeze([
  { text: "Even miracles take a little time." },
  { text: "Sometimes the right path is not the easiest one." },
  { text: "Look for a new angle." },
  { text: "The flower that blooms in adversity is the most rare and beautiful of all." },
  { text: "Everything you see exists together in a delicate balance." },
  { text: "If you are what you eat, then I only want to eat the good stuff." },
  { text: "Not all treasure is silver and gold, mate." },
  { text: "Roots grow in the dark. Give yourself time." },
  { text: "What you water, grows." },
  { text: "Rest is part of growing too." },
]);

/**
 * A shuffle of the quotes (by `random`, 0 <= r < 1) that never starts on the quote this device was shown last time;
 * an opening shows only its first entry, so two openings in a row never show the same quote.
 */
export function quoteOrder(count: number, last: number | null, random: () => number = Math.random): number[] {
  const order = Array.from({ length: count }, (_, i) => i);
  for (let i = count - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [order[i], order[j]] = [order[j], order[i]];
  }
  if (count > 1 && order[0] === last) order.push(order.shift()!);
  return order;
}
