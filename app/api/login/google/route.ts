// GET /api/login/google?for=garden|keep: starts a Google sign-in (lib/server/google.ts, login-rules.ts). for=garden, from
// a device that holds no garden: open the account's garden here, or plant one kept on it; for=keep, from a garden: keep
// it on the account. Answers 303 to Google's own sign-in page with a fresh state, nonce and PKCE challenge, whose secrets
// wait in a short httpOnly cookie under /api/login/google for the return (callback/route.ts); or, where sign-in is off,
// to /garden?signin=unavailable. Personal, so never cached.
import { NextResponse, type NextRequest } from "next/server";
import { googleSignIn } from "@/lib/server/env";
import { authorizeUrl, newOAuthStart } from "@/lib/server/google";
import { NO_STORE } from "@/lib/server/http";
import { signInCallback } from "@/lib/server/login";
import { encodeOAuth, oauthCookie, type LoginIntent } from "@/lib/server/login-rules";

export async function GET(request: NextRequest) {
  const intent: LoginIntent = request.nextUrl.searchParams.get("for") === "keep" ? "keep" : "garden";
  const google = googleSignIn();
  const headers = { "Cache-Control": NO_STORE };
  if (!google) return NextResponse.redirect(new URL("/garden?signin=unavailable", request.nextUrl.origin), { status: 303, headers });
  const start = newOAuthStart();
  const res = NextResponse.redirect(authorizeUrl(google.clientId, signInCallback(request.nextUrl.origin), start), { status: 303, headers });
  res.cookies.set(oauthCookie(encodeOAuth({ ...start, intent })));
  return res;
}
