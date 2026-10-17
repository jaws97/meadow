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
// Rehearsals in production (MEADOW_REHEARSAL=1) are limited to the hours before the game clock starts (h < 0, before
// 10 Nov 00:00 IST), whatever the variable says: a flag left on by mistake can then never mark a colleague's plant as a
// practice one, hide it from the Meadow or let clear-rehearsals delete it.
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

/** MEADOW_REHEARSAL=1 in production, and only before the game clock starts (see the header). */
function productionRehearsal(h: number): boolean {
  return process.env.MEADOW_REHEARSAL === "1" && h < 0;
}

/**
 * Whether a planting at game hour h, before the seeds are handed out, may go in as a rehearsal: outside production
 * always; in production only with MEADOW_REHEARSAL=1 and before the game clock starts.
 */
export function rehearsalAllowed(h: number): boolean {
  return !isProduction() || productionRehearsal(h);
}

/**
 * Whether rehearsal plants are visible here at hour nowH: always outside production; in production only while
 * rehearsing before the game clock starts, so practice plants never share the Meadow with real ones.
 */
export function showRehearsals(nowH: number): boolean {
  return !isProduction() || productionRehearsal(nowH);
}

/**
 * The party codes that open planting (MEADOW_PARTY_CODE, comma-separated so the committee can rotate without a gap:
 * add the new code, update the QR, then drop the old one). Empty when unset.
 */
export function partyCodes(): string[] {
  return (process.env.MEADOW_PARTY_CODE ?? "").split(",").map((c) => c.trim()).filter((c) => c.length > 0);
}
