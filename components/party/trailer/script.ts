// The party trailer's script: seventy seconds in the live garden, cut like a film trailer. A seed of light glows in its
// mound at blue dawn; the watering can wakes and gives it its first drink in true slow motion; the shoot breaks through
// under a racing sky and a passing shower, and the sun breaks over the whole garden; at golden hour, in one held shot,
// the wind dies, a cloud slides off the low sun and the bud opens in its rim light; a doe walks in and looks at the rose;
// night falls, the lantern strikes, and the five other flowers a guest can choose come up out of the dark one by one,
// each named on black over its gate; then silence, the title on black, a new seed waiting at night where the party's
// rose will stand, which hops twice to the tune's last notes, and the party screen again.
//
// Everything the trailer shows is a channel keyed in time and read with `trailerAt(t)`, so the timeline is pure and
// tested without a browser; components/party/trailer/Director plays it in the canvas. The garden's store takes the
// hour, growth, bloom, rain, cloud and wind; the party camera takes a shot and a lens (a pan toward a point, a lens
// shift, whether it rides the growing stem); the depth of field takes a focus point, a range and a bokeh size; the
// scene takes its trailer multipliers (lib/garden/trailerFx) and the post-processing its film look (lib/garden/look);
// the page takes the black, the words, the title and the tagline.
//
// The camera is cut, not only glided: the shot list is a table of segments (SEGMENTS), each with its own keys, and a
// cut is a segment boundary, so a curve never sees two keys at one time. Within a segment a move runs on straight
// lines (already under way at the cut, as a motion-control move is) or on monotone cubics, eased at both ends. Every
// other channel passes through its keys on monotone cubics: continuous in speed, never overshooting a key, so growth
// never shrinks and a hold stays a hold. The few channels that must rise at an exact pace (the can's slow motion, the
// seed's hops) are straight lines. The hours are set against the day's golden hour (components/party/logic
// goldenHour), so a rehearsal in October lights the trailer as the party night will. Species change only at gates,
// under black; the director holds the clock at a gate until the garden has drawn the new flower, so whatever it costs
// is never seen, and the montage's names stand on that black like a fermata. From HOME_AT, under the last black, every
// channel is the party screen's own.
import { CAN, varyOf } from "@/components/garden/garden/canMoment";
import { HOME, type Shot, type XYZ } from "@/components/party/logic";
import { copyGrade, copyLook, LOOK_IDLE, MIXER_IDENTITY, type LookValues } from "@/lib/garden/look";
import { FX_NEUTRAL, type SceneFx } from "@/lib/garden/trailerFx";
import { SPECIES, type SoilSpeciesId } from "@/lib/plant/species";

/** One key: a time (s) and a value. */
export type Key = readonly [t: number, v: number];

/**
 * A channel through its keys: holds the first value before them and the last after; between them a monotone cubic
 * (Fritsch-Carlson), with zero slope at the ends and at every local turn or hold.
 */
export class Track {
  private readonly t: number[];
  private readonly v: number[];
  private readonly m: number[];

  constructor(keys: readonly Key[]) {
    if (keys.length === 0) throw new Error("a track needs a key");
    this.t = keys.map((k) => k[0]);
    this.v = keys.map((k) => k[1]);
    const n = keys.length;
    const d: number[] = [];
    for (let i = 0; i < n - 1; i++) {
      const dt = this.t[i + 1] - this.t[i];
      if (!(dt > 0)) throw new Error(`keys out of order at ${this.t[i]}`);
      d.push((this.v[i + 1] - this.v[i]) / dt);
    }
    const m = new Array<number>(n).fill(0);
    for (let i = 1; i < n - 1; i++) {
      if (d[i - 1] * d[i] > 0) {
        // the harmonic mean of the neighbouring slopes, weighted by the spans: never overshoots
        const h0 = this.t[i] - this.t[i - 1];
        const h1 = this.t[i + 1] - this.t[i];
        const w0 = 2 * h1 + h0;
        const w1 = h1 + 2 * h0;
        m[i] = (w0 + w1) / (w0 / d[i - 1] + w1 / d[i]);
      }
    }
    this.m = m;
  }

  at(time: number): number {
    const { t, v, m } = this;
    const n = t.length;
    if (time <= t[0]) return v[0];
    if (time >= t[n - 1]) return v[n - 1];
    let i = 0;
    while (time > t[i + 1]) i++;
    const h = t[i + 1] - t[i];
    const s = (time - t[i]) / h;
    const s2 = s * s;
    const s3 = s2 * s;
    return (
      (2 * s3 - 3 * s2 + 1) * v[i] + (s3 - 2 * s2 + s) * h * m[i] + (-2 * s3 + 3 * s2) * v[i + 1] + (s3 - s2) * h * m[i + 1]
    );
  }
}

/** A channel on straight lines between its keys (in time order), holding the first before them and the last after. */
export function linear(keys: readonly Key[], time: number): number {
  const n = keys.length;
  if (time <= keys[0][0]) return keys[0][1];
  if (time >= keys[n - 1][0]) return keys[n - 1][1];
  let i = 0;
  while (time > keys[i + 1][0]) i++;
  const [t0, v0] = keys[i];
  const [t1, v1] = keys[i + 1];
  return v0 + ((v1 - v0) * (time - t0)) / (t1 - t0);
}

const clamp01 = (x: number) => Math.min(1, Math.max(0, x));

// ---- the beats (seconds from the first frame of the trailer) --------------------------------------------------------

/** A seed of light in its mound at blue dawn. */
export const SEED_AT = 0;
/** The watering can wakes and gives the seed its first drink (components/garden/garden/canMoment), in slow motion. */
export const WATER_AT = 6;
/** The shoot breaks through, the day races, a shower passes and the sun breaks over the garden. */
export const GROW_AT = 12;
/** Golden hour: the held breath, the cloud sliding off the sun, the bud opening. */
export const BLOOM_AT = 25;
/** The doe walks in, grazes and looks at the rose. */
export const VISIT_AT = 33.6;
/** She leaves the garden, under the chapter's black, a moment before she would turn to walk out (about VISIT_AT + 11.18). */
export const DOE_OFF = VISIT_AT + 10.9;
/** The first picture of the night: the lantern strikes, the fireflies rise. */
export const NIGHT_AT = 45.1;
/** The other flowers, one by one, each named on black over its gate. */
export const FLOWERS_AT = 48.4;
/** Each flower's slot in the montage. */
export const FLOWER_S = 2.8;
/**
 * Offsets into each slot (s): the black is full from DIP_IN, the flower's name comes on at NAME_IN, its gate is at
 * GATE_IN (the flower changes there and the clock waits), the black holds to DIP_HOLD_TO and has lifted by DIP_OUT_TO.
 */
export const DIP_IN = 0.35;
export const NAME_IN = 0.4;
export const GATE_IN = 0.42;
export const DIP_HOLD_TO = 0.65;
export const DIP_OUT_TO = 1.0;
/**
 * The flowers a guest can choose besides the rose, built in brightness to the golden sundrop (the lotus has its own
 * courtyard and the lily its own stem of three, so neither is among them).
 */
export const MONTAGE: readonly SoilSpeciesId[] = ["jasmine", "magnolia", "marigold", "island", "sundrop"];
/** The montage is over: the dip into silence. */
export const END_AT = FLOWERS_AT + MONTAGE.length * FLOWER_S;
/** The title on black, on the trailer's one loud chord. */
export const TITLE_AT = END_AT + 1.0;
/** Under the title: the rose's seed goes back into the bed for the coda (its gate). */
export const RESTORE_AT = END_AT + 1.4;
/** The coda: a new seed fades up at night, where the party's rose will stand. */
export const CODA_AT = END_AT + 3.0;
/** The seed's two hops, "hel-lo" (the second HELLO_GAP_S later). */
export const HELLO_AT = END_AT + 4.2;
export const HELLO_GAP_S = 0.4;
/** Under the last black: the garden is put back as the party shows it, whole at once. */
export const HOME_AT = END_AT + 5.45;
/** The panel and its QR code come back on black; the garden lifts after it. */
export const RETURN_AT = END_AT + 5.6;
/** The trailer is over. */
export const TRAILER_S = RETURN_AT + 2;
/** The black is full after the montage's last flower, through the silence and the title. */
const END_BLACK_AT = END_AT + 0.4;

