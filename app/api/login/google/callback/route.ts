// GET /api/login/google/callback?code=...&state=...: where Google sends a sign-in back (lib/server/google.ts,
// login-rules.ts, login.ts). Checks the state against the sign-in's cookie, exchanges the one-time code for the ID token
// (with the PKCE verifier and our client secret), checks its issuer, audience, expiry and nonce, and keeps only the
// account's number, scrambled. Then opens the account's garden on this device, keeps this device's garden on the
// account, or holds the account for the seed planted next here, and answers 303 to /garden?signin=<how it ended>
// (welcome, plant, kept, taken, elsewhere, cancelled, failed or unavailable), which the garden page reads once and takes
// out of the address bar. The sign-in's cookie is dropped whatever happened. Personal, so never cached.
import { unstable_rethrow } from "next/navigation";
import { NextResponse, type NextRequest } from "next/server";
import { googleSignIn } from "@/lib/server/env";
import { checkIdToken, exchangeCode } from "@/lib/server/google";
import { NO_STORE } from "@/lib/server/http";
import { finishSignIn, signInCallback } from "@/lib/server/login";
import {
  OAUTH_COOKIE,
  clearedLoginCookie,
  clearedOAuthCookie,
  decodeOAuth,
  loginStartCookie,
  sameState,
  subjectHash,
  type SignInResult,
} from "@/lib/server/login-rules";
import { PREV_SESSION_COOKIE, SESSION_COOKIE, prevSessionCookie, sessionCookie } from "@/lib/server/session-rules";

export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const back = (result: SignInResult) => {
    const res = NextResponse.redirect(new URL(`/garden?signin=${result}`, request.nextUrl.origin), {
      status: 303,
      headers: { "Cache-Control": NO_STORE },
    });
    res.cookies.set(clearedOAuthCookie());
    return res;
  };
  const google = googleSignIn();
  if (!google) return back("unavailable");
  const error = params.get("error");
  if (error) return back(error === "access_denied" ? "cancelled" : "failed");
  const started = decodeOAuth(request.cookies.get(OAUTH_COOKIE)?.value);
  const code = params.get("code");
  // a return without this device's own sign-in behind it (expired, another tab's, or forged) goes no further
  if (!started || !code || !sameState(params.get("state"), started.state)) return back("failed");
  try {
    const idToken = await exchangeCode(code, started.verifier, signInCallback(request.nextUrl.origin), google);
    const check = checkIdToken(idToken, google.clientId, started.nonce, Date.now() / 1000);
    if (!check.ok) {
      console.warn(`[meadow api] a Google sign-in was turned away: ${check.why}`);
      return back("failed");
    }
    const done = await finishSignIn(
      started.intent,
      subjectHash(check.sub, google.key),
      request.cookies.get(SESSION_COOKIE)?.value,
      request.cookies.get(PREV_SESSION_COOKIE)?.value,
    );
    const res = back(done.result);
    if (done.sessionToken) res.cookies.set(sessionCookie(done.sessionToken));
    if (done.previousToken) res.cookies.set(prevSessionCookie(done.previousToken));
    if (done.loginToken) res.cookies.set(loginStartCookie(done.loginToken));
    else if (done.result === "welcome" || done.result === "kept") res.cookies.set(clearedLoginCookie());
    return res;
  } catch (err) {
    unstable_rethrow(err);
    const e = err as { code?: string; message?: string };
    console.error(`[meadow api] a Google sign-in did not finish: ${e?.code ?? ""} ${e?.message ?? String(err)}`);
    return back("failed");
  }
}
