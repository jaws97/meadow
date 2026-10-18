// The courtyard's code, asked for ahead of need. A lotus's courtyard is a chunk of its own (components/garden/Scene.tsx
// loads it lazily), so a soil flower's garden never downloads it. The gift flow asks for it the moment the Lotus is
// chosen, so by the time "Go to my garden" swaps the owner's rose for the courtyard behind the soft dim, the chunk has
// arrived (or, on a development server, compiled) and the dim never lifts on the rose with a lotus's care card over it.
// The garden page asks for it as it loads when this device last showed a lotus (the remembered look), so a returning
// owner's courtyard is on its way while the canvas's own chunk still loads. Tiny on purpose: importing this pulls in
// nothing but the split point.
import type { SpeciesId } from "@/lib/plant/species";

export const loadCourtyard = () => import("@/components/lotus/product/LotusGarden");

/** Asks for the courtyard's chunk ahead of need; a failure is left for the scene's own load to meet (and retry). */
export function preloadCourtyard(): void {
  loadCourtyard().catch(() => {});
}

/** lib/client/plant's remembered look and the lotus's id, typed against them rather than imported (they stay tiny). */
const LOOK_KEY: (typeof import("@/lib/client/plant"))["LOOK_KEY"] = "garden-plant:v1";
const LOTUS: SpeciesId = "lotus";

/** When this device last showed a lotus (lib/client/plant's remembered look), its courtyard starts on its way now. */
export function preloadRememberedCourtyard(): void {
  try {
    const raw = window.localStorage.getItem(LOOK_KEY);
    if (raw && (JSON.parse(raw) as { speciesId?: unknown } | null)?.speciesId === LOTUS) preloadCourtyard();
  } catch {
    // a convenience only: the courtyard then loads when the store names it
  }
}
