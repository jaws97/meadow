// The swap gate. When one plant gives way to another behind the soft dim (lib/client/plant.ts swapTo), the dim lifts
// after a short moment for the new plant's materials to compile. A lotus's courtyard brings many new shaders at once, so
// whatever prepares the new scene (its code arriving, then compiling and pre-drawing it) hands that work to holdSwap();
// swapTo waits until every held promise has settled before letting the garden back. The dim never fades onto a scene
// that is still hidden or not there yet:
// - when swapSettled's timeout passes, whoever is still preparing out of sight hears it (onSwapOverdue) and shows
//   itself at once, settling its hold, and the dim lifts;
// - a hold nobody could answer (a courtyard whose code has not arrived, so nothing on screen is ready to be seen: the
//   scene waits in its Suspense boundary) keeps the dim down a while longer, LATE_MS at most, for it to arrive, mount
//   and show itself;
// - if even that runs out, the swap gives up: its listeners hear it again (gaveUp), and what arrives after that shows
//   itself as it mounts (product/stage clears the courtyard it was waiting for), never hidden with no dim over it.
// Framework-free.
const held = new Set<Promise<unknown>>();
const overdue = new Set<(gaveUp: boolean) => void>();

/**
 * How long past its timeout a swap keeps waiting for a hold nobody could answer (ms): a slow network's courtyard chunk
 * (the gift asks for it when the Lotus is chosen, so it is usually long in) or a development server compiling it, then
 * its mount and its own capped preparation. Generous on purpose: the dim, with the care card over it, is a calm wait,
 * and lifting it before the courtyard's code is in shows the scene as it was left (the last flower's frame) under the
 * lotus's card. A courtyard that has mounted answers within its own cap (LotusGarden PREPARE_MAX_MS), so this bounds
 * only a chunk that is very late, or never comes (a load that fails is let go sooner, by the scene).
 */
export const LATE_MS = 25000;

/** Keeps the dim down until p settles (or swapSettled gives up on it). A rejected p simply releases it. */
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

/**
 * Calls `cb` when a swap waits too long: once when its timeout passes (gaveUp false: whoever is preparing out of sight
 * shows itself now), and once more if a hold still keeps it when the late allowance runs out too (gaveUp true: the swap
 * stops waiting and the dim lifts). Returns the unsubscribe.
 */
export function onSwapOverdue(cb: (gaveUp: boolean) => void): () => void {
  overdue.add(cb);
  return () => {
    overdue.delete(cb);
  };
}

const tell = (gaveUp: boolean) => {
  for (const cb of [...overdue]) cb(gaveUp);
};

/**
 * Resolves once every held preparation has settled; at once when none is held. When timeoutMs passes first it tells
 * onSwapOverdue's listeners (a courtyard preparing out of sight shows itself and settles), and waits on for what could
 * not answer for up to lateMs more, then tells them it gave up and resolves.
 */
export function swapSettled(timeoutMs = 6000, lateMs = LATE_MS): Promise<void> {
  if (held.size === 0) return Promise.resolve();
  return new Promise<void>((resolve) => {
    let timer = setTimeout(() => {
      tell(false);
      timer = setTimeout(() => {
        tell(true);
        resolve();
      }, Math.max(0, lateMs));
    }, Math.max(0, timeoutMs));
    void Promise.allSettled([...held]).then(() => {
      clearTimeout(timer);
      resolve();
    });
  });
}
