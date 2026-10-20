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
//
// A lotus is drawn as one of two kinds: in its brass urli on a bed plot (the "lotus" row), or standing in a river pocket
// ("lotusRiver", the ninth row: the pond view's plant on its pocket-length stalks, no urli and no floating leaves, which
// lie on the water as Plants.tsx's pads at every distance). A pocket's plant has no light plant or picture as a sprout
// (a floating-leaf plant is all pads), and stands turned to whichever of the three angles is nearest to facing its open
// channel (pocketSpin), so its light plant, its picture and its visit all stand the same way, its back to the wall.
import * as THREE from "three";
import type { Plot } from "@/components/meadow/layout";
import type { MeadowPlot } from "@/lib/server/meadow";
import type { SpeciesId } from "@/lib/plant/species";

export type Band = "sprout" | "leafy" | "bud" | "bloom";
export const BANDS: readonly Band[] = ["sprout", "leafy", "bud", "bloom"];
/** The species with detail levels, in the atlas's row order: the seed picker's (components/gift/species.ts SEED_ORDER). */
export const LOD_SPECIES: readonly SpeciesId[] = ["rose", "sundrop", "magnolia", "marigold", "island", "jasmine", "lily", "lotus"];
/** What a detail plant is drawn as: a species (the lotus in its urli), or the lotus standing in a river pocket. */
export type LodKind = SpeciesId | "lotusRiver";
/**
 * The atlas rows, in order: the species, then the lotus in a river pocket. A new seed takes its place in the picker's
 * order (the Pink Lily before the lotus) and moves the rows after it down, so the atlas is re-baked whole with it.
 */
export const LOD_KINDS: readonly LodKind[] = [...LOD_SPECIES, "lotusRiver"];

/** The kind a plant of `species` is drawn as (a lotus in a river pocket stands in the water, not in its urli). */
export function lodKindOf(species: SpeciesId, pocket: boolean): LodKind {
  return species === "lotus" && pocket ? "lotusRiver" : species;
}

/** The species whose flowers (and their glow) a kind draws. */
export const speciesOfKind = (kind: LodKind): SpeciesId => (kind === "lotusRiver" ? "lotus" : kind);

/** Whether a kind has a light plant and a picture in a band (a pocket's floating-leaf sprout has neither). */
export const hasLight = (kind: LodKind, band: Band): boolean => !(kind === "lotusRiver" && band === "sprout");

/**
 * Growth and bloom each band is posed at (growth is lib/sim's Visual.growth: a sprout spans about 0.05 to 0.32, a
 * leafy plant to 0.68, a bud to 0.9; by the middle of the bud band the bud is full size). An open flower is drawn
 * fully open: how far it is open is too fine to read at a distance. So is which morning a lily is on: its bloom band
 * has all three of its flowers open.
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
  // picked the same way from the lily's first look (its long stamens count toward its height): a reshaped lily may
  // move its medians, so pick again before baking the atlas
  lily: "typical-199",
  // the lotus in its urli is posed from fixed leaf places (components/lotus/lod.ts), not from a seed: this names the
  // visit's plant in a made-up Meadow's &same=1 (lod/synthetic.ts), whose urli look is the same for every seed
  lotus: "typical-0",
};

/**
 * How far across a plant reaches at its widest, garden metres, where that is more than it stands tall: the lotus's
 * urli is wider than a sprouting lotus is high, so its levels are chosen by its width on screen (LodPlants.tsx), or its
 * picture would be stretched past its pixels before its light plant took over. A pocket's lotus spreads its three
 * standing leaves wider than it stands tall too.
 */
export const LOD_REACH: Partial<Record<LodKind, number>> = { lotus: 0.39, lotusRiver: 0.85 };

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

/** Whether a plant stands level whatever its health (plotTilt's `upright`): the lotus, in its urli or in the river. */
export const standsUpright = (kind: LodKind) => kind === "lotus" || kind === "lotusRiver";

/** Which of SPINS is nearest to the yaw `yaw` (a pocket's channel-facing yaw): the angle its standing plant is turned to. */
export function pocketSpin(yaw: number): number {
  let best = 0;
  let bestD = Infinity;
  SPINS.forEach((s, i) => {
    const d = Math.abs(Math.atan2(Math.sin(yaw - s), Math.cos(yaw - s)));
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  });
  return best;
}

/** The angle (index into SPINS) a plot's plant stands at: a pocket's nearest to facing its channel, else plotSpin. */
export function spinOfPlot(plot: Pick<Plot, "index" | "kind" | "yaw">): number {
  return plot.kind === "pocket" && plot.yaw !== undefined ? pocketSpin(plot.yaw) : plotSpin(plot.index);
}

/** How a plot's plant stands (plotTurn); a pocket's level, turned to its own angle (spinOfPlot). */
export function plotTurnOf(plot: Pick<Plot, "index" | "kind" | "yaw" | "a" | "side">, poorly: boolean, upright: boolean, out = new THREE.Quaternion()): THREE.Quaternion {
  if (plot.kind === "pocket") return out.setFromAxisAngle(UP, SPINS[spinOfPlot(plot)]);
  return plotTurn(plot.index, plot.a, plot.side === "inner", poorly, out, upright);
}

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
      // a closed flower is drawn as its bud
      return p.bloom > 0 ? "bloom" : "bud";
    default:
      return null;
  }
}

/** Index of a kind, band and angle in the atlas (and in the detail meshes' table). */
export function cellIndex(kind: LodKind, band: Band, spin: number): number {
  return (LOD_KINDS.indexOf(kind) * BANDS.length + BANDS.indexOf(band)) * SPINS.length + spin;
}

export const CELL_COUNT = LOD_KINDS.length * BANDS.length * SPINS.length;

/** A stable pseudo-random number in [0, 1) for plot i and channel k (as Plants.tsx scatters its plants). */
export function plotHash(i: number, k: number): number {
  const x = Math.sin(i * 12.9898 + k * 78.233) * 43758.5453;
  return x - Math.floor(x);
}