/** The first night frame's weather snap (the night's lantern lit, the stones dry) happens here, under the chapter's black. */
export const WEATHER_SNAP_AT = 44.7;

/** The growth below which the rose shows no head yet (Plant: heroStemFraction above 0.005). */
export const HEADLESS_GROWTH = 0.0332;

/** The slot's start (s) of the montage's i-th flower. */
export const slotAt = (i: number) => FLOWERS_AT + i * FLOWER_S;

/**
 * Where the director holds the clock until the garden has settled: each flower's swap (inside its full black, before
 * its name has finished coming in) and the restore (under the title), all under black.
 */
export const GATES: readonly number[] = [...MONTAGE.map((_, i) => slotAt(i) + GATE_IN), RESTORE_AT];

// ---- the words ------------------------------------------------------------------------------------------------------

/**
 * The title on black: the product's name (not the giver's), or null for the crest alone. A data switch: set it to null
 * if the name reads as a brand.
 */
export const END_TITLE: string | null = "MEADOW";
/** The last words before the panel, over the coda's seed. */
export const TAGLINE = "Your seed is waiting.";

export type LineId = "L1" | "L2" | "L3" | "L4" | "L5";

/** A line's words come in a group at a time, each group on a struck bell (score.ts). */
export interface LineGroup {
  at: number;
  words: readonly string[];
}

export interface Line {
  id: LineId;
  groups: readonly LineGroup[];
  /** when the whole line starts to fade out (s); it is gone LINE_OUT_S later */
  exit: number;
  /** stays up through black dips (above the cover), rather than needing clear picture under it */
  ridesDips: boolean;
  /** only when the doe is in the trailer */
  visitor?: boolean;
}

/** A group's words take this long to fade in (s), so a line is fully readable this long after its last group. */
export const WORD_IN_S = 0.9;
/** Each word in a group starts this much after the one before it (s). */
export const WORD_STAGGER_S = 0.09;
/** A line takes this long to fade out (s). */
export const LINE_OUT_S = 0.7;

/** Every line over the picture: at most five words each, the call to action through the whole montage. */
export const LINES: readonly Line[] = [
  {
    id: "L1",
    groups: [
      { at: 1.0, words: ["One"] },
      { at: 1.7, words: ["seed."] },
    ],
    exit: 5.1,
    ridesDips: false,
  },
  {
    id: "L2",
    groups: [
      { at: 9.6, words: ["A", "little", "water,"] },
      { at: 10.4, words: ["each", "day."] },
    ],
    exit: 13.8,
    ridesDips: false,
  },
  {
    id: "L3",
    groups: [
      { at: 17.2, words: ["The", "real"] },
      { at: 17.9, words: ["Bangalore"] },
      { at: 18.6, words: ["sky."] },
    ],
    exit: 22.0,
    ridesDips: false,
  },
  {
    id: "L4",
    groups: [
      { at: 33.65, words: ["Sometimes,"] },
      { at: 34.3, words: ["a", "visitor."] },
    ],
    exit: 37.7,
    ridesDips: false,
    visitor: true,
  },
  {
    id: "L5",
    groups: [
      { at: 47.0, words: ["Choose"] },
      { at: 47.6, words: ["your", "flower"] },
    ],
    exit: END_AT,
    ridesDips: true,
  },
];

/** The title is up from TITLE_AT until the coda fades in, and the tagline from just after until the garden lifts. */
export const TITLE_OUT = CODA_AT;
export const TAGLINE_AT = CODA_AT + 0.1;
export const TAGLINE_OUT = RETURN_AT + 0.8;
/** The tagline fades in and out over this long (s). */
export const TAGLINE_FADE_S = 0.8;

// ---- the garden's named points --------------------------------------------------------------------------------------

/**
 * Points the camera pans toward and the focus is pulled to. `head` is the flower head as it stands (env.headPos) and
 * `doeBone` the doe's head as she moves (her head bone), both resolved live by the director; `doeWalk` is a keyed path
 * along her walk; the rest are fixed (metres, the stem at the origin, the camera looking toward -z).
 */
export type PointName = "seed" | "head" | "canHome" | "spout" | "pourAim" | "sky" | "lamp" | "doeWalk" | "doeGraze" | "doeStand" | "doeBone";

export const POINTS: Readonly<Record<Exclude<PointName, "head" | "doeWalk" | "doeBone">, readonly [number, number, number]>> = {
  /** the seed's light in its mound (the hero's ground, HERO_GROUND_Y, and a little) */
  seed: [0, 0.167, 0],
  /** the watering can at home, at its body's height */
  canHome: [0.74, 0.3, 0.2],
  /** where the can's rose pours */
  spout: [0.12, 0.32, 0.08],
  /** between the spout and the mound, for the pour's two-shot */
  pourAim: [0.2, 0.42, 0.15],
  /** high over the back hedge, through the tree crowns */
  sky: [0, 6, -12],
  /** the lantern's lamp */
  lamp: [-0.683, 1.18, -0.458],
  /** her head, grazing, and standing at her station looking at the rose */
  doeGraze: [-1.68, 0.42, -1.72],
  doeStand: [-1.85, 1.15, -1.75],
};

/** Her head along the last of her walk to her station (tour.ts arrive), held where she stops. */
const DOE_WALK: readonly (readonly [number, number, number, number])[] = [
  [38.4, -2.5, 1.1, -1.65],
  [39.3, -2.0, 1.05, -1.72],
];

/**
 * A named point at time `t`, into `out`: the fixed and keyed points as they are, the doe's live head as where she
 * stands to look (the director takes her real head bone when she is there), and the flower head left as `out` was
 * (only the director knows where it stands).
 */
export function pointAt(name: PointName, t: number, out: XYZ): XYZ {
  if (name === "head") return out;
  if (name === "doeWalk") {
    const k = t <= DOE_WALK[0][0] ? 0 : t >= DOE_WALK[1][0] ? 1 : (t - DOE_WALK[0][0]) / (DOE_WALK[1][0] - DOE_WALK[0][0]);
    const [, ax, ay, az] = DOE_WALK[0];
    const [, bx, by, bz] = DOE_WALK[1];
    out.x = ax + (bx - ax) * k;
    out.y = ay + (by - ay) * k;
    out.z = az + (bz - az) * k;
    return out;
  }
  const p = POINTS[name === "doeBone" ? "doeStand" : name];
  out.x = p[0];
  out.y = p[1];
  out.z = p[2];
  return out;
}

// ---- the shots ------------------------------------------------------------------------------------------------------

const shot = (yaw: number, lift: number, dolly: number, focus: number, zoom: number): Readonly<Shot> =>
  Object.freeze({ yaw, lift, dolly, focus, zoom });

/** How a segment moves between its keys: straight lines (under way at the cut), or eased monotone cubics. */
export type Interp = "L" | "E";

