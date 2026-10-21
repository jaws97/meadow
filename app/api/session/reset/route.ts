// POST /api/session/reset: "Sign out other devices" (someone else has my garden link). Body: {} (JSON). Turns off every
// personal garden link of the caller, signs out the devices that opened the garden after this one (never one that
// came before it: no device can sign out the one that planted), lets go of a Google account the garden was kept on after
// this device opened it (lib/server/identity.ts resetAccess, session-rules.ts planSignOut), and returns a fresh private
// link: 200 { link, signedOut, stayed, linksRevoked, releasedAccount }, or 401 no_session.
import type { NextRequest } from "next/server";
import { ApiError, errorResponse, json, readJsonBody } from "@/lib/server/http";
import { gardenLinkUrl, resetAccess } from "@/lib/server/identity";
import { SESSION_COOKIE } from "@/lib/server/session-rules";

export async function POST(request: NextRequest) {
  try {
    await readJsonBody(request);
    const reset = await resetAccess(request.cookies.get(SESSION_COOKIE)?.value);
    if (!reset) {
      throw new ApiError(401, "no_session", "This device has no garden open. Open your garden here first, then sign out the others.");
    }
    return json({
      link: gardenLinkUrl(request.nextUrl.origin, reset.linkToken),
      signedOut: reset.signedOut,
      stayed: reset.stayed,
      linksRevoked: reset.linksRevoked,
      releasedAccount: reset.releasedAccount,
    });
  } catch (err) {
    return errorResponse(err);
  }
}
