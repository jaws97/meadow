// What the Meadow says about a plant, in kind words: never a score, never a scolding, never a guess at anyone's
// pronouns (a person is their name, or "A friend"). Plain, warm, short, sentence case, no exclamation marks. The
// card reads the plant's stage and mood from GET /api/garden/[plot] (lib/sim's PlantMood) and its flower's hours
// from the snapshot. Also the one notice the Meadow raises about itself.
//
// A lotus speaks for itself in its own lines (lib/sim POND_LINES: "the pond could use a top-up"); the card says them of
// it, in the third person ("The pond could use a top-up."), and names its stages as a lotus grows them: in its jar,
// floating leaves, standing leaves, in bud, in bloom, a seed pod. Seen in the Meadow (a river pocket, always full, with
// no koi, or a brass urli), its pond and its koi are back home, and the card says so ("At home, its pond could use a
// top-up."); its friend's own garden says them as they are.
import type { FriendGarden, MeadowPlot } from "@/lib/server/meadow";
import { SPECIES, type SpeciesId } from "@/lib/plant/species";
import type { PondLine, PondVisual, Visual } from "@/lib/sim";

export function speciesName(id: SpeciesId): string {
  return SPECIES[id].name;
}

/**
 * "Planted today", "Day 1", "Day 12", from the server's day of the plant's life (the day it went in being day 1): IST
 * calendar days since planting, as the plant's own care panel and its identity menu count them, so one garden reads
 * the same day wherever it is seen.
 */
export function dayText(day: number): string {
  return day <= 1 ? "Planted today" : `Day ${day - 1}`;
}

/** "Priya's Night Jasmine", "A friend's Marigold": a flower by its owner, so two people with one name are told apart. */
export function flowerOf(name: string, species: SpeciesId): string {
  return `${name}'s ${speciesName(species)}`;
}

/** Night Jasmine opens at dusk; every other flower with the morning light (the lotus before dawn). */
const opensAtDusk = (id: SpeciesId) => id === "jasmine";

/** The friend's visual as a lotus's, or null for a soil flower (read without the model's code: the Meadow's bundle stays light). */
const pondOf = (v: Visual): PondVisual | null => ((v as Partial<PondVisual>).medium === "pond" ? (v as PondVisual) : null);

/** A lotus's own lines, said of it. Lines not here fall to its stage (lotusStageLine). */
const POND_SAID: Partial<Record<PondLine, string>> = {
  "my seed is rotting in murky water; fresh water, please": "Its seed's water has turned murky. Fresh water would help it.",
  "my root and first leaf are out and my water is murky; plant me in my pot in the pond": "Its root and first leaf are out, ready for the pond.",
  "my root and first leaf are out; plant me in my pot in the pond": "Its root and first leaf are out, ready for the pond.",
  "my water has been cloudy for a while; fresh water, please": "Its jar's water is cloudy. Fresh water would help it.",
  "that food clouded my water": "Its jar's water has clouded. Fresh water would help it.",
  "time for fresh water": "A seed in its jar, ready for fresh water.",
  "fresh water would be lovely": "A seed in its jar, ready for fresh water.",
  "my first root is showing": "A seed in its jar. Its first root is showing.",
  "my pot has dried out; my leaves are crisping": "The water in its pot is gone. The pond would love a top-up.",
  "the water in my pot is gone; the mud is drying": "The water in its pot is gone. The pond would love a top-up.",
  "the koi keep eating my young leaves, so I cannot grow; feed them, please": "The koi are nibbling its young leaves. They are hungry.",
  "the pond has dropped below the rim of my pot; a top-up or two, please": "The pond has dropped below its pot. A top-up or two would help.",
  "the koi have nibbled many of my floating leaves; they are hungry": "The koi are nibbling its floating leaves. They are hungry.",
  "the koi are nibbling my young leaves; they are hungry": "The koi are nibbling its young leaves. They are hungry.",
  "the koi are nosing at my bud; they are hungry": "The koi are nosing at its bud. They are hungry.",
  "the pond is low": "The pond is low. A top-up would help.",
  "that food was too strong for my young leaves": "Having a quiet day, mending slowly.",
  "recovering; new leaves will replace the lost ones": "Mending. New leaves will replace the lost ones.",
  "my petals are falling; my seed pod is ready": "Its petals are falling. The seed pod is ready.",
  "my flower is at its widest; the petals fall this evening": "Its flower is at its widest. The petals fall this evening.",
  "in bloom; a smaller second-chance flower": "In bloom, a second-chance flower.",
  "in bloom again": "In bloom again.",
  "in bloom": "In full bloom.",
  "my flower closes in the afternoon and opens again before dawn": "In bloom. The flower closes in the afternoon and opens again before dawn.",
  "my flower opens widest this morning": "In bloom. The flower opens widest this morning.",
  "my petals are opening": "In bloom. The petals are opening.",
  "my petals will finish opening at dawn": "In bloom. The petals finish opening at dawn.",
  "my bud will open before dawn": "A bud is ready. It opens before dawn.",
  "my bud will open before dawn; a smaller flower this time": "A bud is ready. It opens before dawn.",
  "the koi are gulping at the surface this morning; the pond is too green": "The koi are gulping at the surface. The pond has turned green.",
  "the pond has turned green; go easy on the koi food": "The pond has turned green.",
  "I have settled into my pot in the pond": "Just settled into its pot in the pond.",
  "aphids on my bud; wash them into the pond for the koi": "A few aphids on its bud.",
  "aphids on my leaves; wash them into the pond for the koi": "A few aphids on its leaves.",
  "the koi are hungry": "The koi are hungry.",
  "my leaves are paling; a little food would help": "Its leaves are paling a little.",
  "the pond could use a top-up": "The pond could use a top-up.",
  "the pond is turning a little green": "The pond is turning a little green.",
  "the koi have had plenty today; leftover food clouds the water": "The koi have had plenty today.",
  "another bud is on its way": "Another bud is on its way.",
  "my seed pod is ripening": "Its seed pod is ripening.",
  "a second-chance seedling; my flower will be smaller": "A second-chance seedling, finding its feet.",
};