/** One shot of the cut, from its first frame to the cut out of it. */
export interface Segment {
  /** the shot list's name (S01..S19, M1..M5, C1; R1, R2 and V1, V2 are the alternates) */
  id: string;
  from: number;
  to: number;
  /** the camera's keys (logic Shot); one key is a locked-off shot, still breathing on the wander */
  keys: readonly (readonly [number, Readonly<Shot>])[];
  interp: Interp;
  /** the lens: a pan toward a point, a lens shift, riding the stem as it grows, or the coda's match to the party */
  lens?: { look?: number; target?: PointName; shiftX?: number; shiftY?: number; follow?: boolean; coda?: boolean };
  /** the depth of field: its focus (pulled from `target` to `to` by `rack`), its sharp range (m) and bokeh (×) */
  dof: { target: PointName; to?: PointName; rack?: readonly Key[]; range: number; bokeh: number };
  /** trailerFx particle multipliers held through the shot (1 when absent; fireflies follow their own channel) */
  pollen?: number;
  pollenSize?: number;
  fluff?: number;
  fireflies?: number;
}

/** The overhead over the mound, S02, and the same offsets over the open rose, S13 (the rhyme). */
const OVER_A = shot(0.12, 0.8, 0.42, 1, 1);
const OVER_B = shot(0.2, 0.8, 0.42, 1, 1);
/** The golden wide, S09 and S14 (the same offsets). */
const WIDE = shot(0, 0.04, 1.25, 0, 1.08);
/** The drink's close-up, S05 (and the reduced-motion care beat). */
const DRINK_A = shot(0, -0.03, 0.12, 1, 0.6);
const DRINK_B = shot(0, -0.03, 0.115, 1, 0.6);
/** Over the big soft rose toward the doe, S17. */
const OVER_ROSE = shot(0.2, 0.02, 0.29, 1, 0.75);

/** The cut up to the montage, the picture showing from 0.8 s. */
const OPENING: readonly Segment[] = [
  {
    id: "S01",
    from: 0,
    to: 3.4,
    keys: [
      [0, shot(0.08, 0.14, 0.13, 1, 0.75)],
      [3.4, shot(0.06, 0.14, 0.115, 1, 0.75)],
    ],
    interp: "L",
    lens: { shiftY: 0.04 },
    dof: { target: "seed", range: 0.18, bokeh: 1.4 },
    pollen: 0.3,
    fluff: 0.3,
  },
  {
    // the god's-eye view, and the can's latch camera: where the can pours is chosen from where this camera stands
    id: "S02",
    from: 3.4,
    to: 6.0,
    keys: [
      [3.4, OVER_A],
      [6.0, OVER_B],
    ],
    interp: "L",
    dof: { target: "seed", range: 0.6, bokeh: 1.0 },
    fluff: 0.3,
  },
  {
    id: "S03",
    from: 6.0,
    to: 7.9,
    keys: [[6.0, shot(0.3, 0.02, 0.42, 1, 0.9)]],
    interp: "L",
    lens: { look: 0.55, target: "canHome" },
    dof: { target: "canHome", range: 0.35, bokeh: 1.3 },
  },
  {
    id: "S04",
    from: 7.9,
    to: 9.6,
    keys: [[7.9, shot(-0.3, 0.06, 0.3, 1, 0.9)]],
    interp: "L",
    lens: { look: 0.6, target: "pourAim" },
    dof: {
      target: "spout",
      to: "seed",
      rack: [
        [8.7, 0],
        [8.95, 1],
      ],
      range: 0.3,
      bokeh: 1.2,
    },
  },
  {
    id: "S05",
    from: 9.6,
    to: 11.4,
    keys: [
      [9.6, DRINK_A],
      [11.4, DRINK_B],
    ],
    interp: "L",
    lens: { shiftY: 0.08 },
    dof: { target: "seed", range: 0.08, bokeh: 1.4 },
    pollen: 0.3,
    fluff: 0.3,
  },
  {
    id: "S06",
    from: 11.4,
    to: 14.6,
    keys: [[11.4, shot(0.05, -0.02, 0.16, 1, 0.7)]],
    interp: "L",
    lens: { follow: true, shiftY: 0.06 },
    dof: { target: "head", range: 0.12, bokeh: 1.4 },
    pollen: 0.3,
    fluff: 0.3,
  },
  {
    id: "S07",
    from: 14.6,
    to: 16.8,
    keys: [[14.6, shot(0.12, -0.3, 0.24, 1, 0.85)]],
    interp: "L",
    lens: { look: 0.16, target: "sky", follow: true, shiftY: 0.1 },
    dof: { target: "head", range: 0.5, bokeh: 1.2 },
  },
  {
    id: "S08",
    from: 16.8,
    to: 19.0,
    keys: [[16.8, shot(-0.22, -0.16, 0.26, 1, 0.75)]],
    interp: "L",
    lens: { follow: true, shiftY: 0.08 },
    dof: { target: "head", range: 0.4, bokeh: 1.2 },
  },
  {
    id: "S09",
    from: 19.0,
    to: 21.8,
    keys: [[19.0, WIDE]],
    interp: "L",
    dof: { target: "head", range: 3.0, bokeh: 0.6 },
  },
  {
    id: "S10",
    from: 21.8,
    to: 25.0,
    keys: [
      [21.8, shot(0.18, -0.1, 0.42, 1, 0.85)],
      [25.0, shot(0.18, 0, 0.36, 1, 0.85)],
    ],
    interp: "E",
    lens: { follow: true, shiftY: 0.05 },
    dof: { target: "head", range: 0.8, bokeh: 1.0 },
  },
  {
    // the light cue, uncut: the wind dies, the cloud slides off the low sun, the rim light switches on, the sepals part
    id: "S11",
    from: 25.0,
    to: 29.4,
    keys: [
      [25.0, shot(0.15, -0.38, 0.3, 1, 0.78)],
      [29.4, shot(0.15, -0.38, 0.28, 1, 0.78)],
    ],
    interp: "L",
    dof: { target: "head", range: 0.45, bokeh: 1.3 },
    pollen: 2.0,
    pollenSize: 1.4,
  },
  {
    // the payoff, cut on the home chord
    // the bloom card's own view of the flower (lib/garden/cardAim), close enough that the opening petals fill the band
    // and far enough that they never leave it; the lens lowers the bloom, which stands above its head's point
    id: "S12",
    from: 29.4,
    to: 31.6,
    keys: [
      [29.4, shot(0.12, -0.04, 0.22, 1, 0.75)],
      [31.6, shot(0.14, -0.05, 0.19, 1, 0.75)],
    ],
    interp: "L",
    lens: { shiftY: -0.06 },
    dof: { target: "head", range: 0.18, bokeh: 1.4 },
    pollen: 0.3,
    fluff: 0.3,
  },
  {
    // the rhyme: S02's offsets, over the open rose
    id: "S13",
    from: 31.6,
    to: 33.6,
    keys: [
      [31.6, OVER_A],
      [33.6, OVER_B],
    ],
    interp: "L",
    dof: { target: "head", range: 0.35, bokeh: 1.2 },
    pollen: 2.0,
    pollenSize: 1.4,
    fluff: 0.3,
  },
  {
    id: "S14",
    from: 33.6,
    to: 38.4,
    keys: [[33.6, WIDE]],
    interp: "L",
    dof: { target: "head", range: 3.0, bokeh: 0.6 },
    pollen: 1.6,
    pollenSize: 1.2,
  },
  {
    id: "S15",
    from: 38.4,
    to: 39.8,
    keys: [[38.4, shot(-0.3, 0, 0.7, 1, 0.55)]],
    interp: "L",
    lens: { look: 1, target: "doeWalk" },
    dof: { target: "doeBone", range: 0.8, bokeh: 1.2 },
    pollen: 1.4,
    pollenSize: 1.2,
  },
  {
    id: "S16",
    from: 39.8,
    to: 41.8,
    keys: [[39.8, shot(-0.3, 0.02, 0.7, 1, 0.45)]],
    interp: "L",
    lens: { look: 1, target: "doeGraze" },
    dof: { target: "doeBone", range: 0.5, bokeh: 1.3 },
    pollen: 1.4,
    pollenSize: 1.2,
  },
  {
    // the peak: through the big soft rose, focus travels to her eyes as she looks at it
    id: "S17",
    from: 41.8,
    to: 44.6,
    keys: [[41.8, OVER_ROSE]],
    interp: "L",
    lens: { look: 0.42, target: "doeStand" },
    dof: {
      target: "head",
      to: "doeBone",
      rack: [
        [42.0, 0],
        [42.85, 1],
        [44.5, 1],
        [44.55, 0],
      ],
      range: 0.5,
      bokeh: 1.4,
    },
    pollen: 1.4,
    pollenSize: 1.2,
  },
  {
    // night, from the lantern's side, out of the chapter's black; the lamp strikes and the focus pulls to the rose
    id: "S18",
    from: 44.6,
    to: 46.9,
    keys: [
      [44.6, shot(-0.45, 0.03, 0.6, 0.5, 0.9)],
      [46.9, shot(-0.4, 0.03, 0.58, 0.5, 0.9)],
    ],
    interp: "L",
    dof: {
      target: "lamp",
      to: "head",
      rack: [
        [45.6, 0],
        [46.3, 1],
      ],
      range: 0.8,
      bokeh: 1.0,
    },
  },
  {
    id: "S19",
    from: 46.9,
    to: slotAt(0) + DIP_IN,
    keys: [
      [46.9, shot(0.2, 0.3, 0.36, 1, 0.9)],
      [48.75, shot(0.2, 0.3, 0.33, 1, 0.9)],
    ],
    interp: "L",
    lens: { shiftY: 0.06 },
    dof: { target: "head", range: 0.6, bokeh: 1.1 },
  },
];

