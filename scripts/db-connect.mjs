// Shared by the database scripts (migrate, verify-db, smoke-api cleanup, maintenance): opens a postgres.js client from
// an environment variable without ever printing it. Run the scripts with the secrets loaded from the gitignored file,
// e.g. `node --env-file=.env.local scripts/migrate.mjs`.
//
// The Vercel/Supabase connection strings carry query parameters (sslmode, and Supavisor's own "supa" marker) that
// postgres.js would forward to the server as startup settings, so they are dropped here and TLS is configured directly:
// the server's certificate chain and host name are verified against Supabase's root CA (db/supabase-root-2021-ca.crt,
// the same certificate lib/server/db.ts pins), or against POSTGRES_CA_CERT when that is set. POSTGRES_TLS=require falls
// back to encryption without verification, and POSTGRES_TLS=disable to none (a local Postgres), as in lib/server/db.ts.
import { readFileSync } from "node:fs";
import postgres from "postgres";

const CA_FILE = new URL("../db/supabase-root-2021-ca.crt", import.meta.url);

/** The postgres.js ssl option for the current environment. */
export function tlsOption() {
  const mode = process.env.POSTGRES_TLS ?? "verify";
  if (mode === "disable") return false;
  if (mode === "require") return "require";
  const ca = process.env.POSTGRES_CA_CERT ? process.env.POSTGRES_CA_CERT.replace(/\\n/g, "\n") : readFileSync(CA_FILE, "utf8");
  return { ca, rejectUnauthorized: true };
}

/** The connection string in process.env[envName] without its query parameters; throws naming the variable, never its value. */
export function connectionUrl(envName) {
  const raw = process.env[envName];
  if (!raw) {
    throw new Error(`${envName} is not set. Run with: node --env-file=.env.local <script>`);
  }
  let url;
  try {
    url = new URL(raw);
  } catch {
    throw new Error(`${envName} is not a valid connection URL`);
  }
  url.search = "";
  return url;
}

/**
 * A postgres.js client for the connection string in process.env[envName]. Throws a readable error (naming the variable,
 * never its value) when it is missing or malformed.
 */
export function connect(envName = "POSTGRES_URL_NON_POOLING", options = {}) {
  return postgres(connectionUrl(envName).toString(), {
    ssl: tlsOption(),
    max: 1,
    onnotice: () => {},
    connection: { application_name: "meadow-scripts" },
    ...options,
  });
}
