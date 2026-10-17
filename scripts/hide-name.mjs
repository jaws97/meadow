// Moderates the names on garden signs, which everyone sees in the shared Meadow (and possibly on the party screen):
// find a person by plot or first name, hide their name (the Meadow then shows "A friend"), show it again, or rename
// them. A rename goes through the same cleanFirstName() as the API. Changes reach the Meadow within about ten seconds
// (the snapshot is reused for a few seconds and cached by the CDN for five).
//
//   node --env-file=.env.local scripts/hide-name.mjs --plot 12                   who is on plot 12
//   node --env-file=.env.local scripts/hide-name.mjs --name "Asha"               people with that first name (any case)
//   node --env-file=.env.local scripts/hide-name.mjs --plot 12 --hide            show "A friend" instead of the name
//   node --env-file=.env.local scripts/hide-name.mjs --plot 12 --show            show the name again
//   node --env-file=.env.local scripts/hide-name.mjs --plot 12 --rename "Asha"   a new sign name
import { connect } from "./db-connect.mjs";
import { ensureTypeScript, importProject } from "./lib/load-sim.mjs";

ensureTypeScript();

function arg(name) {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main() {
  const { cleanFirstName } = await importProject("lib/server/validate.ts");
  const plotArg = arg("--plot"), nameArg = arg("--name"), renameArg = arg("--rename");
  const action = process.argv.includes("--hide") ? "hide" : process.argv.includes("--show") ? "show" : renameArg !== undefined ? "rename" : null;
  if (plotArg === undefined && nameArg === undefined) {
    console.log("Pass --plot <n> or --name <first name>. See the header of scripts/hide-name.mjs.");
    process.exitCode = 2;
    return;
  }
  const plot = plotArg === undefined ? null : Number(plotArg);
  if (plot !== null && !Number.isInteger(plot)) throw new Error("--plot needs a whole number");

  const sql = connect("POSTGRES_URL_NON_POOLING");
  try {
    const people = await sql`
      select pe.id, pe.first_name, pe.show_name, p.plot_index, p.rehearsal, pe.created_at
      from meadow.people pe
      left join meadow.gardens g on g.person_id = pe.id
      left join meadow.plants p on p.garden_id = g.id and p.garden_slot = 0
      where ${plot === null ? sql`lower(pe.first_name) = lower(${nameArg})` : sql`p.plot_index = ${plot}`}
      order by p.plot_index`;
    if (people.length === 0) {
      console.log("nobody found");
      return;
    }
    for (const p of people) {
      console.log(`plot ${String(p.plot_index ?? "-").padStart(4)}  "${p.first_name}"  shown=${p.show_name}${p.rehearsal ? "  (rehearsal)" : ""}  planted ${p.created_at.toISOString()}`);
    }
    if (!action) return;
    if (plot === null) {
      console.log("To change a sign, pick the person by --plot (names are not unique).");
      process.exitCode = 2;
      return;
    }
    const id = people[0].id;
    if (action === "rename") {
      const clean = cleanFirstName(renameArg);
      if (!clean.ok) throw new Error(clean.message);
      await sql`update meadow.people set first_name = ${clean.value} where id = ${id}`;
      console.log(`renamed plot ${plot} to "${clean.value}"`);
    } else {
      await sql`update meadow.people set show_name = ${action === "show"} where id = ${id}`;
      console.log(action === "hide" ? `plot ${plot} now shows "A friend"` : `plot ${plot} shows its name again`);
    }
  } finally {
    await sql.end();
  }
}

main().catch((err) => {
  console.error(`hide-name failed: ${err.message}`);
  process.exitCode = 1;
});