/**
 * The montage: each flower one segment, from its slot's full black (before its gate) to the next slot's, its first key
 * held until the black lifts so the gate's frame is the slot's widest, then a straight push (never an orbit that would
 * show parts of the rebuilt flower the gate never drew). The sundrop's push ends under the last dip and holds.
 */
const MONTAGE_SHOTS: readonly {
  id: string;
  a: Readonly<Shot>;
  b: Readonly<Shot>;
  dof: Segment["dof"];
  pollen?: number;
  fluff?: number;
}[] = [
  { id: "M1", a: shot(0.02, -0.06, 0.55, 1, 0.9), b: shot(0.02, -0.06, 0.4, 1, 0.9), dof: { target: "head", range: 0.4, bokeh: 1.2 } },
  { id: "M2", a: shot(0.05, 0.7, 0.32, 1, 0.9), b: shot(0.05, 0.7, 0.28, 1, 0.9), dof: { target: "head", range: 0.35, bokeh: 1.2 }, fluff: 0.3 },
  {
    id: "M3",
    a: shot(0.35, -0.04, 0.2, 1, 0.7),
    b: shot(0.35, -0.04, 0.16, 1, 0.7),
    dof: { target: "head", range: 0.15, bokeh: 1.4 },
    pollen: 0.3,
    fluff: 0.3,
  },
  { id: "M4", a: shot(-0.5, 0.04, 0.58, 0.8, 0.9), b: shot(-0.5, 0.04, 0.52, 0.8, 0.9), dof: { target: "head", range: 0.5, bokeh: 1.1 } },
  { id: "M5", a: shot(0.12, -0.34, 0.32, 1, 0.8), b: shot(0.12, -0.34, 0.28, 1, 0.8), dof: { target: "head", range: 0.4, bokeh: 1.2 } },
];
/** The fireflies through the montage, and round the coda's seed. */
const MONTAGE_FIREFLIES = 1.3;
const CODA_FIREFLIES = 1.4;

const MONTAGE_SEGMENTS: readonly Segment[] = MONTAGE_SHOTS.map((m, i) => {
  const from = slotAt(i) + DIP_IN;
  const last = i === MONTAGE_SHOTS.length - 1;
  const to = last ? RESTORE_AT : slotAt(i + 1) + DIP_IN;
  const end = last ? END_BLACK_AT : to;
  return {
    id: m.id,
    from,
    to,
    keys: [
      [from, m.a],
      [slotAt(i) + DIP_HOLD_TO, m.a],
      [end, m.b],
    ],
    interp: "L",
    dof: m.dof,
    pollen: m.pollen,
    fluff: m.fluff,
    fireflies: MONTAGE_FIREFLIES,
  };
});

/** The button: a new seed at night, framed (by the coda's lens shift) where the party's rose will stand. */
const CODA_SEGMENT: Segment = {
  id: "C1",
  from: RESTORE_AT,
  to: HOME_AT,
  keys: [[RESTORE_AT, shot(0.08, 0.12, 0.15, 1, 0.8)]],
  interp: "L",
  lens: { coda: true },
  dof: { target: "seed", range: 0.18, bokeh: 1.4 },
  pollen: 0.3,
  fluff: 0.3,
  fireflies: CODA_FIREFLIES,
};

/** The shot list (from 0 to HOME_AT, every cut a boundary); from HOME_AT the party camera's own HOME. */
export const SEGMENTS: readonly Segment[] = [...OPENING, ...MONTAGE_SEGMENTS, CODA_SEGMENT];

/**
 * Reduced motion (the operator's laptop asks for it): the can stays where it stands and only the soil answers
 * (canLive's own rule), so the care beat watches the soil instead, the drink's close-up and then the wet patch from
 * above.
 */
const REDUCED_CARE: readonly Segment[] = [
  {
    id: "R1",
    from: 6.0,
    to: 9.6,
    keys: [
      [6.0, DRINK_A],
      [9.6, DRINK_B],
    ],
    interp: "L",
    lens: { shiftY: 0.08 },
    dof: { target: "seed", range: 0.08, bokeh: 1.4 },
    pollen: 0.3,
    fluff: 0.3,
  },
  {
    id: "R2",
    from: 9.6,
    to: 11.4,
    keys: [
      [9.6, OVER_A],
      [11.4, OVER_B],
    ],
    interp: "L",
    dof: { target: "seed", range: 0.6, bokeh: 1.0 },
    fluff: 0.3,
  },
];

/** No doe (she failed to build): the rose rim-lit close up while she would arrive and graze, then the same frame as her look, without her. */
const NO_VISITOR: readonly Segment[] = [
  {
    id: "V1",
    from: 38.4,
    to: 41.8,
    keys: [[38.4, shot(0.13, -0.06, 0.2, 1, 0.75)]],
    interp: "L",
    dof: { target: "head", range: 0.25, bokeh: 1.3 },
    pollen: 1.4,
    pollenSize: 1.2,
  },
  {
    id: "V2",
    from: 41.8,
    to: 44.6,
    keys: [[41.8, OVER_ROSE]],
    interp: "L",
    dof: { target: "head", range: 0.5, bokeh: 1.4 },
    pollen: 1.4,
    pollenSize: 1.2,
  },
];

/** How the trailer is played: honouring reduced motion, and with or without the doe. */
export interface TrailerOptions {
  /** the operator's laptop asks for reduced motion (read once as the trailer starts) */
  reduced: boolean;
  /** the doe was built and can walk in */
  visitor: boolean;
}

export const DEFAULT_OPTIONS: Readonly<TrailerOptions> = Object.freeze({ reduced: false, visitor: true });

const swap = (list: readonly Segment[], out: readonly string[], into: readonly Segment[]): Segment[] => {
  const at = list.findIndex((s) => s.id === out[0]);
  return [...list.slice(0, at), ...into, ...list.slice(at + out.length)];
};

const LISTS = new Map<string, readonly Segment[]>();
/** The shot list for these options. */
export function segmentsFor(options: Readonly<TrailerOptions> = DEFAULT_OPTIONS): readonly Segment[] {
  const key = `${options.reduced ? 1 : 0}${options.visitor ? 1 : 0}`;
  let list = LISTS.get(key);
  if (!list) {
    let l: readonly Segment[] = SEGMENTS;
    if (options.reduced) l = swap(l, ["S03", "S04", "S05"], REDUCED_CARE);
    if (!options.visitor) l = swap(l, ["S15", "S16", "S17"], NO_VISITOR);
    list = Object.freeze(l);
    LISTS.set(key, list);
  }
  return list;
}

