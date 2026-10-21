// GET /api/session: which gardens this device holds, for the UI (the cookies are httpOnly, so script cannot tell):
// { signedIn, person: { firstName, plot } | null, previous: { firstName, plot } | null, plantingOpen, login }, where
// previous is the garden "switch back" (POST /api/session/back) would return to, plantingOpen says whether anyone may
// plant without the party link (false only under MEADOW_PLANTING=party), so the door can show the rose instead of a
// seed that could not go in, and login is Google sign-in's word (lib/server/login.ts loginStatus: whether it is offered
// here, whether this garden is kept on an account, and whether an account is signed in on this device for the seed
// planted next).
//
// POST /api/session: opens a personal garden link on this device. The garden page reads the token from its URL
// fragment (/garden#k=<token>, never sent to any server or log), removes it from the address bar, and posts
// { token, confirmSwitch? }. Answers:
//   200 { status: "signed_in", person }                     an empty device is now showing that garden
//   200 { status: "already_here", person }                  this device already shows it
//   409 { error: "switch_needed", current, target, message }  another garden is here: ask, then post again with
//                                                            confirmSwitch: true
//   200 { status: "switched", person, canSwitchBack: true }  switched; the previous garden is kept for "switch back"
//   404 { error: "link_invalid" }                           unknown or revoked link
// Personal, so never cached. GET reads the cookies, which stops build-time prerendering; unstable_rethrow lets that
// signal through the catch instead of turning it into an error response.
import { unstable_rethrow } from "next/navigation";
import { NextResponse, type NextRequest } from "next/server";
import { plantingOpenToAll } from "@/lib/server/env";
import { ApiError, NO_STORE, errorResponse, json, readJsonBody } from "@/lib/server/http";
import { openGardenLink, sessionStatus } from "@/lib/server/identity";
import { loginStatus } from "@/lib/server/login";
import { LOGIN_COOKIE } from "@/lib/server/login-rules";
import { PREV_SESSION_COOKIE, SESSION_COOKIE, prevSessionCookie, sessionCookie } from "@/lib/server/session-rules";
import { parseLinkOpenBody } from "@/lib/server/validate";

export async function GET(request: NextRequest) {
  try {
    const status = await sessionStatus(request.cookies.get(SESSION_COOKIE)?.value, request.cookies.get(PREV_SESSION_COOKIE)?.value);
    const login = await loginStatus(status.personId, request.cookies.get(LOGIN_COOKIE)?.value);
    return json({ signedIn: status.person !== null, person: status.person, previous: status.previous, plantingOpen: plantingOpenToAll(), login });
  } catch (err) {
    unstable_rethrow(err);
    return errorResponse(err);
  }
}

export async function POST(request: NextRequest) {
  try {
    const parsed = parseLinkOpenBody(await readJsonBody(request));
    if (!parsed.ok) throw ApiError.invalid(parsed);
    const result = await openGardenLink(
      parsed.value.token,
      request.cookies.get(SESSION_COOKIE)?.value,
      request.cookies.get(PREV_SESSION_COOKIE)?.value,
      parsed.value.confirmSwitch,
    );
    switch (result.kind) {
      case "invalid":
        throw new ApiError(404, "link_invalid",
          "That garden link no longer opens a garden; it may have been replaced by a newer one. If it is yours, make a fresh link from a device where your garden is open.");
      case "already_here":
        return json({ status: "already_here", person: result.person });
      case "switch_needed": {
        const { current, target } = result;
        return json({
          error: "switch_needed",
          message: `This device is showing ${current.firstName}'s garden. Open ${target.firstName}'s garden here instead? You can switch back afterwards.`,
          current,
          target,
        }, { status: 409 });
      }
      case "signed_in": {
        const res = NextResponse.json(
          { status: result.switched ? "switched" : "signed_in", person: result.person, canSwitchBack: result.switched },
          { headers: { "Cache-Control": NO_STORE } },
        );
        res.cookies.set(sessionCookie(result.sessionToken));
        if (result.previousToken) res.cookies.set(prevSessionCookie(result.previousToken));
        return res;
      }
    }
  } catch (err) {
    return errorResponse(err);
  }
}
