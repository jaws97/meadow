// POST /api/session/reset: "someone else has my garden link". Body: {} (JSON). Revokes every personal garden link of
// the caller and signs out every other device, keeping this one, and returns a fresh private link:
// 200 { link, signedOut, linksRevoked }, or 401 no_session.
import type { NextRequest } from "next/server";
import { ApiError, errorResponse, json, readJsonBody } from "@/lib/server/http";
import { gardenLinkUrl, resetAccess } from "@/lib/server/identity";
import { SESSION_COOKIE } from "@/lib/server/session-rules";

export async function POST(request: NextRequest) {
  try {
    await readJsonBody(request);
    const reset = await resetAccess(request.cookies.get(SESSION_COOKIE)?.value);
    if (!reset) {
      throw new ApiError(401, "no_session", "This device has no garden open. Open your garden here first, then reset its links.");
    }
    return json({ link: gardenLinkUrl(request.nextUrl.origin, reset.linkToken), signedOut: reset.signedOut, linksRevoked: reset.linksRevoked });
  } catch (err) {
    return errorResponse(err);
  }
}