/** The segment playing at `t` (the first before it starts), or null from HOME_AT. */
export function segmentAt(t: number, options: Readonly<TrailerOptions> = DEFAULT_OPTIONS): Segment | null {
  if (t >= HOME_AT) return null;
  const list = segmentsFor(options);
  for (let i = list.length - 1; i >= 0; i--) if (t >= list[i].from) return list[i];
  return list[0];
}

const SHOT_FIELDS = ["yaw", "lift", "dolly", "focus", "zoom"] as const;
const eased = new WeakMap<Segment, Track[]>();
const racks = new WeakMap<Segment, Track>();

/** The segment's focus pull at `t` (0 on its target .. 1 on its second point), or 0 for a shot that pulls none. */
function rackOf(seg: Segment, t: number): number {
  const keys = seg.dof.rack;
  if (!keys || !seg.dof.to) return 0;
  let track = racks.get(seg);
  if (!track) {
    track = new Track(keys);
    racks.set(seg, track);
  }
  return clamp01(track.at(t));
}

/** The segment's shot at `t`, into `out`. */
function shotOf(seg: Segment, t: number, out: Shot): Shot {
  const keys = seg.keys;
  if (keys.length === 1) return Object.assign(out, keys[0][1]);
  if (seg.interp === "E") {
    let tracks = eased.get(seg);
    if (!tracks) {
      tracks = SHOT_FIELDS.map((k) => new Track(keys.map(([kt, s]) => [kt, s[k]] as const)));
      eased.set(seg, tracks);
    }
    for (let i = 0; i < SHOT_FIELDS.length; i++) out[SHOT_FIELDS[i]] = tracks[i].at(t);
    return out;
  }
  if (t <= keys[0][0]) return Object.assign(out, keys[0][1]);
  const n = keys.length;
  if (t >= keys[n - 1][0]) return Object.assign(out, keys[n - 1][1]);
  let i = 0;
  while (t > keys[i + 1][0]) i++;
  const [t0, a] = keys[i];
  const [t1, b] = keys[i + 1];
  const k = (t - t0) / (t1 - t0);
  for (const f of SHOT_FIELDS) out[f] = a[f] + (b[f] - a[f]) * k;
  return out;
}

// ---- the garden's channels ------------------------------------------------------------------------------------------

/** The hours, set against the day's golden hour `g` (about 17.45 on the party night); the jump to night under the chapter's black. */
function hourKeys(g: number): Key[] {
  return [
    [0, 6.2],
    [WATER_AT, 6.45],
    [GROW_AT, 6.9],
    [14.6, 8.6],
    [16.8, 11.4],
    [19.0, 13.2],
    [21.8, 14.9],
    [BLOOM_AT, g - 0.7],
    [27.6, g - 0.5],
    [29.4, g - 0.42],
    [31.6, g - 0.34],
    [VISIT_AT, g - 0.28],
    [38.4, g - 0.16],
    [41.6, g - 0.02],
    [44.45, g + 0.22],
    [44.65, g + 0.95],
    [NIGHT_AT, g + 1.0],
    [46.9, g + 1.4],
    [FLOWERS_AT, g + 1.85],
  ];
}

const GROWTH = new Track([
  // the seed glows in its mound, no head yet, through its first drink from the can
  [0, 0],
  [GROW_AT, 0.025],
  [14.6, 0.13],
  [16.8, 0.33],
  [19.0, 0.52],
  [21.8, 0.74],
  [BLOOM_AT, 0.92],
  [27.6, 0.97],
  [28.6, 1],
]);
/** The sepals part as the cloud slides off (28.6), the home chord lands on the opening petals (29.4). */
const BLOOM = new Track([
  [28.0, 0],
  [32.6, 1],
]);
/** The shower: never above 0.82, so the butterflies fly off rather than vanish. */
const RAIN = new Track([
  [16.2, 0],
  [16.9, 0.8],
  [19.0, 0.8],
  [20.2, 0],
]);
/** Grey for the shower, torn open as the sun breaks (about 20.3), a cloud on the low sun that slides off over the light cue. */
const CLOUD = new Track([
  [0, 0.15],
  [14.6, 0.15],
  [16.2, 0.75],
  [18.8, 0.8],
  [20.0, 0.7],
  [20.8, 0.25],
  [24.0, 0.2],
  [25.6, 0.65],
  [27.8, 0.68],
  [29.1, 0.06],
  [44.2, 0.08],
  [44.65, 0.1],
]);
/**
 * The wind: low through the slow motion (the sway runs on the wall clock and would betray it), a storm before the
 * shower, a held breath for the light cue, an exhale as the petals finish opening, stillness for her look.
 */
const WIND = new Track([
  [0, 0.25],
  [WATER_AT, 0.2],
  [11.4, 0.25],
  [14.6, 0.6],
  [16.0, 1.3],
  [17.2, 1.6],
  [18.8, 1.4],
  [20.4, 0.7],
  [23.0, 0.45],
  [25.4, 0.45],
  [26.4, 0.06],
  [30.8, 0.06],
  [31.6, 0.7],
  [32.8, 0.35],
  [VISIT_AT, 0.3],
  [40.0, 0.2],
  [41.8, 0.08],
  [44.2, 0.15],
  [NIGHT_AT, 0.3],
  [46.9, 0.45],
  [FLOWERS_AT, 0.35],
]);

/** The garden store's wind when nothing drives it (lib/garden/store), which stageShowcase's reset puts back. */
export const WIND_REST = 0.5;

/**
 * The can's moment's pace on the trailer's clock (moment seconds per trailer second, straight lines between): real
 * time through the carry and the tip, true slow motion as the water falls and lands, real time again until the can is
 * still, then hurried on with the time-lapse, so the wet it left dries as the day passes.
 */
/** The slowest the can's moment runs (moment s per trailer s), and how much faster than real time once it is still. */
export const WATER_SLOWEST = 0.3;
const WATER_HURRY = 8;
const WATER_RATE: readonly Key[] = [
  [WATER_AT, 1],
  [8.7, 1],
  [8.9, WATER_SLOWEST],
  [10.3, WATER_SLOWEST],
  [10.7, 1],
];
/** The moment (s) reached at each rate key, for integrating the straight-line rate. */
const WATER_MOMENTS: readonly number[] = WATER_RATE.map((_, i) =>
  WATER_RATE.slice(0, i).reduce((m, [t0, r0], j) => m + ((WATER_RATE[j + 1][0] - t0) * (r0 + WATER_RATE[j + 1][1])) / 2, 0),
);
const WATER_LAST = WATER_RATE[WATER_RATE.length - 1];
/** When (trailer s) the can's moment reaches CAN.still, after which it hurries. */
const WATER_STILL_AT = WATER_LAST[0] + (CAN.still - WATER_MOMENTS[WATER_MOMENTS.length - 1]);

/** The watering can's moment at trailer time t (s since it was pressed, on the trailer's clock), or -1 for none. */
function waterAt(t: number): number {
  if (t < WATER_AT || t >= RESTORE_AT) return -1;
  for (let i = 0; i < WATER_RATE.length - 1; i++) {
    const [t0, r0] = WATER_RATE[i];
    const [t1, r1] = WATER_RATE[i + 1];
    if (t <= t1) {
      const r = r0 + ((r1 - r0) * (t - t0)) / (t1 - t0);
      return WATER_MOMENTS[i] + ((t - t0) * (r0 + r)) / 2;
    }
  }
  if (t <= WATER_STILL_AT) return WATER_MOMENTS[WATER_MOMENTS.length - 1] + (t - WATER_LAST[0]);
  return CAN.still + (t - WATER_STILL_AT) * WATER_HURRY;
}

