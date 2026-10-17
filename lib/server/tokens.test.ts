// Session and garden-link tokens: 32 random bytes as 43 base64url characters, stored only as their SHA-256.
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { TOKEN_BYTES, hashToken, isTokenShape, newToken } from "./tokens";

describe("newToken", () => {
  it("is 32 random bytes as unpadded base64url", () => {
    const t = newToken();
    expect(t).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(Buffer.from(t, "base64url")).toHaveLength(TOKEN_BYTES);
  });

  it("never repeats", () => {
    const seen = new Set(Array.from({ length: 2000 }, newToken));
    expect(seen.size).toBe(2000);
  });
});

describe("hashToken", () => {
  it("is SHA-256: the standard test vector, 32 bytes", () => {
    expect(hashToken("abc").toString("hex")).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
    expect(hashToken(newToken())).toHaveLength(32);
  });

  it("is deterministic, distinct per token, and never the token itself", () => {
    const t = newToken();
    expect(hashToken(t).equals(hashToken(t))).toBe(true);
    expect(hashToken(t).equals(hashToken(newToken()))).toBe(false);
    expect(hashToken(t).toString("base64url")).not.toBe(t);
    expect(hashToken(t).equals(createHash("sha256").update(t).digest())).toBe(true);
  });

  it("keys a seed request id the same way every time, so a retried planting is recognised", () => {
    const id = "3f6c2a9e-8b1d-4c7a-9e2f-1a2b3c4d5e6f";
    expect(hashToken(`seed:${id}`).equals(hashToken(`seed:${id}`))).toBe(true);
    expect(hashToken(`seed:${id}`).equals(hashToken(id))).toBe(false);
  });
});

describe("isTokenShape", () => {
  it("accepts only 43-character base64url strings", () => {
    expect(isTokenShape(newToken())).toBe(true);
    expect(isTokenShape("A".repeat(42))).toBe(false);
    expect(isTokenShape("A".repeat(44))).toBe(false);
    expect(isTokenShape("A".repeat(42) + "=")).toBe(false);
    expect(isTokenShape("A".repeat(42) + "/")).toBe(false);
    expect(isTokenShape(undefined)).toBe(false);
    expect(isTokenShape(42)).toBe(false);
  });
});