/** Its lines about its pond and its koi, said in the Meadow, away from them. */
const POND_SAID_AWAY: Partial<Record<PondLine, string>> = {
  "my root and first leaf are out and my water is murky; plant me in my pot in the pond": "Its root and first leaf are out, ready for its pond at home.",
  "my root and first leaf are out; plant me in my pot in the pond": "Its root and first leaf are out, ready for its pond at home.",
  "my pot has dried out; my leaves are crisping": "At home, the water in its pot is gone. Its pond would love a top-up.",
  "the water in my pot is gone; the mud is drying": "At home, the water in its pot is gone. Its pond would love a top-up.",
  "the koi keep eating my young leaves, so I cannot grow; feed them, please": "At home, the koi are nibbling its young leaves. They are hungry.",
  "the pond has dropped below the rim of my pot; a top-up or two, please": "At home, its pond has dropped below its pot. A top-up or two would help.",
  "the koi have nibbled many of my floating leaves; they are hungry": "At home, the koi are nibbling its floating leaves. They are hungry.",
  "the koi are nibbling my young leaves; they are hungry": "At home, the koi are nibbling its young leaves. They are hungry.",
  "the koi are nosing at my bud; they are hungry": "At home, the koi are nosing at its bud. They are hungry.",
  "the pond is low": "At home, its pond is low. A top-up would help.",
  "the koi are gulping at the surface this morning; the pond is too green": "At home, the koi are gulping at the surface. Its pond has turned green.",
  "the pond has turned green; go easy on the koi food": "At home, its pond has turned green.",
  "I have settled into my pot in the pond": "Just settled into its pot, in its pond at home.",
  "the koi are hungry": "At home, the koi are hungry.",
  "the pond could use a top-up": "At home, its pond could use a top-up.",
  "the pond is turning a little green": "At home, its pond is turning a little green.",
  "the koi have had plenty today; leftover food clouds the water": "At home, the koi have had plenty today.",
};

/** A contented lotus, by its stage (`away`: seen in the Meadow, on the river's water or the urli's). */
function lotusStageLine(f: Pick<FriendGarden, "stage" | "day">, v: PondVisual, away: boolean): string {
  const water = away ? "the water" : "the pond";
  if (v.stage === "jar") return f.day <= 1 ? "Just planted, a seed in a jar of water." : "A seed in clear water, waking up.";
  if (v.aerialLeaves === 0) return `Floating leaves on ${water}, growing well.`;
  if (f.stage === "bud") return "A bud is rising. The flower is on its way.";
  return `Standing leaves over ${water}, growing well.`;
}

