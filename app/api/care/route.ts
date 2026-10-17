// POST /api/care: one care action for the caller's plant. Body { kind, clientEventId, on? } where kind is water, shade,
// cover, feed, tend, talk, revive or replant, and on (true or false) is required for shade and cover. Returns the
// recorded event and the refreshed plant view. A retry with the same clientEventId returns the original event
// (duplicate: true); a can or feed inside its rate limit is declined with 429 and retryAt.
import type { NextRequest } from "next/server";
import { recordCare } from "@/lib/server/garden";
import { ApiError, errorResponse, json, readJsonBody } from "@/lib/server/http";
import { requirePersonId } from "@/lib/server/identity";
import { parseCareBody } from "@/lib/server/validate";

export async function POST(request: NextRequest) {
  try {
    const parsed = parseCareBody(await readJsonBody(request));
    if (!parsed.ok) throw ApiError.invalid(parsed);
    const personId = await requirePersonId(request);
    return json(await recordCare(personId, parsed.value));
  } catch (err) {
    return errorResponse(err);
  }
}
