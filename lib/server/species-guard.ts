// The unknown-species guard. The database is shared by the dev server, Preview and production, and the Meadow snapshot
// loads every plant (rehearsals included where they show), so a plant of a species this build does not know (a new seed
// planted from a newer build, or a build rolled back past its seed) must never reach the model here: step() and toVisual()
// would find no species and throw, and one thrown plant would fail the whole /api/meadow response, the party screen with
// it. The queries filter by SPECIES_IDS, knownPlants() filters the rows again, and the snapshot catches each plant up on
// its own, so a plant that still fails is logged and left out instead. Keep it: it also protects a later rollback.
import type { SpeciesId } from "@/lib/plant/species";
import { SPECIES_IDS } from "./validate";

/** The species this build can step and draw, as a text[] parameter for `p.species = any(...)`. */
export const KNOWN_SPECIES: readonly string[] = SPECIES_IDS;

export function isKnownSpecies(sp: unknown): sp is SpeciesId {
  return typeof sp === "string" && KNOWN_SPECIES.includes(sp);
}

/**
 * The newer seeds, by the count of seeds a page offered when each arrived. A page that knows them says how many seeds it
 * offers (?seeds=8, lib/plant/species ALL_SPECIES.length); a page without the parameter predates the Pink Lily and knows
 * the first seven. The Meadow's snapshot and a friend's garden leave out a plant newer than the page that asks, so a tab
 * left open across a deploy never meets a species its code cannot draw (placing one would throw and reload the page).
 * The parameter also keys the CDN's cache, so the two answers never mix.
 */
const SEED_OF: Partial<Record<SpeciesId, number>> = { lily: 8 };
/** The seeds a page offered before pages said how many they know: the Lotus's build. */
const SEEDS_BEFORE_ASKING = 7;

/** How many seeds the page that asks knows, from its ?seeds= parameter (absent or odd: a page from before it was sent). */
export function seedsOf(param: string | null): number {
  const n = Number(param);
  return param !== null && Number.isInteger(n) && n > SEEDS_BEFORE_ASKING ? n : SEEDS_BEFORE_ASKING;
}

/** The page that knows `seeds` seeds can draw a plant of this species. */
export function seenBy(species: SpeciesId, seeds: number): boolean {
  return (SEED_OF[species] ?? 0) <= seeds;
}

/** The rows whose plant this build knows; the rest are left out (and logged once per call). */
export function knownPlants<T extends { species: unknown }>(rows: readonly T[], log: (msg: string) => void = console.warn): T[] {
  const out = rows.filter((r) => isKnownSpecies(r.species));
  if (out.length < rows.length) {
    const odd = [...new Set(rows.filter((r) => !isKnownSpecies(r.species)).map((r) => String(r.species)))];
    log(`[meadow api] left out ${rows.length - out.length} plant(s) of a species this build does not know: ${odd.join(", ")}`);
  }
  return out;
}
