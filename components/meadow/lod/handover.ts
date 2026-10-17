// The handover between the plant being visited, drawn in full from its owner's own seed (VisitedPlant.tsx, L0), and the
// same plant at its detail level (its light plant or its picture, LodPlants.tsx). When a card opens the full plant
// dissolves in over the plant the visitor just tapped, and when it closes it dissolves back out, the two sharing the
// plant's pixels (materials.ts) so the plant never cuts from one drawing to the other while it is being watched.
// VisitedPlant writes it every frame; LodPlants reads it. One plant at a time: a new visit's plant waits until the
// last one has handed back.

/** Seconds the full plant takes to dissolve in, or back out. */
export const HANDOVER_SECONDS = 0.5;

export const handover = {
  /** the plot being handed over (its full plant at least partly drawn), or -1 */
  plot: -1,
  /** the full plant's share of the plant's pixels: 0 all its detail level .. 1 all the full plant */
  share: 0,
  /** development only: holds the share here (0..1) instead of letting it run, for comparing the two drawings */
  pin: null as number | null,
};
