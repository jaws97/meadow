// The party trailer's script: about a minute and three quarters in the live garden, from a seed at dawn to the rose in
// bloom, a visitor at golden hour, night, the other flowers a guest can choose, and the gift again. Everything the
// trailer shows is a channel keyed in time (the hour, growth, bloom, rain and cloud the garden's store takes, the
// camera's shot, the focus pull to the doe, the black dips) and read with `trailerAt(t)`, so the timeline is pure and
// tested without a browser; components/party/trailer/Director plays it in the canvas.
//
// Channels pass through their keys on monotone cubic curves: continuous in speed, so a crane over several keys never
// stops and starts at each, and never overshooting a key, so growth never shrinks and a hold stays a hold. The hours
// are set against the day's golden hour (components/party/logic goldenHour), so a rehearsal in October lights the
// trailer as the party night will. Species change only at gates, under a black dip; the director holds the clock at a
// gate until the garden has drawn the new flower, so whatever it costs is never seen.
import { HOME, type Shot } from "@/components/party/logic";
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

// ---- the beats (seconds from the first frame of the trailer) --------------------------------------------------------

/** A seed at dawn, close and low over the bed. */
export const SEED_AT = 0;
/** The day passes and the rose grows, with a passing shower. */
export const GROW_AT = 10;
/** Golden hour: the bud opens. */
export const BLOOM_AT = 31;
/** The doe walks in, grazes and looks at the rose. */
export const VISIT_AT = 43;
/** Dusk and night: the lantern, fireflies and stars; she leaves. */
export const NIGHT_AT = 66;
/** The other flowers, one by one, joined by dips to black. */
export const FLOWERS_AT = 80;
/** Each flower's share of the montage: the dip in, the swap under black, the dip out and the hold. */
export const FLOWER_S = 3.8;
const DIP_S = 0.7;
/** The flowers a guest can choose besides the rose (the lotus has its own courtyard, so it is not among them). */
export const MONTAGE: readonly SoilSpeciesId[] = ["sundrop", "magnolia", "marigold", "island", "jasmine"];
/** The end: a dip to black, the closing card, then the party screen as it was, the panel coming back. */
export const END_AT = FLOWERS_AT + MONTAGE.length * FLOWER_S;
/** Under black at the end: the garden is put back as the party shows it. */
export const RESTORE_AT = END_AT + 1.6;
/** The black lifts on the party screen, and the panel and its QR code come back. */
export const RETURN_AT = END_AT + 5.4;
/** The trailer is over. */
export const TRAILER_S = RETURN_AT + 2;

/** The growth below which the rose shows no head yet (Plant: heroStemFraction above 0.005). */
export const HEADLESS_GROWTH = 0.0332;

/** A caption in the lower film bar: when it shows, its line, and an optional second line. */
export interface Caption {
  from: number;
  to: number;
  title: string;
}

export const CAPTIONS: readonly Caption[] = [
  { from: 1.6, to: 8.6, title: "Every garden begins with a seed" },
  { from: GROW_AT + 2.5, to: GROW_AT + 9, title: "It grows with the real Bangalore sky" },
  { from: BLOOM_AT + 4, to: BLOOM_AT + 10.5, title: "One golden evening, it blooms" },
  { from: VISIT_AT + 4.5, to: VISIT_AT + 11, title: "Sometimes, a visitor comes" },
  { from: FLOWERS_AT + 0.9, to: END_AT - 0.4, title: "Choose your own flower" },
];

/** The closing card, on black. */
export const CARD = { from: END_AT + 1.4, to: RETURN_AT - 0.6, title: "Your seed is waiting" } as const;

// ---- the channels ---------------------------------------------------------------------------------------------------

/** The hours, set against the day's golden hour `g` (about 17.45 on the party night). */
function hourKeys(g: number): Key[] {
  return [
    [0, 6.2],
    [GROW_AT, 6.9],
    [GROW_AT + 4, 8.6],
    [GROW_AT + 10, 11.8],
    [GROW_AT + 16, 14.4],
    [BLOOM_AT, g - 1.85],
    [BLOOM_AT + 6, g - 0.75],
    [VISIT_AT, g - 0.1],
    [NIGHT_AT, g + 0.15],
    [NIGHT_AT + 6, g + 0.85],
    [NIGHT_AT + 10, g + 1.65],
    [FLOWERS_AT, g + 1.85],
  ];
}

