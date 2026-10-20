// The personal garden's growth schedule for the hero and the bed round it.
// Every flower now blooms on its own fourteenth evening, so most visits find
// the hero part-grown: these curves make each stage read as a young rose
// rather than a bare stick waiting for its bloom. lib/plant/growth stays the
// shared, species-level mapping (the meadow uses it too); this file only
// re-times it for the hero in this scene.
//
//  - The cane lengthens steadily across the fortnight instead of shooting up
//    in the first half: a seedling is a hand high, half-grown is about two
//    thirds of full height, and it tops out just before the bud opens.
//  - Leaves run up the cane as it reaches them, alternating side to side,
//    mostly turned across the camera so their leaflets read.
//  - A bud with its sepals shows from about growth 0.4 and swells until the
//    bloom opens.
//  - The companions stay low and in leaf while the hero is young and come
//    into flower as it buds, so the owner's plant is never upstaged.
import { lerp, clamp01, easeOutBack, easeOutCubic, Rng, smoothstep } from "@/lib/plant/prng";
import type { LeafNode } from "@/lib/plant/blueprint";
import type { Species } from "@/lib/plant/species";

/** Growth at which the cane starts to lengthen, and the span over which it reaches full height. */
const STEM_START = 0.03;
const STEM_SPAN = 0.9;
/** Shapes the cane's easing: above 1 it slows toward the top, so the last stretch is gentle. */
const STEM_EASE = 1.4;
/** Overlap between stem segments' growth windows, as in lib/plant/growth. */
const SEG_OVERLAP = 0.85;

/** Fraction of its full height the hero's cane has reached at growth g. */
export function heroStemFraction(g: number): number {
  const t = clamp01((g - STEM_START) / STEM_SPAN);
  return 1 - Math.pow(1 - t, STEM_EASE);
}

/** The growth at which the cane reaches fraction f of its height (the inverse of heroStemFraction). */
export function heroGrowthAtStem(f: number): number {
  return STEM_START + STEM_SPAN * (1 - Math.pow(1 - clamp01(f), 1 / STEM_EASE));
}

/** Each segment's own 0..1 extension, bottom-up with overlap, on the hero's schedule. */
export function heroSegmentGrowth(g: number, i: number, n: number): number {
  return clamp01(heroStemFraction(g) * n - i * SEG_OVERLAP);
}

/**
 * A segment's girth as a share of its full radius: a young cane is slender
 * (a seedling's is about a centimetre across, not a pipe), thickening as the
 * whole plant matures and, within that, as the segment itself lengthens.
 */
export function heroStemGirth(g: number, gi: number): number {
  return lerp(0.24, 1, heroStemFraction(g)) * lerp(0.7, 1, gi);
}

/**
 * How far one leaf has unfurled: it starts once the cane has grown past its
 * node, so a leaf never opens in mid air above a short stem, and takes about
 * a tenth of the fortnight to spread its leaflets.
 */
export function heroLeafUnfurl(leaf: LeafNode, n: number, g: number): number {
  const reach = (leaf.t + leaf.seg * SEG_OVERLAP) / n;
  const start = heroGrowthAtStem(Math.min(1, reach + 0.02)) - 0.015;
  return easeOutBack(smoothstep(start, start + 0.11, g));
}

/** The bud: shows at about growth 0.38 and swells until the bloom opens. */
export function heroBudGrowth(g: number): number {
  return easeOutCubic(smoothstep(0.36, 0.86, g));
}

/** The sepals' parting as the bud swells, before the bloom opens: a sliver of colour at the tip. */
export function heroSepalPart(bud: number): number {
  return smoothstep(0.55, 1, bud);
}

/**
 * How faded a hero leaf reads (the leaf texture yellows up to about 0.55, then
 * browns): the fade of poor health (lib/plant/growth fadeOf), or a live
 * plant's yellowing (chlorosis), whichever shows more. Yellowing turns the
 * lower, older leaves first and never browns them.
 */
export function heroLeafFade(healthFade: number, chlorosis: number, order: number): number {
  return Math.max(healthFade, 0.55 * clamp01(chlorosis * (1.25 - 0.7 * order)));
}

/**
 * The companions' height (as a share of their full height) and how open
 * their flowers are, by the hero's growth: low and in leaf through the
 * hero's first week, flowering as its bud swells, in full bloom with it.
 */
export function companionGrow(g: number): number {
  return lerp(0.48, 1, smoothstep(0.06, 0.8, g));
}
export function companionOpen(g: number): number {
  return smoothstep(0.42, 0.9, g);
}

/**
 * Leaf angles round the cane, in turns of the head's frame: alternate sides,
 * mostly across the camera (which looks down -z from +z), a few toward the
 * back and front for depth. A leaf at yaw 0 points at the camera.
 */
const LEAF_BEARINGS = [92, -96, 138, -52, 70, -140, 44, -84, 118, -62, 100, -118].map((d) => (d * Math.PI) / 180);

/**
 * The hero's leaves: more of them than the species' blueprint carries, spread
 * evenly up the cane from just above the mulch to just under the bud, larger
 * through the middle and smaller at the top, the topmost few three-leaflet as
 * on a real rose. Built from the blueprint's own seed so it is stable per owner.
 */
export function heroLeaves(seed: string, sp: Species, segments: number): LeafNode[] {
  const rng = new Rng(`${sp.id}|${seed}|hero-leaves`);
  const [lo, hi] = sp.leaves.count;
  const count = Math.round(lerp(lo, hi, rng.next()) * 1.35);
  const turn = rng.int(0, LEAF_BEARINGS.length - 1);
  const flip = rng.sign();
  const out: LeafNode[] = [];
  for (let i = 0; i < count; i++) {
    const order = count === 1 ? 0.5 : i / (count - 1);
    const along = Math.min(0.9, Math.max(0.06, lerp(0.07, sp.leaves.top ?? 0.88, order) + rng.range(-0.02, 0.02)));
    const seg = Math.min(segments - 1, Math.floor(along * segments));
    const t = along * segments - seg;
    const compound = sp.leaves.compound;
    out.push({
      seg,
      t: Math.min(0.98, Math.max(0.02, t)),
      yaw: flip * LEAF_BEARINGS[(i + turn) % LEAF_BEARINGS.length] + rng.range(-0.22, 0.22),
      // low leaves stand out level and droop, high ones angle up toward the bud
      pitch: lerp(1.3, 0.98, order) + rng.range(-0.08, 0.08),
      roll: rng.range(-0.2, 0.2),
      size: lerp(1.05, 0.82, order) * (1 + 0.14 * Math.sin(Math.PI * order)) * rng.range(0.92, 1.08),
      variant: rng.int(0, 2),
      order,
      leaflets: compound >= 5 && order > 0.82 ? 3 : compound,
      phase: rng.range(0, 6.28),
    });
  }
  return out;
}
