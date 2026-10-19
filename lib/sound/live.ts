// The live garden: what the garden sounds like now, worked out from the same sky and weather the picture is drawn
// from (lib/sound/scene reads them), so the ear and the eye agree. It is the sound panel's default, and it is pure:
// a LiveInput in, a Mixdown out, tested in node (live.test.ts). The engine (lib/sound/engine) eases towards each new
// Mixdown over LIVE_TAU_S, so the garden never switches a sound on or off; it drifts, the way a real one does.
//
// The day, in the order a morning in Bangalore hears it:
// - night (the sun more than about ten degrees down): crickets, a far night forest with an owl in it (only in the
//   flower garden, and only in dry air), and a few frogs, more of them while the garden is still wet after rain
// - dawn (the sun from about eight degrees below the horizon to twelve above, in the morning): the Indian morning
//   chorus of koel, magpie-robin, barbet and oriole, loudest around sunrise, with single calls dropped in now and then
// - day (the sun above about twelve degrees): garden birds, and bees in the meadow once the sun is well up and the air
//   is dry; a little quieter in the midday lull
// - dusk (the sun from about ten degrees up to ten below, in the evening): night falling, crickets and frogs joining in
// - always: wind in the leaves, as strong as the garden's own wind
// - rain: light rain on the leaves, and a monsoon downpour under it when the rain is heavy; birds, bees and their calls
//   hush in rain, and the crickets go quieter. When the rain stops the drips go on while the garden is still wet: any
//   steady shower soaks it through, and it dries over three to five minutes (`nextWet`, which lib/sound/scene runs on
//   its own clock rather than the picture's, whose wet stones dry in seconds).
// - the lotus courtyard: its water, always (the fountain into a stone basin), and a few more frogs at night
// - the doe: while she is in the garden the birds go a little quieter, as if the garden were listening
//
// Every weight is a smooth function of its inputs (smoothsteps on the sun's height, and a soft turn from morning to
// evening at noon and midnight, when neither dawn nor dusk can sound), so a small change in the sky makes a small
// change in the sound. At most MAX_LAYERS layers play at once (lib/sound/catalog), which keeps a phone within its audio
// memory. Most of the time fewer than that are wanted; when more would be (the courtyard at night in a downpour, as
// dusk turns to night), the faintest give way smoothly: every level is measured against the sixth loudest, and a
// layer less than twice as loud as that fades towards silence, so the cap never makes a jump either.
import { clamp01, smoothstep } from "@/lib/plant/prng";
import { BIRD_CALLS, MAX_LAYERS } from "@/lib/sound/catalog";
import type { LiveInput, MixLayer, Mixdown, ShotPlan } from "@/lib/sound/types";

/** How quickly the live garden follows the sky and the weather: the engine's time constant for each new state (s). */
export const LIVE_TAU_S = 8;

/** Levels at or below this are left out of the Mixdown (linear gain, about -60 dB). */
export const LEVEL_FLOOR = 0.001;

/** The doe in the garden: birds and their calls go to this share of their level. */
const DEER_DUCK = 0.8;
/** The dawn chorus's bird calls at their busiest, and by day (calls per minute). */
const DAWN_CALLS_PER_MIN = 2.5;
const DAY_CALLS_PER_MIN = 0.8;
/** How loud a single bird call sits over the beds (linear gain, before the doe). */
const CALL_LEVEL = 0.3;
/** Fewer calls than this a minute is none (a call every twenty minutes would only startle). */
const CALLS_MIN_PER_MIN = 0.05;
/** A layer this many times as loud as the sixth loudest is left alone by the cap; nearer than that it fades. */
const CAP_SOFTNESS = 2;
/** Rain from about this much soaks the garden through, for the sound (the scene's light rain is 0.3). */
const SOAKING_RAIN = 0.25;
/** The garden wets at this rate in rain (per second: soaked in about ten seconds of steady rain). */
export const WET_UP_PER_S = 0.25;
/** It dries at this rate after the rain (per second: a time constant of 150 s, so the drips fade over minutes). */
export const WET_DOWN_PER_S = 1 / 150;

/** The order layers are listed in: the place, the weather, then the creatures. */
const ORDER = [
  "water-fountain",
  "wind-leaves",
  "rain-light",
  "rain-monsoon",
  "rain-after",
  "birds-blr",
  "birds-garden",
  "birds-meadow",
  "night-dusk",
  "night-crickets",
  "night-forest",
  "night-frogs",
] as const;

