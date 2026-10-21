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

/** Google sign-in's settings: the web client from Google Cloud, and the key that scrambles each account's number. */
export interface GoogleSignIn {
  clientId: string;
  clientSecret: string;
  key: string;
}

/**
 * A development server's own key: its practice sign-ins never match a real one (the database is shared, env.ts header).
 * Public, so it scrambles nothing that matters.
 */
const DEV_LOGIN_KEY = "meadow-development-sign-in-key-not-for-production";
/** A production key shorter than this (MEADOW_LOGIN_KEY) is a mistake, not a key. */
const LOGIN_KEY_MIN = 32;
let warnedLoginKey = false;

let warnedNetworkKey = false;

/**
 * The key network addresses are scrambled with for the per-network limits (lib/server/network.ts): MEADOW_LOGIN_KEY,
 * so nothing more needs setting on Vercel (network.ts derives a key of its own from it, so the two uses never meet). A
 * development server or a Preview without it uses the public development key; production without it (or with one too
 * short) keeps no network marks and so has no per-network limits, which is logged once.
 */
export function networkKey(): string | null {
  const key = (process.env.MEADOW_LOGIN_KEY ?? "").trim();
  if (deployment() !== "production") return key || DEV_LOGIN_KEY;
  if (key.length >= LOGIN_KEY_MIN) return key;
  if (!warnedNetworkKey) {
    warnedNetworkKey = true;
    console.error(`[meadow api] the per-network limits are off: MEADOW_LOGIN_KEY must be set (${LOGIN_KEY_MIN} characters or more)`);
  }
  return null;
}

/**
 * Whether planting and name checks ask Vercel BotID that the request comes from a real browser (lib/server/bot.ts):
 * yes, unless MEADOW_BOT_CHECK is "off", the switch should it ever turn real people away (set it on Vercel, then
 * redeploy).
 */
export function botCheckOn(): boolean {
  return (process.env.MEADOW_BOT_CHECK ?? "").trim().toLowerCase() !== "off";
}

/**
 * Google sign-in (lib/server/google.ts), on when GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET hold the web client made in
 * Google Cloud and, in production, MEADOW_LOGIN_KEY holds the key each account's Google number is scrambled with before
 * it is stored (login-rules.ts subjectHash; a development server uses a key of its own). Off on a Preview, whose
 * changing address Google would not send anyone back to. While it is off, anyone may plant as before, without signing in.
 */
export function googleSignIn(): GoogleSignIn | null {
  const clientId = (process.env.GOOGLE_CLIENT_ID ?? "").trim();
  const clientSecret = (process.env.GOOGLE_CLIENT_SECRET ?? "").trim();
  if (!clientId || !clientSecret) return null;
  const where = deployment();
  if (where === "preview") return null;
  const key = (process.env.MEADOW_LOGIN_KEY ?? "").trim();
  if (where !== "production") return { clientId, clientSecret, key: key || DEV_LOGIN_KEY };
  if (key.length < LOGIN_KEY_MIN) {
    if (!warnedLoginKey) {
      warnedLoginKey = true;
      console.error(`[meadow api] Google sign-in is off: MEADOW_LOGIN_KEY must be set (${LOGIN_KEY_MIN} characters or more) beside the Google client`);
    }
    return null;
  }
  return { clientId, clientSecret, key };
}
