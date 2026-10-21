// POST /api/name: whether a first name is still free for a garden sign, asked by the name step before the seeds appear.
// Body { firstName, partyCode?, clientEventId? } as for planting, open to whoever may plant (anyone, or under
// MEADOW_PLANTING=party only the party link: 403 party_code_required / party_code_wrong). A name that may not stand on
// a sign gets 400 name_unkind with field firstName. clientEventId is the device's own pending planting
// request for that name, if any: a planting whose answer was lost already holds the name, and must not look taken.
// Answers { firstName, available, message }: the name tidied as the sign would show it, and when it is taken the calm
// words the name step shows. Names are unique in the Meadow, ignoring case (migration 0007); this is only a hint, and
// POST /api/seed checks again when the seed goes in. Without the party code, one network may ask a limited number of
// times an hour (429 names_resting, lib/server/network.ts), and a request Vercel BotID takes for a script gets 403
// not_verified (lib/server/bot.ts); the name step then goes on without an answer and the planting checks.
import { NextResponse, type NextRequest } from "next/server";
import { hourIndexOf } from "@/lib/sim";
import { requireHuman } from "@/lib/server/bot";
import { checkNameFree } from "@/lib/server/garden";
import { ApiError, NO_STORE, errorResponse, readJsonBody } from "@/lib/server/http";
import { requestMark } from "@/lib/server/network";
import { istDayOfHour } from "@/lib/server/rules";
import { parseNameCheckBody } from "@/lib/server/validate";

export async function POST(request: NextRequest) {
  try {
    const parsed = parseNameCheckBody(await readJsonBody(request));
    if (!parsed.ok) throw ApiError.invalid(parsed);
    await requireHuman("name check");
    const network = requestMark(request.headers, istDayOfHour(hourIndexOf(new Date())));
    return NextResponse.json(await checkNameFree(parsed.value, network), { headers: { "Cache-Control": NO_STORE } });
  } catch (err) {
    return errorResponse(err);
  }
}
