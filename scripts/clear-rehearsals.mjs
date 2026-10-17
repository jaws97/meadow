// Removes rehearsal plantings: plants marked plants.rehearsal when they went in, because they were planted before the
// seeds were handed out, or through a server that is not the production deployment (the local dev server and Vercel
// Preview share this database). It deletes the people whose every plant is a rehearsal, cascading to their gardens,
// plants, events, checkpoints, sprinkles, sessions and links. Real plants are never touched: the mark is set at insert
// and never inferred from the planting hour, so moving the opening hour cannot turn a colleague's plant into a
// rehearsal.
//
// From the start of the game clock (10 Nov 00:00 IST, lib/sim's GAME_START) colleagues are planting, so deleting then
// also needs --force: look at the list first.
//
//   node --env-file=.env.local scripts/clear-rehearsals.mjs                  list what would go
//   node --env-file=.env.local scripts/clear-rehearsals.mjs --yes            delete it (before 10 Nov)
//   node --env-file=.env.local scripts/clear-rehearsals.mjs --yes --force    delete it on or after 10 Nov
//   add --weather to also delete the weather hours from before the game clock (h < 0) once no rehearsal plant needs them
//   (they are real Open-Meteo data and harmless to keep)
import { connect } from "./db-connect.mjs";
import { ensureTypeScript, importSim } from "./lib/load-sim.mjs";

ensureTypeScript();

async function main() {
  const { GAME_START_MS } = await importSim();
  const apply = process.argv.includes("--yes");
  const force = process.argv.includes("--force");
  const weather = process.argv.includes("--weather");
  const sql = connect("POSTGRES_URL_NON_POOLING");
  try {
    const people = await sql`
      select pe.id, pe.first_name, count(p.id)::int as plants, min(p.plot_index) as plot, min(p.created_at) as planted
      from meadow.people pe join meadow.gardens g on g.person_id = pe.id join meadow.plants p on p.garden_id = g.id
      group by pe.id, pe.first_name
      having bool_and(p.rehearsal)
      order by min(p.created_at)`;
    const [real] = await sql`select count(*)::int as n from meadow.plants where not rehearsal`;
    const [wx] = await sql`select count(*)::int as n from meadow.weather_hours where h < 0`;
    console.log(`rehearsal gardens: ${people.length}`);
    for (const p of people) console.log(`  plot ${String(p.plot).padStart(4)}  ${p.first_name}  (planted ${p.planted.toISOString()})`);
    console.log(`real plants (kept): ${real.n}`);
    console.log(`weather hours before the game clock: ${wx.n}${weather ? "" : " (kept; add --weather to remove)"}`);
    if (!apply) {
      console.log("dry run: nothing deleted (add --yes to delete)");
      return;
    }
    if (Date.now() >= GAME_START_MS && !force) {
      console.log("The game clock has started (10 Nov 00:00 IST) and colleagues are planting. Check the list above, then run again with --yes --force.");
      process.exitCode = 2;
      return;
    }
    const result = await sql.begin(async (tx) => {
      const ids = people.map((p) => p.id);
      // re-checked inside the transaction: only people whose plants are all still rehearsals
      const gone = ids.length === 0 ? [] : await tx`
        delete from meadow.people pe where pe.id = any(${ids}::uuid[])
          and not exists (
            select 1 from meadow.gardens g join meadow.plants p on p.garden_id = g.id
            where g.person_id = pe.id and not p.rehearsal)
        returning pe.id`;
      let weatherGone = 0;
      if (weather) {
        const [left] = await tx`select count(*)::int as n from meadow.plants where rehearsal and planted_h < 0`;
        if (left.n === 0) weatherGone = (await tx`delete from meadow.weather_hours where h < 0 returning h`).length;
      }
      return { people: gone.length, weather: weatherGone };
    });
    console.log(`deleted ${result.people} rehearsal gardens${weather ? ` and ${result.weather} pre-game weather hours` : ""}`);
  } finally {
    await sql.end();
  }
}

main().catch((err) => {
  console.error(`clear-rehearsals failed: ${err.message}`);
  process.exitCode = 1;
});
