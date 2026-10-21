// Device sessions: the cookie flags, opening a garden link never silently replaces the garden a device holds, and
// sessions and links stop working after their server-side lifetime, with an hourly cap on how many a person can make;
// and "Sign out other devices" never lets a newer device sign out an older one.
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  LINKS_PER_HOUR,
  LINK_TTL_DAYS,
  PREV_SESSION_COOKIE,
  SESSIONS_PER_HOUR,
  SESSION_COOKIE,
  SESSION_MAX_AGE_S,
  SESSION_TTL_DAYS,
  clearedCookie,
  decideLinkOpen,
  linkCutoff,
  planSignOut,
  prevSessionCookie,
  sessionCookie,
  sessionCutoff,
  underHourlyLimit,
} from "./session-rules";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("cookies", () => {
  it("are httpOnly, SameSite=Lax, site-wide, and outlast the season", () => {
    for (const c of [sessionCookie("t"), prevSessionCookie("t")]) {
      expect(c).toMatchObject({ value: "t", httpOnly: true, sameSite: "lax", path: "/", maxAge: SESSION_MAX_AGE_S });
    }
    expect(sessionCookie("t").name).toBe(SESSION_COOKIE);
    expect(prevSessionCookie("t").name).toBe(PREV_SESSION_COOKIE);
    expect(SESSION_MAX_AGE_S).toBeGreaterThan(60 * 60 * 24 * 60);
  });

  it("are Secure in production only (so the local dev server on http still works)", () => {
    vi.stubEnv("NODE_ENV", "production");
    expect(sessionCookie("t").secure).toBe(true);
    vi.stubEnv("NODE_ENV", "development");
    expect(sessionCookie("t").secure).toBe(false);
  });

  it("clear with the same name and path, an empty value and no lifetime", () => {
    expect(clearedCookie(SESSION_COOKIE)).toMatchObject({ name: SESSION_COOKIE, value: "", path: "/", maxAge: 0, httpOnly: true });
    expect(clearedCookie(PREV_SESSION_COOKIE).name).toBe(PREV_SESSION_COOKIE);
  });
});

describe("decideLinkOpen", () => {
  it("signs an empty device in", () => {
    expect(decideLinkOpen("asha", null, false)).toBe("sign_in");
    expect(decideLinkOpen("asha", null, true)).toBe("sign_in");
  });

  it("does nothing when the device already shows that garden", () => {
    expect(decideLinkOpen("asha", "asha", false)).toBe("already_here");
    expect(decideLinkOpen("asha", "asha", true)).toBe("already_here");
  });

  it("asks before replacing another person's garden, and switches only when confirmed", () => {
    expect(decideLinkOpen("asha", "ravi", false)).toBe("switch_needed");
    expect(decideLinkOpen("asha", "ravi", true)).toBe("switch");
  });
});

describe("lifetimes and limits", () => {
  const DAY = 24 * 60 * 60 * 1000;
  const now = new Date("2027-03-01T10:00:00Z");

  it("honour a session a little past its cookie, and a link for a year", () => {
    expect(SESSION_TTL_DAYS * 86_400).toBeGreaterThan(SESSION_MAX_AGE_S);
    expect(SESSION_TTL_DAYS).toBeLessThanOrEqual(366);
    expect(now.getTime() - sessionCutoff(now).getTime()).toBe(SESSION_TTL_DAYS * DAY);
    expect(now.getTime() - linkCutoff(now).getTime()).toBe(LINK_TTL_DAYS * DAY);
    expect(LINK_TTL_DAYS).toBeGreaterThanOrEqual(SESSION_TTL_DAYS);
  });

  it("cap how many sessions and links one person can make in an hour", () => {
    expect(underHourlyLimit(0, LINKS_PER_HOUR)).toBe(true);
    expect(underHourlyLimit(LINKS_PER_HOUR - 1, LINKS_PER_HOUR)).toBe(true);
    expect(underHourlyLimit(LINKS_PER_HOUR, LINKS_PER_HOUR)).toBe(false);
    expect(underHourlyLimit(SESSIONS_PER_HOUR + 5, SESSIONS_PER_HOUR)).toBe(false);
    // planting makes one session and one link, and a person sets up a few devices: well inside both caps
    expect(LINKS_PER_HOUR).toBeGreaterThanOrEqual(5);
    expect(SESSIONS_PER_HOUR).toBeGreaterThanOrEqual(12);
  });
});

describe("planSignOut: a newer key never outranks an older one", () => {
  // standings in microseconds: the phone that planted, then a link opened by the wrong person, then that person's
  // Google account, then the gardener's own laptop
  const PLANTED = 1_000_000, STRANGER = 2_000_000, STRANGER_KEEPS = 3_000_000, LAPTOP = 4_000_000;

  it("lets the phone that planted sign out a stranger's link and let go of the Google account they added", () => {
    const plan = planSignOut(PLANTED, [{ id: "stranger", standingUs: STRANGER }, { id: "stranger-google", standingUs: STRANGER_KEEPS }], STRANGER_KEEPS);
    expect(plan).toEqual({ signOut: ["stranger", "stranger-google"], stay: 0, releaseAccount: true });
  });

  it("never lets the stranger sign out the phone that planted, or let go of an account added before them", () => {
    expect(planSignOut(STRANGER, [{ id: "phone", standingUs: PLANTED }], null)).toEqual({ signOut: [], stay: 1, releaseAccount: false });
    // the gardener kept the garden on Google before the link went astray
    expect(planSignOut(STRANGER, [{ id: "phone", standingUs: PLANTED }], 1_500_000).releaseAccount).toBe(false);
  });

  it("signs out only devices that came later, and counts the ones that stay", () => {
    const plan = planSignOut(STRANGER, [
      { id: "phone", standingUs: PLANTED },
      { id: "laptop", standingUs: LAPTOP },
    ], null);
    expect(plan.signOut).toEqual(["laptop"]);
    expect(plan.stay).toBe(1);
  });

  it("leaves a device opened through Google alone with the account it came by, and its twins on that account", () => {
    // a device opened through Google stands from the moment the garden was kept on the account, to the microsecond
    const plan = planSignOut(STRANGER_KEEPS, [{ id: "other-google-device", standingUs: STRANGER_KEEPS }], STRANGER_KEEPS);
    expect(plan).toEqual({ signOut: [], stay: 1, releaseAccount: false });
  });

  it("does nothing to other devices when there are none, and lets go of no account when none is kept", () => {
    expect(planSignOut(PLANTED, [], null)).toEqual({ signOut: [], stay: 0, releaseAccount: false });
  });
});
