// A still of the garden laid over the live canvas while a tier change swaps
// the scene behind it (a tier prepared out of sight, TierLayers.tsx, or one
// rebuilt in place where it cannot be), then dissolved into the new tier.
// Once the garden has been revealed it never goes back behind the loading
// veil: a change of tier (the governor's, after a sustained drop, or one
// picked in the development panel) holds the last frame instead, so the
// garden simply pauses for a moment and eases into its new look. A change of pixel ratio
// on a showing canvas (the garden's budget, the Meadow's calm step-down) is
// held the same way, briefly: resizing clears the drawing buffer, which on
// screen is a blink of the whole picture.
//
// The still must be copied in the same task that drew the frame: the canvas
// is created without preserveDrawingBuffer, so once the browser has
// composited the frame its drawing buffer reads back blank. The governor
// copies it from the frame loop, straight after the composer has drawn.
let still: HTMLCanvasElement | null = null;
let fadeTimer = 0;

/**
 * A resize behind the still: it stays until this many frames have been drawn
 * at the new size (or this long has passed), then dissolves over the last.
 */
export const RESIZE_HOLD = { frames: 3, maxMs: 1500, dissolveMs: 450 } as const;

/** Copies the frame just drawn onto a canvas over the live one. False when there is nothing to hold it in. */
export function holdFrame(source: HTMLCanvasElement): boolean {
  const host = source.parentElement?.parentElement ?? source.parentElement;
  if (!host || source.width === 0 || source.height === 0) return false;
  window.clearTimeout(fadeTimer);
  const c = still ?? document.createElement("canvas");
  still = c;
  c.width = source.width;
  c.height = source.height;
  c.setAttribute("aria-hidden", "true");
  Object.assign(c.style, {
    position: "absolute",
    inset: "0",
    width: "100%",
    height: "100%",
    pointerEvents: "none",
    transition: "none",
    opacity: "1",
    zIndex: "1",
  });
  const ctx = c.getContext("2d");
  if (!ctx) return false;
  ctx.drawImage(source, 0, 0);
  if (c.parentElement !== host) host.appendChild(c);
  return true;
}

export function isHolding(): boolean {
  return still !== null && still.isConnected && still.style.opacity !== "0";
}

/** Dissolves the held still into the live canvas behind it, then removes it. */
export function releaseFrame(ms: number) {
  const c = still;
  if (!c) return;
  c.style.transition = `opacity ${ms}ms cubic-bezier(0.4, 0, 0.2, 1)`;
  // A frame later, so the transition starts from the opaque still.
  requestAnimationFrame(() => {
    c.style.opacity = "0";
  });
  window.clearTimeout(fadeTimer);
  fadeTimer = window.setTimeout(() => {
    if (still === c) still = null;
    c.remove();
  }, ms + 80);
}
