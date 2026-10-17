// GET /api/meadow: the shared Meadow snapshot (lib/server/meadow.ts), the same for every viewer, so the CDN caches it
// for 5 s (short, so a sprout planted at the party reaches the big screen within seconds) and serves a stale copy while
// it refreshes. The ETag lets a client that polls send If-None-Match and get a
// bodiless 304 when nothing changed. Reading the request headers keeps this handler out of build-time prerendering;
// unstable_rethrow lets that signal through the catch instead of turning it into an error response.
import { createHash } from "node:crypto";
import { unstable_rethrow } from "next/navigation";
import type { NextRequest } from "next/server";
import { errorResponse } from "@/lib/server/http";
import { meadowSnapshot } from "@/lib/server/meadow";

const CACHE = "public, max-age=0, s-maxage=5, stale-while-revalidate=30";

function matches(ifNoneMatch: string | null, etag: string): boolean {
  if (!ifNoneMatch) return false;
  return ifNoneMatch.split(",").some((t) => {
    const tag = t.trim();
    return tag === "*" || tag === etag || tag === `W/${etag}`;
  });
}

export async function GET(request: NextRequest) {
  try {
    const ifNoneMatch = request.headers.get("if-none-match");
    const body = JSON.stringify(await meadowSnapshot());
    const etag = `"${createHash("sha256").update(body).digest("base64url").slice(0, 27)}"`;
    const headers = { ETag: etag, "Cache-Control": CACHE };
    if (matches(ifNoneMatch, etag)) return new Response(null, { status: 304, headers });
    return new Response(body, { status: 200, headers: { ...headers, "Content-Type": "application/json" } });
  } catch (err) {
    unstable_rethrow(err);
    return errorResponse(err);
  }
}
