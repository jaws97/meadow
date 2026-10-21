// Google sign-in, as OpenID Connect's authorization-code flow with PKCE, a state and a nonce, kept to the one thing
// Meadow needs: the number Google gives the account (the ID token's `sub`), which login-rules.ts scrambles before it is
// stored. The scope is openid alone, so Google sends no email, name or picture. The ID token comes straight from
// Google's token endpoint over HTTPS, in exchange for the one-time code, our client secret and the PKCE verifier, so,
// as Google's own guide says, its signature need not be checked again; its issuer, audience, expiry and nonce are.
// Pure apart from the token request (fetch, which the tests replace).
import { createHash, randomBytes } from "node:crypto";

export const GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
export const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const ISSUERS = new Set(["https://accounts.google.com", "accounts.google.com"]);
/** Seconds of clock difference forgiven when reading the token's times. */
const SKEW_S = 300;

/** The secrets one sign-in carries from its start to its return: the state, the nonce and the PKCE verifier. */
export interface OAuthStart {
  state: string;
  nonce: string;
  verifier: string;
}

const random = () => randomBytes(32).toString("base64url");

/** Fresh secrets for one sign-in (each 43 characters: a PKCE verifier may be 43 to 128). */
export function newOAuthStart(): OAuthStart {
  return { state: random(), nonce: random(), verifier: random() };
}

/** The PKCE challenge for a verifier (S256). */
export function codeChallenge(verifier: string): string {
  return createHash("sha256").update(verifier, "ascii").digest("base64url");
}

/** Where a sign-in starts: Google's own page, asked for the account's number only, always letting the person choose. */
export function authorizeUrl(clientId: string, redirectUri: string, start: OAuthStart): string {
  const q = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: "openid",
    state: start.state,
    nonce: start.nonce,
    code_challenge: codeChallenge(start.verifier),
    code_challenge_method: "S256",
    prompt: "select_account",
  });
  return `${GOOGLE_AUTH_URL}?${q}`;
}

export type IdTokenCheck = { ok: true; sub: string } | { ok: false; why: string };

/** Reads an ID token's claims and checks them against this sign-in: Google's issuer, our client, unexpired, our nonce. */
export function checkIdToken(idToken: string, clientId: string, nonce: string, nowS: number): IdTokenCheck {
  const parts = idToken.split(".");
  if (parts.length !== 3) return { ok: false, why: "not a token" };
  let claims: Record<string, unknown>;
  try {
    claims = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8")) as Record<string, unknown>;
  } catch {
    return { ok: false, why: "unreadable claims" };
  }
  if (typeof claims !== "object" || claims === null) return { ok: false, why: "unreadable claims" };
  if (typeof claims.iss !== "string" || !ISSUERS.has(claims.iss)) return { ok: false, why: "issuer" };
  const aud = claims.aud;
  if (!(aud === clientId || (Array.isArray(aud) && aud.includes(clientId) && claims.azp === clientId))) return { ok: false, why: "audience" };
  if (typeof claims.exp !== "number" || claims.exp + SKEW_S < nowS) return { ok: false, why: "expired" };
  if (typeof claims.iat === "number" && claims.iat - SKEW_S > nowS) return { ok: false, why: "issued in the future" };
  if (claims.nonce !== nonce) return { ok: false, why: "nonce" };
  if (typeof claims.sub !== "string" || claims.sub.length === 0 || claims.sub.length > 255) return { ok: false, why: "subject" };
  return { ok: true, sub: claims.sub };
}

/** Exchanges the one-time code for the ID token at Google's token endpoint. Throws on any refusal. */
export async function exchangeCode(
  code: string,
  verifier: string,
  redirectUri: string,
  client: { clientId: string; clientSecret: string },
  fetchFn: typeof fetch = fetch,
): Promise<string> {
  const res = await fetchFn(GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
    body: new URLSearchParams({
      code,
      client_id: client.clientId,
      client_secret: client.clientSecret,
      redirect_uri: redirectUri,
      grant_type: "authorization_code",
      code_verifier: verifier,
    }),
    signal: AbortSignal.timeout(10_000),
  });
  const body = (await res.json().catch(() => null)) as { id_token?: unknown; error?: unknown } | null;
  if (!res.ok || typeof body?.id_token !== "string") {
    throw new Error(`Google's token endpoint answered ${res.status}${typeof body?.error === "string" ? ` (${body.error})` : ""}`);
  }
  return body.id_token;
}
