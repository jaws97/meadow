// The party code: planting a seed needs the code printed in the party's QR link (/garden?code=XXXX), so random traffic
// from the internet cannot use up the planting throttle or fill the big screen with names before colleagues arrive.
// The committee sets MEADOW_PARTY_CODE on Vercel (env.ts partyCodes) and can rotate it; colleagues who miss the party
// get the same link from a colleague or the team chat.
//
// It is a gate, not a password: the link is shared by design. It only has to be unguessable (8 or more random
// characters, see the backend notes for a one-line generator). Pure, so the tests run without a server.
import { createHash, timingSafeEqual } from "node:crypto";
import { ApiError } from "./http";

export type PartyCodeCheck = "ok" | "missing" | "wrong" | "not_configured";

const digest = (s: string) => createHash("sha256").update(s, "utf8").digest();

/**
 * Whether a planting request's code opens planting. With no code configured, planting is open outside production (the
 * dev server and Preview) and closed in production (a forgotten variable must not leave the live site open).
 * Compared through SHA-256 digests with timingSafeEqual, so the time taken says nothing about the code.
 */
export function checkPartyCode(given: string | null, configured: readonly string[], production: boolean): PartyCodeCheck {
  if (configured.length === 0) return production ? "not_configured" : "ok";
  if (given === null || given === "") return "missing";
  const g = digest(given);
  let match = false;
  for (const code of configured) match = timingSafeEqual(g, digest(code)) || match;
  return match ? "ok" : "wrong";
}

/** Throws the calm answer for a code that does not open planting. */
export function requirePartyCode(given: string | null, configured: readonly string[], production: boolean): void {
  const result = checkPartyCode(given, configured, production);
  if (result === "ok") return;
  if (result === "not_configured") {
    console.error("[meadow api] MEADOW_PARTY_CODE is not set on this production deployment: planting is closed until it is");
    throw new ApiError(503, "planting_not_ready", "Seed planting is still being set up. Please try again in a few minutes.", { retryAfterS: 60 });
  }
  if (result === "missing") {
    throw new ApiError(403, "party_code_required",
      "Seeds are handed out with the party link. Scan the QR code at the party, or ask a colleague to share the link.");
  }
  throw new ApiError(403, "party_code_wrong",
    "That party link looks out of date. Scan the QR code again, or ask a colleague for the latest link.");
}
