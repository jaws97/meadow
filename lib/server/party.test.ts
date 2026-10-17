// The party code gate: the QR link's code opens planting, a missing or old code gets a calm 403, and a production
// deployment without a configured code stays closed rather than open to the internet.
import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "./http";
import { checkPartyCode, requirePartyCode } from "./party";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("checkPartyCode", () => {
  it("accepts any configured code exactly, and refuses others", () => {
    const codes = ["Rose-7f3k9q", "lantern2x8p"];
    expect(checkPartyCode("Rose-7f3k9q", codes, true)).toBe("ok");
    expect(checkPartyCode("lantern2x8p", codes, true)).toBe("ok");
    expect(checkPartyCode("rose-7f3k9q", codes, true)).toBe("wrong");
    expect(checkPartyCode("Rose-7f3k9", codes, true)).toBe("wrong");
    expect(checkPartyCode(null, codes, true)).toBe("missing");
    expect(checkPartyCode("", codes, false)).toBe("missing");
  });

  it("is open outside production when no code is configured, and closed in production", () => {
    expect(checkPartyCode(null, [], false)).toBe("ok");
    expect(checkPartyCode("anything", [], false)).toBe("ok");
    expect(checkPartyCode("anything", [], true)).toBe("not_configured");
  });
});

describe("requirePartyCode", () => {
  const thrown = (fn: () => void): ApiError => {
    try {
      fn();
    } catch (err) {
      return err as ApiError;
    }
    throw new Error("expected an ApiError");
  };

  it("answers a missing or old code with a calm 403 that says how to get the link", () => {
    const missing = thrown(() => requirePartyCode(null, ["abc12345"], true));
    expect(missing).toBeInstanceOf(ApiError);
    expect(missing).toMatchObject({ status: 403, code: "party_code_required" });
    expect(missing.message).toMatch(/QR code/);
    expect(thrown(() => requirePartyCode("old12345", ["abc12345"], true))).toMatchObject({ status: 403, code: "party_code_wrong" });
    expect(() => requirePartyCode("abc12345", ["abc12345"], true)).not.toThrow();
  });

  it("answers 503 with a retry hint (and logs) when production has no code configured", () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const err = thrown(() => requirePartyCode("abc12345", [], true));
    expect(err).toMatchObject({ status: 503, code: "planting_not_ready" });
    expect(err.extra.retryAfterS).toBeGreaterThan(0);
    expect(log).toHaveBeenCalledOnce();
  });
});
