-- Lock the meadow schema down and prove it.
--
-- Supabase's Data API (PostgREST) and GraphQL act as the roles anon and authenticated. This migration revokes every
-- privilege those roles (and PUBLIC) could hold on the schema, its tables, sequences and functions, including the
-- defaults for objects created later, and makes sure row-level security is on for every table in the schema. It ends
-- with assertions that abort the migration if anything is still reachable, so an insecure state can never be recorded
-- as applied. Idempotent: run it again after any future migration (scripts/verify-db.mjs checks the same things).

-- RLS on every table in the schema, including any a later migration forgot.
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
alter default privileges in schema meadow revoke all on functions from public;

-- The Supabase API roles. Guarded, so the same file also runs on a plain Postgres without them.
do $$
declare
  r text;
begin
  foreach r in array array['anon', 'authenticated'] loop
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

-- Assertions: abort (and roll this migration back) if anything is still exposed.
do $$
declare
  r text;
  bad text;
begin
  select string_agg(c.relname, ', ') into bad
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'meadow' and c.relkind in ('r', 'p') and not c.relrowsecurity;
  if bad is not null then
    raise exception 'row-level security is off on meadow tables: %', bad;
  end if;

  foreach r in array array['anon', 'authenticated'] loop
    if exists (select 1 from pg_roles where rolname = r) then
      if has_schema_privilege(r, 'meadow', 'USAGE') or has_schema_privilege(r, 'meadow', 'CREATE') then
        raise exception 'role % still has a privilege on schema meadow', r;
      end if;
      select string_agg(c.relname, ', ') into bad
      from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'meadow' and c.relkind in ('r', 'p', 'v', 'm')
        and has_table_privilege(r, c.oid, 'SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER');
      if bad is not null then
        raise exception 'role % still has privileges on meadow tables: %', r, bad;
      end if;
      select string_agg(c.relname, ', ') into bad
      from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'meadow' and c.relkind = 'S'
        -- CASE keeps the planner from calling has_sequence_privilege on other relations (it raises on a non-sequence)
        and case when c.relkind = 'S' then has_sequence_privilege(r, c.oid, 'USAGE, SELECT, UPDATE') else false end;
      if bad is not null then
        raise exception 'role % still has privileges on meadow sequences: %', r, bad;
      end if;
      select string_agg(p.proname, ', ') into bad
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'meadow' and has_function_privilege(r, p.oid, 'EXECUTE');
      if bad is not null then
        raise exception 'role % can still execute meadow functions: %', r, bad;
      end if;
    end if;
  end loop;
end
$$;
