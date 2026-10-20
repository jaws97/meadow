// A Meadow page older than the server it polls (a tab left open across the deploy that offers a new seed) leaves out
// the plants it has no species for, instead of failing to draw the whole Meadow, and says so once per species.
import { describe, expect, it } from "vitest";
import { knownPlots, type MeadowPlot, type MeadowSnapshot } from "@/components/meadow/data";
import { ALL_SPECIES, type SpeciesId } from "@/lib/plant/species";

// a species from a newer build arrives as a string this build's SpeciesId does not name
const plot = (n: number, species: string): MeadowPlot => ({ plot: n, species: species as SpeciesId, name: `P${n}`, stage: "leafy", health: "fine", bloom: 0, generation: 1 });
const snapshot = (plots: MeadowPlot[]): MeadowSnapshot => ({ v: 1, h: 0, at: "2026-11-10T00:00:00+05:30", count: plots.length, plots });

describe("knownPlots", () => {
  it("keeps every species this build knows, the Pink Lily among them, as the same snapshot", () => {
    const logs: string[] = [];
    const s = snapshot(ALL_SPECIES.map((sp, i) => plot(i, sp)));
    expect(knownPlots(s, (m) => logs.push(m))).toBe(s);
    expect(logs).toEqual([]);
  });

  it("leaves out a newer species' plants, keeps the order and the server's count, and logs each species once", () => {
    const logs: string[] = [];
    const s = snapshot([plot(0, "rose"), plot(1, "orchid"), plot(2, "lily"), plot(3, "orchid"), plot(4, "tulip")]);
    const out = knownPlots(s, (m) => logs.push(m));
    expect(out.plots.map((p) => p.plot)).toEqual([0, 2]);
    expect(out.count).toBe(5);
    expect(logs).toHaveLength(2);
    expect(logs[0]).toContain("orchid");
    expect(logs[1]).toContain("tulip");
    // the next poll brings the same plants: nothing more is logged
    knownPlots(s, (m) => logs.push(m));
    expect(logs).toHaveLength(2);
  });
});
