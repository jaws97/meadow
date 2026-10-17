// POST /api/link: a fresh personal garden link for the caller (for someone who lost the one from planting and wants to
// open their garden on another device): { link } in the form /garden#k=<token>. Private: it opens the garden for whoever
// holds it, so share /meadow?plot=N to show a flower instead. The newest five links keep working; making a sixth retires
// the oldest, and POST /api/session/reset revokes them all. Ten new links an hour at most (429 too_many_links).
// Body: {} as JSON, like every other change: the JSON content type keeps cross-site forms out (a cross-origin fetch
// would need a CORS preflight this API never answers), so CSRF protection does not rest on SameSite alone.
import { NextResponse, type NextRequest } from "next/server";
import { newGardenLink } from "@/lib/server/garden";
import { NO_STORE, errorResponse, readJsonBody } from "@/lib/server/http";
import { gardenLinkUrl, requirePersonId } from "@/lib/server/identity";

export async function POST(request: NextRequest) {
  try {
    await readJsonBody(request);
    const personId = await requirePersonId(request);
    const token = await newGardenLink(personId);
    return NextResponse.json({ link: gardenLinkUrl(request.nextUrl.origin, token) }, { headers: { "Cache-Control": NO_STORE } });
  } catch (err) {
    return errorResponse(err);
  }
}
