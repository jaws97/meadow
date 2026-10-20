// A lily's flowers on one stem (Species raceme): the lowest opens first, on the morning the model says the flower opens,
// the next on the morning after and the third the morning after that, each on its own short stalk round the top of the
// stem, with the youngest bud at the tip, which stays closed. Laid out once per plant from its seed and shared by the
// garden's hero (components/garden/Plant.tsx) and the posed plant (components/meadow/lod/pose.ts), so a lily in the
// Meadow is the lily of its owner's garden. The model knows one flower (its bloom); the later flowers only follow the
// clock from the hour it opened, so nothing here touches the simulation.
import { Rng, smoothstep } from "./prng";
import type { Species } from "./species";

export interface RacemeNode {
  /** 0 is the lowest flower, the one that opens first and leads (the head the camera, the card and the butterflies follow) */
  order: number;
  /** the stem segment its stalk leaves, and where along it (the tip bud: the last segment's end) */
  seg: number;
  t: number;
  /** bearing round the stem, radians */
  yaw: number;
  /** how far the stalk leans out from the stem, radians */
  out: number;
  /** the stalk's length, metres (0 for the tip bud, which sits on the stem itself) */
  length: number;
  /** the flower's tilt on its stalk, radians: a little more outward than the stalk's end */
  tilt: number;
  /** a turn of the whole flower about its own axis, so the three are not copies */
  spin: number;
  /** the flower's size against the lead's */
  scale: number;
  /** the youngest bud at the tip: it never opens on this stem */
  tipBud: boolean;
}

/** The share of the hero's growth each later bud lags the lead by, so the lowest swells first. */
const BUD_LAG = 0.035;

/**
 * The raceme for a plant's seed, on a cane of `segments` segments: its flowers bottom-up over the top `span` of the cane,
 * then the bud at the tip; none for a flower that grows alone.
 */
export function racemeNodes(seed: string, sp: Species, segments: number): RacemeNode[] {
  const r = sp.raceme;
  if (!r) return [];
  const rng = new Rng(`${sp.id}|${seed}|raceme`);
  const turn = rng.range(0, Math.PI * 2);
  const out: RacemeNode[] = [];
  for (let k = 0; k < r.flowers; k++) {
    const share = r.flowers === 1 ? 0 : k / (r.flowers - 1);
    const along = 1 - r.span + r.span * 0.85 * share + rng.range(-0.012, 0.012);
    const seg = Math.min(segments - 1, Math.floor(along * segments));
    out.push({
      order: k,
      seg,
      t: Math.min(0.98, Math.max(0.02, along * segments - seg)),
      // round the stem in a spiral, as a raceme's flowers are borne
      yaw: turn + k * 2.4 + rng.range(-0.25, 0.25),
      out: r.out * (1 - 0.18 * share) * rng.range(0.92, 1.08),
      length: r.pedicel * (1 - 0.25 * share) * rng.range(0.9, 1.1),
      tilt: rng.range(0.15, 0.3),
      spin: rng.range(0, Math.PI * 2),
      scale: r.scale * (1 - 0.07 * k),
      tipBud: false,
    });
  }
  out.push({ order: r.flowers, seg: segments - 1, t: 1, yaw: 0, out: 0, length: 0, tilt: rng.range(0.04, 0.12), spin: rng.range(0, Math.PI * 2), scale: r.scale * 0.5, tipBud: true });
  return out;
}

/** How far a raceme head's bud has swelled, from the hero's own bud growth curve and the growth it lags by. */
export function racemeBudGrowth(budAt: (g: number) => number, growth: number, node: RacemeNode): number {
  return budAt(growth - node.order * BUD_LAG) * (node.tipBud ? 0.85 : 1);
}

/**
 * How open a raceme flower is against the model's bloom, from `opened`, the hours since the lead flower opened (null
 * while it has not, or Infinity where every flower is shown open: the Meadow's pictures, a garden with no clock). The
 * lead follows the model; the k-th flower after it opens with the morning light k days on, over the same four hours.
 */
export function racemeOpen(node: RacemeNode, opened: number | null): number {
  if (node.tipBud) return 0;
  if (node.order === 0) return 1;
  if (opened === null) return 0;
  const from = 24 * node.order - 2;
  return smoothstep(from, from + 4, opened);
}