type LiveKey = (typeof ORDER)[number];

/**
 * Morning against evening, from the clock: 1 through the morning, 0 through the afternoon and evening. It turns over
 * smoothly around noon and midnight, when the sun is far from the horizon and neither dawn nor dusk is sounding.
 */
function morningness(hour: number): number {
  const c = 0.5 + 0.5 * Math.cos((2 * Math.PI * (hour - 6)) / 24);
  return smoothstep(0.1, 0.9, c);
}

/** The weights behind every layer, shared by the Mixdown and its words. */
interface Weights {
  levels: Record<LiveKey, number>;
  callsPerMin: number;
  callLevel: number;
}

function weigh(input: LiveInput): Weights {
  const alt = Number.isFinite(input.sunAltitudeDeg) ? input.sunAltitudeDeg : 0;
  const hour = Number.isFinite(input.hour) ? input.hour : 12;
  const r = clamp01(input.rain || 0);
  const w = clamp01(input.wet || 0);
  const v = clamp01(input.wind || 0);

  const am = morningness(hour);
  const pm = 1 - am;
  // the sun's height (degrees) sets every part of the day
  const dawn = am * smoothstep(-9, -1, alt) * (1 - smoothstep(4, 13, alt));
  const day = smoothstep(5, 15, alt);
  const fullDay = smoothstep(12, 28, alt);
  const lull = 1 - 0.35 * smoothstep(45, 75, alt);
  const dusk = pm * (1 - smoothstep(3, 12, alt)) * smoothstep(-14, -6, alt);
  const night = 1 - smoothstep(-14, -6, alt);

  // rain: the light-rain bed comes in from about 0.05; bees, the night forest and the calls want dry air
  const raining = smoothstep(0.02, 0.08, r);
  const dry = 1 - smoothstep(0.02, 0.1, r);
  const listening = input.deer ? DEER_DUCK : 1;
  const birds = (1 - r) * listening;
  const callsInRain = 1 - smoothstep(0.03, 0.2, r);
  const hushed = 1 - 0.6 * r;

  const levels: Record<LiveKey, number> = {
    "water-fountain": input.lotus ? 0.3 : 0,
    "wind-leaves": 0.06 + 0.3 * v,
    "rain-light": (0.25 + 0.5 * r) * raining,
    "rain-monsoon": 1.2 * Math.max(0, r - 0.6),
    // the drips after a shower: they give way to the rain itself once it falls steadily
    "rain-after": 0.45 * w * (1 - smoothstep(0.1, 0.5, r)),
    "birds-blr": 0.5 * dawn * birds,
    "birds-garden": 0.28 * day * lull * birds,
    "birds-meadow": 0.25 * fullDay * lull * birds * dry,
    "night-dusk": 0.45 * dusk * hushed,
    "night-crickets": 0.4 * night * hushed,
    "night-forest": input.lotus ? 0 : 0.15 * night * dry,
    "night-frogs": night * (0.08 + 0.35 * w + (input.lotus ? 0.1 : 0)),
  };
  for (const key of ORDER) levels[key] = clamp01(levels[key]);

  const callsPerMin = Math.min(DAWN_CALLS_PER_MIN, DAWN_CALLS_PER_MIN * dawn + DAY_CALLS_PER_MIN * day * lull) * (1 - r) * callsInRain;
  return { levels, callsPerMin, callLevel: CALL_LEVEL * listening };
}

/** How wet `rain` (0..1, the scene's env.rain) leaves the garden once it has fallen for a while: 0 dry .. 1 soaked. */
export function soakedBy(rain: number): number {
  return smoothstep(0.02, SOAKING_RAIN, clamp01(Number.isFinite(rain) ? rain : 0));
}

/**
 * The garden's wetness `dtS` seconds on (LiveInput.wet): towards soakedBy(rain), quickly while it rains and slowly as it
 * dries, so the drips after a shower go on for a few minutes. Pure; lib/sound/scene calls it at every look.
 */
export function nextWet(wet: number, rain: number, dtS: number): number {
  const w = clamp01(Number.isFinite(wet) ? wet : 0);
  const target = soakedBy(rain);
  const dt = Math.max(0, Number.isFinite(dtS) ? dtS : 0);
  const rate = target > w ? WET_UP_PER_S : WET_DOWN_PER_S;
  return w + (target - w) * (1 - Math.exp(-dt * rate));
}

