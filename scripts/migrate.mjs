// Applies pending SQL migrations from db/migrations to the database, in file-name order, each in its own transaction,
// and records them in meadow.schema_migrations (version, name, checksum). Uses the direct (session) connection,
// POSTGRES_URL_NON_POOLING, never the transaction pooler, and takes an advisory lock so two runs cannot overlap.
//
// Every migration's transaction also runs db/lockdown.sql after the migration's own SQL and before the ledger insert:
// it re-applies the lockdown (RLS on every table, nothing for PUBLIC or the Supabase API roles) and asserts it, so a
// migration that would expose anything fails and rolls back instead of being committed and reported afterwards. After
// applying, the full security verification (scripts/verify-db.mjs) runs as well and exits 1 on any FAIL.
//
//   node --env-file=.env.local scripts/migrate.mjs            apply pending migrations
//   node --env-file=.env.local scripts/migrate.mjs --status   list applied and pending, change nothing
//
// File names are <version>_<name>.sql, e.g. 0001_foundation.sql. An applied migration whose file has since changed is
// reported (checksum mismatch) and never re-run: write a new migration instead.
import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { connect } from "./db-connect.mjs";
import { verifySecurity } from "./verify-db.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const MIGRATIONS_DIR = path.join(ROOT, "db", "migrations");
const LOCKDOWN_FILE = path.join(ROOT, "db", "lockdown.sql");
const FILE_RE = /^(\d{4})_([a-z0-9_]+)\.sql$/;
// any constant works; it only has to be the same for every run of this script
const LOCK_KEY = 0x6d656164; // "mead"

async function loadMigrations() {
  const files = (await readdir(MIGRATIONS_DIR)).filter((f) => f.endsWith(".sql")).sort();
  const out = [];
  for (const file of files) {
    const m = FILE_RE.exec(file);
    if (!m) throw new Error(`migration file name must look like 0001_name.sql: ${file}`);
    // CRLF-insensitive, so a Windows checkout does not look like an edited migration
    const text = (await readFile(path.join(MIGRATIONS_DIR, file), "utf8")).replace(/\r\n/g, "\n");
    out.push({ version: m[1], name: m[2], file, text, checksum: createHash("sha256").update(text).digest("hex") });
  }
  const versions = new Set();
  for (const mig of out) {
    if (versions.has(mig.version)) throw new Error(`two migrations share version ${mig.version}`);
    versions.add(mig.version);
  }
  return out;
}

async function main() {
  const statusOnly = process.argv.includes("--status");
  const migrations = await loadMigrations();
  const lockdown = (await readFile(LOCKDOWN_FILE, "utf8")).replace(/\r\n/g, "\n");
  const sql = connect("POSTGRES_URL_NON_POOLING");
  try {
    await sql`select pg_advisory_lock(${LOCK_KEY})`;
    // bootstrap the ledger (0001 creates the same table; both are idempotent)
    await sql`create schema if not exists meadow`;
    await sql`
      create table if not exists meadow.schema_migrations (
        version text primary key, name text not null, checksum text not null,
        applied_at timestamptz not null default now())`;
    await sql`alter table meadow.schema_migrations enable row level security`;

    const applied = new Map((await sql`select version, name, checksum from meadow.schema_migrations`).map((r) => [r.version, r]));
    const pending = [];
    for (const mig of migrations) {
      const done = applied.get(mig.version);
      if (!done) pending.push(mig);
      else if (done.checksum !== mig.checksum) console.warn(`warning: ${mig.file} changed after it was applied (not re-run)`);
      else console.log(`applied  ${mig.file}`);
    }
    for (const mig of pending) console.log(`${statusOnly ? "pending " : "applying"} ${mig.file}`);
    if (statusOnly) return;

    for (const mig of pending) {
      await sql.begin(async (tx) => {
        await tx.unsafe(mig.text);
        // inside the same transaction: a failed assertion rolls this migration back
        await tx.unsafe(lockdown);
        await tx`insert into meadow.schema_migrations (version, name, checksum) values (${mig.version}, ${mig.name}, ${mig.checksum})`;
      });
      console.log(`done     ${mig.file}`);
    }
    if (pending.length === 0) console.log("nothing to apply");

    const { ok, report } = await verifySecurity(sql);
    console.log("\nsecurity verification:");
    for (const line of report) console.log(`  ${line}`);
    if (!ok) process.exitCode = 1;
  } finally {
    await sql`select pg_advisory_unlock(${LOCK_KEY})`.catch(() => {});
    await sql.end();
  }
}

main().catch((err) => {
  // postgres.js errors carry no credentials; print the message and the SQL position only
  console.error(`migrate failed: ${err.message}${err.position ? ` (at character ${err.position})` : ""}`);
  process.exitCode = 1;
});
