// Fills the local Meadow with rehearsal plantings to look at it, and takes them away again. Rehearsal only: it
// plants through the LOCAL dev server's API (which marks every planting as a rehearsal, hidden from the production
// Meadow) and refuses any other server; every name ends in "(delete me)"; and it only ever changes or deletes the
// people it created itself, recorded in a state file.
//
//   node --env-file=.env.local scripts/seed-meadow-rehearsal.mjs plant 60     plant 60 seeds (six species in turn)
//   node --env-file=.env.local scripts/seed-meadow-rehearsal.mjs arrange      move them to the inner rings, as the
//                                                                               party would fill them, at mixed stages
//   node --env-file=.env.local scripts/seed-meadow-rehearsal.mjs clear        delete every person this script made
//   add --also "Tester (delete me)" to `clear` to remove one more rehearsal garden made by hand, by its exact name
//   add --state <file> to keep the record somewhere other than the system temp folder
//
// "arrange" writes the rehearsal plants' rows directly: their plots (the lowest free plots, inner rings first, as
// lib/server/plots.ts hands them out), their planting hour (backdated by their age) and a checkpoint at a chosen
// stage (seed, sprout, leafy, bud or bloom; a few a little poorly), so the Meadow shows the fortnight's whole range.
// The dev server never saves a catch-up, so these stay as written until they are cleared. Before 10 Nov only.
//
// The database is reached with POSTGRES_URL_NON_POOLING; nothing secret is printed.
import { randomUUID } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { connect } from "./db-connect.mjs";
import { ensureTypeScript, importSim } from "./lib/load-sim.mjs";

ensureTypeScript();

const BASE = "http://localhost:3000";
const SPECIES = ["rose", "sundrop", "magnolia", "marigold", "tefiti", "jasmine"];
const NAMES = [
  "Asha", "Rahul", "Priya", "Arjun", "Meera", "Kiran", "Divya", "Vikram", "Ananya", "Rohan", "Sneha", "Aditya", "Kavya",
  "Nikhil", "Pooja", "Siddharth", "Lakshmi", "Varun", "Isha", "Karthik", "Neha", "Manoj", "Riya", "Suresh", "Tara",
  "Deepak", "Aisha", "Ravi", "Nandini", "Arun", "Shreya", "Ganesh", "Maya", "Harish", "Leela", "Omar", "Zoya", "Farhan",
  "Joseph", "Maria", "Thomas", "Grace", "Daniel", "Sara", "Vivek", "Bhavna", "Imran", "Kalpana", "Mohan", "Rekha",
  "Sanjay", "Usha", "Yash", "Anil", "Chitra", "Dev", "Esha", "Gopal", "Hema", "Jaya", "Kunal", "Latha", "Naveen", "Parvati",
  "Rajesh", "Sunita", "Tanvi", "Uday", "Vani", "Wasim",
];
/** Stages by share of the plantings, youngest first. */
const STAGES = [
  { stage: "seed", share: 0.3, D: 0.02, days: 0 },
  { stage: "sprout", share: 0.2, D: 0.16, days: 3 },
  { stage: "leafy", share: 0.2, D: 0.45, days: 7 },
  { stage: "bud", share: 0.15, D: 0.82, days: 11 },
  { stage: "bloom", share: 0.15, D: 1, days: 15 },
];

const args = process.argv.slice(2);
const command = args[0];
const flag = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const STATE = flag("--state") ?? join(tmpdir(), "meadow-rehearsal-seeds.json");

function readState() {
  if (!existsSync(STATE)) return { people: [] };
  return JSON.parse(readFileSync(STATE, "utf8"));
}
function writeState(state) {
  writeFileSync(STATE, JSON.stringify(state, null, 2));
}

async function plant(count) {
  const state = readState();
  // a little slack: the database's clock and this machine's need not agree to the second
  const startedAt = new Date(Date.now() - 10_000).toISOString();
  let planted = 0;
  for (let i = 0; i < count; i++) {
    const firstName = `${NAMES[(state.people.length + i) % NAMES.length]} (delete me)`;
    const species = SPECIES[(state.people.length + i) % SPECIES.length];
    const res = await fetch(`${BASE}/api/seed`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ firstName, species, clientEventId: randomUUID() }),
    });
    const body = await res.json().catch(() => ({}));
    if (res.status !== 201) {
      console.log(`  ${firstName}: ${res.status} ${body.error ?? ""} ${body.message ?? ""}`);
      if (res.status === 429 || res.status === 503) await new Promise((r) => setTimeout(r, 6000));
      continue;
    }
    if (body.me?.plant?.rehearsal !== true) throw new Error("a planting came back as a real plant; stopping (this script is for rehearsals only)");
    planted++;
  }
  // find exactly the people just made: rehearsal-only gardens named "(delete me)" created since this run started
  const sql = connect("POSTGRES_URL_NON_POOLING");
  try {
    const rows = await sql`
      select pe.id, pe.first_name from meadow.people pe
      join meadow.gardens g on g.person_id = pe.id join meadow.plants p on p.garden_id = g.id
      where pe.created_at >= ${startedAt} and pe.first_name like '% (delete me)' and p.rehearsal
        and pe.first_name = any(${NAMES.map((n) => `${n} (delete me)`)})`;
    const known = new Set(state.people.map((p) => p.id));
    for (const r of rows) if (!known.has(r.id)) state.people.push({ id: r.id, name: r.first_name });
    writeState(state);
    console.log(`planted ${planted}; ${state.people.length} rehearsal gardens recorded`);
  } finally {
    await sql.end();
  }
}