/** The nominal times of the can's last drips (canMoment varyOf), which a press's own drips vary about. */
export const DRIP_NOMINAL: readonly number[] = [5.3, 5.8, 6.5, 7.05];
/** The furthest back (ms) the director looks for a press stamp that pours the trailer's way. */
export const PRESS_SEARCH_MS = 200;

/**
 * The can's press for this run: the latest stamp at or before `now` (ms), at most PRESS_SEARCH_MS back, whose own
 * variation (canMoment varyOf) sweeps the positive way and lets all four last drips fall, so every run pours as the
 * cut was framed; `now` itself if none does. Also the run's drip offsets (s) from their nominal times, for the music.
 */
export function pickCanPress(now: number): { at: number; drips: number[] } {
  for (let back = 0; back <= PRESS_SEARCH_MS; back++) {
    const v = varyOf(now - back);
    if (v.sweep > 0 && v.drips.length === DRIP_NOMINAL.length) return { at: now - back, drips: v.drips.map((d, i) => d - DRIP_NOMINAL[i]) };
  }
  return { at: now, drips: varyOf(now).drips.map((d, i) => d - DRIP_NOMINAL[i]) };
}

/** Black over the picture: the fade up, the chapter's black, each flower's dip, the end, the coda and the last black. */
function coverKeys(): Key[] {
  const keys: Key[] = [
    [0, 1],
    [0.8, 0],
    [44.2, 0],
    [44.45, 1],
    [44.75, 1],
    [NIGHT_AT, 0],
  ];
  for (let i = 0; i < MONTAGE.length; i++) {
    const s = slotAt(i);
    keys.push([s, 0], [s + DIP_IN, 1], [s + DIP_HOLD_TO, 1], [s + DIP_OUT_TO, 0]);
  }
  keys.push(
    [END_AT, 0],
    [END_BLACK_AT, 1],
    [CODA_AT, 1],
    [CODA_AT + 0.5, 0],
    [HOME_AT - 0.4, 0],
    [HOME_AT - 0.05, 1],
    [RETURN_AT + 0.8, 1],
    [TRAILER_S, 0],
  );
  return keys;
}
const COVER = new Track(coverKeys());

// ---- the scene's trailer multipliers (lib/garden/trailerFx) -----------------------------------------------------------

/** The heart's glow swelling after the chord (the montage keeps each flower's own); lite caps it at 2.5. */
const GLOW = new Track([
  [0, 1],
  [29.5, 1],
  [30.6, 5],
  [VISIT_AT, 3],
  [38.4, 2],
  [44.2, 2],
  [44.65, 1.5],
  [46.9, 1.8],
  [FLOWERS_AT, 1],
]);
/** The rim kicker switching on as the cloud slides off. */
const RIM = new Track([
  [0, 1],
  [27.8, 1],
  [29.1, 1.4],
  [VISIT_AT, 1.4],
  [38.4, 1.2],
  [41.8, 1.2],
  [44.2, 1],
]);
/** The seed of light, brighter than the garden's own until the shoot has broken through. */
const SEED_LIGHT = new Track([
  [5.999, 2.6],
  [6.0, 1.8],
  [12.6, 1.8],
  [13.2, 1],
]);
const CODA_SEED_LIGHT = 1.8;
/** The seed's light set in the mound's crown (m above its own place) while the close shots look at it. */
const SEED_RISE = new Track([
  [12.6, 0.014],
  [13.2, 0],
]);
const CODA_SEED_RISE = 0.014;
/** Scent sparkles lifting off the opening rose. */
const SCENT = new Track([
  [30.2, 0],
  [30.8, 0.85],
  [32.6, 0.6],
  [34.0, 0],
]);
/** The lantern low through the chapter's black, struck in a swell, then settling. */
const LAMP = new Track([
  [DOE_OFF, 1],
  [DOE_OFF + 0.05, 0.3],
  [45.6, 0.3],
  [46.15, 1.15],
  [47.4, 1.0],
]);
/** The fireflies rising as the lantern strikes (the montage and the coda have their own). */
const FIREFLIES = new Track([
  [NIGHT_AT, 1],
  [46.0, 1.5],
]);
/**
 * The seed's hops in the coda, "hel-lo": its light swells at each (straight lines, each rise long enough never to
 * flash, the second from where the first has fallen to), and the mound bulges (eased; none under reduced motion).
 */
const SEED_PULSE: readonly Key[] = [
  [HELLO_AT, 0],
  [HELLO_AT + 0.32, 1],
  [HELLO_AT + HELLO_GAP_S, 0.6],
  [HELLO_AT + HELLO_GAP_S + 0.32, 1],
  [HELLO_AT + HELLO_GAP_S + 0.92, 0],
];
const SEED_BULGE = new Track([
  [HELLO_AT, 0],
  [HELLO_AT + 0.15, 1],
  [HELLO_AT + HELLO_GAP_S, 0.2],
  [HELLO_AT + HELLO_GAP_S + 0.15, 1],
  [HELLO_AT + HELLO_GAP_S + 0.5, 0],
]);

// ---- the film look (lib/garden/look) ---------------------------------------------------------------------------------

/** × on the exposure: eyes adjusting at dawn, a darker shower, the sun breaking, the light cue, the payoff. */
const EXPOSURE = new Track([
  [0, 0.9],
  [2.0, 1.0],
  [16.8, 1.0],
  [17.3, 0.92],
  [20.0, 0.92],
  [20.8, 1.08],
  [21.8, 1.0],
  [BLOOM_AT, 0.95],
  [27.8, 0.95],
  [29.1, 1.08],
  [30.6, 1.1],
  [31.6, 1.06],
  [VISIT_AT, 1.0],
  [NIGHT_AT, 0.97],
  [FLOWERS_AT, 1.0],
]);
const BLOOM_INTENSITY = new Track([
  [0, 0.95],
  [3.4, 0.9],
  [11.4, 0.85],
  [16.8, 0.8],
  [20.0, 0.8],
  [20.8, 0.95],
  [21.8, 0.9],
  [BLOOM_AT, 0.85],
  [27.8, 0.85],
  [29.1, 1.1],
  [30.6, 1.3],
  [31.6, 1.2],
  [VISIT_AT, 1.0],
  [41.8, 1.0],
  [44.2, 1.05],
]);
/** The heart's glow pushed through a lowered threshold at the payoff (lite's floor keeps it above 0.95). */
const BLOOM_THRESHOLD = new Track([
  [0, 0.82],
  [11.4, 0.85],
  [20.8, 0.82],
  [BLOOM_AT, 0.85],
  [27.8, 0.85],
  [29.1, 0.8],
  [30.6, 0.74],
  [31.6, 0.76],
  [VISIT_AT, 0.82],
  [41.8, 0.8],
]);
/** Vignette darkness and offset: an iris on the seed and in the shower, open for the wide, an iris-in on her look. */
const VIGNETTE: readonly (readonly [number, number, number])[] = [
  [0, 0.55, 0.2],
  [3.4, 0.5, 0.22],
  [11.4, 0.4, 0.25],
  [16.8, 0.5, 0.22],
  [20.0, 0.4, 0.25],
  [BLOOM_AT, 0.54, 0.2],
  [27.8, 0.54, 0.2],
  [29.1, 0.42, 0.22],
  [VISIT_AT, 0.36, 0.28],
  [38.4, 0.42, 0.25],
  [41.8, 0.42, 0.25],
  [43.5, 0.58, 0.18],
  [NIGHT_AT, 0.55, 0.18],
  [FLOWERS_AT, 0.5, 0.2],
];
const VIGNETTE_DARKNESS = new Track(VIGNETTE.map(([t, d]) => [t, d] as const));
const VIGNETTE_OFFSET = new Track(VIGNETTE.map(([t, , o]) => [t, o] as const));
/** Saturation and contrast: a desaturated, harder shower, a richer golden hour, a moodier night. */
const TONE: readonly (readonly [number, number, number])[] = [
  [0, 0.02, 0.06],
  [16.8, 0.02, 0.06],
  [17.4, -0.08, 0.12],
  [20.0, -0.08, 0.12],
  [20.8, 0.04, 0.06],
  [BLOOM_AT, 0.03, 0.07],
  [29.1, 0.05, 0.07],
  [VISIT_AT, 0.04, 0.07],
  [44.6, -0.04, 0.09],
  [49.0, 0, 0.08],
];
const SATURATION = new Track(TONE.map(([t, s]) => [t, s] as const));
const CONTRAST = new Track(TONE.map(([t, , c]) => [t, c] as const));
/** Grain: a faster stock in the rain and at night, barely any at the golden bloom. */
const GRAIN = new Track([
  [0, 0.04],
  [WATER_AT, 0.035],
  [GROW_AT, 0.03],
  [17.4, 0.055],
  [20.8, 0.03],
  [BLOOM_AT, 0.02],
  [VISIT_AT, 0.03],
  [44.6, 0.05],
  [49.0, 0.045],
]);
/** The lens breathing on the payoff's cut: chromatic aberration doubled, settling over half a second. */
const CA_BREATH: readonly Key[] = [
  [29.4, 2],
  [29.9, 1],
];

