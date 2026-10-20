// The shared Meadow's plot table: how plot indexes map to rings, innermost first, and to the lotus pockets in the river.
// The server hands plot indexes out in planting order (the lowest free index, so the inner rings fill first and a
// removed test plant's plot is reused), and the Meadow draws plot i on ring plotRing(i).ring at slot plotRing(i).slot,
// or, for a pocket, at pocketPlace(i). Both sides read this one table, so they always agree.
//
// Pure constants with no server imports: safe to import from client components. The Meadow owns the geometry: radii and
// the angle rule may change freely, but plot order must stay inner rings first, because a stored plot_index never moves.
//
// The angle rule. Rings come in pairs, the two rows of one raised bed, and avenues cut across the beds from the rose
// dais outward: four through the inner bed (on the diagonals, so one runs straight toward the Meadow's camera) and
// eight through every bed beyond it. A ring's plots are shared evenly among the arcs between its avenues, with
// AVENUE_GAP metres kept clear round each avenue, and a ring fills evenly all the way round: the first plant of a
// ring goes in the middle of one arc, the next in the middle of the opposite arc, and so on, so a ring that is a
// quarter planted looks evenly sown rather than a crescent.
//
// Capacity is elastic. The six planned rings (PLOT_CAPACITY, 360 plots) seat about 300 colleagues; past them the
// Meadow keeps growing outward with rings that continue the same rhythm (ringAt), up to MAX_RINGS as a backstop
// against a runaway script, so a second device or an in-app browser that plants again never meets a "Meadow full"
// wall. The Meadow should size its ground to the outermost ring in use, not to PLOT_CAPACITY.
//
// The river (the Rose Island moat). A slow ring of water runs between the inner bed and bed 1, between RIVER_WALLS,
// so the rose, its dais, the inner path and bed 0 stand on an island; beds 1 and 2 lie beyond it. A lotus is planted
// in the river: 56 pockets line its walls (6 a quarter on the inner bank, 8 on the outer, one every POCKET_PITCH
// metres, centred between the four bridges on the diagonals), numbered WATER_BASE + k in sowing order k, a range of
// their own clear of every bed plot. A lotus takes the lowest free pocket; once all 56 are taken it takes the lowest
// free bed plot like any seed, and the Meadow stands it in a brass urli there. Every other seed ignores the pockets.
// The pocket count and sowing order lock when the first real lotus is planted (planting opened on 20 Oct): after that more
// pockets may only be appended (new indexes after the last, existing angles untouched). Radii and angles are never
// stored, so they may still move.

export interface PlotRing {
  /** ring radius from the rose dais at the origin, metres */
  readonly radius: number;
  /** plots on this ring */
  readonly count: number;
}

/**
 * The planned rings, inner to outer: 360 plots for about 300 colleagues, with room for late planters. Beds 1 and 2
 * stand beyond the river (RIVER_WALLS) and its two towpaths.
 */
