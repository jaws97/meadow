// Where the doe stands in the garden for a screen's shape and the flower's height, so the garden's own camera shows
// her whole, in the open, clear of the lantern's post and lamp, the bloom, the hedges and the page's cards. The garden
// camera's settled framing changes with both (components/garden/CameraRig: a young plant is framed close and from
// above, which leaves no lawn in view behind it; a tall bloom is framed from further back, which opens up the back of
// the garden), so the stations were found by projecting her outline, grazing and standing, through that framing for
// each screen shape and flower height, with the camera's idle drift either way. Where none fits she does not come.
//
// Pure, and free of three.js: the garden page decides the visit with it at load (lib/garden/visitor), before her
// chunk is asked for.
import { heroStemFraction } from "@/components/garden/garden/heroGrowth";
import { SPECIES, type SpeciesId } from "@/lib/plant/species";

/**
 * - back: on the back lawn left of the bed, side-on against the dark hedge (her first composition);
 * - backLeft, backNear: a little further left, or nearer, where a shorter bloom's framing leaves less of the back;
 * - lawn: on the lawn left of the lantern, three-quarters toward the viewer, nearer and larger;
 * - portrait: a tall screen's, just inside its left edge, three-quarters toward the viewer.
 */
export type DeerStation = "back" | "backLeft" | "backNear" | "lawn" | "portrait";

/** The screen shapes the garden's camera frames differently (lib/garden/layout's framings, by aspect). */
export type ScreenShape = "wide" | "laptop" | "tabletLandscape" | "square" | "tabletPortrait" | "phone";

export function screenShape(aspect: number): ScreenShape {
  if (aspect >= 1.7) return "wide";
  if (aspect >= 1.45) return "laptop";
  if (aspect >= 1.2) return "tabletLandscape";
  if (aspect >= 0.8) return "square";
  if (aspect >= 0.6) return "tabletPortrait";
  return "phone";
}

/** The flower's head above the mulch (m), roughly: its cane's share of the species' full height. */
export function headHeight(speciesId: SpeciesId, growth: number): number {
  return heroStemFraction(growth) * SPECIES[speciesId].stem.height;
}

/** From the lowest head each station needs: the first whose floor the head clears, below its ceiling. */
const BANDS: Record<ScreenShape, readonly (readonly [from: number, to: number, station: DeerStation])[]> = {
  wide: [
    [0.95, Infinity, "back"],
    [0.85, 0.95, "backLeft"],
    [0.8, 0.85, "backNear"],
    [0.6, 0.8, "lawn"],
  ],
  laptop: [
    [1.0, Infinity, "back"],
    [0.95, 1.0, "backLeft"],
    [0.9, 0.95, "backNear"],
    [0.65, 0.9, "lawn"],
  ],
  tabletLandscape: [
    [1.15, Infinity, "back"],
    [0.9, 1.15, "lawn"],
  ],
  // between the landscape and portrait framings: not mapped, so she does not come
  square: [],
  tabletPortrait: [[0.7, 1.15, "portrait"]],
  // above a metre the lamp touches her back: a lantern in front of a deer, which reads as depth
  phone: [[0.9, 1.2, "portrait"]],
};

/**
 * Whether the station needs the day's light. At night the garden is lit by its lantern: on a wide screen she stands in
 * its light, side-on, and reads; a tall screen's station is behind the lamp from the camera, in its glare, and she is
 * lost. The sun's height (radians) below which a station that needs the day is dark: the end of civil dusk.
 */
export const DUSK_ALTITUDE = (-6 * Math.PI) / 180;
export const needsDaylight = (station: DeerStation): boolean => station === "portrait";

/** Where she stands for this screen and flower, or null: nowhere is clean, and she does not come. */
export function stationFor(aspect: number, head: number): DeerStation | null {
  for (const [from, to, station] of BANDS[screenShape(aspect)]) if (head >= from && head < to) return station;
  return null;
}
