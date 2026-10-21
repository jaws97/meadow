// The rules of Google sign-in: the sign-in's cookie, the scrambled account number that is all Meadow keeps, what a
// sign-in does on its return, and who may plant without the party link once sign-in is on.
import { describe, expect, it } from "vitest";
import {
  LOGIN_COOKIE,
  OAUTH_COOKIE,
  clearedLoginCookie,
  clearedOAuthCookie,
  decideSignIn,
  decodeOAuth,
  encodeOAuth,
  loginStartCookie,
  oauthCookie,
  plantingNeeds,
  resultOf,
  sameState,
  subjectHash,
} from "./login-rules";
import { newOAuthStart } from "./google";

describe("the sign-in's cookie", () => {
  it("carries the state, nonce, verifier and what the sign-in is for, and nothing else gets through", () => {
    const t = { ...newOAuthStart(), intent: "keep" as const };
    expect(decodeOAuth(encodeOAuth(t))).toEqual(t);
    expect(decodeOAuth(undefined)).toBeNull();
    expect(decodeOAuth("not-base64-json")).toBeNull();
    expect(decodeOAuth(encodeOAuth({ ...t, intent: "admin" as "keep" }))).toBeNull();
    expect(decodeOAuth(encodeOAuth({ ...t, state: "short" }))).toBeNull();
    expect(decodeOAuth("x".repeat(500))).toBeNull();
  });

  it("compares the returned state in constant time, and only an exact match passes", () => {
    const s = newOAuthStart().state;
    expect(sameState(s, s)).toBe(true);
    expect(sameState(null, s)).toBe(false);
    expect(sameState(s.slice(1), s)).toBe(false);
    expect(sameState(`${s.slice(0, -1)}x`, s)).toBe(s.endsWith("x"));
  });

  it("is httpOnly and lax, lives ten minutes under /api/login/google, and is dropped on the return", () => {
    expect(oauthCookie("v")).toMatchObject({ name: OAUTH_COOKIE, httpOnly: true, sameSite: "lax", path: "/api/login/google", maxAge: 600 });
    expect(clearedOAuthCookie()).toMatchObject({ name: OAUTH_COOKIE, value: "", path: "/api/login/google", maxAge: 0 });
    expect(loginStartCookie("t")).toMatchObject({ name: LOGIN_COOKIE, httpOnly: true, path: "/", maxAge: 3600 });
    expect(clearedLoginCookie()).toMatchObject({ name: LOGIN_COOKIE, value: "", path: "/", maxAge: 0 });
  });
});

describe("what is kept of a Google account", () => {
  it("is 32 bytes that change with the account and with the server's key, and never the number itself", () => {
    const a = subjectHash("109876543210987654321", "key-one-key-one-key-one-key-one-x");
    expect(a).toHaveLength(32);
    expect(subjectHash("109876543210987654321", "key-one-key-one-key-one-key-one-x").equals(a)).toBe(true);
    expect(subjectHash("109876543210987654322", "key-one-key-one-key-one-key-one-x").equals(a)).toBe(false);
    expect(subjectHash("109876543210987654321", "key-two-key-two-key-two-key-two-x").equals(a)).toBe(false);
    expect(a.toString("utf8")).not.toContain("109876543210987654321");
  });
});

describe("what a sign-in does on its return", () => {
  it("from a device without a garden: opens the account's garden, or holds the account for a planting", () => {
    expect(decideSignIn("garden", "p1", null, false)).toEqual({ kind: "open", personId: "p1", switchFrom: null });
    expect(decideSignIn("garden", null, null, false)).toEqual({ kind: "plant" });
    // already showing it; another garden on the device is kept for "switch back"
    expect(decideSignIn("garden", "p1", "p1", true)).toEqual({ kind: "here" });
    expect(decideSignIn("garden", "p1", "p2", false)).toEqual({ kind: "open", personId: "p1", switchFrom: "p2" });
  });

  it("from a garden: keeps it on the account, once, and never takes another garden's account", () => {
    expect(decideSignIn("keep", null, "p1", false)).toEqual({ kind: "keep", personId: "p1" });
    expect(decideSignIn("keep", "p1", "p1", true)).toEqual({ kind: "kept_already" });
    expect(decideSignIn("keep", "p2", "p1", false)).toEqual({ kind: "taken" });
    expect(decideSignIn("keep", null, "p1", true)).toEqual({ kind: "elsewhere" });
    expect(decideSignIn("keep", null, null, false)).toEqual({ kind: "no_garden" });
  });

  it("tells the garden page how it ended", () => {
    expect(resultOf({ kind: "open", personId: "p", switchFrom: null })).toBe("welcome");
    expect(resultOf({ kind: "here" })).toBe("welcome");
    expect(resultOf({ kind: "plant" })).toBe("plant");
    expect(resultOf({ kind: "keep", personId: "p" })).toBe("kept");
    expect(resultOf({ kind: "kept_already" })).toBe("kept");
    expect(resultOf({ kind: "taken" })).toBe("taken");
    expect(resultOf({ kind: "elsewhere" })).toBe("elsewhere");
    expect(resultOf({ kind: "no_garden" })).toBe("failed");
  });
});

describe("who may plant", () => {
  it("lets the party link plant as before, and asks anyone else to sign in once sign-in is on", () => {
    expect(plantingNeeds("party", true, false, false)).toBe("go");
    expect(plantingNeeds("open", false, false, false)).toBe("go");
    expect(plantingNeeds("open", true, false, false)).toBe("sign_in");
    expect(plantingNeeds("open", true, true, false)).toBe("go");
  });

  it("gives each account one garden, with the party link too", () => {
    expect(plantingNeeds("open", true, true, true)).toBe("has_garden");
    expect(plantingNeeds("party", true, true, true)).toBe("has_garden");
  });
});
