-- Party-day hardening, from the security and reliability review of 16 Oct 2026.
--
-- 1. plants.rehearsal: an explicit mark on practice plants, set when the plant is inserted: planted before the seeds are
--    handed out (with MEADOW_REHEARSAL=1), or planted through any server that is not the production deployment (the
--    local dev server and Vercel Preview share this database). The production Meadow hides them, and
--    scripts/clear-rehearsals.mjs deletes by this flag alone, never by planting hour, so moving the opening hour can never
--    make a colleague's plant look like a rehearsal.
-- 2. An index on plants.created_at for the planting throttle (plantings in the last minute).
-- 3. meadow_app, a least-privilege role for the app: SELECT and INSERT where the app reads and appends, UPDATE only on
--    the columns it really changes, no DELETE, no TRUNCATE, no DDL, owns nothing, and cannot bypass row-level security
--    (each table gets one policy, for meadow_app alone). It is created NOLOGIN: scripts/app-role.mjs gives it a password
--    and writes the pooler URL to a gitignored file for Vercel's POSTGRES_URL. postgres keeps running the migrations.
--
-- db/lockdown.sql runs after this file inside the same transaction (scripts/migrate.mjs) and asserts the result.
-- Idempotent.

alter table meadow.plants add column if not exists rehearsal boolean not null default false;
-- hours before 10 Nov 00:00 IST are before the party by definition (the database is empty today; this is for safety)
update meadow.plants set rehearsal = true where planted_h < 0 and not rehearsal;

create index if not exists plants_created_at_idx on meadow.plants (created_at);

-- The app role. Roles are cluster-wide, hence the guard instead of "if not exists".
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'meadow_app') then
    create role meadow_app nologin noinherit nocreatedb nocreaterole nobypassrls;
  end if;
end
$$;
alter role meadow_app nocreatedb nocreaterole nobypassrls noinherit;

-- Lets the migration role SET ROLE meadow_app for scripts/verify-db.mjs's functional check, without inheriting anything
-- (postgres already holds more than meadow_app). PG16+ syntax; Supabase runs 17.
do $$
begin
  if not exists (
    select 1 from pg_auth_members m
    where m.roleid = 'meadow_app'::regrole and m.member = current_user::regrole and m.set_option
  ) then
    execute format('grant meadow_app to %I with inherit false, set true', current_user);
  end if;
end
$$;

grant usage on schema meadow to meadow_app;

grant select, insert on meadow.people, meadow.gardens, meadow.plant_events, meadow.weather_hours to meadow_app;
grant select, insert on meadow.sessions, meadow.garden_links, meadow.plants, meadow.checkpoints, meadow.sprinkles to meadow_app;
grant update (last_seen_at, revoked_at) on meadow.sessions to meadow_app;
grant update (last_used_at, use_count, revoked_at) on meadow.garden_links to meadow_app;
grant update (generation) on meadow.plants to meadow_app;
grant update (h, state, sim_version, version, updated_at) on meadow.checkpoints to meadow_app;
grant update (event_id) on meadow.sprinkles to meadow_app;
-- the identity columns of plant_events and sprinkles
grant usage on sequence meadow.plant_events_id_seq, meadow.sprinkles_id_seq to meadow_app;

-- One policy per app table, for meadow_app only: it sees and writes every row (the app is the only client), while
-- anon, authenticated and every other role still match no policy at all.
do $$
declare
  t text;
begin
  foreach t in array array['people', 'sessions', 'garden_links', 'gardens', 'plants', 'plant_events', 'weather_hours',
                           'checkpoints', 'sprinkles'] loop
    execute format('drop policy if exists meadow_app_all on meadow.%I', t);
    execute format('create policy meadow_app_all on meadow.%I as permissive for all to meadow_app using (true) with check (true)', t);
  end loop;
end
$$;
