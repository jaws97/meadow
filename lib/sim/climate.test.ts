// The data modules match their sources: the climate normal is the mean of the three recorded years, and the twin table
// is well formed (its numbers are pinned exactly by the parity test's constants block).
import { describe, expect, it } from "vitest";
import { CLIM_T, CLIM_T_YEARS } from "./climate";
import { TWIN } from "./twin";
import { BED, SIM_SPECIES } from "./model";
import { NH, YEARS, readFixture, rowsFor, type PackedWeather } from "./__fixtures__/harness";

describe("CLIM_T", () => {
  it("is the mean hourly temperature of 2023-25, summed in year order, for every game hour", () => {
    expect(CLIM_T_YEARS).toEqual(YEARS);
    expect(CLIM_T).toHaveLength(NH);
    const mean = Array.from({ length: NH }, (_, h) => YEARS.reduce((a, y) => a + rowsFor(y)[h].T, 0) / YEARS.length);
    expect(CLIM_T).toEqual(mean);
  });

  it("agrees with the climT the prototype ships in demo-weather.json (x10, rounded)", () => {
    const demo = readFixture<PackedWeather>("demo-weather.json");
    expect(demo.climT).toEqual(CLIM_T.map((x) => Math.round(x * 10)));
  });
});

describe("TWIN", () => {
  it("covers every species with 21 non-decreasing entries from the seed mass to B_pot", () => {
    for (const id of Object.keys(SIM_SPECIES) as (keyof typeof TWIN)[]) {
      const t = TWIN[id];
      expect(t.tab, id).toHaveLength(21);
      expect(t.tab[0], id).toBe(BED.B0);
      expect(t.tab[20], id).toBe(t.Bpot);
      for (let i = 1; i < 21; i++) expect(t.tab[i], `${id} ${i}`).toBeGreaterThanOrEqual(t.tab[i - 1]);
    }
  });
});
