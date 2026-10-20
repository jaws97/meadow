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
// Rehearsals in production: every planting before the game clock starts (h < 0, before 10 Nov 00:00 IST) is a practice
// one, so colleagues can test the live site with the party link until then (until 20 Oct this also needed
// MEADOW_REHEARSAL=1; the variable is no longer read). Those are marked plants.live_practice as well, and they are the
// only practice plants the production Meadow shows (until the game clock starts), so seeds from a dev server or a
// Preview never reach the live Meadow or the party screen. The game clock is the only bound: a practice plant can never
// be planted on or after 10 Nov, so nothing can mark a colleague's plant as a practice one, hide it from the Meadow or
// let clear-rehearsals delete it. On 10 Nov practice plants leave the Meadow and planting waits for 15:00.
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

/** Production rehearses only before the game clock starts (see the header). */
function productionRehearsal(h: number): boolean {
  return h < 0;
}

/**
 * Whether a planting at game hour h, before the seeds are handed out, may go in as a rehearsal: outside production
 * always; in production only before the game clock starts.
 */
export function rehearsalAllowed(h: number): boolean {
  return !isProduction() || productionRehearsal(h);
}

/**
 * Whether a practice (rehearsal) plant is visible here at hour nowH: every one outside production; in production only
 * the ones planted through production itself (plants.live_practice), and only before the game clock starts, so seeds
 * from a dev server or a Preview never reach the live Meadow and practice plants never share it with real ones.
 */
export function practiceVisible(livePractice: boolean, nowH: number): boolean {
  return !isProduction() || (livePractice && productionRehearsal(nowH));
}

/**
 * The party codes that open planting (MEADOW_PARTY_CODE, comma-separated so the committee can rotate without a gap:
 * add the new code, update the QR, then drop the old one). Empty when unset.
 */
export function partyCodes(): string[] {
  return (process.env.MEADOW_PARTY_CODE ?? "").split(",").map((c) => c.trim()).filter((c) => c.length > 0);
}