/** One kind line about how a friend's lotus is doing, from its own words. */
function lotusMoodLine(f: Pick<FriendGarden, "stage" | "day">, v: PondVisual, at: number, away: boolean): string {
  if (f.stage === "resting" || !v.alive) return "Resting for now. Every garden has quiet days.";
  const said = (away ? POND_SAID_AWAY[v.says] : undefined) ?? POND_SAID[v.says];
  if (said) return said;
  const h = istHour(at);
  if (v.mood === "resting" && (h >= 19 || h < 5)) return "Resting for the night.";
  return lotusStageLine(f, v, away);
}

/** The hour in Bangalore, fractional. */
const istHour = (at = Date.now()) => (((at / 3_600_000 + 5.5) % 24) + 24) % 24;

/**
 * One kind line about how a friend's plant is doing. `away`: said in the Meadow, where a lotus stands away from its own
 * pond and koi (its friend's garden says it as it is).
 */
export function moodLine(f: Pick<FriendGarden, "species" | "stage" | "visual" | "day" | "generation">, at = Date.now(), away = false): string {
  const pond = pondOf(f.visual);
  if (pond) return lotusMoodLine(f, pond, at, away);
  const mood = f.visual.mood;
  // a plant that has died back is resting; a living one "rests" at night, or while it gathers itself after a hard spell
  if (f.stage === "resting" || !f.visual.alive) return "Resting for now. Every garden has quiet days.";
  if (mood === "resting") {
    const h = istHour(at);
    if (h >= 19 || h < 6) return f.stage === "bloom" && opensAtDusk(f.species) ? "Awake in the night air, petals open." : "Resting for the night.";
    return "Taking it easy today, gathering its strength.";
  }
  if (mood === "soggy") return "Drying out gently after a lot of water.";
  if (mood === "unwell") return "Having a quiet day, mending slowly.";
  if (mood === "thirsty") return "Would love a little water today.";
  switch (f.stage) {
    case "seed":
      return f.day <= 1 ? "Just planted, settling into the soil." : "Still a seed, gathering itself to sprout.";
    case "sprout":
      return f.generation > 1 ? "A second-chance sprout, finding its feet." : "A small sprout, reaching for the light.";
    case "leafy":
      return "Leafy and growing well.";
    case "bud":
      // a flower open now reads as one (a practice plant before 10 Nov has no bloom hour to mark it by)
      if (f.visual.bloom >= 0.2) return "In full bloom.";
      return "A bud is forming. The flower is on its way.";
    case "bloom":
      if (f.visual.bloom < 0.2) return opensAtDusk(f.species) ? "In bloom. The petals open at dusk." : "In bloom. The petals open with the morning light.";
      return "In full bloom.";
  }
  return "Growing quietly.";
}

/** A lotus's stage in its own words: the snapshot's stage, and on a visit the lotus's own visual. */
function lotusStageWord(p: Pick<MeadowPlot, "stage" | "bloom">, v: PondVisual | null): string {
  switch (p.stage) {
    case "seed":
      return "in its jar";
    case "sprout":
      return "floating leaves";
    case "leafy":
      return "standing leaves";
    case "bud":
      return "in bud";
    case "bloom":
      // a flowered lotus closes its flower in the afternoon and keeps its seed pod for weeks after: the snapshot
      // cannot tell the two apart, a visit can
      if (v) return v.flowerDay === 0 && v.pod ? "a seed pod" : "in bloom";
      return p.bloom > 0 ? "in bloom" : "has flowered";
    case "resting":
      return "resting";
  }
}

/**
 * A short line for the find list and a plant still loading: what the snapshot already knows (a visit's visual, when
 * there is one, tells a lotus's seed pod from its flower).
 */
export function stageWord(p: Pick<MeadowPlot, "stage" | "bloom" | "species">, v?: Visual | null): string {
  if (p.species === "lotus") return lotusStageWord(p, v ? pondOf(v) : null);
  switch (p.stage) {
    case "seed":
      return "a seed";
    case "sprout":
      return "a sprout";
    case "leafy":
      return "growing";
    case "bud":
      return "in bud";
    case "bloom":
      return "in bloom";
    case "resting":
      return "resting";
  }
}

/**
 * Shown once when the Meadow moves the cart onto its lighter glide under load, or because the physics stopped. The
 * cart stays on screen and carries on, so this names only what the visitor may feel: a smoother, gentler ride.
 */
export const GLIDE_NOTICE = "Riding smooth today";
