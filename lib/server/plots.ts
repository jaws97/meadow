// The shared Meadow's plot table: how plot indexes map to rings, innermost first. The server hands plot indexes out in
// planting order (the lowest free index, so the inner rings fill first and a removed test plant's plot is reused), and
// the Meadow draws plot i on ring plotRing(i).ring at slot plotRing(i).slot. Both sides read this one table, so they
// always agree.
//
// Pure constants with no server imports: safe to import from client components. The Meadow owns the geometry: radii and
// the angle rule may change freely (the first two rings match the spike's PLOT_ROWS), but plot order must stay inner
// rings first, because a stored plot_index never moves.
//
// Capacity is elastic. The six planned rings (PLOT_CAPACITY, 360 plots) seat about 300 colleagues; past them the
// Meadow keeps growing outward with rings that continue the same rhythm (ringAt), up to MAX_RINGS as a backstop
// against a runaway script, so a second device or an in-app browser that plants again never meets a "Meadow full"
// wall. The Meadow should size its ground to the outermost ring in use, not to PLOT_CAPACITY.

export interface PlotRing {
  /** ring radius from the rose dais at the origin, metres */
  readonly radius: number;
  /** plots on this ring */
  readonly count: number;
}

/** The planned rings, inner to outer: 360 plots for about 300 colleagues, with room for late planters. */
export const PLOT_RINGS: readonly PlotRing[] = Object.freeze([
  Object.freeze({ radius: 8.3, count: 32 }),
  Object.freeze({ radius: 10.7, count: 40 }),
  Object.freeze({ radius: 15.0, count: 56 }),
  Object.freeze({ radius: 17.4, count: 64 }),
  Object.freeze({ radius: 21.7, count: 80 }),
  Object.freeze({ radius: 24.1, count: 88 }),
]);

/** Plots on the planned rings. Rehearsal plants are kept to the outer end of this range. */
export const PLOT_CAPACITY: number = PLOT_RINGS.reduce((n, r) => n + r.count, 0);

/** Rings the Meadow may grow to (six planned, six more if needed): 1152 plots in all. */
export const MAX_RINGS = 12;

// Rings come in pairs: a wide path, then a narrow one. Going outward the gap alternates 2.4 m and 4.3 m and the plot
// count grows by 8 and 16, exactly as the planned rings do; worked in decimetres so radii stay exact to 0.1 m.
const ALL_RINGS: readonly PlotRing[] = (() => {
  const rings: PlotRing[] = [...PLOT_RINGS];
  while (rings.length < MAX_RINGS) {
    const i = rings.length - 1, prev = rings[i];
    const even = i % 2 === 0;
    rings.push(Object.freeze({ radius: (Math.round(prev.radius * 10) + (even ? 24 : 43)) / 10, count: prev.count + (even ? 8 : 16) }));
  }
  return Object.freeze(rings);
})();

/** The hard ceiling on plot indexes: every plot of every ring up to MAX_RINGS. */
export const PLOT_LIMIT: number = ALL_RINGS.reduce((n, r) => n + r.count, 0);

/** Ring r (0 = innermost), planned or grown, or null beyond MAX_RINGS. */
export function ringAt(r: number): PlotRing | null {
  return Number.isInteger(r) && r >= 0 && r < ALL_RINGS.length ? ALL_RINGS[r] : null;
}

export interface PlotPlace {
  index: number;
  ring: number;
  slot: number;
  radius: number;
  /** polar angle in radians, slots evenly spaced and offset by half a slot on alternate rings so rows interleave */
  angle: number;
}

/** Where plot `index` sits, or null outside 0 .. PLOT_LIMIT - 1. */
export function plotRing(index: number): PlotPlace | null {
  if (!Number.isInteger(index) || index < 0) return null;
  let first = 0;
  for (let ring = 0; ring < ALL_RINGS.length; ring++) {
    const { radius, count } = ALL_RINGS[ring];
    if (index < first + count) {
      const slot = index - first;
      const angle = ((slot + (ring % 2 ? 0.5 : 0)) / count) * Math.PI * 2;
      return { index, ring, slot, radius, angle };
    }
    first += count;
  }
  return null;
}

export interface AssignOptions {
  /** "inner" (the default): the lowest free plot. "outer": a rehearsal plant, kept to the far end of the planned rings. */
  from?: "inner" | "outer";
  /** plot indexes run 0 .. limit - 1 (PLOT_LIMIT by default) */
  limit?: number;
  /** the planned plots, PLOT_CAPACITY by default: where "outer" starts looking, from the top down */
  planned?: number;
}

/**
 * The plot a new plant gets: the lowest free index, so the inner rings fill first and the Meadow grows outward ring by
 * ring past the planned ones; or, for a rehearsal plant, the highest free index of the planned rings, so rehearsals never
 * leave holes where colleagues plant on the day (falling back to the lowest free index when those are all taken).
 * Returns null only when every plot up to the limit is taken.
 */
export function assignPlot(taken: Iterable<number>, { from = "inner", limit = PLOT_LIMIT, planned = PLOT_CAPACITY }: AssignOptions = {}): number | null {
  const used = new Set<number>();
  for (const t of taken) used.add(t);
  if (from === "outer") {
    for (let i = Math.min(planned, limit) - 1; i >= 0; i--) if (!used.has(i)) return i;
  }
  for (let i = 0; i < limit; i++) if (!used.has(i)) return i;
  return null;
}
