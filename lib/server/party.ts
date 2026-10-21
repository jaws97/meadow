// The party code: the code printed in the party's QR link (/garden?code=XXXX). Since 21 Oct anyone may plant without
// it, so the code no longer opens planting: a seed planted with it is the party's, and skips the limits that keep a
// flood of strangers (or a runaway script) from crowding the Meadow and the big screen (rules.ts openPlantingWait), so
// the party afternoon can never be held up by anyone outside it. A code that is there must still be the party's: an
// old or mistyped party link gets the same calm answer as before, rather than quietly planting as a stranger's seed and
// running into those limits halfway through the party. The committee sets MEADOW_PARTY_CODE on Vercel (env.ts
// partyCodes) and can rotate it. MEADOW_PLANTING=party (env.ts plantingOpenToAll) brings back the old rule, the party
// link or no seed, should strangers ever need keeping out.
//
// It is a gate, not a password: the link is shared by design. It only has to be unguessable (8 or more random
// characters, see the backend notes for a one-line generator). Pure, so the tests run without a server.
import { createHash, timingSafeEqual } from "node:crypto";
import { ApiError } from "./http";

export type PartyCodeCheck = "ok" | "missing" | "wrong" | "not_configured";

/** Whose planting this is: the party's (it came with the code) or anyone's (open planting, within the limits). */
export type PlantingPass = "party" | "open";

const digest = (s: string) => createHash("sha256").update(s, "utf8").digest();

/**
 * Whether a request's code is the party's. With no code configured, every request is the party's outside production
 * (the dev server and Preview) and none is in production. Compared through SHA-256 digests with timingSafeEqual, so the
 * time taken says nothing about the code.
 */
export function checkPartyCode(given: string | null, configured: readonly string[], production: boolean): PartyCodeCheck {
  if (configured.length === 0) return production ? "not_configured" : "ok";
  if (given === null || given === "") return "missing";
  const g = digest(given);
  let match = false;
  for (const code of configured) match = timingSafeEqual(g, digest(code)) || match;
  return match ? "ok" : "wrong";
}

/**
 * Whose planting (or name check) this is: the party's with its code, else, with no code at all, anyone's while planting
 * is open to all. A code that is not the party's, and under MEADOW_PLANTING=party a missing one, is turned away with the
 * calm answer that says how to get the link; a code that production cannot check (MEADOW_PARTY_CODE unset), with the
 * answer that planting is still being set up.
 */
export function plantingPass(given: string | null, configured: readonly string[], production: boolean, openToAll: boolean): PlantingPass {
  const result = checkPartyCode(given, configured, production);
  if (result === "ok") return "party";
  if (openToAll && (given === null || given === "")) return "open";
  if (result === "not_configured") {
    console.error("[meadow api] MEADOW_PARTY_CODE is not set on this production deployment: planting with the party link is closed until it is");
    throw new ApiError(503, "planting_not_ready", "Seed planting is still being set up. Please try again in a few minutes.", { retryAfterS: 60 });
  }
  if (result === "missing") {
    throw new ApiError(403, "party_code_required",
      "Seeds are handed out with the party link. Scan the QR code at the party, or ask a colleague to share the link.");
  }
  throw new ApiError(403, "party_code_wrong",
    "That party link looks out of date. Scan the QR code again, or ask a colleague for the latest link.");
}
