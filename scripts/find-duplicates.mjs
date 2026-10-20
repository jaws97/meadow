// Finds people who may have planted twice: identity is one cookie per browser, so a second device, an in-app browser
// (Teams, WhatsApp, Instagram) or cleared cookies can plant a second garden for the same colleague. Names are unique
// in the Meadow (migration 0007), so a second garden carries a variant ("Asha" and "Asha K"): this groups people by the
// first word of their name (ignoring case; names are stored trimmed, with single spaces) and shows, for each garden,
// its sign name, its plot, when it was planted, how much it was
// cared for, sprinkles given, and when a device last opened it, so the committee can see which one is in use. Removing
// a garden is explicit, by plot, and only with --yes; it deletes the person with their garden, plant, events,
// checkpoint, sessions and links. Sprinkles they gave stay in their friends' event logs, so no other plant changes.
//
//   node --env-file=.env.local scripts/find-duplicates.mjs                              list possible duplicates
//   node --env-file=.env.local scripts/find-duplicates.mjs --remove 361,402             show what would be removed
//   node --env-file=.env.local scripts/find-duplicates.mjs --remove 361,402 --yes       remove those gardens
import { connect } from "./db-connect.mjs";

function arg(name) {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main() {
  const sql = connect("POSTGRES_URL_NON_POOLING");
  try {
    const rows = await sql`
      with people as (
        select pe.id, pe.first_name, lower(split_part(pe.first_name, ' ', 1)) as key, pe.created_at,
               p.id as plant_id, p.plot_index, p.species, p.rehearsal
        from meadow.people pe
        join meadow.gardens g on g.person_id = pe.id
        join meadow.plants p on p.garden_id = g.id and p.garden_slot = 0
      )
      select pp.*, count(*) over (partition by pp.key) as same_name,
             (select count(*)::int from meadow.plant_events e where e.plant_id = pp.plant_id) as events,
             (select count(*)::int from meadow.sprinkles s where s.giver_id = pp.id) as sprinkles_given,
             (select max(s.last_seen_at) from meadow.sessions s where s.person_id = pp.id) as last_seen
      from people pp
      order by pp.key, pp.created_at`;
    const groups = rows.filter((r) => Number(r.same_name) > 1);
    console.log(`people: ${rows.length}, sharing the first word of their name with someone: ${groups.length}`);
    let key = null;
    for (const r of groups) {
      if (r.key !== key) {
        key = r.key;
        console.log(`\n${r.key}`);
      }
      console.log(`  plot ${String(r.plot_index).padStart(4)}  "${r.first_name}"  ${r.species.padEnd(8)}  planted ${r.created_at.toISOString()}  `
        + `events ${r.events}  sprinkles given ${r.sprinkles_given}  last seen ${r.last_seen ? r.last_seen.toISOString() : "never"}`
        + `${r.rehearsal ? "  (rehearsal)" : ""}`);
    }
    if (groups.length > 0) console.log("\nA shared first word is not proof of a duplicate: check with the person before removing a garden.");

    const remove = arg("--remove");
    if (remove === undefined) return;
    const plots = remove.split(",").map((s) => Number(s.trim()));
    if (plots.some((p) => !Number.isInteger(p) || p < 0)) throw new Error("--remove takes plot numbers, e.g. --remove 361,402");
    const doomed = rows.filter((r) => plots.includes(r.plot_index));
    for (const r of doomed) console.log(`${process.argv.includes("--yes") ? "removing" : "would remove"} plot ${r.plot_index} "${r.first_name}" (${r.events} events)`);
    const missing = plots.filter((p) => !doomed.some((r) => r.plot_index === p));
    if (missing.length) console.log(`no garden on plot(s): ${missing.join(", ")}`);
    if (!process.argv.includes("--yes")) {
      console.log("dry run: nothing removed (add --yes)");
      return;
    }
    const gone = await sql`delete from meadow.people where id = any(${doomed.map((r) => r.id)}::uuid[]) returning id`;
    console.log(`removed ${gone.length} garden(s); their plots are free for the next planting`);
  } finally {
    await sql.end();
  }
}

main().catch((err) => {
  console.error(`find-duplicates failed: ${err.message}`);
  process.exitCode = 1;
});
