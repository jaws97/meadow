// The rules of Google sign-in (login.ts, the routes under app/api/login/google), kept pure so they are tested without a
// database or Google: the cookies a sign-in uses, what it does on its return, and who may plant without the party link.
//
// What is kept: only the account's Google number scrambled with a key that lives on Vercel alone (subjectHash,
// HMAC-SHA-256), never an email, a name or a picture, so the database by itself cannot say whose account a garden is on.
//
// A sign-in is for one of two things:
// - "garden", from a device that holds no garden (the gift's first step): an account that keeps a garden opens it here;
//   an account with none starts a planting, held for an hour by an httpOnly cookie (meadow_login), so the seed planted
//   next on this device is kept on that account;
// - "keep", from a garden (the name pill's menu): this garden is kept on the account, so signing in on any other device
//   opens it. Each account keeps one garden, and each garden is kept on one account.
//
// Since Google sign-in is on (env.ts googleSignIn), a seed planted without the party link needs a signed-in Google
// account that keeps no garden yet: one garden for each account, so strangers cannot crowd the Meadow. A seed with the
// party link plants as before, and is kept on an account too when one was signed in on the device.
import { createHmac, timingSafeEqual } from "node:crypto";
import type { CookieSpec } from "./session-rules";

/** The secrets of a sign-in in progress, from its start to its return (short-lived, only under /api/login/google). */
export const OAUTH_COOKIE = "meadow_oauth";
/** A Google account signed in on this device that keeps no garden yet: the seed planted next is kept on it. */
export const LOGIN_COOKIE = "meadow_login";
export const OAUTH_PATH = "/api/login/google";
/** Ten minutes to choose an account at Google and come back. */
export const OAUTH_MAX_AGE_S = 10 * 60;
/** An hour to choose a name and a seed after signing in. */
export const LOGIN_START_MAX_AGE_S = 60 * 60;

export type LoginIntent = "garden" | "keep";

/**
 * How a sign-in ended, as the garden page reads it (/garden?signin=...): welcome (an account's garden opened here),
 * plant (signed in, now choose a name and a seed), kept (this garden is now kept on the account), taken (that account
 * keeps another garden), elsewhere (this garden is kept on another account), cancelled, failed, unavailable.
 */
export type SignInResult = "welcome" | "plant" | "kept" | "taken" | "elsewhere" | "cancelled" | "failed" | "unavailable";
export const SIGN_IN_RESULTS: readonly SignInResult[] = ["welcome", "plant", "kept", "taken", "elsewhere", "cancelled", "failed", "unavailable"];

export interface OAuthTransaction {
  state: string;
  nonce: string;
  verifier: string;
  intent: LoginIntent;
}

const SECRET_RE = /^[A-Za-z0-9_-]{43}$/;

/** The OAuth cookie's value: the transaction as base64url JSON (httpOnly, so no script reads it; the state guards it). */
export function encodeOAuth(t: OAuthTransaction): string {
  return Buffer.from(JSON.stringify([t.state, t.nonce, t.verifier, t.intent]), "utf8").toString("base64url");
}

/** The transaction from the OAuth cookie, or null for anything else. */
export function decodeOAuth(value: string | undefined): OAuthTransaction | null {
  if (!value || value.length > 400) return null;
  try {
    const v = JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as unknown;
    if (!Array.isArray(v) || v.length !== 4) return null;
    const [state, nonce, verifier, intent] = v as unknown[];
    if (![state, nonce, verifier].every((s) => typeof s === "string" && SECRET_RE.test(s))) return null;
    if (intent !== "garden" && intent !== "keep") return null;
    return { state: state as string, nonce: nonce as string, verifier: verifier as string, intent };
  } catch {
    return null;
  }
}

/** Whether the state Google sent back is the one this device's sign-in began with (compared in constant time). */
export function sameState(returned: string | null, expected: string): boolean {
  if (returned === null || returned.length !== expected.length) return false;
  return timingSafeEqual(Buffer.from(returned, "utf8"), Buffer.from(expected, "utf8"));
}