export const PLOT_RINGS: readonly PlotRing[] = Object.freeze([
  Object.freeze({ radius: 8.3, count: 32 }),
  Object.freeze({ radius: 10.7, count: 40 }),
  Object.freeze({ radius: 22.6, count: 56 }),
  Object.freeze({ radius: 25.0, count: 64 }),
  Object.freeze({ radius: 29.3, count: 80 }),
  Object.freeze({ radius: 31.7, count: 88 }),
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

/** Metres of arc kept clear of plants round each avenue, at the plant row: the avenue itself and a margin each side. */
export const AVENUE_GAP = 3.5;

const QUARTER = Math.PI / 4;
const INNER_AVENUES: readonly number[] = Object.freeze([1, 3, 5, 7].map((k) => k * QUARTER));
const OUTER_AVENUES: readonly number[] = Object.freeze([0, 1, 2, 3, 4, 5, 6, 7].map((k) => k * QUARTER));

/** The bed (0 = innermost) that ring r belongs to: two rings to a bed. */
export const bedOfRing = (ring: number): number => Math.floor(ring / 2);

/** The polar angles (radians, ascending in [0, 2pi)) of the avenues that cross bed b. */
export function avenueAngles(bed: number): readonly number[] {
  return bed === 0 ? INNER_AVENUES : OUTER_AVENUES;
}

/** The order the arcs of a ring are sown in: each next arc as far as can be from those already begun. */
const ARC_ORDER: Readonly<Record<number, readonly number[]>> = { 4: [0, 2, 1, 3], 8: [0, 4, 2, 6, 1, 5, 3, 7] };

const spreadCache = new Map<number, readonly number[]>();
/**
 * The order the m places along one arc are filled in: each next place as far as can be from the places already
 * taken and from the arc's two ends (ties go to the lower place), so the first lands in the middle.
 */
function spreadOrder(m: number): readonly number[] {
  const known = spreadCache.get(m);
  if (known) return known;
  const taken: number[] = [];
  const free = new Set(Array.from({ length: m }, (_, i) => i));
  while (free.size > 0) {
    let best = -1;
    let bestD = -1;
    for (const p of free) {
      let d = Math.min(p + 1, m - p);
      for (const t of taken) d = Math.min(d, Math.abs(p - t));
      if (d > bestD) {
        bestD = d;
        best = p;
      }
    }
    taken.push(best);
    free.delete(best);
  }
  const order = Object.freeze(taken);
  spreadCache.set(m, order);
  return order;
}

export interface PlotPlace {
  index: number;
  ring: number;
  slot: number;
  radius: number;
  /** polar angle in radians, in [0, 2pi): never inside an avenue (see the header) */
  angle: number;
  /** which arc between two avenues the plot is in (0 starts at the ring's first avenue), and its place along it */
  arc: number;
  place: number;
}

/** Where plot `index` sits, or null outside 0 .. PLOT_LIMIT - 1. */
export function plotRing(index: number): PlotPlace | null {
  if (!Number.isInteger(index) || index < 0) return null;
  let first = 0;
  for (let ring = 0; ring < ALL_RINGS.length; ring++) {
    const { radius, count } = ALL_RINGS[ring];
    if (index < first + count) {
      const slot = index - first;
      const avenues = avenueAngles(bedOfRing(ring));
      const arcs = avenues.length;
      const perArc = count / arcs;
      const arc = ARC_ORDER[arcs][slot % arcs];
      const place = spreadOrder(perArc)[Math.floor(slot / arcs)];
      const from = avenues[arc];
      const to = arc + 1 < arcs ? avenues[arc + 1] : avenues[0] + Math.PI * 2;
      const clear = AVENUE_GAP / 2 / radius;
      const angle = (from + clear + ((place + 0.5) / perArc) * (to - from - 2 * clear)) % (Math.PI * 2);
      return { index, ring, slot, radius, angle, arc, place };
    }
    first += count;
  }
  return null;
}

/** How many rings the Meadow should draw for plots up to `highestIndex`: the planned six at least, then whole beds. */
export function ringsToDraw(highestIndex: number): number {
  const p = highestIndex >= 0 ? plotRing(highestIndex) : null;
  const used = p ? p.ring + 1 : 0;
  return Math.min(MAX_RINGS, Math.max(PLOT_RINGS.length, used + (used % 2)));
}

/** The first plot index of ring r (the sum of the counts of the rings inside it). */
export function firstPlotOfRing(ring: number): number {
  let first = 0;
  for (let r = 0; r < ring && r < ALL_RINGS.length; r++) first += ALL_RINGS[r].count;
  return first;
}

// ---- the river's pockets -------------------------------------------------------------------------------------------

/**
 * The river's two walls (its water's edges), metres from the rose. The island's towpath runs inside the inner one, the
 * outer towpath outside the outer one, a granite coping on each (components/meadow/river.ts draws the river from these).
 */
export const RIVER_WALLS = Object.freeze({ inner: 14.4, outer: 18.9 } as const);

/** Pocket plot indexes start here: past PLOT_LIMIT, so a pocket is never a bed plot. */
export const WATER_BASE = 2000;
/** Pockets on each bank between two neighbouring bridges. */
export const POCKETS_PER_QUARTER = Object.freeze({ in: 6, out: 8 } as const);
/** Metres between neighbouring pockets along a bank, measured on the line the lotus stand on. */
export const POCKET_PITCH = 2.7;
/** How far out from its wall a pocket's lotus stands, metres (the pocket reaches 1.1 m out). */
export const POCKET_LOTUS_OUT = 0.55;
/** Every pocket in the river. */
export const POCKET_COUNT = 4 * (POCKETS_PER_QUARTER.in + POCKETS_PER_QUARTER.out);

export type PocketBank = "in" | "out";

/**
 * The banks in sowing order: the inner bank's 24 first (reached from the island without a bridge, as the cart starts
 * there, and filled like the beds, inside first), then the outer bank's 32. (The design drawing's alternative, the banks
 * interleaved 3 to 4, is ["in", "out", "in", "out", "in", "out", "out"]: the pattern is read with k % its length.)
 */
const BANK_PATTERN: readonly PocketBank[] = Object.freeze([
  ...Array.from({ length: 4 * POCKETS_PER_QUARTER.in }, (): PocketBank => "in"),
  ...Array.from({ length: 4 * POCKETS_PER_QUARTER.out }, (): PocketBank => "out"),
]);

export interface PocketPlace {
  index: number;
  /** sowing order: 0 is the first pocket a lotus takes */
  order: number;
  bank: PocketBank;
  /** the quarter between two bridges (0 is centred on pi/2, between the pi/4 and 3pi/4 bridges) and the place along it */
  arc: number;
  place: number;
  /** where the lotus stands: the radius of its line, POCKET_LOTUS_OUT off its wall, and its polar angle in [0, 2pi) */
  radius: number;
  angle: number;
}

/** Where the lotus of the pocket at `place` along quarter `arc` of `bank` stands (the Meadow's river reads it too). */
export function pocketSpot(bank: PocketBank, arc: number, place: number): { radius: number; angle: number } {
  const n = POCKETS_PER_QUARTER[bank];
  const radius = bank === "in" ? RIVER_WALLS.inner + POCKET_LOTUS_OUT : RIVER_WALLS.outer - POCKET_LOTUS_OUT;
  const mid = INNER_AVENUES[arc] + QUARTER;
  const angle = (mid + ((place - (n - 1) / 2) * POCKET_PITCH) / radius + Math.PI * 2) % (Math.PI * 2);
  return { radius, angle };
}

// Within a bank, the bed rings' own rule: quarters 0, 2, 1, 3 in turn, the places along each spread from the middle.
const POCKETS: readonly PocketPlace[] = (() => {
  const seen: Record<PocketBank, number> = { in: 0, out: 0 };
  const out: PocketPlace[] = [];
  for (let k = 0; k < POCKET_COUNT; k++) {
    const bank = BANK_PATTERN[k % BANK_PATTERN.length];
    const s = seen[bank]++;
    const arc = ARC_ORDER[4][s % 4];
    const place = spreadOrder(POCKETS_PER_QUARTER[bank])[Math.floor(s / 4)];
    out.push(Object.freeze({ index: WATER_BASE + k, order: k, bank, arc, place, ...pocketSpot(bank, arc, place) }));
  }
  return Object.freeze(out);
})();

export const isBedIndex = (i: number): boolean => Number.isInteger(i) && i >= 0 && i < PLOT_LIMIT;
export const isPocketIndex = (i: number): boolean => Number.isInteger(i) && i >= WATER_BASE && i < WATER_BASE + POCKET_COUNT;
/** Any plot of the Meadow: a bed plot or a pocket. */
export const isPlotIndex = (i: number): boolean => isBedIndex(i) || isPocketIndex(i);
/** What kind of plot an index is, or null when it is no plot at all. */
export function plotKindOf(i: number): "bed" | "pocket" | null {
  return isBedIndex(i) ? "bed" : isPocketIndex(i) ? "pocket" : null;
}

/** Where pocket `index` is, or null when it is not a pocket. */
export function pocketPlace(index: number): PocketPlace | null {
  return isPocketIndex(index) ? POCKETS[index - WATER_BASE] : null;
}

// ---- handing plots out ---------------------------------------------------------------------------------------------

export interface AssignOptions {
  /** "inner" (the default): the lowest free plot. "outer": a rehearsal plant, kept to the far end of the planned rings. */
  from?: "inner" | "outer";
  /** bed plot indexes run 0 .. limit - 1 (PLOT_LIMIT by default) */
  limit?: number;
  /** the planned plots, PLOT_CAPACITY by default: where "outer" starts looking, from the top down */
  planned?: number;
  /** a lotus: a pocket in the river first (the lowest free one, or for a rehearsal the highest), a bed plot after */
  water?: boolean;
}

/**
 * The plot a new plant gets: the lowest free index, so the inner rings fill first and the Meadow grows outward ring by
 * ring past the planned ones; or, for a rehearsal plant, the highest free index of the planned rings, so rehearsals never
 * leave holes where colleagues plant on the day (falling back to the lowest free index when those are all taken). A
 * lotus (`water`) takes a pocket first in the same spirit, the lowest free one or a rehearsal's the highest, and with
 * every pocket taken a bed plot by the same rule as any seed. Pocket numbers in `taken` never decide a bed plot.
 * Returns null only when every plot up to the limit (and, for a lotus, every pocket) is taken.
 */
export function assignPlot(
  taken: Iterable<number>,
  { from = "inner", limit = PLOT_LIMIT, planned = PLOT_CAPACITY, water = false }: AssignOptions = {},
): number | null {
  const used = new Set<number>();
  for (const t of taken) used.add(t);
  if (water) {
    if (from === "outer") {
      for (let k = POCKET_COUNT - 1; k >= 0; k--) if (!used.has(WATER_BASE + k)) return WATER_BASE + k;
    } else {
      for (let k = 0; k < POCKET_COUNT; k++) if (!used.has(WATER_BASE + k)) return WATER_BASE + k;
    }
  }
  if (from === "outer") {
    for (let i = Math.min(planned, limit) - 1; i >= 0; i--) if (!used.has(i)) return i;
  }
  for (let i = 0; i < limit; i++) if (!used.has(i)) return i;
  return null;
}
