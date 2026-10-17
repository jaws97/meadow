// Switches the app's own database connection to the least-privilege role meadow_app (created by migration 0003, NOLOGIN
// until this script enables it). postgres keeps running migrations and these scripts; the deployed app then connects as
// a role that can read and append but cannot delete, truncate, change the schema, disable row-level security or drop the
// write-once triggers.
//
//   node --env-file=.env.local scripts/app-role.mjs --status
//       whether meadow_app exists and can log in
//   node --env-file=.env.local scripts/app-role.mjs --enable
//       gives meadow_app LOGIN and a fresh random password, and writes its transaction-pooler URL to
//       .env.meadow-app.local (MEADOW_APP_POSTGRES_URL) and, as POSTGRES_URL, to .env.development.local (both
//       gitignored by .env*). Next.js reads .env.development.local before .env.local, so after a restart `next dev`
//       connects as meadow_app, while the scripts (--env-file=.env.local) keep the migration role. Add --no-dev to leave
//       .env.development.local alone. The password is sent to Postgres only as a SCRAM-SHA-256 verifier, so it never
//       appears in a statement or a server log, and this script never prints it.
//   node --env-file=.env.meadow-app.local scripts/app-role.mjs --test
//       connects with that URL through the pooler and checks it reads meadow and is refused a DELETE
//
// Then, in Vercel > meadow > Settings > Environment Variables, set POSTGRES_URL for Production and Preview to the value
// of MEADOW_APP_POSTGRES_URL (nothing deployed needs POSTGRES_URL_NON_POOLING, the migration role: remove it from both
// if the integration added it), redeploy, and delete .env.meadow-app.local. Running --enable again rotates the password
// (every deployment and the dev server keep working only after their POSTGRES_URL is updated with the new one).
import { createHash, createHmac, pbkdf2Sync, randomBytes } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import postgres from "postgres";
import { connect, connectionUrl, tlsOption } from "./db-connect.mjs";

const OUT_FILE = new URL("../.env.meadow-app.local", import.meta.url);
const DEV_FILE = new URL("../.env.development.local", import.meta.url);
const DEV_NOTE = "# meadow_app for next dev (scripts/app-role.mjs): no DELETE, TRUNCATE or DDL. Secret: never commit or share.";

/** Sets POSTGRES_URL in .env.development.local, keeping any other lines already there. */
function writeDevFile(url) {
  const kept = existsSync(DEV_FILE)
    ? readFileSync(DEV_FILE, "utf8").split(/\r?\n/).filter((l) => !l.startsWith("POSTGRES_URL=") && l !== DEV_NOTE)
    : [];
  while (kept.length > 0 && kept[kept.length - 1] === "") kept.pop();
  writeFileSync(DEV_FILE, [...kept, DEV_NOTE, `POSTGRES_URL=${url}`, ""].join("\n"), { encoding: "utf8", mode: 0o600 });
}

/** The SCRAM-SHA-256 verifier Postgres stores for a password (what psql's \password sends), RFC 5802 / 7677. */
function scramVerifier(password) {
  const salt = randomBytes(16), iterations = 4096;
  const salted = pbkdf2Sync(password.normalize("NFKC"), salt, iterations, 32, "sha256");
  const clientKey = createHmac("sha256", salted).update("Client Key").digest();
  const storedKey = createHash("sha256").update(clientKey).digest();
  const serverKey = createHmac("sha256", salted).update("Server Key").digest();
  return `SCRAM-SHA-256$${iterations}:${salt.toString("base64")}$${storedKey.toString("base64")}:${serverKey.toString("base64")}`;
}

async function status(sql) {
  const [r] = await sql`select rolname, rolcanlogin, rolbypassrls from pg_roles where rolname = 'meadow_app'`;
  console.log(r ? `meadow_app exists: login=${r.rolcanlogin} bypassrls=${r.rolbypassrls}` : "meadow_app does not exist yet: run scripts/migrate.mjs");
  return r;
}

async function enable() {
  const sql = connect("POSTGRES_URL_NON_POOLING");
  try {
    if (!(await status(sql))) return;
    const password = randomBytes(32).toString("base64url");
    const verifier = scramVerifier(password);
    // the verifier is base64 and "$:" only, so it is safe inside a quoted literal (ALTER ROLE takes no parameters)
    if (!/^[A-Za-z0-9+/=$:-]+$/.test(verifier)) throw new Error("unexpected verifier format");
    await sql.unsafe(`alter role meadow_app with login password '${verifier}'`);
    // Supavisor names a role on the pooler "<role>.<project ref>", exactly as the postgres user appears in POSTGRES_URL
    const pooled = connectionUrl("POSTGRES_URL");
    const user = decodeURIComponent(pooled.username);
    const ref = user.includes(".") ? user.slice(user.indexOf(".") + 1) : null;
    pooled.username = ref ? `meadow_app.${ref}` : "meadow_app";
    pooled.password = password;
    writeFileSync(OUT_FILE, [
      "# meadow_app through the transaction pooler, written by scripts/app-role.mjs. Secret: never commit or share.",
      "# Set POSTGRES_URL for Vercel's Production environment to this value, redeploy, then delete this file.",
      `MEADOW_APP_POSTGRES_URL=${pooled.toString()}`,
      "",
    ].join("\n"), { encoding: "utf8", mode: 0o600 });
    console.log("meadow_app can now log in. Its pooler URL is in .env.meadow-app.local (not printed). Next: --test, then Vercel.");
    if (!process.argv.includes("--no-dev")) {
      writeDevFile(pooled.toString());
      console.log("Restart next dev: it will connect as meadow_app (POSTGRES_URL in .env.development.local).");
    }
  } finally {
    await sql.end();
  }
}

async function test() {
  const url = connectionUrl("MEADOW_APP_POSTGRES_URL");
  const sql = postgres(url.toString(), { ssl: tlsOption(), prepare: false, max: 1, onnotice: () => {} });
  try {
    const [who] = await sql`select current_user as user, (select count(*)::int from meadow.plants) as plants`;
    console.log(`connected through the pooler as ${who.user}; it can read meadow.plants (${who.plants} rows)`);
    try {
      await sql`delete from meadow.people where false`;
      console.log("FAIL: meadow_app was allowed to DELETE");
      process.exitCode = 1;
    } catch (err) {
      console.log(err.code === "42501" ? "ok: DELETE is refused (42501)" : `unexpected: ${err.code} ${err.message}`);
    }
  } finally {
    await sql.end();
  }
}

async function main() {
  if (process.argv.includes("--enable")) return enable();
  if (process.argv.includes("--test")) return test();
  const sql = connect("POSTGRES_URL_NON_POOLING");
  try {
    await status(sql);
  } finally {
    await sql.end();
  }
}

main().catch((err) => {
  console.error(`app-role failed: ${err.message}`);
  process.exitCode = 1;
});