/** The grade presets (the channel mixer's rows, R, G, B, each as weights of the input r, g, b). */
export const GRADES = Object.freeze({
  IDENTITY: MIXER_IDENTITY,
  DAWN: [1.05, 0, 0, 0, 1.0, 0, 0, 0, 0.93],
  DAY: [1.0, 0, 0, 0, 1.0, 0, 0, 0, 1.0],
  RAIN: [0.96, 0, 0, 0, 0.99, 0, 0, 0, 1.05],
  SUN: [1.02, 0, 0, 0, 1.0, 0, 0, 0, 0.97],
  GOLDEN: [1.07, 0, 0, 0, 1.01, 0, 0, 0, 0.88],
  AMBER: [1.08, 0, 0, 0, 1.0, 0, 0, 0, 0.86],
  NIGHT: [0.93, 0, 0, 0, 0.98, 0, 0, 0.03, 1.07],
  MONTAGE: [0.95, 0, 0, 0, 0.99, 0, 0, 0.02, 1.05],
  CODA: [1.0, 0, 0, 0, 0.99, 0, 0, 0, 1.0],
} as const satisfies Record<string, readonly number[]>);
export type GradeName = keyof typeof GRADES;

/** The grade's keys: straight blends between consecutive presets, the night's turns under black. */
const GRADE: readonly (readonly [number, GradeName])[] = [
  [0, "DAWN"],
  [WATER_AT, "DAWN"],
  [GROW_AT, "DAY"],
  [16.8, "DAY"],
  [17.4, "RAIN"],
  [20.0, "RAIN"],
  [20.8, "SUN"],
  [22.0, "SUN"],
  [BLOOM_AT, "GOLDEN"],
  [VISIT_AT, "GOLDEN"],
  [34.4, "AMBER"],
  [44.45, "AMBER"],
  [44.6, "NIGHT"],
  [FLOWERS_AT, "NIGHT"],
  [49.0, "MONTAGE"],
  [END_AT, "MONTAGE"],
  [CODA_AT, "CODA"],
  [HOME_AT, "IDENTITY"],
];

function gradeAt(t: number, out: number[]): number[] {
  let a = GRADE[0];
  let b = GRADE[0];
  let k = 0;
  if (t >= GRADE[GRADE.length - 1][0]) a = b = GRADE[GRADE.length - 1];
  else if (t > GRADE[0][0]) {
    let i = 0;
    while (t > GRADE[i + 1][0]) i++;
    a = GRADE[i];
    b = GRADE[i + 1];
    k = (t - a[0]) / (b[0] - a[0]);
  }
  const ga = GRADES[a[1]];
  const gb = GRADES[b[1]];
  for (let i = 0; i < 9; i++) out[i] = ga[i] + (gb[i] - ga[i]) * k;
  return out;
}

// ---- the coda -------------------------------------------------------------------------------------------------------

/** The garden for the coda, staged at the RESTORE gate (control stageCoda) and held until HOME_AT: a seed at night. */
export const CODA = Object.freeze({ growth: 0, bloom: 0, afterGolden: 1.85, rain: 0, cloud: 0.15, wind: 0.2 });
/** The coda's film look (its depth of field is its shot's, its grade the grade's keys). */
const CODA_LOOK = Object.freeze({
  exposure: 1.0,
  bloomIntensity: 1.1,
  bloomThreshold: 0.78,
  vignetteDarkness: 0.6,
  vignetteOffset: 0.18,
  saturation: 0,
  contrast: 0.06,
  grain: 0.04,
  ca: 1,
});

// ---- one frame -------------------------------------------------------------------------------------------------------

/** The lens of a frame: a pan toward a named point, the lens shift, riding the stem, or the coda's match to the party. */
export interface FrameLens {
  /** 0 the shot's own aim .. 1 straight at the target */
  look: number;
  /** the point it pans toward (null for none); `point` holds it for every name but `head` and `doeBone` */
  target: PointName | null;
  point: XYZ;
  /** the share of the frame the subject moves left (x) and up (y) */
  shiftX: number;
  shiftY: number;
  /** the aim takes the flower head as it stands, frame by frame */
  follow: boolean;
  /** the coda: the director's coda shift (logic codaShift) takes the place of shiftX and shiftY */
  coda: boolean;
}

/** The focus of a frame: on `from`, pulled toward `to` by `rack` (0..1); the points as in FrameLens. */
export interface FrameDof {
  from: PointName;
  to: PointName | null;
  fromPoint: XYZ;
  toPoint: XYZ;
  rack: number;
}

/** The type over the picture (the overlay's, through the trailer store). */
export interface FrameText {
  /** the line shown last (kept as it fades out), how many of its groups are in, and whether it is on */
  line: LineId | null;
  lineGroups: number;
  lineOn: boolean;
  /** the montage flower's name shown last (kept as it fades out), and whether it is on */
  name: string | null;
  nameOn: boolean;
  title: boolean;
  tagline: boolean;
}

export interface TrailerFrame {
  hour: number;
  growth: number;
  bloom: number;
  rain: number;
  cloud: number;
  wind: number;
  shot: Shot;
  lens: FrameLens;
  dof: FrameDof;
  /** the doe is in the garden (she walks in when it first turns on) */
  doe: boolean;
  /** the watering can's moment (s since it was pressed, on the trailer's clock), or -1 for none */
  water: number;
  /** the flower in the bed (the rose, or one of the montage) */
  species: SoilSpeciesId;
  /** 0 the picture .. 1 black */
  cover: number;
  /** the scene's trailer multipliers (lib/garden/trailerFx) */
  fx: SceneFx;
  /** the film look (lib/garden/look), the depth of field's range and bokeh included */
  look: LookValues;
  text: FrameText;
  events: {
    /** the shot list's name of the segment playing ("HOME" from HOME_AT): a change is a cut */
    shot: string;
    /** the night's weather snap is due (from WEATHER_SNAP_AT); the director makes it once */
    weatherSnap: boolean;
  };
  /** the film bars are up */
  bars: boolean;
  /** the coda (RESTORE_AT until HOME_AT): the director writes the coda's values */
  coda: boolean;
  /** the garden is the party's again (from HOME_AT) and the panel comes back (from RETURN_AT) */
  restored: boolean;
  panel: boolean;
}

