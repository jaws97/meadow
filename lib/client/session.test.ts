// The browser helpers' pure parts: the first-name check matches the server's word for word, a garden link is read out
// of the address bar and the address cleaned, the planting retry policy follows the backend notes, and fallback ids are
// UUIDs the seed route accepts. Then one planting run against a stand-in window: a lost answer is said to be a lost
// connection, is tried again as soon as the browser is back online (with the same request), and success drops the
// party code from the address through replaceState(null, ...). And the gift's season check, by lib/sim's hours.
import { afterEach, describe, expect, it, vi } from "vitest";
import { seasonAt, seedsOpenText, showcaseLine } from "@/components/gift/copy";
import { cleanFirstName, isUuid } from "@/lib/server/validate";
import {
  ApiProblem,
  checkFirstName,
  isRetryablePlanting,
  newClientEventId,
  parseLinkLocation,
  plantSeed,
  retryDelayMs,
  splitParams,
} from "./session";

const TOKEN = "A".repeat(20) + "b_-" + "9".repeat(20);

describe("checkFirstName mirrors the server", () => {
  const names = [
    "Asha", "  Asha  ", "Mary-Anne", "O'Brien", "O’Brien", "Jr. Rao", "Zoë", "अनन्या", "李", "  ", "", "Asha!", "123",
    "Ravi (delete me)", "A".repeat(24), "A".repeat(25), "Aná", "Two  spaces", "😀", "Anna Maria",
  ];
  for (const raw of names) {
    it(JSON.stringify(raw), () => {
      const server = cleanFirstName(raw);
      const client = checkFirstName(raw);
      expect(client.ok).toBe(server.ok);
      if (server.ok && client.ok) expect(client.name).toBe(server.value);
      if (!server.ok && !client.ok) {
        expect(client.code).toBe(server.code);
        expect(client.message).toBe(server.message);
      }
    });
  }
});

describe("parseLinkLocation", () => {
  it("takes the token and leaves the rest of the address", () => {
    expect(parseLinkLocation("/garden", "?code=X1", `#k=${TOKEN}`)).toEqual({ token: TOKEN, incomplete: false, cleaned: "/garden?code=X1" });
  });
  it("keeps other fragment parts", () => {
    expect(parseLinkLocation("/garden", "", `#k=${TOKEN}&view=meadow`).cleaned).toBe("/garden#view=meadow");
  });
  it("flags a cut-short token and still cleans it away", () => {
    expect(parseLinkLocation("/garden", "", "#k=abc")).toEqual({ token: null, incomplete: true, cleaned: "/garden" });
  });
  it("reads the old form's ?link=invalid", () => {
    expect(parseLinkLocation("/garden", "?link=invalid", "")).toEqual({ token: null, incomplete: true, cleaned: "/garden" });
  });
  it("leaves an ordinary address alone", () => {
    expect(parseLinkLocation("/garden", "?code=X1", "")).toEqual({ token: null, incomplete: false, cleaned: null });
  });
  it("keeps bare parameters as they were written", () => {
    expect(parseLinkLocation("/garden", "?nopanel&dev", `#k=${TOKEN}`).cleaned).toBe("/garden?nopanel&dev");
    expect(parseLinkLocation("/garden", "?link=invalid&dev", "").cleaned).toBe("/garden?dev");
  });
});

describe("splitParams", () => {
  it("finds the named parts and returns the rest untouched", () => {
    const { rest, found } = splitParams("?nopanel&code=Ab%2012&quality=lite", ["code"]);
    expect(rest).toBe("nopanel&quality=lite");
    expect(found.get("code")).toBe("Ab 12");
  });
  it("copes with an empty string and a malformed escape", () => {
    expect(splitParams("", ["code"]).rest).toBe("");
    expect(splitParams("?code=%E0%A4%A&x", ["code"]).found.get("code")).toBe("%E0%A4%A");
  });
});

