// Removes device sessions and personal garden links that no longer open anything, once they are a month past it:
// revoked rows (retired by the active caps, a sign-out, a switch or a reset) 30 days after they were revoked, and rows
// past their server-side lifetime (lib/server/session-rules.ts SESSION_TTL_DAYS, LINK_TTL_DAYS) 30 days after they
// expired. Google sign-ins held for a planting (meadow.login_starts, an hour each) go a month after they were made.
// The month keeps recent history for support questions ("which devices had my garden?"). The scrambled network marks
// behind the per-network limits (meadow.network_marks, lib/server/network.ts) go once they are two days old: the
// limits look back a day at most. Gardens, plants, people and the gardens kept on Google accounts (meadow.logins, let
// go of or not) are never touched. Run it now and then (monthly is plenty; weekly keeps the network marks small); the
// app role cannot delete, so this runs as the migration role.
//
//   node --env-file=.env.local scripts/prune-identity.mjs          count what would go
//   node --env-file=.env.local scripts/prune-identity.mjs --yes    delete it
import { connect } from "./db-connect.mjs";
import { ensureTypeScript, importProject } from "./lib/load-sim.mjs";

ensureTypeScript();

const GRACE_DAYS = 30;
/** Network marks older than this are of no use to any limit (network.ts looks back a day). */
const MARK_DAYS = 2;

async function main() {
  const { SESSION_TTL_DAYS, LINK_TTL_DAYS } = await importProject("lib/server/session-rules.ts");
  const apply = process.argv.includes("--yes");
  const sql = connect("POSTGRES_URL_NON_POOLING");
  try {
    // functions, so every query gets a fragment of its own
    const sessionsGone = () => sql`
      (revoked_at is not null and revoked_at < now() - make_interval(days => ${GRACE_DAYS}::int))
      or created_at < now() - make_interval(days => ${SESSION_TTL_DAYS + GRACE_DAYS}::int)`;
    const linksGone = () => sql`
      (revoked_at is not null and revoked_at < now() - make_interval(days => ${GRACE_DAYS}::int))
      or created_at < now() - make_interval(days => ${LINK_TTL_DAYS + GRACE_DAYS}::int)`;
    const startsGone = () => sql`created_at < now() - make_interval(days => ${GRACE_DAYS}::int)`;
    const marksGone = () => sql`created_at < now() - make_interval(days => ${MARK_DAYS}::int)`;
    const [counts] = await sql`
      select (select count(*)::int from meadow.sessions) as sessions,
             (select count(*)::int from meadow.sessions where ${sessionsGone()}) as sessions_old,
             (select count(*)::int from meadow.garden_links) as links,
             (select count(*)::int from meadow.garden_links where ${linksGone()}) as links_old,
             (select count(*)::int from meadow.login_starts) as starts,
             (select count(*)::int from meadow.login_starts where ${startsGone()}) as starts_old,
             (select count(*)::int from meadow.network_marks) as marks,
             (select count(*)::int from meadow.network_marks where ${marksGone()}) as marks_old`;
    console.log(`sessions: ${counts.sessions} rows, ${counts.sessions_old} revoked or expired more than ${GRACE_DAYS} days ago`);
    console.log(`garden links: ${counts.links} rows, ${counts.links_old} revoked or expired more than ${GRACE_DAYS} days ago`);
    console.log(`Google sign-ins held for a planting: ${counts.starts} rows, ${counts.starts_old} made more than ${GRACE_DAYS} days ago`);
    console.log(`network marks: ${counts.marks} rows, ${counts.marks_old} made more than ${MARK_DAYS} days ago`);
    if (!apply) {
      console.log("dry run: nothing deleted (add --yes to delete)");
      return;
    }
    const result = await sql.begin(async (tx) => ({
      sessions: (await tx`delete from meadow.sessions where ${sessionsGone()} returning 1`).length,
      links: (await tx`delete from meadow.garden_links where ${linksGone()} returning 1`).length,
      starts: (await tx`delete from meadow.login_starts where ${startsGone()} returning 1`).length,
      marks: (await tx`delete from meadow.network_marks where ${marksGone()} returning 1`).length,
    }));
    console.log(`deleted ${result.sessions} sessions, ${result.links} garden links, ${result.starts} sign-ins held for a planting and ${result.marks} network marks`);
  } finally {
    await sql.end();
  }
}

main().catch((err) => {
  console.error(`prune-identity failed: ${err.message}`);
  process.exitCode = 1;
});
