// Verifies, from SQL, that the meadow schema is private: every table has row-level security enabled; PUBLIC and the
// Supabase API roles (anon, authenticated, service_role) hold no privilege on the schema, its tables, sequences or
// functions; policies exist for meadow_app only; and the app role meadow_app has exactly what the app needs. It then
// proves the app role works and is fenced in: as meadow_app, inside a transaction that is always rolled back, it runs
// the app's kinds of writes and checks that DELETE, TRUNCATE, DDL and disabling RLS are refused. Also lists what the
// schema contains and which migrations are applied.
//
//   node --env-file=.env.local scripts/verify-db.mjs
//
// Exits 1 if anything is exposed. scripts/migrate.mjs runs the same check after applying migrations.
import path from "node:path";
import { fileURLToPath } from "node:url";
import { connect } from "./db-connect.mjs";

const API_ROLES = ["anon", "authenticated", "service_role"];
const APP_ROLE = "meadow_app";

/** Runs every check; returns { ok, report } where report is printable lines. Never prints connection details. */
export async function verifySecurity(sql) {
  const lines = [];
  let ok = true;

  const tables = await sql`
    select c.relname as name, c.relrowsecurity as rls,
           pg_get_userbyid(c.relowner) as owner,
           (select count(*)::int from pg_policy p where p.polrelid = c.oid) as policies,
           (select string_agg(distinct case when r.oid = 0 then 'PUBLIC' else r.rolname end, ',')
              from pg_policy p, unnest(p.polroles) as pr(oid) left join pg_roles r on r.oid = pr.oid
              where p.polrelid = c.oid) as policy_roles
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'meadow' and c.relkind in ('r', 'p')
    order by c.relname`;
  if (tables.length === 0) {
    ok = false;
    lines.push("FAIL no tables found in schema meadow");
  }
  lines.push(`tables in schema meadow: ${tables.length}`);
  for (const t of tables) {
    const policyOk = !t.policy_roles || t.policy_roles === APP_ROLE;
    if (!t.rls || !policyOk) ok = false;
    lines.push(`  ${t.rls && policyOk ? "ok  " : "FAIL"} ${t.name.padEnd(18)} rls=${t.rls} owner=${t.owner} policies=${t.policies}${t.policy_roles ? ` (for ${t.policy_roles})` : ""}`);
  }

  const publicTables = await sql`
    select count(*)::int as n from information_schema.tables where table_schema = 'public'`;
  lines.push(`tables in schema public (exposed by the Data API): ${publicTables[0].n}`);

  const [pub] = await sql`
    select has_schema_privilege('public', 'meadow', 'USAGE') as usage,
           (select count(*)::int from information_schema.role_table_grants where table_schema = 'meadow' and grantee = 'PUBLIC') as grants,
           (select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
              where n.nspname = 'meadow' and has_function_privilege('public', p.oid, 'EXECUTE')) as functions`;
  const pubClean = !pub.usage && pub.grants === 0 && pub.functions === 0;
  if (!pubClean) ok = false;
  lines.push(`PUBLIC: ${pubClean ? "ok  " : "FAIL"} schema usage=${pub.usage}, table grants=${pub.grants}, executable meadow functions=${pub.functions}`);

  // the global default that removes the built-in PUBLIC EXECUTE on new functions (pg_default_acl row with no schema)
  const [def] = await sql`
    select exists (
      select 1 from pg_default_acl d
      where d.defaclrole = current_user::regrole and d.defaclnamespace = 0 and d.defaclobjtype = 'f'
        and not exists (select 1 from aclexplode(d.defaclacl) a where a.grantee = 0)
    ) as revoked`;
  if (!def.revoked) ok = false;
  lines.push(`functions the migration role creates: ${def.revoked ? "ok   no PUBLIC EXECUTE by default" : "FAIL PUBLIC EXECUTE is still the default"}`);

  const roles = await sql`select rolname from pg_roles where rolname = any(${API_ROLES})`;
  const present = roles.map((r) => r.rolname);
  for (const role of API_ROLES) {
    if (!present.includes(role)) {
      lines.push(`role ${role}: not present (plain Postgres), nothing to check`);
      continue;
    }
    const [schema] = await sql`
      select has_schema_privilege(${role}, 'meadow', 'USAGE') as usage,
             has_schema_privilege(${role}, 'meadow', 'CREATE') as create`;
    const grants = await sql`
      select table_name, privilege_type from information_schema.role_table_grants
      where table_schema = 'meadow' and grantee = ${role}
      order by table_name, privilege_type`;
    const tablePriv = await sql`
      select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'meadow' and c.relkind in ('r', 'p', 'v', 'm')
        and has_table_privilege(${role}, c.oid, 'SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER')`;
    const seqPriv = await sql`
      select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'meadow' and c.relkind = 'S'
        and case when c.relkind = 'S' then has_sequence_privilege(${role}, c.oid, 'USAGE, SELECT, UPDATE') else false end`;
    const fnPriv = await sql`
      select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'meadow' and has_function_privilege(${role}, p.oid, 'EXECUTE')`;
    const clean = !schema.usage && !schema.create && grants.length === 0 && tablePriv.length === 0
      && seqPriv.length === 0 && fnPriv.length === 0;
    if (!clean) ok = false;
    lines.push(
      `role ${role}: ${clean ? "ok  " : "FAIL"} schema usage=${schema.usage} create=${schema.create}, `
        + `role_table_grants=${grants.length}, tables with any privilege=${tablePriv.length}, `
        + `sequences=${seqPriv.length}, functions=${fnPriv.length}`,
    );
    for (const g of grants) lines.push(`    grant ${g.privilege_type} on ${g.table_name}`);
  }

  const [app] = await sql`select rolname, rolcanlogin, rolbypassrls, rolsuper, rolcreaterole, rolcreatedb from pg_roles where rolname = ${APP_ROLE}`;
  if (!app) {
    lines.push(`role ${APP_ROLE}: not created yet (migration 0003)`);
  } else {
    const grants = await sql`
      select table_name, string_agg(privilege_type, ',' order by privilege_type) as privs
      from information_schema.role_table_grants
      where table_schema = 'meadow' and grantee = ${APP_ROLE}
      group by table_name order by table_name`;
    const cols = await sql`
      select table_name, string_agg(column_name, ',' order by column_name) as cols
      from information_schema.column_privileges
      where table_schema = 'meadow' and grantee = ${APP_ROLE} and privilege_type = 'UPDATE'
        and not exists (select 1 from information_schema.role_table_grants g
                        where g.table_schema = 'meadow' and g.grantee = ${APP_ROLE} and g.table_name = column_privileges.table_name
                          and g.privilege_type = 'UPDATE')
      group by table_name order by table_name`;
    const [own] = await sql`
      select count(*)::int as n from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'meadow' and c.relowner = ${APP_ROLE}::regrole`;
    const fenced = !app.rolbypassrls && !app.rolsuper && !app.rolcreaterole && !app.rolcreatedb && own.n === 0
      && grants.every((g) => !/DELETE|TRUNCATE|REFERENCES|TRIGGER/.test(g.privs) && g.table_name !== "schema_migrations");
    if (!fenced) ok = false;
    lines.push(`role ${APP_ROLE}: ${fenced ? "ok  " : "FAIL"} login=${app.rolcanlogin} bypassrls=${app.rolbypassrls} owns=${own.n}`);
    // reliability rather than exposure, so a missing setting warns instead of failing (migration 0004 sets them)
    const [cfg] = await sql`
      select array_to_string(s.setconfig, ', ') as settings
      from pg_db_role_setting s where s.setrole = ${APP_ROLE}::regrole and s.setdatabase = 0`;
    const settings = cfg?.settings ?? "";
    const bounded = ["statement_timeout=", "lock_timeout=", "idle_in_transaction_session_timeout="].every((k) => settings.includes(k));
    lines.push(`  ${bounded ? "ok  " : "WARN"} ${APP_ROLE} defaults: ${settings || "none (every wait unbounded outside transaction())"}`);
    for (const g of grants) lines.push(`    ${g.table_name.padEnd(14)} ${g.privs}`);
    for (const c of cols) lines.push(`    ${c.table_name.padEnd(14)} UPDATE (${c.cols})`);
    const probe = await probeAppRole(sql);
    if (!probe.ok) ok = false;
    for (const line of probe.lines) lines.push(`  ${line}`);
  }

  const migrations = await sql`
    select version, name, applied_at from meadow.schema_migrations order by version`.catch(() => []);
  lines.push(`applied migrations: ${migrations.map((m) => m.version + "_" + m.name).join(", ") || "none"}`);

  lines.push(ok ? "RESULT: meadow is private" : "RESULT: EXPOSED, see FAIL lines");
  return { ok, report: lines };
}

