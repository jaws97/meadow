// POST /api/sprinkle: one small sprinkle from the caller to a friend's plant. Body { plot, clientEventId }, where plot
// is the friend's plot from GET /api/meadow. One per person per IST day; the model counts the first two a plant gets
// each day (counts: false means it arrived as good wishes only).
import type { NextRequest } from "next/server";
import { sprinkle } from "@/lib/server/garden";
import { ApiError, errorResponse, json, readJsonBody } from "@/lib/server/http";
import { requirePersonId } from "@/lib/server/identity";
import { parseSprinkleBody } from "@/lib/server/validate";

export async function POST(request: NextRequest) {
  try {
    const parsed = parseSprinkleBody(await readJsonBody(request));
    if (!parsed.ok) throw ApiError.invalid(parsed);
    const giverId = await requirePersonId(request);
    return json(await sprinkle(giverId, parsed.value));
  } catch (err) {
    return errorResponse(err);
  }
}
