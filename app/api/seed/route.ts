// POST /api/seed: plant a seed. Body { firstName, species, showName?, clientEventId, partyCode } where clientEventId is
// a UUID from crypto.randomUUID(), kept and sent again on a retry, and partyCode is the `code` query parameter of the
// party's QR link (/garden?code=XXXX). Creates the person, their garden and plant in the next free Meadow plot, sets the
// httpOnly session cookie, and returns the personal garden link (private, shown once: the server keeps only its hash)
// with the new plant's view. A retry with the same clientEventId, name and species within half an hour returns the
// same planting (200, replay: true) instead of planting twice; a device that already holds a garden gets 409
// already_planted. A missing or old party code gets 403 party_code_required / party_code_wrong. A burst beyond the
// planting throttle gets 429 busy_planting and a busy database 503 busy, both with Retry-After: the UI retries those
// two by itself with the same body.
import { NextResponse, type NextRequest } from "next/server";
import { plantSeed } from "@/lib/server/garden";
import { ApiError, NO_STORE, errorResponse, readJsonBody } from "@/lib/server/http";
import { gardenLinkUrl, personIdFromRequest } from "@/lib/server/identity";
import { sessionCookie } from "@/lib/server/session-rules";
import { parseSeedBody } from "@/lib/server/validate";

export async function POST(request: NextRequest) {
  try {
    const parsed = parseSeedBody(await readJsonBody(request));
    if (!parsed.ok) throw ApiError.invalid(parsed);
    const sessionPersonId = await personIdFromRequest(request);
    const result = await plantSeed(parsed.value, { sessionPersonId });
    const res = NextResponse.json(
      { link: gardenLinkUrl(request.nextUrl.origin, result.linkToken), replay: result.replay, me: result.me },
      { status: result.replay ? 200 : 201, headers: { "Cache-Control": NO_STORE } },
    );
    if (result.sessionToken) res.cookies.set(sessionCookie(result.sessionToken));
    return res;
  } catch (err) {
    return errorResponse(err);
  }
}
