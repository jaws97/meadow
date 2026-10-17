// GET /api/me: the caller's plant, caught up to the last completed hour (see MeView in lib/server/garden.ts): the
// state summary, the renderer's Visual, the bloom forecast, what care is available now, and this hour's pending actions.
// Personal, so never cached. Reading the cookie stops build-time prerendering; unstable_rethrow lets that signal (and
// any other Next.js control error) through the catch instead of turning it into an error response.
import { unstable_rethrow } from "next/navigation";
import type { NextRequest } from "next/server";
import { getMe } from "@/lib/server/garden";
import { errorResponse, json } from "@/lib/server/http";
import { requirePersonId } from "@/lib/server/identity";

export async function GET(request: NextRequest) {
  try {
    const personId = await requirePersonId(request);
    return json(await getMe(personId));
  } catch (err) {
    unstable_rethrow(err);
    return errorResponse(err);
  }
}
