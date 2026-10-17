// Telling gardens apart by their flower and their day, for two colleagues who share a first name.
import { describe, expect, it } from "vitest";
import { dateOfHour } from "@/lib/sim";
import { dayWords, factsLine, gardenName, gardenNames, istDayOf, knownFacts } from "./gardens";

// hour 100 is 04:00 IST on 14 Nov; hour 15 is the party, 15:00 IST on 10 Nov
const now = dateOfHour(100).getTime();
const partyDay = istDayOf(dateOfHour(15).getTime());

describe("garden names", () => {
  it("counts days as the care panel's chip does", () => {
    expect(dayWords(istDayOf(now), now)).toBe("Planted today");
    expect(dayWords(partyDay, now)).toBe("Day 4");
    expect(factsLine({ species: "jasmine", plantedDay: partyDay }, now)).toBe("Night Jasmine · Day 4");
    expect(factsLine({ species: "marigold", plantedDay: null }, now)).toBe("Marigold");
  });

  it("names a garden by its flower when it is known", () => {
    const priya = { firstName: "Priya", plot: 12 };
    expect(gardenName(priya, { species: "jasmine", plantedDay: partyDay })).toBe("Priya's Night Jasmine garden");
    expect(gardenName(priya, null)).toBe("Priya's garden");
  });

  it("adds the day only when the name and the flower are both shared", () => {
    const a = { firstName: "Priya", plot: 12 };
    const b = { firstName: "Priya", plot: 40 };
    const jasmine = { species: "jasmine" as const, plantedDay: partyDay };
    const marigold = { species: "marigold" as const, plantedDay: partyDay };
    const newMarigold = { species: "marigold" as const, plantedDay: istDayOf(now) };
    expect(gardenNames(a, jasmine, b, marigold, now)).toEqual(["Priya's Night Jasmine garden", "Priya's Marigold garden"]);
    expect(gardenNames(a, marigold, b, newMarigold, now)).toEqual(["Priya's Marigold garden, day 4", "Priya's Marigold garden, planted today"]);
    expect(gardenNames(a, null, b, null, now)).toEqual(["Priya's garden", "Priya's garden"]);
  });

  it("knows nothing outside a browser", () => {
    expect(knownFacts({ firstName: "Priya", plot: 12 })).toBeNull();
    expect(knownFacts(null)).toBeNull();
  });
});
