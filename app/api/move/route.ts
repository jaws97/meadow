// GET /api/move?to=/garden: carries a device's garden from the old address to the new one (lib/server/move.ts): the old
// address's garden pages send a device that holds a garden there to this route (next.config.ts), which answers 307 to
// the new address's garden with a fresh personal link in the fragment and clears the old address's cookies, or to the
// same page at the new address when there is no garden to carry. The link carries the device's standing (when its hold
// on the garden began, lib/server/session-rules.ts), so the device keeps it at the new address; such a link works once.
// Personal, so never cached.
import { NextResponse, type NextRequest } from "next/server";
import { newGardenLink } from "@/lib/server/garden";
import { NO_STORE } from "@/lib/server/http";
import { personIdFromRequest } from "@/lib/server/identity";
import { moveTarget } from "@/lib/server/move";
import { PREV_SESSION_COOKIE, SESSION_COOKIE, clearedCookie } from "@/lib/server/session-rules";
import { hashToken, isTokenShape } from "@/lib/server/tokens";

export async function GET(request: NextRequest) {
  const session = request.cookies.get(SESSION_COOKIE)?.value;
  const move = await moveTarget(request.headers.get("host"), request.nextUrl.searchParams, {
    personId: () => personIdFromRequest(request),
    newLink: (personId) => newGardenLink(personId, isTokenShape(session) ? hashToken(session) : null),
  });
  const res = NextResponse.redirect(move.location, { status: 307, headers: { "Cache-Control": NO_STORE } });
  if (move.carried) {
    res.cookies.set(clearedCookie(SESSION_COOKIE));
    res.cookies.set(clearedCookie(PREV_SESSION_COOKIE));
  }
  return res;
}
