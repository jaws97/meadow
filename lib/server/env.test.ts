// Which deployment this is, and what it may write: only production saves checkpoints and weather; Vercel without
// VERCEL_ENV is never production; practice (rehearsal) plants come only from a dev server or a Preview and never show in
// production, where every planting is real, before the party too.
import { afterEach, describe, expect, it, vi } from "vitest";
import { deployment, isProduction, partyCodes, plantingOpenToAll, showRehearsals, writesDerivedState } from "./env";
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
    expect(showRehearsals()).toBe(true);
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

describe("practice plants", () => {
  it("show on a dev server or a Preview, which plant only those", () => {
    vi.stubEnv("VERCEL_ENV", "preview");
    expect(showRehearsals()).toBe(true);
  });

  it("never show in production, whatever the old MEADOW_REHEARSAL switch says, and planting is open from 20 Oct", () => {
    vi.stubEnv("VERCEL_ENV", "production");
    for (const flag of ["", "0", "1"]) {
      vi.stubEnv("MEADOW_REHEARSAL", flag);
      expect(showRehearsals()).toBe(false);
    }
    // 20 Oct, the party morning, the party and the last hour of 10 Dec: open; after it, closed
    for (const h of [-494, -1, 0, 14, 15, 743]) expect(plantingWindow(h), `h ${h}`).toBe("open");
    expect(plantingWindow(744)).toBe("closed");
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

describe("plantingOpenToAll", () => {
  it("lets anyone plant unless MEADOW_PLANTING asks for the party link again", () => {
    vi.stubEnv("MEADOW_PLANTING", "");
    expect(plantingOpenToAll()).toBe(true);
    vi.stubEnv("MEADOW_PLANTING", "open");
    expect(plantingOpenToAll()).toBe(true);
    vi.stubEnv("MEADOW_PLANTING", " Party ");
    expect(plantingOpenToAll()).toBe(false);
  });
});
