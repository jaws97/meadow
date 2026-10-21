// Google sign-in's talk with Google: the sign-in page it starts at (openid only, PKCE S256, a fresh state and nonce),
// the ID token's checks (Google's issuer, our client, unexpired, our nonce), and the code exchange.
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { GOOGLE_TOKEN_URL, authorizeUrl, checkIdToken, codeChallenge, exchangeCode, newOAuthStart } from "./google";

const CLIENT = "123-abc.apps.googleusercontent.com";
const NOW = 1_800_000_000;
const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url");
const token = (claims: Record<string, unknown>) => `${b64({ alg: "RS256", kid: "k" })}.${b64(claims)}.sig`;
const good = { iss: "https://accounts.google.com", aud: CLIENT, sub: "109876543210987654321", nonce: "n-1", exp: NOW + 3600, iat: NOW };

describe("the sign-in page", () => {
  it("asks Google for the account's number only, with PKCE, a state and a nonce, letting the person choose an account", () => {
    const start = newOAuthStart();
    const u = new URL(authorizeUrl(CLIENT, "https://growmyflower.vercel.app/api/login/google/callback", start));
    expect(u.origin + u.pathname).toBe("https://accounts.google.com/o/oauth2/v2/auth");
    const q = Object.fromEntries(u.searchParams);
    expect(q).toMatchObject({
      client_id: CLIENT,
      redirect_uri: "https://growmyflower.vercel.app/api/login/google/callback",
      response_type: "code",
      scope: "openid",
      state: start.state,
      nonce: start.nonce,
      code_challenge_method: "S256",
      prompt: "select_account",
    });
    expect(q.code_challenge).toBe(createHash("sha256").update(start.verifier).digest("base64url"));
    expect(q.code_challenge).toBe(codeChallenge(start.verifier));
  });

  it("makes fresh secrets each time, long enough for a PKCE verifier", () => {
    const a = newOAuthStart(), b = newOAuthStart();
    for (const s of [a.state, a.nonce, a.verifier]) expect(s).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(new Set([a.state, a.nonce, a.verifier, b.state, b.nonce, b.verifier]).size).toBe(6);
  });
});

describe("the ID token's checks", () => {
  it("takes Google's number for a token made for this sign-in", () => {
    expect(checkIdToken(token(good), CLIENT, "n-1", NOW)).toEqual({ ok: true, sub: good.sub });
    expect(checkIdToken(token({ ...good, iss: "accounts.google.com" }), CLIENT, "n-1", NOW).ok).toBe(true);
    expect(checkIdToken(token({ ...good, aud: [CLIENT, "other"], azp: CLIENT }), CLIENT, "n-1", NOW).ok).toBe(true);
  });

  it("turns away another issuer, another client, an old token, another sign-in's nonce and a missing number", () => {
    const why = (claims: Record<string, unknown>, nonce = "n-1") => {
      const r = checkIdToken(token(claims), CLIENT, nonce, NOW);
      return r.ok ? "ok" : r.why;
    };
    expect(why({ ...good, iss: "https://evil.example" })).toBe("issuer");
    expect(why({ ...good, aud: "someone-else" })).toBe("audience");
    expect(why({ ...good, aud: [CLIENT, "other"] })).toBe("audience");
    expect(why({ ...good, exp: NOW - 301 })).toBe("expired");
    expect(why({ ...good, iat: NOW + 3600 })).toBe("issued in the future");
    expect(why(good, "n-2")).toBe("nonce");
    expect(why({ ...good, sub: "" })).toBe("subject");
    expect(checkIdToken("not.a", CLIENT, "n-1", NOW)).toEqual({ ok: false, why: "not a token" });
    expect(checkIdToken("a.%%%.c", CLIENT, "n-1", NOW).ok).toBe(false);
  });
});

describe("the code exchange", () => {
  it("sends the code with the verifier and the client's secret, and returns the ID token", async () => {
    let sent: { url: string; body: URLSearchParams } | null = null;
    const fake = (async (url: string, init: RequestInit) => {
      sent = { url, body: init.body as URLSearchParams };
      return new Response(JSON.stringify({ id_token: "the.id.token", access_token: "x" }), { status: 200 });
    }) as unknown as typeof fetch;
    const got = await exchangeCode("code-1", "verifier-1", "http://localhost:3000/api/login/google/callback", { clientId: CLIENT, clientSecret: "s3cret" }, fake);
    expect(got).toBe("the.id.token");
    expect(sent!.url).toBe(GOOGLE_TOKEN_URL);
    expect(Object.fromEntries(sent!.body)).toEqual({
      code: "code-1",
      client_id: CLIENT,
      client_secret: "s3cret",
      redirect_uri: "http://localhost:3000/api/login/google/callback",
      grant_type: "authorization_code",
      code_verifier: "verifier-1",
    });
  });

  it("throws on a refusal, saying what Google said", async () => {
    const fake = (async () => new Response(JSON.stringify({ error: "invalid_grant" }), { status: 400 })) as unknown as typeof fetch;
    await expect(exchangeCode("c", "v", "r", { clientId: CLIENT, clientSecret: "s" }, fake)).rejects.toThrow("400 (invalid_grant)");
  });
});
