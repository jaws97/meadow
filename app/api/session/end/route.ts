// POST /api/session/end: signs this device out. Body: {} (JSON, which keeps cross-site forms out). Revokes the
// device's current session and the one kept for "switch back", and clears both cookies; the gardens themselves are
// untouched and open again from their personal garden links. 200 { status: "signed_out", ended }.
import { NextResponse, type NextRequest } from "next/server";
import { NO_STORE, errorResponse, readJsonBody } from "@/lib/server/http";
import { endSessions } from "@/lib/server/identity";
import { PREV_SESSION_COOKIE, SESSION_COOKIE, clearedCookie } from "@/lib/server/session-rules";

export async function POST(request: NextRequest) {
  try {
    await readJsonBody(request);
    const ended = await endSessions([request.cookies.get(SESSION_COOKIE)?.value, request.cookies.get(PREV_SESSION_COOKIE)?.value]);
    const res = NextResponse.json({ status: "signed_out", ended }, { headers: { "Cache-Control": NO_STORE } });
    res.cookies.set(clearedCookie(SESSION_COOKIE));
    res.cookies.set(clearedCookie(PREV_SESSION_COOKIE));
    return res;
  } catch (err) {
    return errorResponse(err);
  }
}
