// The lines the loading veils show while a garden wakes, one per opening and a second if the wait runs long
// (components/garden/VeilQuote). They are Lijas's own picks, motivational lines for the wait.
// A name is shown only where the source is certain: many of these sayings travel without a reliable author,
// and a guessed name is worse than none.

export interface Quote {
  text: string;
  by?: string;
}

export const QUOTES: readonly Quote[] = Object.freeze([
  { text: "The obsessed will always outwork the talented." },
  { text: "An idiot in motion will beat a genius at rest." },
  { text: "You already know what to do. You're just negotiating with comfort." },
  { text: "Don't chase the butterflies, make the garden beautiful." },
  { text: "If you're going through hell, keep going." },
  { text: "Not all treasure is silver and gold, mate.", by: "Captain Jack Sparrow" },
  { text: "Don't tell me the sky's the limit when there are footprints on the moon." },
]);

/**
 * The order this opening shows quotes in: a shuffle (by `random`, 0 <= r < 1) that never starts on the quote the
 * device saw first last time, so two openings in a row never begin the same way.
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
