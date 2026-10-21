// The party code: the QR link's code marks a planting as the party's, anyone without a code plants in the open while
// planting is open to all, an old or mistyped code still gets its calm 403 (never a stranger's seed), and under
// MEADOW_PLANTING=party a missing code gets the 403 too and a production deployment without a configured code stays
// closed rather than open to the internet.
import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "./http";
import { checkPartyCode, plantingPass } from "./party";

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

  it("counts every request as the party's outside production when no code is configured, and none in production", () => {
    expect(checkPartyCode(null, [], false)).toBe("ok");
    expect(checkPartyCode("anything", [], false)).toBe("ok");
    expect(checkPartyCode("anything", [], true)).toBe("not_configured");
  });
});

describe("plantingPass", () => {
  const thrown = (fn: () => void): ApiError => {
    try {
      fn();
    } catch (err) {
      return err as ApiError;
    }
    throw new Error("expected an ApiError");
  };

  it("while planting is open to all, lets anyone plant without a code, and the party's code marks a seed as the party's", () => {
    expect(plantingPass("abc12345", ["abc12345"], true, true)).toBe("party");
    expect(plantingPass(null, ["abc12345"], true, true)).toBe("open");
    expect(plantingPass("", ["abc12345"], true, true)).toBe("open");
    // a production deployment with no code configured still lets anyone plant
    expect(plantingPass(null, [], true, true)).toBe("open");
    // a development server or a Preview plants practice seeds with no limits
    expect(plantingPass(null, [], false, true)).toBe("party");
  });

  it("while planting is open to all, still answers an old or mistyped party link, so the party's seeds never count as strangers'", () => {
    expect(thrown(() => plantingPass("old12345", ["abc12345"], true, true))).toMatchObject({ status: 403, code: "party_code_wrong" });
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(thrown(() => plantingPass("abc12345", [], true, true))).toMatchObject({ status: 503, code: "planting_not_ready" });
    expect(log).toHaveBeenCalledOnce();
  });

  it("with MEADOW_PLANTING=party, answers a missing or old code with a calm 403 that says how to get the link", () => {
    const missing = thrown(() => plantingPass(null, ["abc12345"], true, false));
    expect(missing).toBeInstanceOf(ApiError);
    expect(missing).toMatchObject({ status: 403, code: "party_code_required" });
    expect(missing.message).toMatch(/QR code/);
    expect(thrown(() => plantingPass("old12345", ["abc12345"], true, false))).toMatchObject({ status: 403, code: "party_code_wrong" });
    expect(plantingPass("abc12345", ["abc12345"], true, false)).toBe("party");
  });

  it("with MEADOW_PLANTING=party, answers 503 with a retry hint (and logs) when production has no code configured", () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const err = thrown(() => plantingPass("abc12345", [], true, false));
    expect(err).toMatchObject({ status: 503, code: "planting_not_ready" });
    expect(err.extra.retryAfterS).toBeGreaterThan(0);
    expect(log).toHaveBeenCalledOnce();
  });
});
