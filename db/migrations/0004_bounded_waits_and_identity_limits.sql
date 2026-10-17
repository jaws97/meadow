-- Bounded waits for the app role and indexes for the identity limits, from the security and reliability review of
-- 17 Oct 2026.
--
-- 1. meadow_app's own defaults: a statement may run 15 s, wait 5 s for a lock, and a transaction may sit idle 15 s.
--    Role settings apply whenever a backend connection starts as meadow_app, including Supavisor's pooled ones, so
--    every query the app sends is bounded even outside db.ts transaction() (which sets 5 s / 10 s / 15 s for itself).
--    The Postgres default is no lock timeout at all, and Supabase's own statement timeout is two minutes. postgres
--    keeps its defaults: migrations and maintenance scripts may legitimately take longer.
-- 2. (person_id, created_at) on sessions and garden_links: identity.ts counts each person's rows from the last hour for
--    the hourly creation limits, and prune-identity.mjs walks old rows. They replace the person_id-only indexes, which
--    they cover.
--
-- db/lockdown.sql runs after this file inside the same transaction (scripts/migrate.mjs) and asserts the result.
-- Idempotent.

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'meadow_app') then
    alter role meadow_app set statement_timeout = '15s';
    alter role meadow_app set lock_timeout = '5s';
    alter role meadow_app set idle_in_transaction_session_timeout = '15s';
  end if;
end
$$;

create index if not exists sessions_person_created_idx on meadow.sessions (person_id, created_at);
create index if not exists garden_links_person_created_idx on meadow.garden_links (person_id, created_at);
drop index if exists meadow.sessions_person_idx;
drop index if exists meadow.garden_links_person_idx;
