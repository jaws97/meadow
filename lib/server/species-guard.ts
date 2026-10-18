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

/** The rows whose plant this build knows; the rest are left out (and logged once per call). */
export function knownPlants<T extends { species: unknown }>(rows: readonly T[], log: (msg: string) => void = console.warn): T[] {
  const out = rows.filter((r) => isKnownSpecies(r.species));
  if (out.length < rows.length) {
    const odd = [...new Set(rows.filter((r) => !isKnownSpecies(r.species)).map((r) => String(r.species)))];
    log(`[meadow api] left out ${rows.length - out.length} plant(s) of a species this build does not know: ${odd.join(", ")}`);
  }
  return out;
}