const GROWTH = new Track([
  [0, 0],
  // the seed glows in its mound, the head not yet shown
  [GROW_AT, 0.025],
  [GROW_AT + 4, 0.12],
  [GROW_AT + 13, 0.55],
  [BLOOM_AT - 1, 0.86],
  [BLOOM_AT + 4, 1],
]);
const BLOOM = new Track([
  [BLOOM_AT + 3, 0],
  [BLOOM_AT + 10, 1],
]);
const RAIN = new Track([
  [GROW_AT + 7, 0],
  [GROW_AT + 9, 0.8],
  [GROW_AT + 12.5, 0.8],
  [GROW_AT + 14.5, 0],
]);
const CLOUD = new Track([
  [GROW_AT + 6, 0.15],
  [GROW_AT + 9, 0.8],
  [GROW_AT + 12.5, 0.8],
  [GROW_AT + 16, 0.25],
  [BLOOM_AT + 9, 0.15],
]);
/** 0: the flower head in focus; 1: the doe. */
const RACK = new Track([
  [VISIT_AT + 6.5, 0],
  [VISIT_AT + 8, 1],
  [VISIT_AT + 13, 1],
  [VISIT_AT + 15, 0],
]);

/** The camera's shots, as the party camera takes them (components/party/PartyCamera): offsets from the composed garden. */
const SHOT_KEYS: readonly (readonly [number, Shot])[] = [
  // close over the bed, looking down into it, pushing in on the mound
  [0, { yaw: -0.02, lift: 0.18, dolly: 0.32, focus: 1, zoom: 1 }],
  [GROW_AT, { yaw: -0.06, lift: 0.16, dolly: 0.27, focus: 1, zoom: 1 }],
  // rising and pulling back as the rose climbs
  [GROW_AT + 6, { yaw: -0.02, lift: 0.1, dolly: 0.42, focus: 1, zoom: 1 }],
  [GROW_AT + 14, { yaw: 0.06, lift: 0.07, dolly: 0.66, focus: 0.85, zoom: 1 }],
  [BLOOM_AT, { yaw: 0.1, lift: 0.05, dolly: 0.86, focus: 0.7, zoom: 1 }],
  // in toward the bud as it opens
  [BLOOM_AT + 11, { yaw: -0.04, lift: 0.02, dolly: 0.64, focus: 0.9, zoom: 0.96 }],
  // wide, and a little toward the lantern's side, for the visitor
  [VISIT_AT + 4.5, { yaw: -0.12, lift: 0, dolly: 1.02, focus: 0.2, zoom: 1 }],
  [NIGHT_AT, { yaw: -0.1, lift: 0, dolly: 1, focus: 0.2, zoom: 1 }],
  // in a little as the light goes
  [FLOWERS_AT - 2, { yaw: 0.02, lift: 0.03, dolly: 0.86, focus: 0.5, zoom: 1 }],
];
const SHOT_TRACKS = (["yaw", "lift", "dolly", "focus", "zoom"] as const).map(
  (k) => [k, new Track(SHOT_KEYS.map(([t, s]) => [t, s[k]] as const))] as const,
);

/**
 * The montage's shot of a flower, by how tall it stands: closer for a short one, and from the lantern's side of the
 * bed, which swings the lamp out from behind the bloom (the tallest, the sundrop, carries its head at the lamp's height).
 */
function flowerShot(id: SoilSpeciesId, s: number, out: Shot): Shot {
  const tall = SPECIES[id].stem.height / SPECIES.sundrop.stem.height;
  out.yaw = -0.36 + 0.1 * s;
  out.lift = 0.05;
  out.dolly = 0.38 + 0.34 * tall;
  out.focus = 0.85;
  out.zoom = 1;
  return out;
}

