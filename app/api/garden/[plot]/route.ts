// GET /api/garden/[plot]: a friend's plant, read-only (gardenOfPlot in lib/server/meadow.ts): the name on their sign,
// the species, the seed and the renderer's Visual, caught up to the last completed hour, plus the day count and the
// Meadow's coarse bands. It is what "See their garden" draws and what the Meadow's visit card says; it carries nothing
// private, so it is the same for every viewer and the CDN may cache it briefly. The ETag lets a client send
// If-None-Match and get a bodiless 304 when nothing changed. An empty plot (or a practice plant this deployment hides)
// is 404 plot_empty; a plot number outside the Meadow is 404 plot_unknown. Reading the request headers keeps this handler
// out of build-time prerendering; unstable_rethrow lets that signal through the catch instead of turning it into an
// error response.
import { createHash } from "node:crypto";
import { unstable_rethrow } from "next/navigation";
import type { NextRequest } from "next/server";
import { ApiError, errorResponse } from "@/lib/server/http";
import { gardenOfPlot } from "@/lib/server/meadow";
import { PLOT_LIMIT } from "@/lib/server/plots";

// The plant changes once an hour, and its flower opens and closes with the clock, so a minute is fresh enough.
const CACHE = "public, max-age=0, s-maxage=60, stale-while-revalidate=300";

function matches(ifNoneMatch: string | null, etag: string): boolean {
  if (!ifNoneMatch) return false;
  return ifNoneMatch.split(",").some((t) => {
    const tag = t.trim();
    return tag === "*" || tag === etag || tag === `W/${etag}`;
  });
}

function parsePlot(raw: string): number {
  const plot = /^\d{1,5}$/.test(raw) ? Number(raw) : NaN;
  if (!Number.isInteger(plot) || plot < 0 || plot >= PLOT_LIMIT) {
    throw new ApiError(404, "plot_unknown", "That plot is not in the Meadow.");
  }
  return plot;
}

export async function GET(request: NextRequest, ctx: { params: Promise<{ plot: string }> }) {
  try {
    const ifNoneMatch = request.headers.get("if-none-match");
    const { plot: raw } = await ctx.params;
    const body = JSON.stringify(await gardenOfPlot(parsePlot(raw)));
    const etag = `"${createHash("sha256").update(body).digest("base64url").slice(0, 27)}"`;
    const headers = { ETag: etag, "Cache-Control": CACHE };
    if (matches(ifNoneMatch, etag)) return new Response(null, { status: 304, headers });
    return new Response(body, { status: 200, headers: { ...headers, "Content-Type": "application/json" } });
  } catch (err) {
    unstable_rethrow(err);
    return errorResponse(err);
  }
}
