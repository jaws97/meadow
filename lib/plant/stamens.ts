// A lily's long stamens (FlowerSpec center.long), laid out once per plant from its seed: six or so round a central
// style, each leaning out of the throat on its own bearing, an anther laid across its tip. Shared by the garden's hero
// (components/garden/Plant.tsx) and the posed plant (components/meadow/lod/pose.ts), so a lily seen in the Meadow is
// the lily of its owner's garden. Every other flower keeps its short tuft, drawn where those two files draw it.
import { Rng } from "./prng";
import type { FlowerSpec } from "./species";

export interface LongStamen {
  /** bearing round the flower's axis, radians */
  yaw: number;
  /** lean out of the throat, radians from the axis */
  lean: number;
  /** how far from the axis the stamen rises, metres */
  foot: number;
  /** the filament's length, metres */
  length: number;
  /** the style: thicker, a touch longer and nearly upright, with a stigma instead of an anther */
  style: boolean;
}

/** The anther's semi-axes as shares of its filament's length: long across the tip, slim, a little deeper than thick. */
export const ANTHER: readonly [number, number, number] = [0.085, 0.02, 0.028];
/** The stigma's semi-axes as shares of the style's length: a small round three-lobed knob, a little flattened. */
export const STIGMA: readonly [number, number, number] = [0.05, 0.035, 0.05];
/** The filament's and the style's thickness against the shared unit filament (components/garden/materials petioleGeometry). */
export const FILAMENT_GIRTH = 0.75;
export const STYLE_GIRTH = 1.4;

/** The long stamens and the style for a plant's seed, or none for a flower with the short tuft. */
export function longStamens(seed: string, center: FlowerSpec["center"]): LongStamen[] {
  const long = center.long;
  if (!long) return [];
  const rng = new Rng(`${seed}|long-stamens`);
  const turn = rng.range(0, Math.PI * 2);
  const out: LongStamen[] = [];
  for (let k = 0; k < center.stamens; k++) {
    out.push({
      yaw: turn + (k / center.stamens) * Math.PI * 2 + rng.range(-0.14, 0.14),
      lean: rng.range(0.26, 0.42),
      foot: center.radius * 0.3,
      length: long.length * rng.range(0.88, 1),
      style: false,
    });
  }
  out.push({ yaw: rng.range(0, Math.PI * 2), lean: rng.range(0.03, 0.09), foot: 0, length: long.length * 1.06, style: true });
  return out;
}