async function arrange() {
  const { createPlant, Bideal, SIM_SPECIES, SIM_VERSION, hourIndexOf, GAME_START_MS } = await importSim();
  if (Date.now() >= GAME_START_MS) throw new Error("the game clock has started (10 Nov): rehearsal plants are not arranged any more");
  const state = readState();
  const ids = state.people.map((p) => p.id);
  if (ids.length === 0) return console.log("nothing recorded to arrange");
  const nowH = hourIndexOf(new Date());
  const sql = connect("POSTGRES_URL_NON_POOLING");
  try {
    await sql.begin(async (tx) => {
      // the same lock the server takes to hand out plots, so no planting races this
      await tx`select pg_advisory_xact_lock(${0x706c6f74})`;
      const mine = await tx`
        select p.id as plant_id, pe.id as person_id, p.species from meadow.plants p
        join meadow.gardens g on g.id = p.garden_id join meadow.people pe on pe.id = g.person_id
        where pe.id = any(${ids}::uuid[]) and p.rehearsal and pe.first_name like '% (delete me)'
        order by pe.created_at`;
      const others = await tx`select plot_index from meadow.plants where id <> all(${mine.map((m) => m.plant_id)}::uuid[])`;
      const taken = new Set(others.map((r) => r.plot_index));
      // park them out of the way first, so moving into a plot one of them holds never collides
      for (let i = 0; i < mine.length; i++) await tx`update meadow.plants set plot_index = ${100000 + i} where id = ${mine[i].plant_id}`;
      let next = 0;
      let k = 0;
      for (const m of mine) {
        while (taken.has(next)) next++;
        const plot = next++;
        // which stage: walk the shares in order
        const t = (k + 0.5) / mine.length;
        let acc = 0;
        let pick = STAGES[STAGES.length - 1];
        for (const s of STAGES) {
          acc += s.share;
          if (t <= acc) {
            pick = s;
            break;
          }
        }
        const plantedH = nowH - pick.days * 24 - (k % 5);
        const sp = SIM_SPECIES[m.species];
        const s = createPlant(m.species, plantedH, m.person_id);
        const never = plantedH - 99;
        s.lastCanH = Math.min(s.lastCanH, never);
        s.lastFeedH = Math.min(s.lastFeedH, never);
        s.h = nowH;
        s.D = pick.D;
        s.B = Bideal(sp, pick.D);
        s.Np = 45 * s.B;
        if (pick.stage === "bloom") {
          s.ripeH = nowH - 30;
          s.bloomH = nowH - 8;
          s.op = 1;
        }
        // one in seven a little poorly (an old dry spell), to see the kind words
        if (k % 7 === 3) s.Dw = 0.42;
        await tx`update meadow.plants set plot_index = ${plot}, planted_h = ${plantedH} where id = ${m.plant_id}`;
        await tx`
          update meadow.checkpoints set h = ${nowH}, state = ${tx.json(s)}, sim_version = ${SIM_VERSION}, version = version + 1, updated_at = now()
          where plant_id = ${m.plant_id}`;
        k++;
      }
    });
    console.log(`arranged ${ids.length} rehearsal plants on the inner rings`);
  } finally {
    await sql.end();
  }
}

async function clear() {
  const state = readState();
  const also = flag("--also");
  const sql = connect("POSTGRES_URL_NON_POOLING");
  try {
    const extra = also && also.endsWith("(delete me)") ? await sql`select id from meadow.people where first_name = ${also}` : [];
    const ids = [...state.people.map((p) => p.id), ...extra.map((r) => r.id)];
    if (ids.length === 0) return console.log("nothing recorded to clear");
    // only people whose every plant is a rehearsal, and only names that say so
    const gone = await sql`
      delete from meadow.people pe where pe.id = any(${ids}::uuid[]) and pe.first_name like '%(delete me)'
        and not exists (select 1 from meadow.gardens g join meadow.plants p on p.garden_id = g.id where g.person_id = pe.id and not p.rehearsal)
      returning pe.id`;
    writeState({ people: [] });
    const [left] = await sql`select count(*)::int as n from meadow.people where id = any(${ids}::uuid[])`;
    console.log(`deleted ${gone.length} rehearsal gardens; ${left.n} left of those recorded`);
  } finally {
    await sql.end();
  }
}

async function main() {
  if (command === "plant") await plant(Math.max(1, Math.min(120, Number(args[1]) || 60)));
  else if (command === "arrange") await arrange();
  else if (command === "clear") await clear();
  else console.log("usage: seed-meadow-rehearsal.mjs plant <count> | arrange | clear [--also <name>] [--state <file>]");
}

main().catch((err) => {
  console.error(`seed-meadow-rehearsal failed: ${err.message}`);
  process.exitCode = 1;
});
