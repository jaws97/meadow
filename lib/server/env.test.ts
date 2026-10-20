// Which deployment this is, and what it may write: only production saves checkpoints and weather; Vercel without
// VERCEL_ENV is never production; rehearsals are open everywhere except production, where they are open only before
// the game clock starts, so no plant planted on or after 10 Nov can be marked or hidden as a rehearsal.
import { afterEach, describe, expect, it, vi } from "vitest";
import { PLANT_OPEN_H } from "@/lib/sim";
import { deployment, isProduction, partyCodes, practiceVisible, rehearsalAllowed, writesDerivedState } from "./env";
import { plantingWindow } from "./rules";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("deployment", () => {
  it("follows VERCEL_ENV on Vercel", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("VERCEL", "1");
    vi.stubEnv("VERCEL_ENV", "preview");
    expect(deployment()).toBe("preview");
    expect(writesDerivedState()).toBe(false);
    vi.stubEnv("VERCEL_ENV", "production");
    expect(deployment()).toBe("production");
    expect(writesDerivedState()).toBe(true);
  });

  it("never treats Vercel without VERCEL_ENV as production, even though NODE_ENV is production there", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("VERCEL", "1");
    vi.stubEnv("VERCEL_ENV", "");
    expect(deployment()).toBe("preview");
    expect(writesDerivedState()).toBe(false);
    expect(rehearsalAllowed(PLANT_OPEN_H + 1)).toBe(true);
  });

  it("treats next dev and tests as development, and a local production build (no VERCEL) as production", () => {
    vi.stubEnv("VERCEL", "");
    vi.stubEnv("VERCEL_ENV", "");
    vi.stubEnv("NODE_ENV", "development");
    expect(deployment()).toBe("development");
    vi.stubEnv("NODE_ENV", "test");
    expect(isProduction()).toBe(false);
    vi.stubEnv("NODE_ENV", "production");
    expect(isProduction()).toBe(true);
  });
});

describe("rehearsals", () => {
  it("are open outside production at any hour before the seeds are handed out", () => {
    vi.stubEnv("VERCEL_ENV", "preview");
    vi.stubEnv("MEADOW_REHEARSAL", "");
    expect(rehearsalAllowed(-48)).toBe(true);
    expect(rehearsalAllowed(15)).toBe(true);
    // a dev server or a Preview shows every practice plant, the live site's own included
    expect(practiceVisible(false, 15)).toBe(true);
    expect(practiceVisible(true, -48)).toBe(true);
  });

  it("are open in production before the game clock starts, with or without the old MEADOW_REHEARSAL switch", () => {
    vi.stubEnv("VERCEL_ENV", "production");
    for (const flag of ["", "0", "1"]) {
      vi.stubEnv("MEADOW_REHEARSAL", flag);
      expect(rehearsalAllowed(-24)).toBe(true);
      expect(practiceVisible(true, -24)).toBe(true);
      expect(rehearsalAllowed(-1)).toBe(true);
      expect(practiceVisible(true, -1)).toBe(true);
      expect(rehearsalAllowed(0)).toBe(false);
      expect(practiceVisible(true, 0)).toBe(false);
      expect(plantingWindow(-1, rehearsalAllowed(-1))).toBe("rehearsal");
    }
  });

  it("cannot touch a party-day planting at 15:00 IST in production, even with the old MEADOW_REHEARSAL=1 left on", () => {
    vi.stubEnv("VERCEL_ENV", "production");
    vi.stubEnv("MEADOW_REHEARSAL", "1");
    const h = 15; // 10 Nov 15:00 IST, when the party starts
    expect(rehearsalAllowed(h)).toBe(false);
    expect(practiceVisible(true, h)).toBe(false);
    // the planting is either real (open) or refused until the opening hour (early), never a rehearsal
    expect(plantingWindow(h, rehearsalAllowed(h))).toBe(h >= PLANT_OPEN_H ? "open" : "early");
    for (let hour = 0; hour < PLANT_OPEN_H + 48; hour++) {
      expect(plantingWindow(hour, rehearsalAllowed(hour))).not.toBe("rehearsal");
    }
  });
});

describe("practice plants in the live Meadow", () => {
  it("are only the live site's own, and only before the game clock starts: never a dev server's or a Preview's seeds", () => {
    vi.stubEnv("VERCEL_ENV", "production");
    for (const h of [-500, -1, 0, 15, 400]) expect(practiceVisible(false, h), `a dev or Preview seed at h ${h}`).toBe(false);
    expect(practiceVisible(true, -500)).toBe(true);
    expect(practiceVisible(true, -1)).toBe(true);
    expect(practiceVisible(true, 0)).toBe(false);
    expect(practiceVisible(true, 400)).toBe(false);
  });
});

describe("partyCodes", () => {
  it("reads a comma-separated list, trimmed, so a code can be rotated without a gap", () => {
    vi.stubEnv("MEADOW_PARTY_CODE", "");
    expect(partyCodes()).toEqual([]);
    vi.stubEnv("MEADOW_PARTY_CODE", " Rose-7f3k9q , lantern2x8p ,");
    expect(partyCodes()).toEqual(["Rose-7f3k9q", "lantern2x8p"]);
  });
});
