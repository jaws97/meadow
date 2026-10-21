// The per-network limits: which network an address counts as (an IPv6 /64 whole, an IPv4 address alone), the scrambled
// mark that is all the database keeps (different every IST day, and under every key), and when a network has planted or
// checked its share.
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  NAME_CHECKS_PER_NETWORK_HOUR,
  SEEDS_PER_NETWORK_DAY,
  SEEDS_PER_NETWORK_HOUR,
  clientAddress,
  networkMark,
  networkNameWait,
  networkOf,
  networkSeedWait,
  requestMark,
} from "./network";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("networkOf", () => {
  it("counts an IPv4 address as itself, an IPv4-mapped IPv6 address included", () => {
    expect(networkOf("203.0.113.9")).toBe("203.0.113.9");
    expect(networkOf(" 203.0.113.9 ")).toBe("203.0.113.9");
    expect(networkOf("::ffff:203.0.113.9")).toBe("203.0.113.9");
    expect(networkOf("010.001.002.003")).toBe("10.1.2.3");
  });

  it("counts every address in an IPv6 /64 as one network, however it is written", () => {
    const a = networkOf("2401:4900:1c3a:7d2e:1111:2222:3333:4444");
    expect(a).toBe("2401:4900:1c3a:7d2e::/64");
    expect(networkOf("2401:4900:1c3a:7d2e::9")).toBe(a);
    expect(networkOf("2401:4900:1C3A:7D2E:0:0:0:1")).toBe(a);
    expect(networkOf("[2401:4900:1c3a:7d2e::1]")).toBe(a);
    expect(networkOf("fe80::1%eth0")).toBe("fe80:0:0:0::/64");
    expect(networkOf("2401:4900:1c3a:7d2f::1")).not.toBe(a);
  });

  it("keeps text it cannot read as an address as it is, trimmed and shortened", () => {
    expect(networkOf("unknown")).toBe("unknown");
    expect(networkOf("1:2:3")).toBe("1:2:3");
    expect(networkOf("999.1.1.1")).toBe("999.1.1.1");
    expect(networkOf("x".repeat(200))).toHaveLength(64);
  });
});

describe("clientAddress", () => {
  it("reads Vercel's x-real-ip first, then the first x-forwarded-for entry", () => {
    expect(clientAddress(new Headers({ "x-real-ip": "203.0.113.9", "x-forwarded-for": "198.51.100.1" }))).toBe("203.0.113.9");
    expect(clientAddress(new Headers({ "x-forwarded-for": "198.51.100.1, 10.0.0.1" }))).toBe("198.51.100.1");
    expect(clientAddress(new Headers())).toBeNull();
  });
});

describe("networkMark", () => {
  const KEY = "k".repeat(40);

  it("is 32 bytes, the same for one network on one day, and different across days, networks and keys", () => {
    const m = networkMark("203.0.113.9", "2026-11-10", KEY);
    expect(m).toHaveLength(32);
    expect(networkMark("203.0.113.9", "2026-11-10", KEY).equals(m)).toBe(true);
    expect(networkMark("203.0.113.9", "2026-11-11", KEY).equals(m)).toBe(false);
    expect(networkMark("203.0.113.10", "2026-11-10", KEY).equals(m)).toBe(false);
    expect(networkMark("203.0.113.9", "2026-11-10", "j".repeat(40)).equals(m)).toBe(false);
  });

  it("never contains the address", () => {
    const m = networkMark("203.0.113.9", "2026-11-10", KEY);
    expect(m.toString("latin1")).not.toContain("203.0.113.9");
  });

  it("is kept only where there is a key: never in production without MEADOW_LOGIN_KEY", () => {
    const headers = new Headers({ "x-real-ip": "203.0.113.9" });
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.stubEnv("VERCEL", "1");
    vi.stubEnv("VERCEL_ENV", "production");
    vi.stubEnv("MEADOW_LOGIN_KEY", "");
    expect(requestMark(headers, "2026-11-10")).toBeNull();
    vi.stubEnv("MEADOW_LOGIN_KEY", KEY);
    expect(requestMark(headers, "2026-11-10")?.equals(networkMark("203.0.113.9", "2026-11-10", KEY))).toBe(true);
    // a development server marks with the public development key, so its marks never match production's
    vi.stubEnv("VERCEL_ENV", "development");
    vi.stubEnv("MEADOW_LOGIN_KEY", "");
    expect(requestMark(headers, "2026-11-10")).toHaveLength(32);
    expect(requestMark(headers, "2026-11-10")?.equals(networkMark("203.0.113.9", "2026-11-10", KEY))).toBe(false);
  });
});

describe("limits", () => {
  it("let a household or an office team plant, and stop a script after a few seeds an hour", () => {
    expect(networkSeedWait({ hour: 0, day: 0 })).toBe("go");
    expect(networkSeedWait({ hour: SEEDS_PER_NETWORK_HOUR - 1, day: SEEDS_PER_NETWORK_HOUR - 1 })).toBe("go");
    expect(networkSeedWait({ hour: SEEDS_PER_NETWORK_HOUR, day: SEEDS_PER_NETWORK_HOUR })).toBe("hour");
    expect(networkSeedWait({ hour: 0, day: SEEDS_PER_NETWORK_DAY })).toBe("day");
    expect(networkSeedWait({ hour: SEEDS_PER_NETWORK_HOUR, day: SEEDS_PER_NETWORK_DAY })).toBe("day");
    expect(SEEDS_PER_NETWORK_DAY).toBeGreaterThan(SEEDS_PER_NETWORK_HOUR);
  });

  it("let a person try plenty of names, and stop a script listing them", () => {
    expect(networkNameWait(0)).toBe("go");
    expect(networkNameWait(NAME_CHECKS_PER_NETWORK_HOUR - 1)).toBe("go");
    expect(networkNameWait(NAME_CHECKS_PER_NETWORK_HOUR)).toBe("hour");
    expect(NAME_CHECKS_PER_NETWORK_HOUR).toBeGreaterThanOrEqual(30);
  });
});
