// Which deployment this server is, and what that lets it write. The local dev server and Vercel Preview share the
// production database today (one Supabase project), so only the production deployment may write state that other
// deployments would then build on:
// - checkpoints (catch-ups computed by this build's lib/sim, which may differ from production's), and
// - the shared weather store (rows are written once and never changed, so a row normalised by another build's
//   lib/sim/weather.ts would stay forever).
// Elsewhere both are computed in memory for the response and dropped. Plantings made outside production are marked as
// rehearsals (plants.rehearsal): hidden from the production Meadow, kept on the outer plots and removed by
// scripts/clear-rehearsals.mjs. Care and sprinkles from outside production may only touch rehearsal plants.
//
// Every planting through production is real, whenever it happens: planting opened on 20 Oct for anyone with the party
// link, and those first gardens grow on through the party like any other (the MEADOW_REHEARSAL switch and the practice
// plantings of 20 Oct are gone; the variable is no longer read).
//
// The cure is a separate database for development and Preview (see the backend notes); these rules keep the shared one
// safe until then, and stay correct afterwards.
//
// Pure apart from reading process.env, so it is safe in tests (NODE_ENV=test reads as development).

export type Deployment = "production" | "preview" | "development";

let warnedNoVercelEnv = false;

/**
 * VERCEL_ENV on Vercel. On Vercel without it (system variables not exposed) this is never production, so a Preview
 * cannot save checkpoints or plant real plants; off Vercel (a local `next start`) NODE_ENV=production is production.
 */
export function deployment(): Deployment {
  const v = process.env.VERCEL_ENV;
  if (v === "production" || v === "preview" || v === "development") return v;
  if (process.env.VERCEL) {
    if (!warnedNoVercelEnv) {
      warnedNoVercelEnv = true;
      console.error("[meadow api] running on Vercel without VERCEL_ENV: treated as Preview. Expose the system environment variables.");
    }
    return "preview";
  }
  return process.env.NODE_ENV === "production" ? "production" : "development";
}

export function isProduction(): boolean {
  return deployment() === "production";
}

/** Whether this server saves checkpoints and writes the shared weather store (production only, see the header). */
export function writesDerivedState(): boolean {
  return isProduction();
}

/**
 * Whether practice (rehearsal) plants show here: on a dev server or a Preview, which plant only those; never in
 * production, so seeds from them never reach the live Meadow or the party screen.
 */
export function showRehearsals(): boolean {
  return !isProduction();
}

/**
 * The party codes (MEADOW_PARTY_CODE, comma-separated so the committee can rotate without a gap: add the new code,
 * update the QR, then drop the old one). Empty when unset. A seed planted with one skips the limits on strangers'
 * plantings (party.ts).
 */
export function partyCodes(): string[] {
  return (process.env.MEADOW_PARTY_CODE ?? "").split(",").map((c) => c.trim()).filter((c) => c.length > 0);
}

/**
 * Whether anyone may plant, party link or not: yes, unless MEADOW_PLANTING is "party", which asks for the party link
 * again, as before 21 Oct, should strangers ever need keeping out (set it on Vercel, then redeploy).
 */
export function plantingOpenToAll(): boolean {
  return (process.env.MEADOW_PLANTING ?? "").trim().toLowerCase() !== "party";
}
