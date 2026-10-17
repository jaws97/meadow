// What the Meadow says about a plant, in kind words: never a score, never a scolding, never a guess at anyone's
// pronouns (a person is their name, or "A friend"). Plain, warm, short, sentence case, no exclamation marks. The
// card reads the plant's stage and mood from GET /api/garden/[plot] (lib/sim's PlantMood) and its flower's hours
// from the snapshot.
import type { FriendGarden, MeadowPlot } from "@/lib/server/meadow";
import { SPECIES, type SpeciesId } from "@/lib/plant/species";

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

/** Night Jasmine opens at dusk; every other flower with the morning light. */
const opensAtDusk = (id: SpeciesId) => id === "jasmine";

/** The hour in Bangalore, fractional. */
const istHour = (at = Date.now()) => (((at / 3_600_000 + 5.5) % 24) + 24) % 24;

/** One kind line about how a friend's plant is doing. */
export function moodLine(f: Pick<FriendGarden, "species" | "stage" | "visual" | "day" | "generation">, at = Date.now()): string {
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

/** A short line for the find list and a plant still loading: what the snapshot already knows. */
export function stageWord(p: Pick<MeadowPlot, "stage" | "bloom" | "species">): string {
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
