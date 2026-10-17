// The one Postgres client, server-only. Created lazily on first use, so importing this module never needs the
// connection string: a build without database variables still compiles, and only a request that really needs the
// database fails (with a calm 503, see DbUnavailableError in http.ts).
//
// It connects through Supabase's transaction pooler (POSTGRES_URL, port 6543), which shares a few backend connections
// among every function instance; prepared statements do not survive a transaction pooler, hence prepare: false. Only
// transaction-scoped features are used (sql.begin, pg_advisory_xact_lock, set_config(..., true)), never session state.
// The URL's query parameters are dropped because postgres.js would forward unknown ones (Supavisor's "supa") as server
// settings. Never log the URL.
//
// TLS is verified: the server's chain must lead to Supabase's root CA (supabase-ca.ts, or POSTGRES_CA_CERT) and its
// certificate must name the host, so a network attacker cannot pose as the database. postgres.js's ssl: "require"
// would encrypt without checking either. POSTGRES_TLS=require is the escape hatch if Supabase ever changes CA before
// this file is updated (encrypted, unverified, as before); POSTGRES_TLS=disable is for a local Postgres only.
//
// transaction() is how every locking transaction starts: it caps how long the transaction may wait for a lock, run a
// statement or sit idle, so one stalled request cannot hold up every planting at the party for the server's two-minute
// default; http.ts turns those timeouts into a calm 503 "please try again".
import "server-only";
import postgres from "postgres";
import { DbUnavailableError } from "./http";
import { SUPABASE_ROOT_CA } from "./supabase-ca";

export type Sql = postgres.Sql;
export type Tx = postgres.TransactionSql;
/** Either the client or a transaction: what the query helpers accept. */
export type Queryable = postgres.ISql;

const globalForDb = globalThis as typeof globalThis & { __meadowSql?: Sql };

/** True when a connection string is configured (the client itself is still only created on first use). */
export function hasDatabase(): boolean {
  return Boolean(process.env.POSTGRES_URL);
}

function tlsOption(): "require" | false | { ca: string; rejectUnauthorized: true } {
  const mode = process.env.POSTGRES_TLS ?? "verify";
  if (mode === "disable") return false;
  if (mode === "require") return "require";
  // an env var holding a PEM often arrives with its newlines escaped
  const ca = process.env.POSTGRES_CA_CERT ? process.env.POSTGRES_CA_CERT.replace(/\\n/g, "\n") : SUPABASE_ROOT_CA;
  return { ca, rejectUnauthorized: true };
}

/** The shared client. Throws DbUnavailableError when POSTGRES_URL is missing. */
export function db(): Sql {
  // kept on globalThis so development hot reloads reuse one pool instead of leaking connections
  if (globalForDb.__meadowSql) return globalForDb.__meadowSql;
  const raw = process.env.POSTGRES_URL;
  if (!raw) throw new DbUnavailableError();
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new DbUnavailableError();
  }
  url.search = "";
  const client = postgres(url.toString(), {
    ssl: tlsOption(),
    prepare: false,
    max: 4,
    idle_timeout: 20,
    connect_timeout: 10,
    onnotice: () => {},
    connection: { application_name: "meadow" },
  });
  globalForDb.__meadowSql = client;
  return client;
}

/** Limits for one locking transaction; a holder that stalls frees everyone else within seconds. */
export const TX_LIMITS = Object.freeze({ lockTimeout: "5s", statementTimeout: "10s", idleTimeout: "15s" });

/**
 * Runs fn in a transaction that gives up on a lock after 5 s, on a statement after 10 s and on an idle transaction
 * after 15 s (Postgres errors 55P03, 57014 and 25P03, answered as 503 "busy" by http.ts). set_config(..., true) is
 * transaction-local, so the pooler's shared connections are left as they were.
 */
export async function transaction<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
  const result = await db().begin(async (tx) => {
    await tx`
      select set_config('lock_timeout', ${TX_LIMITS.lockTimeout}, true),
             set_config('statement_timeout', ${TX_LIMITS.statementTimeout}, true),
             set_config('idle_in_transaction_session_timeout', ${TX_LIMITS.idleTimeout}, true)`;
    return fn(tx);
  });
  // postgres.js types begin() as UnwrapPromiseArray<T>, which is T for the non-array values every caller returns
  return result as unknown as T;
}