describe("planting retries", () => {
  const p = (status: number, code: string, retryAfterS: number | null = null) => new ApiProblem(status, code, "m", retryAfterS);

  it("retries only the throttle, a busy or resting database, and a lost answer", () => {
    expect(isRetryablePlanting(p(429, "busy_planting", 6))).toBe(true);
    expect(isRetryablePlanting(p(503, "busy", 5))).toBe(true);
    expect(isRetryablePlanting(p(503, "unavailable"))).toBe(true);
    expect(isRetryablePlanting(p(0, "offline"))).toBe(true);
    for (const code of ["too_soon", "too_many_links", "too_many_devices", "shade_limit"]) expect(isRetryablePlanting(p(429, code, 900))).toBe(false);
    for (const [status, code] of [[503, "meadow_full"], [503, "planting_not_ready"], [403, "party_code_required"], [403, "party_code_wrong"], [409, "already_planted"], [409, "not_yet"], [400, "name_required"], [500, "server_error"]] as const) {
      expect(isRetryablePlanting(p(status, code))).toBe(false);
    }
  });

  it("waits at least Retry-After, with at most half again plus a second of jitter", () => {
    expect(retryDelayMs(p(429, "busy_planting", 6), 1, () => 0)).toBe(6000);
    expect(retryDelayMs(p(429, "busy_planting", 6), 1, () => 1)).toBe(10000);
    expect(retryDelayMs(p(503, "unavailable"), 1, () => 0)).toBe(5000);
  });

  it("backs off 2, 4, 8 s after a lost answer", () => {
    expect([1, 2, 3, 4].map((a) => retryDelayMs(p(0, "offline"), a, () => 0))).toEqual([2000, 4000, 8000, 8000]);
  });
});

describe("newClientEventId", () => {
  it("makes UUIDs the seed route accepts, with or without randomUUID", () => {
    expect(isUuid(newClientEventId())).toBe(true);
    const c = globalThis.crypto as { randomUUID?: unknown };
    const saved = c.randomUUID;
    try {
      Object.defineProperty(c, "randomUUID", { value: undefined, configurable: true });
      for (let i = 0; i < 50; i++) expect(isUuid(newClientEventId())).toBe(true);
    } finally {
      Object.defineProperty(c, "randomUUID", { value: saved, configurable: true });
    }
  });
});

describe("a planting whose answer was lost", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  function standInWindow(search: string) {
    const store = new Map<string, string>();
    const win = Object.assign(new EventTarget(), {
      location: { pathname: "/garden", search, hash: "" },
      sessionStorage: {
        getItem: (k: string) => store.get(k) ?? null,
        setItem: (k: string, v: string) => void store.set(k, v),
        removeItem: (k: string) => void store.delete(k),
      },
      history: { state: { __NA: true }, replaceState: vi.fn() },
    });
    vi.stubGlobal("window", win);
    return win;
  }

  it("says the connection dropped, tries again once back online with the same request, then drops the code", async () => {
    vi.useFakeTimers();
    const win = standInWindow("?code=party&nopanel");
    const bodies: string[] = [];
    const fetchMock = vi.fn(async (_path: string, init: { body: string }) => {
      bodies.push(init.body);
      if (bodies.length === 1) throw new TypeError("Failed to fetch");
      return new Response(JSON.stringify({ link: "https://x/garden#k=abc", replay: false, me: {} }), { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);
    const waits: number[] = [];
    const planted = plantSeed({ firstName: "Mira", species: "rose", showName: true }, "party", {
      onWait: ({ problem }) => waits.push(problem.status),
    });
    await vi.advanceTimersByTimeAsync(0);
    expect(waits).toEqual([0]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    // back online long before the 2 to 4 s backoff is over: tried again a moment later
    win.dispatchEvent(new Event("online"));
    await vi.advanceTimersByTimeAsync(450);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const result = await planted;
    expect(result.link).toContain("#k=");
    expect(JSON.parse(bodies[1])).toEqual(JSON.parse(bodies[0]));
    expect(JSON.parse(bodies[0])).toMatchObject({ partyCode: "party", firstName: "Mira" });
    // the code leaves the address with a null state, so Next's router takes the clean address as its own
    expect(win.history.replaceState).toHaveBeenCalledWith(null, "", "/garden?nopanel");
  });
});

describe("the gift's season", () => {
  it("follows lib/sim's hours: early before 15:00 IST on 10 Nov, open until 10 Dec, then closed", () => {
    expect(seasonAt(new Date("2026-11-10T14:59:00+05:30"))).toBe("early");
    expect(seasonAt(new Date("2026-11-10T15:00:00+05:30"))).toBe("open");
    expect(seasonAt(new Date("2026-12-10T23:59:00+05:30"))).toBe("open");
    expect(seasonAt(new Date("2026-12-11T00:00:00+05:30"))).toBe("closed");
  });

  it("names the opening moment plainly, and the showcase line follows the season", () => {
    expect(seedsOpenText()).toBe("3 pm on 10 November");
    expect(showcaseLine(new Date("2026-10-20T10:00:00+05:30"))).toBe("Seeds are handed out at the party on 10 November.");
    expect(showcaseLine(new Date("2026-12-20T10:00:00+05:30"))).toMatch(/^Planting closed/);
  });
});