/** Black over the picture: the fade up, each flower's dip, and the end. */
function coverKeys(): Key[] {
  const keys: Key[] = [
    [0, 1],
    [1.5, 0],
  ];
  for (let i = 0; i < MONTAGE.length; i++) {
    const s = FLOWERS_AT + i * FLOWER_S;
    keys.push([s, 0], [s + DIP_S, 1], [s + DIP_S + 0.05, 1], [s + 2 * DIP_S, 0]);
  }
  keys.push([END_AT, 0], [END_AT + 1.2, 1], [RETURN_AT, 1], [TRAILER_S, 0]);
  return keys;
}
const COVER = new Track(coverKeys());

/** Where the director holds the clock until the garden has settled: each flower's swap and the restore, all under black. */
export const GATES: readonly number[] = [...MONTAGE.map((_, i) => FLOWERS_AT + i * FLOWER_S + DIP_S + 0.02), RESTORE_AT];

// ---- one frame -------------------------------------------------------------------------------------------------------

export interface TrailerFrame {
  hour: number;
  growth: number;
  bloom: number;
  rain: number;
  cloud: number;
  shot: Shot;
  /** 0 the flower in focus .. 1 the doe */
  rack: number;
  /** the doe is in the garden (she walks in when it first turns on) */
  doe: boolean;
  /** the flower in the bed (the rose, or one of the montage) */
  species: SoilSpeciesId;
  /** 0 the picture .. 1 black */
  cover: number;
  /** the lower bar's caption, its second line (a flower's name), and the closing card */
  caption: string | null;
  sub: string | null;
  card: boolean;
  /** the film bars are up */
  bars: boolean;
  /** the garden is the party's again (from the restore) and the panel comes back (from the return) */
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
 * through its share of the montage (0..1), or null while the rose is there.
 */
export function montageAt(t: number): { index: number; s: number } | null {
  if (t < GATES[0] || t >= RESTORE_AT) return null;
  let index = 0;
  while (index + 1 < MONTAGE.length && t >= GATES[index + 1]) index++;
  const s = Math.min(1, Math.max(0, (t - FLOWERS_AT - index * FLOWER_S) / FLOWER_S));
  return { index, s };
}

/** The trailer at time `t` (s), lit for a day whose golden hour is `golden`. Fills and returns `out`. */
export function trailerAt(t: number, golden: number, out: TrailerFrame = blankFrame()): TrailerFrame {
  const restored = t >= RESTORE_AT;
  out.hour = restored ? golden : hourTrack(golden).at(t);
  out.growth = restored ? 1 : GROWTH.at(t);
  out.bloom = restored ? 1 : BLOOM.at(t);
  out.rain = restored ? 0 : RAIN.at(t);
  out.cloud = restored ? 0.15 : CLOUD.at(t);
  out.rack = RACK.at(t);
  out.doe = t >= VISIT_AT && t < FLOWERS_AT;
  out.cover = Math.min(1, Math.max(0, COVER.at(t)));
  out.bars = t < RETURN_AT;
  out.restored = restored;
  out.panel = t >= RETURN_AT;

  // the flower: the rose until the first gate, then each of the montage's from its own, and the rose again at the restore
  const m = montageAt(t);
  out.species = m ? MONTAGE[m.index] : "rose";

  if (restored) Object.assign(out.shot, HOME);
  else if (m) flowerShot(MONTAGE[m.index], m.s, out.shot);
  else for (const [k, track] of SHOT_TRACKS) out.shot[k] = track.at(t);

  out.caption = null;
  for (const c of CAPTIONS) if (t >= c.from && t < c.to) out.caption = c.title;
  out.sub = m && t < END_AT && m.s > 0.26 && m.s < 0.94 ? SPECIES[MONTAGE[m.index]].name : null;
  out.card = t >= CARD.from && t < CARD.to;
  return out;
}

export function blankFrame(): TrailerFrame {
  return {
    hour: 12,
    growth: 0,
    bloom: 0,
    rain: 0,
    cloud: 0.15,
    shot: { ...HOME },
    rack: 0,
    doe: false,
    species: "rose",
    cover: 1,
    caption: null,
    sub: null,
    card: false,
    bars: true,
    restored: false,
    panel: false,
  };
}
