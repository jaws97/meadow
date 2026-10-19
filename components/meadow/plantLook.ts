// How a plant in the Meadow stands, from the snapshot's coarse bands: its height by stage and species (a growing
// plant's measured from the very plant its detail levels draw, lod/atlasManifest.ts), where the cart pulls up to visit
// it, and the owner's rose on the dais as a visit of its own. Shared by the plants, the tap picker, the visit card and
// the camera, so they always agree on where a plant's head is.
import type { VisitTarget } from "@/components/meadow/autopilot";
import { ROSE } from "@/components/meadow/autopilot";
import { DAIS, meadowLayout, plotAt } from "@/components/meadow/layout";
import { HEIGHTS } from "@/components/meadow/lod/atlasManifest";
import { bandOf } from "@/components/meadow/lod/bands";
import { SPECIES, type SpeciesId } from "@/lib/plant/species";
import type { MeadowPlot } from "@/lib/server/meadow";
import { isPocketIndex } from "@/lib/server/plots";

export type Stage = MeadowPlot["stage"];

/** The owner of the Meadow, whose rose stands on the dais (the garden's default seed). */
export const OWNER_NAME = "Lijas";
export const OWNER_SEED = "Lijas";

/** The rose on the dais stands this much larger than life, so it reads as the centrepiece from anywhere. */
export const ROSE_SCALE = 2.3;

/**
 * Every plant in the Meadow stands this much larger than its garden size (the rose on the dais more again), so a
 * friend's flower reads from the path beside it and from across the rings. The full plant drawn for a visit uses
 * the same scale, so nothing jumps when it takes over.
 */
export const PLANT_SCALE = 1.3;

/** A cheap stand-in's height at each stage, as a share of its species' full height (a seed is a mound with a shoot). */
export const STAGE_SHARE: Record<Stage, number> = { seed: 0.07, sprout: 0.2, leafy: 0.5, bud: 0.86, bloom: 1, resting: 0.36 };

/** A species' full height in the Meadow, metres (the lotus's: its urli and its plant in full bloom). */
export function speciesHeight(id: SpeciesId): number {
  if (id === "lotus") return HEIGHTS.lotus.bloom * PLANT_SCALE;
  return SPECIES[id].stem.height * PLANT_SCALE;
}

/** The lotus's urli from the soil to its rim (components/lotus/frame.ts VESSEL_OUTER, its foot on the soil), metres. */
const URLI_HEIGHT = 0.1425 * PLANT_SCALE;
/** A lotus in a river pocket, from the water: its floating leaves, or its seed of light, before it stands, metres. */
const POCKET_LOTUS_LOW = 0.12;

/**
 * Metres from the plot's foot (the soil, or the water of a river pocket) to the top of a plant drawn for this snapshot
 * entry (before its own few percent of size).
 */
export function plantHeight(p: Pick<MeadowPlot, "species" | "stage" | "bloom"> & { plot?: number }): number {
  // a lotus in a river pocket: its floating leaves until it stands, then its standing plant as its detail levels draw it
  if (p.species === "lotus" && p.plot !== undefined && isPocketIndex(p.plot)) {
    const band = bandOf(p);
    return band && band !== "sprout" ? HEIGHTS.lotusRiver[band] * PLANT_SCALE : POCKET_LOTUS_LOW;
  }
  // a lotus in its jar or at rest is its urli on the plot (Plants.tsx), the seed of light a little over the water
  if (p.species === "lotus" && (p.stage === "seed" || p.stage === "resting")) return URLI_HEIGHT;
  if (p.stage === "seed") return 0.09 * PLANT_SCALE;
  const band = bandOf(p);
  return band ? HEIGHTS[p.species][band] * PLANT_SCALE : speciesHeight(p.species) * STAGE_SHARE[p.stage];
}

/** Where a plant's middle is in the world, for tap picking and for the camera. */
export function plantCentre(p: MeadowPlot): { x: number; y: number; z: number } | null {
  const plot = plotAt(p.plot);
  if (!plot) return null;
  return { x: plot.x, y: plot.y + Math.max(0.12, plantHeight(p) * 0.6), z: plot.z };
}

export function plotTarget(index: number): VisitTarget | null {
  const plot = plotAt(index);
  return plot ? { index, x: plot.x, z: plot.z, park: plot.park } : null;
}

/** The rose's visit: pull up on the inner path at the point nearest the cart, beside the dais. */
export function roseTarget(from: { x: number; z: number }): VisitTarget {
  const a = Math.atan2(from.z, from.x);
  const r = DAIS.r + 0.95;
  return { index: ROSE, x: 0, z: 0, park: { x: r * Math.cos(a), z: r * Math.sin(a) } };
}

/** Height of the rose's head above the ground, for the camera. */
export const ROSE_HEAD_Y = DAIS.h + 1.0 * ROSE_SCALE;

/** The innermost path's centre, where the cart starts. */
export function innerPathRadius(): number {
  return meadowLayout().paths[0].r;
}
