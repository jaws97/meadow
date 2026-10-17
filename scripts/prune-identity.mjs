// Removes device sessions and personal garden links that no longer open anything, once they are a month past it:
// revoked rows (retired by the active caps, a sign-out, a switch or a reset) 30 days after they were revoked, and rows
// past their server-side lifetime (lib/server/session-rules.ts SESSION_TTL_DAYS, LINK_TTL_DAYS) 30 days after they
// expired. The month keeps recent history for support questions ("which devices had my garden?"). Gardens, plants and
// people are never touched. Run it now and then (monthly is plenty); the app role cannot delete, so this runs as the
// migration role.
//
//   node --env-file=.env.local scripts/prune-identity.mjs          count what would go
//   node --env-file=.env.local scripts/prune-identity.mjs --yes    delete it
import { connect } from "./db-connect.mjs";
import { ensureTypeScript, importProject } from "./lib/load-sim.mjs";

ensureTypeScript();

const GRACE_DAYS = 30;

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
    const [counts] = await sql`
      select (select count(*)::int from meadow.sessions) as sessions,
             (select count(*)::int from meadow.sessions where ${sessionsGone()}) as sessions_old,
             (select count(*)::int from meadow.garden_links) as links,
             (select count(*)::int from meadow.garden_links where ${linksGone()}) as links_old`;
    console.log(`sessions: ${counts.sessions} rows, ${counts.sessions_old} revoked or expired more than ${GRACE_DAYS} days ago`);
    console.log(`garden links: ${counts.links} rows, ${counts.links_old} revoked or expired more than ${GRACE_DAYS} days ago`);
    if (!apply) {
      console.log("dry run: nothing deleted (add --yes to delete)");
      return;
    }
    const result = await sql.begin(async (tx) => ({
      sessions: (await tx`delete from meadow.sessions where ${sessionsGone()} returning 1`).length,
      links: (await tx`delete from meadow.garden_links where ${linksGone()} returning 1`).length,
    }));
    console.log(`deleted ${result.sessions} sessions and ${result.links} garden links`);
  } finally {
    await sql.end();
  }
}

main().catch((err) => {
  console.error(`prune-identity failed: ${err.message}`);
  process.exitCode = 1;
});
