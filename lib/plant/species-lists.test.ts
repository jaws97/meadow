// Every hand-kept list of species holds exactly the seven, in the seed picker's order. TypeScript checks the lists typed
// Record<SpeciesId, ...>, but not an array that merely satisfies SpeciesId[]: a list missing the lotus compiles and then
// quietly leaves it out (no head in the Meadow, no atlas row, no packet). The pure TypeScript lists are imported; the
// ones in React files and scripts are read as text; the newest migration's plants_species_check must name the same keys.
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { SEED_ORDER } from "@/components/gift/species";
import { LOD_SEEDS, LOD_SPECIES } from "@/components/meadow/lod/bands";
import { ALL_SPECIES, SPECIES, isLotus, type SpeciesId } from "@/lib/plant/species";
import { SPECIES_IDS } from "@/lib/server/validate";
import { POND_SPECIES, SIM_SPECIES } from "@/lib/sim";

const ROOT = path.resolve(__dirname, "../..");
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), "utf8");
const SEVEN = ["rose", "sundrop", "magnolia", "marigold", "island", "jasmine", "lotus"];

/** The string literals of the first array that `marker` opens, e.g. `const SPECIES_IDS: readonly SpeciesId[] = [`. */
function literalList(text: string, marker: RegExp): string[] {
  const m = marker.exec(text);
  if (!m) throw new Error(`no list matching ${marker}`);
  const open = text.indexOf("[", m.index + m[0].length - 1);
  const close = text.indexOf("]", open);
  return [...text.slice(open + 1, close).matchAll(/["']([a-z]+)["']/g)].map((x) => x[1]);
}

describe("every list of species holds the seven", () => {
  it("the server's, the picker's, the species records and the models'", () => {
    expect([...SPECIES_IDS]).toEqual(SEVEN);
    expect([...ALL_SPECIES]).toEqual(SEVEN);
    expect([...SEED_ORDER]).toEqual(SEVEN);
    expect(Object.keys(SPECIES).sort()).toEqual([...SEVEN].sort());
    expect([...Object.keys(SIM_SPECIES), ...Object.keys(POND_SPECIES)].sort()).toEqual([...SEVEN].sort());
    expect(SEVEN.filter((id) => isLotus(id as SpeciesId))).toEqual(["lotus"]);
  });

  it("the Meadow's atlas rows, with the lotus appended last so the older cells keep their places", () => {
    expect([...LOD_SPECIES]).toEqual(SEVEN);
    expect(Object.keys(LOD_SEEDS).sort()).toEqual([...SEVEN].sort());
  });

  it("the lists kept in React files and scripts", () => {
    expect(literalList(read("components/meadow/Plants.tsx"), /const SPECIES_IDS[^=]*= \[/)).toEqual(SEVEN);
    expect(literalList(read("components/meadow/data.ts"), /const species = \[/)).toEqual(SEVEN);
    expect(literalList(read("scripts/seed-meadow-rehearsal.mjs"), /const SPECIES = \[/)).toEqual(SEVEN);
  });

  it("the database: the newest migration's plants_species_check names exactly the server's species", () => {
    const dir = path.join(ROOT, "db", "migrations");
    const newest = fs.readdirSync(dir).filter((f) => f.endsWith(".sql") && /plants_species_check/.test(fs.readFileSync(path.join(dir, f), "utf8"))).sort().at(-1) as string;
    const sql = fs.readFileSync(path.join(dir, newest), "utf8");
    const check = /add constraint plants_species_check\s+check \(species in \(([^)]*)\)\)/.exec(sql);
    expect(check, newest).not.toBeNull();
    const keys = [...(check as RegExpExecArray)[1].matchAll(/'([a-z]+)'/g)].map((x) => x[1]);
    expect(keys).toEqual([...SPECIES_IDS]);
  });
});