/** The 32 bytes stored for a Google account: its number, keyed with the server's key, so it cannot be read back. */
export function subjectHash(sub: string, key: string): Buffer {
  return createHmac("sha256", key).update(`google:${sub}`, "utf8").digest();
}

function cookie(name: string, value: string, path: string, maxAge: number) {
  return { name, value, httpOnly: true as const, secure: process.env.NODE_ENV === "production", sameSite: "lax" as const, path, maxAge };
}

/** Set-Cookie options for a sign-in in progress. */
export function oauthCookie(value: string) {
  return cookie(OAUTH_COOKIE, value, OAUTH_PATH, OAUTH_MAX_AGE_S);
}

/** Set-Cookie options that end a sign-in in progress. */
export function clearedOAuthCookie() {
  return cookie(OAUTH_COOKIE, "", OAUTH_PATH, 0);
}

/** Set-Cookie options for an account signed in on a device without a garden, for the seed planted next. */
export function loginStartCookie(token: string): CookieSpec {
  return cookie(LOGIN_COOKIE, token, "/", LOGIN_START_MAX_AGE_S) as CookieSpec;
}

/** Set-Cookie options that drop it (once the seed is in). */
export function clearedLoginCookie(): CookieSpec {
  return cookie(LOGIN_COOKIE, "", "/", 0) as CookieSpec;
}

export type SignInOutcome =
  /** open the account's garden on this device; `switchFrom`: the device's own other garden, kept for "switch back" */
  | { kind: "open"; personId: string; switchFrom: string | null }
  /** this device already shows the account's garden */
  | { kind: "here" }
  /** no garden on the account: hold the account for the seed planted next on this device */
  | { kind: "plant" }
  /** keep the device's garden on the account */
  | { kind: "keep"; personId: string }
  | { kind: "kept_already" }
  | { kind: "taken" }
  | { kind: "elsewhere" }
  | { kind: "no_garden" };

/**
 * What a sign-in does on its return: `accountPerson` keeps a garden on the account (or null), the device shows
 * `devicePerson`'s garden (or null), whose own garden is kept on an account already when `deviceKept`.
 */
export function decideSignIn(intent: LoginIntent, accountPerson: string | null, devicePerson: string | null, deviceKept: boolean): SignInOutcome {
  if (intent === "garden") {
    if (accountPerson === null) return { kind: "plant" };
    if (accountPerson === devicePerson) return { kind: "here" };
    return { kind: "open", personId: accountPerson, switchFrom: devicePerson };
  }
  if (devicePerson === null) return { kind: "no_garden" };
  if (accountPerson === devicePerson) return { kind: "kept_already" };
  if (accountPerson !== null) return { kind: "taken" };
  if (deviceKept) return { kind: "elsewhere" };
  return { kind: "keep", personId: devicePerson };
}

/** The word the garden page reads for an outcome. */
export function resultOf(outcome: SignInOutcome): SignInResult {
  switch (outcome.kind) {
    case "open":
    case "here":
      return "welcome";
    case "plant":
      return "plant";
    case "keep":
    case "kept_already":
      return "kept";
    case "taken":
      return "taken";
    case "elsewhere":
      return "elsewhere";
    case "no_garden":
      return "failed";
  }
}

/**
 * Whether a seed may go in: with the party link, always (the limits are its own, party.ts); without it, once Google
 * sign-in is on, only for a signed-in account (`signedIn`) that keeps no garden yet (`accountHasGarden`).
 */
export function plantingNeeds(pass: "party" | "open", signInOn: boolean, signedIn: boolean, accountHasGarden: boolean): "go" | "sign_in" | "has_garden" {
  if (signedIn && accountHasGarden) return "has_garden";
  if (pass === "open" && signInOn && !signedIn) return "sign_in";
  return "go";
}
