// Several flowers on one stem (Species raceme), a lily's up the top of its stem or a jasmine's cluster at its tip: the
// lowest opens first, at the hour the model says the flower opens (a lily's morning, a jasmine's dusk), the next a day
// later and the third a day after that, each on its own short stalk round the stem, with the youngest bud at the tip
// and, in a cluster, a few more young buds among the flowers, which stay closed. Laid out once per plant from its seed
// and shared by the garden's hero (components/garden/Plant.tsx) and the posed plant (components/meadow/lod/pose.ts), so
// a plant in the Meadow is the plant of its owner's garden. The model knows one flower (its bloom); the later flowers
// only follow the clock from the hour it opened, so nothing here touches the simulation.
import { lerp, Rng, smoothstep } from "./prng";
import type { Species } from "./species";

export interface RacemeNode {
  /** 0 is the lowest flower, the one that opens first and leads (the head the camera, the card and the butterflies follow) */
  order: number;
  /** the stem segment its stalk leaves, and where along it (the tip bud: the last segment's end) */
  seg: number;
  t: number;
  /** bearing round the stem, radians (the tip bud's: the way it leans) */
  yaw: number;
  /** how far the stalk leans out from the stem, radians */
  out: number;
  /** the stalk's length, metres (0 for the tip bud, which sits on the stem itself) */
  length: number;
  /** the flower's tilt on its stalk, radians: a little more outward than the stalk's end (the tip bud's lean off the cane) */
  tilt: number;
  /** a turn of the whole flower about its own axis, so the three are not copies */
  spin: number;
  /** the flower's size against the lead's */
  scale: number;
  /** the youngest bud at the tip: it never opens on this stem */
  tipBud: boolean;
  /** a bud that stays closed on this stem: the tip's, and a cluster's young buds among its flowers */
  closed: boolean;
}

/** The share of the hero's growth each later bud lags the lead by, so the lowest swells first. */
const BUD_LAG = 0.035;
/** A head's bud growth past which its bud shows (the garden's own threshold for showing a head's petals). */
export const BUD_SHOWN = 0.04;
/** How far a stalk's end curves back toward the sky, as a share of its length: a lily holds its flowers out, not down. */
const PEDICEL_CURL = 0.3;
/** A closed bud's stalk against its open flower's, in length and in lean: the buds are held close and upright. */
const STALK_CLOSED = 0.6;
const LEAN_CLOSED = 0.75;

/**
 * The raceme for a plant's seed, on a cane of `segments` segments: its flowers bottom-up over the top `span` of the cane,
 * then a cluster's young buds among them, then the bud at the tip (always last); none for a flower that grows alone.
 */
export function racemeNodes(seed: string, sp: Species, segments: number): RacemeNode[] {
  const r = sp.raceme;
  if (!r) return [];
  const rng = new Rng(`${sp.id}|${seed}|raceme`);
  // the lead faces the garden's front give or take (yaw 0 is toward its camera, as for the leaves), so the first flower
  // to open is seen face on; the others spiral on round the stem from it, one way or the other
  const turn = rng.range(-0.6, 0.6);
  const way = rng.next() < 0.5 ? -1 : 1;
  const out: RacemeNode[] = [];
  for (let k = 0; k < r.flowers; k++) {
    const share = r.flowers === 1 ? 0 : k / (r.flowers - 1);
    const along = 1 - r.span + r.span * 0.78 * share + rng.range(-0.012, 0.012);
    const seg = Math.min(segments - 1, Math.floor(along * segments));
    out.push({
      order: k,
      seg,
      t: Math.min(0.98, Math.max(0.02, along * segments - seg)),
      // round the stem in a spiral, as a raceme's flowers are borne
      yaw: turn + way * k * 2.4 + rng.range(-0.25, 0.25),
      out: r.out * (1 - 0.18 * share) * rng.range(0.92, 1.08),
      length: r.pedicel * (1 - 0.25 * share) * rng.range(0.9, 1.1),
      tilt: rng.range(0.25, 0.4) * (r.tilt ?? 1),
      spin: rng.range(0, Math.PI * 2),
      scale: r.scale * (1 - 0.07 * k),
      tipBud: false,
      closed: false,
    });
  }
  // the tip bud leans a little away from the flower below the top one, whose upper petals reach up the stem to it
  const below = out[Math.max(0, r.flowers - 2)];
  const tip: RacemeNode = {
    order: r.flowers,
    seg: segments - 1,
    t: 1,
    yaw: below.yaw + Math.PI,
    out: 0,
    length: 0,
    tilt: rng.range(0.1, 0.2),
    spin: rng.range(0, Math.PI * 2),
    scale: r.scale * 0.5,
    tipBud: true,
    closed: true,
  };
  // a cluster's young buds, gathered round its tip as a jasmine's are, fanned out on the side away from the top flower
  // on shorter stalks held closer in (drawn after everything else, so a raceme without them is laid out as it always was)
  const buds = r.buds ?? 0;
  const top = out[r.flowers - 1];
  for (let j = 0; j < buds; j++) {
    const along = Math.min(0.985, 1 - r.span * (0.16 - 0.035 * j) + rng.range(-0.008, 0.008));
    const seg = Math.min(segments - 1, Math.floor(along * segments));
    out.push({
      order: r.flowers + 1 + j,
      seg,
      t: Math.min(0.98, Math.max(0.02, along * segments - seg)),
      yaw: top.yaw + Math.PI + (j - (buds - 1) / 2) * 1.15 + rng.range(-0.2, 0.2),
      out: r.out * 0.7 * rng.range(0.9, 1.1),
      length: r.pedicel * 0.7 * rng.range(0.9, 1.1),
      tilt: rng.range(0.05, 0.15),
      spin: rng.range(0, Math.PI * 2),
      scale: r.scale * 0.8,
      tipBud: false,
      closed: true,
    });
  }
  out.push(tip);
  return out;
}

