// The coarse looks a growing plant is drawn in, shared by the Meadow's detail levels and the script that bakes their
// picture atlas (scripts/bake-meadow-plants.mjs), so a plant seen from across the rings and the same plant near the
// cart are always the same shape.
//
// A snapshot plant (stage and how open its flower is) falls into one of four bands: a seedling, a young leafy plant,
// a plant in bud, and a flower open. A flower closed for the night (or the day, for the night bloomers) is drawn as
// its bud, which at full size is the same closed flower in its parted sepals. Each band is posed once per species,
// from a seed whose plant is the most typical of its species (so the full plant drawn for a visit, from its owner's
// own seed, stands about as tall and holds its head about where the light plant did), at the middle of the band's
// growth. Each plot turns its plant to one of three angles (so neighbours of one species and stage still read as
// different plants) and leans it a touch toward the path, and the full plant drawn for a visit stands exactly the same
// way (plotTurn), so the visit's handover never turns the plant round. Health is laid on top of that per plant: a
// poorly plant leans further and its leaves pale (as the Meadow has always shown it); the plant being visited is drawn
// in full from the owner's own seed and numbers (VisitedPlant.tsx).
//
// The bake view is the Meadow camera's: it never turns (CameraRig's fixed bearing), so a picture of a plant taken
// from that bearing at a typical elevation is how the camera sees it.
import * as THREE from "three";
import type { MeadowPlot } from "@/lib/server/meadow";
import type { SpeciesId } from "@/lib/plant/species";

export type Band = "sprout" | "leafy" | "bud" | "bloom";
export const BANDS: readonly Band[] = ["sprout", "leafy", "bud", "bloom"];
/** The atlas rows, in order; a new species is appended last so the existing cells keep their places. */
export const LOD_SPECIES: readonly SpeciesId[] = ["rose", "sundrop", "magnolia", "marigold", "island", "jasmine", "lotus"];

/**
 * Growth and bloom each band is posed at (growth is lib/sim's Visual.growth: a sprout spans about 0.05 to 0.32, a
 * leafy plant to 0.68, a bud to 0.9; by the middle of the bud band the bud is full size). An open flower is drawn
 * fully open: how far it is open is too fine to read at a distance.
 */
export const BAND_LOOK: Record<Band, { growth: number; bloom: number }> = {
  sprout: { growth: 0.19, bloom: 0 },
  leafy: { growth: 0.5, bloom: 0 },
  bud: { growth: 0.79, bloom: 0 },
  bloom: { growth: 1, bloom: 1 },
};

/**
 * The seed each species' detail plants are posed from: of 500 seeds ("typical-0" to "typical-499"), the one whose
 * plant is nearest its species' median in head height, overall height, head offset, bud height and leafy height.
 */
export const LOD_SEEDS: Record<SpeciesId, string> = {
  rose: "typical-78",
  sundrop: "typical-264",
  magnolia: "typical-45",
  marigold: "typical-79",
  island: "typical-20",
  jasmine: "typical-2",
  // the lotus in its urli is posed from fixed leaf places (components/lotus/lod.ts), not from a seed: this names the
  // visit's plant in a made-up Meadow's &same=1 (lod/synthetic.ts), whose urli look is the same for every seed
  lotus: "typical-0",
};

/**
 * How far across a plant reaches at its widest, garden metres, where that is more than it stands tall: the lotus's
 * urli is wider than a sprouting lotus is high, so its levels are chosen by its width on screen (LodPlants.tsx), or its
 * picture would be stretched past its pixels before its light plant took over.
 */
export const LOD_REACH: Partial<Record<SpeciesId, number>> = { lotus: 0.39 };

/** The three angles a detail plant is turned to, radians about its stem. */
export const SPINS: readonly number[] = [0, (2 * Math.PI) / 3, (4 * Math.PI) / 3];

/** The angle (index into SPINS) the plant in plot `plot` is turned to, at every level and for its visit. */
export function plotSpin(plot: number): number {
  return Math.min(SPINS.length - 1, Math.floor(plotHash(plot, 1) * SPINS.length));
}

const UP = new THREE.Vector3(0, 1, 0);

/**
 * Which way the plant in plot `plot` (at angle `a` round the Meadow, on the `inner` or outer side of its bed) leans:
 * a touch toward the path, further when it is poorly. A unit vector, its stem's direction. An `upright` plant (the
 * lotus, whose urli stands level on the soil with its water) does not lean at all.
 */
export function plotTilt(plot: number, a: number, inner: boolean, poorly: boolean, out = new THREE.Vector3(), upright = false): THREE.Vector3 {
  if (upright) return out.set(0, 1, 0);
  const toward = inner ? -1 : 1;
  const px = Math.cos(a) * toward, pz = Math.sin(a) * toward;
  const lean = poorly ? 0.22 : 0.04 * plotHash(plot, 3);
  return out.set(px * Math.sin(lean) + plotHash(plot, 4) * 0.02, Math.cos(lean), pz * Math.sin(lean)).normalize();
}

/** How the plant in a plot stands: leaning (plotTilt), then turned to its angle (plotSpin) about its stem. */
export function plotTurn(plot: number, a: number, inner: boolean, poorly: boolean, out = new THREE.Quaternion(), upright = false): THREE.Quaternion {
  const spin = new THREE.Quaternion().setFromAxisAngle(UP, SPINS[plotSpin(plot)]);
  return out.setFromUnitVectors(UP, plotTilt(plot, a, inner, poorly, undefined, upright)).multiply(spin);
}

/** Whether a species' plant stands level whatever its health (plotTilt's `upright`): the lotus in its urli. */
export const standsUpright = (species: SpeciesId) => species === "lotus";

/** The Meadow camera's fixed bearing (CameraRig THETA) and the elevation the pictures are taken from, radians. */
export const VIEW_THETA = 0.25 * Math.PI;
export const BAKE_ELEVATION = 0.25 * Math.PI;

/** The band a snapshot plant is drawn in, or null for a seed or a resting plant (Plants.tsx draws those itself). */
export function bandOf(p: Pick<MeadowPlot, "stage" | "bloom">): Band | null {
  switch (p.stage) {
    case "sprout":
      return "sprout";
    case "leafy":
      return "leafy";
    case "bud":
      return "bud";
    case "bloom":
      // a closed flower (and a practice plant before 10 Nov, which has no bloom hour) is drawn as its bud
      return p.bloom > 0 ? "bloom" : "bud";
    default:
      return null;
  }
}

/** Index of a species, band and angle in the atlas (and in the detail meshes' table). */
export function cellIndex(species: SpeciesId, band: Band, spin: number): number {
  return (LOD_SPECIES.indexOf(species) * BANDS.length + BANDS.indexOf(band)) * SPINS.length + spin;
}

export const CELL_COUNT = LOD_SPECIES.length * BANDS.length * SPINS.length;

/** A stable pseudo-random number in [0, 1) for plot i and channel k (as Plants.tsx scatters its plants). */
export function plotHash(i: number, k: number): number {
  const x = Math.sin(i * 12.9898 + k * 78.233) * 43758.5453;
  return x - Math.floor(x);
}
