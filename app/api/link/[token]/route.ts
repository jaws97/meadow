// GET /api/link/[token]: the old path form of a personal garden link. It no longer signs anything in: a GET must have
// no side effects, because link-preview bots (Teams, Slack, Outlook Safe Links) fetch links shared in chats. It only
// redirects to /garden#k=<token>, where the garden page asks before switching gardens and exchanges the token with
// POST /api/session. New links are issued in the fragment form directly, so tokens stay out of request logs; this route
// remains for any link typed or saved in the old form. Never cached, and sent with no Referer.
import { NextResponse, type NextRequest } from "next/server";
import { NO_STORE } from "@/lib/server/http";
import { isTokenShape } from "@/lib/server/tokens";

export async function GET(request: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const target = new URL("/garden", request.url);
  if (isTokenShape(token)) target.hash = `k=${token}`;
  else target.searchParams.set("link", "invalid");
  const res = NextResponse.redirect(target, 303);
  res.headers.set("Cache-Control", NO_STORE);
  res.headers.set("Referrer-Policy", "no-referrer");
  return res;
}
