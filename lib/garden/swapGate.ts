// The swap gate. When one plant gives way to another behind the soft dim (lib/client/plant.ts swapTo), the dim lifts
// after a short moment for the new plant's materials to compile. A lotus's courtyard brings many new shaders at once, so
// whatever prepares the new scene (compiling and pre-drawing it) hands that work to holdSwap(); swapTo waits until every
// held promise has settled, never longer than its timeout, before letting the garden back. When the timeout wins, the
// dim is about to lift whatever is ready, so whoever is still preparing out of sight hears it (onSwapOverdue) and shows
// itself: the dim never fades onto a scene that is still hidden. Framework-free.
const held = new Set<Promise<unknown>>();
const overdue = new Set<() => void>();

/** Keeps the dim down until p settles (or swapSettled's timeout passes). A rejected p simply releases it. */
export function holdSwap(p: Promise<void>): void {
  held.add(p);
  const release = () => {
    held.delete(p);
  };
  p.then(release, release);
}

/** How many preparations are holding the swap right now. */
export function swapHolds(): number {
  return held.size;
}

/** Calls `cb` when a swap stops waiting for what still holds it (its timeout passed); returns the unsubscribe. */
export function onSwapOverdue(cb: () => void): () => void {
  overdue.add(cb);
  return () => {
    overdue.delete(cb);
  };
}

/**
 * Resolves once every held preparation has settled, or after timeoutMs, whichever is first (then telling onSwapOverdue's
 * listeners first); at once when none is held.
 */
export function swapSettled(timeoutMs = 6000): Promise<void> {
  if (held.size === 0) return Promise.resolve();
  return new Promise<void>((resolve) => {
    const timer = setTimeout(() => {
      for (const cb of [...overdue]) cb();
      resolve();
    }, Math.max(0, timeoutMs));
    void Promise.allSettled([...held]).then(() => {
      clearTimeout(timer);
      resolve();
    });
  });
}