/** How far a raceme head's bud has swelled, from the hero's own bud growth curve and the growth it lags by. */
export function racemeBudGrowth(budAt: (g: number) => number, growth: number, node: RacemeNode): number {
  return budAt(growth - node.order * BUD_LAG) * (node.tipBud ? 0.85 : 1);
}

/**
 * A raceme head's size, as a lone flower's head is sized by its bud (0.3 + 0.7 * bud), at its own share. The tip bud
 * is the cane's growing tip until the buds show, and never shrinks below the lone flower's growing tip, so the young
 * cane never ends in a bare tube.
 */
export function racemeHeadScale(node: RacemeNode, bud: number): number {
  const s = (0.3 + 0.7 * bud) * node.scale;
  return node.tipBud ? Math.max(0.3, s) : s;
}

/**
 * How far a flower's stalk has grown out, as a share of its full length: nothing until its bud shows, lengthening as
 * the bud swells, so young buds sit bunched at the top of the cane, and the rest of the way as the flower opens
 * (`open`, 0 closed to 1 open), which carries it out into the air, clear of its neighbours.
 */
export function racemeStalkGrowth(bud: number, open: number): number {
  return bud > BUD_SHOWN ? lerp(0.35, 1, smoothstep(BUD_SHOWN, 0.9, bud)) * lerp(STALK_CLOSED, 1, open) : 0;
}

/** How far a flower's stalk leans out from the stem, radians: a bud's held closer in, an open flower's further out. */
export function racemeStalkLean(node: RacemeNode, open: number): number {
  return node.out * lerp(LEAN_CLOSED, 1, open);
}

/**
 * A flower's stalk as a tube (lib/plant/geometry makeStemGeometry, stemEndTransform): its length, its radii at the
 * stem and at the flower (a share of the cane's), and its offset across, negative so that, leant out by `out`, it
 * curves back up toward the light.
 */
export function pedicelShape(node: RacemeNode, sp: Species): { length: number; r0: number; r1: number; dz: number } {
  return { length: node.length, r0: sp.stem.radius * 0.55, r1: sp.stem.radius * 0.4, dz: -node.length * PEDICEL_CURL };
}

/**
 * How open a raceme flower is against the model's bloom, from `opened`, the hours since the lead flower opened (null
 * while it has not, or Infinity where every flower is shown open: the Meadow's pictures, a garden with no clock). The
 * lead follows the model; the k-th flower after it opens at the same hour k days on (with a lily's morning light, a
 * jasmine's dusk), over the same four hours. A closed bud never opens.
 */
export function racemeOpen(node: RacemeNode, opened: number | null): number {
  if (node.closed) return 0;
  if (node.order === 0) return 1;
  if (opened === null) return 0;
  const from = 24 * node.order - 2;
  return smoothstep(from, from + 4, opened);
}

/**
 * The bloom clock for racemeOpen: the hours from `bloomedAt` (the model's bloom hour as an ISO time, null before the
 * flower opens) to `now` (epoch ms), or null while it has not opened. Read straight off the clock, never eased.
 */
export function openedSince(bloomedAt: string | null | undefined, now: number): number | null {
  if (!bloomedAt) return null;
  const at = Date.parse(bloomedAt);
  return Number.isFinite(at) ? (now - at) / 3_600_000 : null;
}
