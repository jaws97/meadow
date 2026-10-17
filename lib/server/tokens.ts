// Bearer tokens for device sessions and personal garden links: 32 random bytes, sent to the browser as base64url
// (43 characters) and stored only as their SHA-256, so a database leak reveals no usable token and a lost link can be
// replaced but never read back. Pure apart from the CSPRNG, so the tests run without a database.
import { createHash, randomBytes } from "node:crypto";

export const TOKEN_BYTES = 32;
/** 32 bytes as unpadded base64url is always 43 characters. */
const TOKEN_RE = /^[A-Za-z0-9_-]{43}$/;

/** A fresh random token, base64url without padding. */
export function newToken(): string {
  return randomBytes(TOKEN_BYTES).toString("base64url");
}

/** True for a string shaped like a token from newToken(); checked before any hashing or database lookup. */
export function isTokenShape(value: unknown): value is string {
  return typeof value === "string" && TOKEN_RE.test(value);
}

/** The 32-byte SHA-256 the database stores for a token (or any other secret-ish key, such as a seed request id). */
export function hashToken(token: string): Buffer {
  return createHash("sha256").update(token, "utf8").digest();
}