/**
 * Acts as meadow_app inside a transaction that is always rolled back: the app's writes must work (RLS policies and
 * grants are right) and anything beyond them must be refused with 42501 (insufficient privilege).
 */
async function probeAppRole(sql) {
  const lines = [];
  let ok = true;
  const ROLLBACK = new Error("rollback");
  try {
    await sql.begin(async (tx) => {
      await tx`set local role meadow_app`;
      const [p] = await tx`insert into meadow.people (first_name) values ('Verify probe (rolled back)') returning id`;
      const [g] = await tx`insert into meadow.gardens (person_id) values (${p.id}) returning id`;
      const [pl] = await tx`
        insert into meadow.plants (garden_id, species, seed, plot_index, planted_h, sim_version, rehearsal)
        values (${g.id}, 'rose', 'probe', 999999, -100000, 1, true) returning id`;
      await tx`insert into meadow.checkpoints (plant_id, h, state, sim_version) values (${pl.id}, -100000, '{}'::jsonb, 1)`;
      await tx`select h from meadow.checkpoints where plant_id = ${pl.id} for update`;
      await tx`update meadow.checkpoints set version = version + 1, updated_at = now() where plant_id = ${pl.id}`;
      await tx`update meadow.plants set generation = 2 where id = ${pl.id}`;
      const [e] = await tx`
        insert into meadow.plant_events (plant_id, h, kind, client_event_id) values (${pl.id}, -100000, 'water', 'probe-rolled-back') returning id`;
      const [s] = await tx`
        insert into meadow.sprinkles (giver_id, plant_id, ist_day, h) values (${p.id}, ${pl.id}, '2000-01-01', -100000) returning id`;
      await tx`update meadow.sprinkles set event_id = ${e.id} where id = ${s.id}`;
      await tx`insert into meadow.sessions (token_hash, person_id) values (${Buffer.alloc(32, 7)}, ${p.id})`;
      await tx`update meadow.sessions set last_seen_at = now(), revoked_at = now() where person_id = ${p.id}`;
      await tx`insert into meadow.garden_links (token_hash, person_id) values (${Buffer.alloc(32, 9)}, ${p.id})`;
      await tx`update meadow.garden_links set use_count = use_count + 1, last_used_at = now(), revoked_at = now() where person_id = ${p.id}`;
      await tx`
        insert into meadow.weather_hours (h, t_c, rh_pct, precip_mm, sw_wm2, et0_mm, wind_kmh, soil_t_c, is_day, source)
        values (-100000, 20, 70, 0, 0, 0, 5, 20, 0, 'probe') on conflict (h) do nothing`;
      const [seen] = await tx`select count(*)::int as n from meadow.plants where id = ${pl.id}`;
      if (seen.n !== 1) throw new Error("meadow_app cannot read its own insert (RLS policy missing)");
      lines.push("ok   as meadow_app: insert/select/update on every app table works (rolled back)");

      const refused = [
        ["DELETE a person", (q) => q`delete from meadow.people where id = ${p.id}`],
        ["DELETE an event", (q) => q`delete from meadow.plant_events where id = ${e.id}`],
        ["UPDATE a name", (q) => q`update meadow.people set first_name = 'x' where id = ${p.id}`],
        ["UPDATE an event", (q) => q`update meadow.plant_events set h = 0 where id = ${e.id}`],
        ["TRUNCATE weather", (q) => q`truncate meadow.weather_hours`],
        ["read schema_migrations", (q) => q`select * from meadow.schema_migrations`],
        ["disable RLS", (q) => q`alter table meadow.people disable row level security`],
        ["drop the append-only trigger", (q) => q`drop trigger plant_events_append_only on meadow.plant_events`],
        ["create a table", (q) => q`create table meadow.probe_table (id int)`],
      ];
      for (const [label, run] of refused) {
        try {
          await tx.savepoint((q) => run(q));
          ok = false;
          lines.push(`FAIL as meadow_app: ${label} was allowed`);
        } catch (err) {
          const good = err.code === "42501";
          if (!good) ok = false;
          lines.push(`${good ? "ok  " : "FAIL"} as meadow_app: ${label} refused (${err.code})`);
        }
      }
      throw ROLLBACK;
    });
  } catch (err) {
    if (err !== ROLLBACK) {
      ok = false;
      lines.push(`FAIL meadow_app probe: ${err.code ?? ""} ${err.message}`);
    }
  }
  return { ok, lines };
}

async function main() {
  const sql = connect();
  try {
    const { ok, report } = await verifySecurity(sql);
    for (const line of report) console.log(line);
    process.exitCode = ok ? 0 : 1;
  } finally {
    await sql.end();
  }
}

if (process.argv[1] && path.resolve(fileURLToPath(import.meta.url)).toLowerCase() === path.resolve(process.argv[1]).toLowerCase()) {
  main().catch((err) => {
    console.error(`verify-db failed: ${err.message}`);
    process.exitCode = 1;
  });
}