/**
 * Keeps at most `max` levels above zero without a jump: each level is weighed against the (max+1)-th loudest, `t`;
 * a level at or below `t` falls silent, one at or above CAP_SOFTNESS times `t` is untouched, and one in between eases
 * from one to the other. Continuous in every level, since `t` is.
 */
function softCap(levels: number[], max: number): number[] {
  const sorted = [...levels].sort((a, b) => b - a);
  const t = sorted[max] ?? 0;
  if (t <= 0) return levels;
  return levels.map((l) => l * smoothstep(t, t * CAP_SOFTNESS, l));
}

/**
 * What the garden sounds like now: at most MAX_LAYERS beds (tile keys from lib/sound/catalog, levels 0..1) and the
 * bird calls dropped in over them, eased in over LIVE_TAU_S.
 */
export function liveMixdown(input: LiveInput): Mixdown {
  const { levels, callsPerMin, callLevel } = weigh(input);
  const capped = softCap(
    ORDER.map((key) => levels[key]),
    MAX_LAYERS,
  );
  const layers: MixLayer[] = [];
  ORDER.forEach((key, i) => {
    if (capped[i] > LEVEL_FLOOR) layers.push({ key, level: capped[i] });
  });
  const shots: ShotPlan | null =
    callsPerMin >= CALLS_MIN_PER_MIN ? { sounds: [...BIRD_CALLS], perMinute: callsPerMin, level: callLevel } : null;
  return { layers, shots, tauS: LIVE_TAU_S };
}

/** Two parts of a phrase: "x and y", or "x, y" when either already has an "and" in it. */
function pair(a: string, b: string): string {
  return a.includes(" and ") || b.includes(" and ") ? `${a}, ${b}` : `${a} and ${b}`;
}

/**
 * What plays now, in plain words for the panel and the lock screen: "dawn birds and a light breeze", "rain on the
 * leaves", "drops falling after the rain", "crickets and frogs", "the courtyard fountain and crickets". Two parts at
 * most, the weather first when it is what you hear.
 */
export function describeLive(input: LiveInput): string {
  const mixdown = liveMixdown(input);
  const at = (key: LiveKey) => mixdown.layers.find((l) => l.key === key)?.level ?? 0;
  const wind = clamp01(input.wind || 0);

  // each part: its words, how much it matters (lower first), and where it sits in the phrase
  const parts: { words: string; rank: number; place: number }[] = [];
  const rain = at("rain-monsoon") > 0.08 ? "heavy rain" : at("rain-light") > 0.15 ? "rain on the leaves" : null;
  if (rain) parts.push({ words: rain, rank: 0, place: 0 });
  if (input.lotus) parts.push({ words: "the courtyard fountain", rank: 2, place: 1 });

  if (rain) {
    // in rain only the frogs carry over it
    if (at("night-frogs") >= 0.2) parts.push({ words: "frogs", rank: 3, place: 2 });
  } else {
    if (at("rain-after") > 0.06) parts.push({ words: "drops falling after the rain", rank: 1, place: 3 });
    const families = [
      { level: at("birds-blr"), words: "dawn birds" },
      { level: at("birds-garden") + at("birds-meadow"), words: at("birds-meadow") >= 0.05 ? "birds and bees" : "birds" },
      { level: at("night-dusk"), words: "the dusk chorus" },
      {
        level: at("night-crickets") + at("night-forest") + at("night-frogs"),
        words: at("night-frogs") >= 0.2 ? "crickets and frogs" : "crickets",
      },
    ];
    const loudest = families.reduce((a, b) => (b.level > a.level ? b : a));
    if (loudest.level >= 0.05) parts.push({ words: loudest.words, rank: 3, place: 2 });
    if (wind >= 0.65) parts.push({ words: "wind in the leaves", rank: 4, place: 4 });
    else if (wind >= 0.35) parts.push({ words: "a light breeze", rank: 4, place: 4 });
  }

  const chosen = parts
    .sort((a, b) => a.rank - b.rank)
    .slice(0, 2)
    .sort((a, b) => a.place - b.place)
    .map((p) => p.words);
  if (chosen.length === 0) return "a quiet garden";
  return chosen.length === 1 ? chosen[0] : pair(chosen[0], chosen[1]);
}