const hourTracks = new Map<number, Track>();
function hourTrack(golden: number): Track {
  const key = Math.round(golden * 1000) / 1000;
  let track = hourTracks.get(key);
  if (!track) {
    track = new Track(hourKeys(key));
    hourTracks.set(key, track);
  }
  return track;
}

/**
 * The montage's flower in the bed at time t (from its gate until the next one, the last until the restore) and how far
 * through its slot (0..1), or null while the rose is there.
 */
export function montageAt(t: number): { index: number; s: number } | null {
  if (t < GATES[0] || t >= RESTORE_AT) return null;
  let index = 0;
  while (index + 1 < MONTAGE.length && t >= GATES[index + 1]) index++;
  const s = clamp01((t - slotAt(index)) / FLOWER_S);
  return { index, s };
}

function lensAtRest(l: FrameLens) {
  l.look = 0;
  l.target = null;
  l.point.x = l.point.y = l.point.z = 0;
  l.shiftX = 0;
  l.shiftY = 0;
  l.follow = false;
  l.coda = false;
}

/**
 * The trailer at time `t` (s), lit for a day whose golden hour is `golden`, played with `options`. Fills and returns
 * `out`. For RESTORE_AT <= t < HOME_AT it gives the coda's values; from HOME_AT every channel is the party screen's own.
 */
export function trailerAt(
  t: number,
  golden: number,
  out: TrailerFrame = blankFrame(),
  options: Readonly<TrailerOptions> = DEFAULT_OPTIONS,
): TrailerFrame {
  const home = t >= HOME_AT;
  const coda = !home && t >= RESTORE_AT;
  out.restored = home;
  out.coda = coda;
  out.bars = t < RETURN_AT;
  out.panel = t >= RETURN_AT;
  out.cover = clamp01(COVER.at(t));
  out.water = waterAt(t);
  out.doe = options.visitor && t >= VISIT_AT && t < DOE_OFF;

  // the flower: the rose until the first gate, then each of the montage's from its own, and the rose again at the restore
  const m = montageAt(t);
  out.species = m ? MONTAGE[m.index] : "rose";

  // the garden
  if (home) {
    out.hour = golden;
    out.growth = 1;
    out.bloom = 1;
    out.rain = 0;
    out.cloud = 0.15;
    out.wind = WIND_REST;
  } else if (coda) {
    out.hour = golden + CODA.afterGolden;
    out.growth = CODA.growth;
    out.bloom = CODA.bloom;
    out.rain = CODA.rain;
    out.cloud = CODA.cloud;
    out.wind = CODA.wind;
  } else {
    out.hour = hourTrack(golden).at(t);
    out.growth = GROWTH.at(t);
    out.bloom = BLOOM.at(t);
    out.rain = RAIN.at(t);
    out.cloud = CLOUD.at(t);
    out.wind = WIND.at(t);
  }

  // the shot, its lens and its focus
  const seg = segmentAt(t, options);
  const lens = out.lens;
  const dof = out.dof;
  if (!seg) {
    Object.assign(out.shot, HOME);
    lensAtRest(lens);
    dof.from = "head";
    dof.to = null;
    dof.rack = 0;
  } else {
    shotOf(seg, t, out.shot);
    const l = seg.lens;
    lens.look = l?.look ?? 0;
    lens.target = l?.target ?? null;
    if (lens.target) pointAt(lens.target, t, lens.point);
    lens.shiftX = l?.shiftX ?? 0;
    lens.shiftY = l?.shiftY ?? 0;
    lens.follow = l?.follow ?? false;
    lens.coda = l?.coda ?? false;
    dof.from = seg.dof.target;
    dof.to = seg.dof.to ?? null;
    pointAt(dof.from, t, dof.fromPoint);
    if (dof.to) pointAt(dof.to, t, dof.toPoint);
    dof.rack = rackOf(seg, t);
  }

  // the scene's multipliers
  const fx = out.fx;
  if (home) Object.assign(fx, FX_NEUTRAL);
  else {
    fx.glow = coda ? 1 : GLOW.at(t);
    fx.rim = coda ? 1 : RIM.at(t);
    fx.seedLight = coda ? CODA_SEED_LIGHT : SEED_LIGHT.at(t);
    fx.seedPulse = coda ? clamp01(linear(SEED_PULSE, t)) : 0;
    fx.seedBulge = coda && !options.reduced ? clamp01(SEED_BULGE.at(t)) : 0;
    fx.seedRise = coda ? CODA_SEED_RISE : SEED_RISE.at(t);
    fx.pollen = seg?.pollen ?? 1;
    fx.pollenSize = seg?.pollenSize ?? 1;
    fx.fluff = seg?.fluff ?? 1;
    fx.fireflies = seg?.fireflies ?? FIREFLIES.at(t);
    fx.scent = coda ? 0 : SCENT.at(t);
    fx.lamp = coda ? 1 : LAMP.at(t);
  }

  // the film look
  const look = out.look;
  if (home) {
    copyLook(look, LOOK_IDLE);
  } else {
    if (coda) copyGrade(look, CODA_LOOK);
    else {
      look.exposure = EXPOSURE.at(t);
      look.bloomIntensity = BLOOM_INTENSITY.at(t);
      look.bloomThreshold = BLOOM_THRESHOLD.at(t);
      look.vignetteDarkness = VIGNETTE_DARKNESS.at(t);
      look.vignetteOffset = VIGNETTE_OFFSET.at(t);
      look.saturation = SATURATION.at(t);
      look.contrast = CONTRAST.at(t);
      look.grain = GRAIN.at(t);
      look.ca = t >= CA_BREATH[0][0] && t < CA_BREATH[1][0] ? linear(CA_BREATH, t) : 1;
    }
    look.dofRange = seg ? seg.dof.range : LOOK_IDLE.dofRange;
    look.bokeh = seg ? seg.dof.bokeh : LOOK_IDLE.bokeh;
    gradeAt(t, look.mixer);
  }

  // the words
  const text = out.text;
  text.line = null;
  text.lineGroups = 0;
  text.lineOn = false;
  for (const line of LINES) {
    if (line.visitor && !options.visitor) continue;
    if (t < line.groups[0].at) break;
    text.line = line.id;
    let groups = 0;
    while (groups < line.groups.length && line.groups[groups].at <= t) groups++;
    text.lineGroups = groups;
    text.lineOn = t < line.exit;
  }
  text.name = null;
  text.nameOn = false;
  for (let i = 0; i < MONTAGE.length; i++) {
    if (t < slotAt(i) + NAME_IN) break;
    text.name = SPECIES[MONTAGE[i]].name;
    text.nameOn = t < slotAt(i + 1);
  }
  text.title = t >= TITLE_AT && t < TITLE_OUT;
  text.tagline = t >= TAGLINE_AT && t < TAGLINE_OUT;

  out.events.shot = seg ? seg.id : "HOME";
  out.events.weatherSnap = t >= WEATHER_SNAP_AT;
  return out;
}

export function blankFrame(): TrailerFrame {
  return {
    hour: 12,
    growth: 0,
    bloom: 0,
    rain: 0,
    cloud: 0.15,
    wind: WIND_REST,
    shot: { ...HOME },
    lens: { look: 0, target: null, point: { x: 0, y: 0, z: 0 }, shiftX: 0, shiftY: 0, follow: false, coda: false },
    dof: { from: "head", to: null, fromPoint: { x: 0, y: 0, z: 0 }, toPoint: { x: 0, y: 0, z: 0 }, rack: 0 },
    doe: false,
    water: -1,
    species: "rose",
    cover: 1,
    fx: { ...FX_NEUTRAL },
    look: { ...LOOK_IDLE, mixer: [...MIXER_IDENTITY] },
    text: { line: null, lineGroups: 0, lineOn: false, name: null, nameOn: false, title: false, tagline: false },
    events: { shot: "HOME", weatherSnap: false },
    bars: true,
    coda: false,
    restored: false,
    panel: false,
  };
}
