// POST /api/session/back: returns this device to the garden it showed before a switch. Body: {} (JSON, which keeps
// cross-site forms out). The garden switched away from is signed out on this device, so on a shared tablet the second
// person's garden does not linger. 200 { status: "switched_back", person }, or 409 nothing_to_switch_back.
import { NextResponse, type NextRequest } from "next/server";
import { ApiError, NO_STORE, errorResponse, readJsonBody } from "@/lib/server/http";
import { switchBack } from "@/lib/server/identity";
import { PREV_SESSION_COOKIE, SESSION_COOKIE, clearedCookie, sessionCookie } from "@/lib/server/session-rules";

export async function POST(request: NextRequest) {
  try {
    await readJsonBody(request);
    const back = await switchBack(request.cookies.get(SESSION_COOKIE)?.value, request.cookies.get(PREV_SESSION_COOKIE)?.value);
    if (!back) throw new ApiError(409, "nothing_to_switch_back", "There is no earlier garden on this device to go back to.");
    const res = NextResponse.json({ status: "switched_back", person: back.person }, { headers: { "Cache-Control": NO_STORE } });
    res.cookies.set(sessionCookie(back.sessionToken));
    res.cookies.set(clearedCookie(PREV_SESSION_COOKIE));
    return res;
  } catch (err) {
    return errorResponse(err);
  }
}
