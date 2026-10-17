-- The meadow lockdown, run by scripts/migrate.mjs inside EVERY migration's transaction, after the migration's own SQL
-- and before it is recorded in meadow.schema_migrations. If any assertion below fails, the exception rolls the whole
-- migration back, so an exposed schema can never be committed, let alone recorded as applied. (0002_lockdown.sql did
-- this once; this file keeps doing it for every later migration.) Idempotent, and it never grants anything.
--
-- What it enforces:
-- - row-level security on every table in schema meadow, including tables a migration forgot;
-- - no privilege at all for PUBLIC, anon, authenticated or service_role (the roles Supabase's Data API, GraphQL and
--   service key act as) on the schema, its tables, sequences and functions, now and by default for later objects;
-- - no EXECUTE for PUBLIC on functions the migration role creates anywhere: Postgres grants that by default, and only
--   the global default privilege (not a per-schema one) can take it away;
-- - row-level security policies only for meadow_app (none for PUBLIC or the API roles);
-- - meadow_app (when present) owns nothing, cannot create in the schema, and holds no DELETE, TRUNCATE, REFERENCES or
--   TRIGGER privilege and nothing on schema_migrations.

do $$
declare
  t regclass;
begin
  for t in
    select c.oid::regclass
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'meadow' and c.relkind in ('r', 'p')
  loop
    execute format('alter table %s enable row level security', t);
  end loop;
end
$$;

revoke all on schema meadow from public;
revoke all on all tables in schema meadow from public;
revoke all on all sequences in schema meadow from public;
revoke all on all functions in schema meadow from public;
alter default privileges in schema meadow revoke all on tables from public;
alter default privileges in schema meadow revoke all on sequences from public;
-- global, so it removes the built-in PUBLIC EXECUTE for every function this role creates from now on
alter default privileges revoke execute on functions from public;

do $$
declare
  r text;
begin
  foreach r in array array['anon', 'authenticated', 'service_role'] loop
    if exists (select 1 from pg_roles where rolname = r) then
      execute format('revoke all on schema meadow from %I', r);
      execute format('revoke all on all tables in schema meadow from %I', r);
      execute format('revoke all on all sequences in schema meadow from %I', r);
      execute format('revoke all on all functions in schema meadow from %I', r);
      execute format('alter default privileges in schema meadow revoke all on tables from %I', r);
      execute format('alter default privileges in schema meadow revoke all on sequences from %I', r);
      execute format('alter default privileges in schema meadow revoke all on functions from %I', r);
    end if;
  end loop;
end
$$;

-- Assertions.
do $$
declare
  r text;
  bad text;
begin
  select string_agg(c.relname, ', ') into bad
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'meadow' and c.relkind in ('r', 'p') and not c.relrowsecurity;
  if bad is not null then
    raise exception 'lockdown: row-level security is off on meadow tables: %', bad;
  end if;

  if has_schema_privilege('public', 'meadow', 'USAGE') or has_schema_privilege('public', 'meadow', 'CREATE') then
    raise exception 'lockdown: PUBLIC still has a privilege on schema meadow';
  end if;
  select string_agg(p.proname, ', ') into bad
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'meadow' and has_function_privilege('public', p.oid, 'EXECUTE');
  if bad is not null then
    raise exception 'lockdown: PUBLIC can execute meadow functions: %', bad;
  end if;

  foreach r in array array['anon', 'authenticated', 'service_role'] loop
    if exists (select 1 from pg_roles where rolname = r) then
      if has_schema_privilege(r, 'meadow', 'USAGE') or has_schema_privilege(r, 'meadow', 'CREATE') then
        raise exception 'lockdown: role % has a privilege on schema meadow', r;
      end if;
      select string_agg(c.relname, ', ') into bad
      from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'meadow' and c.relkind in ('r', 'p', 'v', 'm')
        and has_table_privilege(r, c.oid, 'SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER');
      if bad is not null then
        raise exception 'lockdown: role % has privileges on meadow tables: %', r, bad;
      end if;
      select string_agg(c.relname, ', ') into bad
      from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'meadow' and c.relkind = 'S'
        -- CASE keeps the planner from calling has_sequence_privilege on other relations (it raises on a non-sequence)
        and case when c.relkind = 'S' then has_sequence_privilege(r, c.oid, 'USAGE, SELECT, UPDATE') else false end;
      if bad is not null then
        raise exception 'lockdown: role % has privileges on meadow sequences: %', r, bad;
      end if;
      select string_agg(p.proname, ', ') into bad
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'meadow' and has_function_privilege(r, p.oid, 'EXECUTE');
      if bad is not null then
        raise exception 'lockdown: role % can execute meadow functions: %', r, bad;
      end if;
    end if;
  end loop;

  -- policies may name meadow_app only (0 in polroles is PUBLIC)
  select string_agg(c.relname || '.' || pol.polname, ', ') into bad
  from pg_policy pol
  join pg_class c on c.oid = pol.polrelid
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'meadow'
    and exists (
      select 1 from unnest(pol.polroles) as pr(oid)
      where pr.oid = 0 or pr.oid not in (select oid from pg_roles where rolname = 'meadow_app')
    );
  if bad is not null then
    raise exception 'lockdown: policies on meadow tables apply to roles other than meadow_app: %', bad;
  end if;

  if exists (select 1 from pg_roles where rolname = 'meadow_app') then
    select string_agg(c.relname, ', ') into bad
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'meadow' and c.relowner = 'meadow_app'::regrole;
    if bad is not null then
      raise exception 'lockdown: meadow_app owns meadow objects: %', bad;
    end if;
    if has_schema_privilege('meadow_app', 'meadow', 'CREATE') then
      raise exception 'lockdown: meadow_app may create objects in schema meadow';
    end if;
    if exists (select 1 from pg_roles where rolname = 'meadow_app' and (rolsuper or rolbypassrls or rolcreaterole or rolcreatedb)) then
      raise exception 'lockdown: meadow_app has a superuser, bypassrls, createrole or createdb attribute';
    end if;
    select string_agg(c.relname, ', ') into bad
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'meadow' and c.relkind in ('r', 'p', 'v', 'm')
      and (has_table_privilege('meadow_app', c.oid, 'DELETE, TRUNCATE, REFERENCES, TRIGGER')
           or (c.relname = 'schema_migrations' and has_table_privilege('meadow_app', c.oid, 'SELECT, INSERT, UPDATE')));
    if bad is not null then
      raise exception 'lockdown: meadow_app holds more than it needs on: %', bad;
    end if;
  end if;
end
$$;
