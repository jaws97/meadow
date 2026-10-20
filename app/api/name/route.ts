// POST /api/name: whether a first name is still free for a garden sign, asked by the name step before the seeds appear.
// Body { firstName, partyCode, clientEventId? } as for planting, behind the same party code (403 party_code_required /
// party_code_wrong), so only people with the party link can ask. clientEventId is the device's own pending planting
// request for that name, if any: a planting whose answer was lost already holds the name, and must not look taken.
// Answers { firstName, available, message }: the name tidied as the sign would show it, and when it is taken the calm
// words the name step shows. Names are unique in the Meadow, ignoring case (migration 0007); this is only a hint, and
// POST /api/seed checks again when the seed goes in.
import { NextResponse, type NextRequest } from "next/server";
import { checkNameFree } from "@/lib/server/garden";
import { ApiError, NO_STORE, errorResponse, readJsonBody } from "@/lib/server/http";
import { parseNameCheckBody } from "@/lib/server/validate";

export async function POST(request: NextRequest) {
  try {
    const parsed = parseNameCheckBody(await readJsonBody(request));
    if (!parsed.ok) throw ApiError.invalid(parsed);
    return NextResponse.json(await checkNameFree(parsed.value), { headers: { "Cache-Control": NO_STORE } });
  } catch (err) {
    return errorResponse(err);
  }
}
