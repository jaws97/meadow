import { describe, expect, it } from "vitest";
import { ALL_SPECIES } from "@/lib/plant/species";
import { isKnownSpecies, knownPlants, KNOWN_SPECIES, seedsOf, seenBy } from "./species-guard";
import { SPECIES_IDS } from "./validate";

describe("the unknown-species guard", () => {
  it("knows exactly the species the seed picker offers", () => {
    expect([...KNOWN_SPECIES]).toEqual([...SPECIES_IDS]);
    for (const sp of SPECIES_IDS) expect(isKnownSpecies(sp)).toBe(true);
    for (const sp of ["orchid", "", "ROSE", null, undefined, 7]) expect(isKnownSpecies(sp)).toBe(false);
  });

  it("leaves out rows of a species this build does not know, keeps the order, and says so once", () => {
    const logs: string[] = [];
    const rows = [
      { plot: 1, species: "rose" },
      { plot: 2, species: "orchid" },
      { plot: 3, species: "jasmine" },
      { plot: 4, species: "orchid" },
      { plot: 5, species: "tulip" },
    ];
    const out = knownPlants(rows, (m) => logs.push(m));
    expect(out.map((r) => r.plot)).toEqual([1, 3]);
    expect(logs).toHaveLength(1);
    expect(logs[0]).toContain("3 plant(s)");
    expect(logs[0]).toContain("orchid, tulip");
  });

  it("says nothing when every plant is known", () => {
    const logs: string[] = [];
    const rows = SPECIES_IDS.map((species, plot) => ({ plot, species }));
    expect(knownPlants(rows, (m) => logs.push(m))).toEqual(rows);
    expect(logs).toEqual([]);
  });

  it("sends a page only the plants it can draw: a page that does not say how many seeds it knows predates the lily", () => {
    expect(seedsOf(null)).toBe(7);
    for (const odd of ["", "abc", "6", "7", "7.5", "-8"]) expect(seedsOf(odd)).toBe(7);
    expect(seedsOf("8")).toBe(8);
    expect(seedsOf(String(ALL_SPECIES.length))).toBe(ALL_SPECIES.length);
    for (const sp of SPECIES_IDS) expect(seenBy(sp, ALL_SPECIES.length)).toBe(true);
    for (const sp of SPECIES_IDS) expect(seenBy(sp, seedsOf(null))).toBe(sp !== "lily");
  });
});
