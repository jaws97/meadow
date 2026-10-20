// One-off, 20 Oct 2026: turns the live site's practice plantings into real gardens. For a few hours that day every
// planting on the live site before 10 Nov was marked as practice (plants.rehearsal and plants.live_practice, migration
// 0008) and given a plot at the far end of the planned rings; the owner then asked that those first gardens "also grow".
// This moves each one, oldest first, to the plot a real planting would have taken (lib/server/plots.ts assignPlot: the
// lowest free bed plot, or for a lotus the next river pocket) and marks it real, under the same lock plantSeed hands out
// plots with. Run it once the build that plants real gardens is live, then apply migration 0009, which rebuilds their
// checkpoints and drops live_practice. Gardens planted through a dev server or a Preview are left alone.
//
//   node --env-file=.env.local scripts/convert-early-gardens.mjs          list what would change
//   node --env-file=.env.local scripts/convert-early-gardens.mjs --yes    change it
import { connect } from "./db-connect.mjs";
import { ensureTypeScript, importProject } from "./lib/load-sim.mjs";

ensureTypeScript();

// lib/server/garden.ts PLOT_LOCK_KEY: one planting (or this) at a time hands out plots
const PLOT_LOCK_KEY = 0x706c6f74;

async function main() {
  const { assignPlot } = await importProject("lib/server/plots.ts");
  const apply = process.argv.includes("--yes");
  const sql = connect("POSTGRES_URL_NON_POOLING");
  try {
    const [col] = await sql`
      select count(*)::int as n from information_schema.columns
      where table_schema = 'meadow' and table_name = 'plants' and column_name = 'live_practice'`;
    if (col.n === 0) {
      console.log("plants.live_practice is gone (migration 0009 has run): nothing to convert");
      return;
    }
    const moved = await sql.begin(async (tx) => {
      await tx`select pg_advisory_xact_lock(${PLOT_LOCK_KEY})`;
      const early = await tx`
        select p.id, p.species, p.plot_index, pe.first_name from meadow.plants p
        join meadow.gardens g on g.id = p.garden_id join meadow.people pe on pe.id = g.person_id
        where p.live_practice order by p.created_at`;
      const taken = (await tx`select plot_index from meadow.plants`).map((r) => r.plot_index);
      const out = [];
      for (const p of early) {
        const others = taken.filter((t) => t !== p.plot_index);
        const plot = assignPlot(others, { from: "inner", water: p.species === "lotus" });
        if (plot === null) throw new Error("the Meadow has no free plot");
        out.push({ name: p.first_name, species: p.species, from: p.plot_index, to: plot });
        taken.splice(taken.indexOf(p.plot_index), 1, plot);
        if (apply) await tx`update meadow.plants set plot_index = ${plot}, rehearsal = false, live_practice = false where id = ${p.id}`;
      }
      return out;
    });
    console.log(`practice gardens planted on the live site: ${moved.length}`);
    for (const m of moved) console.log(`  "${m.name}" (${m.species}): plot ${m.from} -> ${m.to}`);
    console.log(apply ? "done: they are real gardens now" : "dry run: nothing changed (add --yes)");
  } finally {
    await sql.end();
  }
}

main().catch((err) => {
  console.error(`convert-early-gardens failed: ${err.message}`);
  process.exitCode = 1;
});
