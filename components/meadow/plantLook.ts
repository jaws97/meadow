// How a plant in the Meadow stands, from the snapshot's coarse bands: its height by stage and species (a growing
// plant's measured from the very plant its detail levels draw, lod/atlasManifest.ts), where the cart pulls up to visit
// it, and the owner's rose on the dais as a visit of its own. Shared by the plants, the tap picker, the visit card and
// the camera, so they always agree on where a plant's head is.
import type { VisitTarget } from "@/components/meadow/autopilot";
import { ROSE } from "@/components/meadow/autopilot";
import { BED, DAIS, meadowLayout, plotAt } from "@/components/meadow/layout";
import { HEIGHTS } from "@/components/meadow/lod/atlasManifest";
import { bandOf } from "@/components/meadow/lod/bands";
import { SPECIES, type SpeciesId } from "@/lib/plant/species";
import type { MeadowPlot } from "@/lib/server/meadow";

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

/** A species' full height in the Meadow, metres. */
export function speciesHeight(id: SpeciesId): number {
  return SPECIES[id].stem.height * PLANT_SCALE;
}

/** Metres from the soil to the top of a plant drawn for this snapshot entry (before its own few percent of size). */
export function plantHeight(p: Pick<MeadowPlot, "species" | "stage" | "bloom">): number {
  if (p.stage === "seed") return 0.09 * PLANT_SCALE;
  const band = bandOf(p);
  return band ? HEIGHTS[p.species][band] * PLANT_SCALE : speciesHeight(p.species) * STAGE_SHARE[p.stage];
}

/** Where a plant's middle is in the world, for tap picking and for the camera. */
export function plantCentre(p: MeadowPlot): { x: number; y: number; z: number } | null {
  const plot = plotAt(p.plot);
  if (!plot) return null;
  return { x: plot.x, y: BED.soilH + Math.max(0.12, plantHeight(p) * 0.6), z: plot.z };
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
