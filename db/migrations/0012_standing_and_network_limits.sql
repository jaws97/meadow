-- Who may sign whom out, and a brake on scripts, from 21 Oct 2026 (lib/server/identity.ts, login.ts, network.ts).
--
-- A newer key never outranks an older one: each device's session remembers when its hold on the garden began, so a
-- personal link that reached the wrong person can never be used to lock the gardener out. "Sign out other devices"
-- (POST /api/session/reset) signs out only devices whose hold began after the asking device's, and lets go of a Google
-- account the garden was kept on after that; the cap on devices retires the newest holds first.
--
-- 1. meadow.sessions.standing_at: when the device's hold on the garden began. The planting device: the planting. A
--    device opened by a personal link: that moment. A device opened through Google: when the garden was kept on that
--    account. Switching back keeps a session (and so its standing); a device carried from the old address keeps its own
--    (2). Existing sessions take their own created_at.
-- 2. meadow.garden_links.standing_at: set only on the link that carries a device from the old address to the new one
--    (lib/server/move.ts), so the session it opens there keeps the device's standing; such a link works once.
-- 3. meadow.logins.forgotten_at: a garden kept on a Google account can be let go of (a mark, never a delete: the app
--    role still cannot delete). One account keeps one garden and one garden is kept on one account among the rows not
--    let go of, so a let-go account may keep a garden again and the garden may be kept on another account. The primary
--    key becomes (subject_hash, created_at), as one account may now have several rows over time; the uniqueness the app
--    relies on moves to two partial unique indexes, logins_account_key and logins_garden_key.
-- 4. meadow.network_marks: a scrambled mark of the network a seed (or a name check) without the party link came from,
--    for the per-network limits (lib/server/network.ts). The mark is an HMAC of the address with a key that changes
--    every IST day, so marks from different days cannot be matched with one another and no address can be read back;
--    scripts/prune-identity.mjs removes them after two days.
--
-- meadow_app may insert the new columns (its table-wide insert grants), set forgotten_at, and read and add network
-- marks; it still cannot delete anything.
--
-- The order, because the dev server, Preview and production share one database: apply this migration, then deploy the
-- build that uses it. The live build keeps working on it: new sessions take now() as their standing, and its rare race
-- answer for one account planting on two devices at once (a 409 matched by the old primary key's name) becomes a 500
-- until the new build is live.
--
-- Changing the tables takes a brief exclusive lock on sessions, garden_links and logins; it waits at most 3 seconds and
-- otherwise fails and rolls back with nothing changed: run scripts/migrate.mjs again a moment later.
--
-- db/lockdown.sql runs after this file inside the same transaction (scripts/migrate.mjs) and asserts the result.
-- Idempotent.

set local lock_timeout = '3s';

-- 1. sessions.standing_at
alter table meadow.sessions add column if not exists standing_at timestamptz;
update meadow.sessions set standing_at = created_at where standing_at is null;
alter table meadow.sessions alter column standing_at set default now();
alter table meadow.sessions alter column standing_at set not null;

-- 2. garden_links.standing_at
alter table meadow.garden_links add column if not exists standing_at timestamptz;

-- 3. logins.forgotten_at and its keys
alter table meadow.logins add column if not exists forgotten_at timestamptz;
do $$
begin
  if exists (select 1 from pg_constraint where conrelid = 'meadow.logins'::regclass and conname = 'logins_person_id_key') then
    alter table meadow.logins drop constraint logins_person_id_key;
  end if;
  if exists (select 1 from pg_constraint where conrelid = 'meadow.logins'::regclass and conname = 'logins_pkey'
             and array_length(conkey, 1) = 1) then
    alter table meadow.logins drop constraint logins_pkey;
    alter table meadow.logins add constraint logins_pkey primary key (subject_hash, created_at);
  end if;
end
$$;
create unique index if not exists logins_account_key on meadow.logins (subject_hash) where forgotten_at is null;
create unique index if not exists logins_garden_key on meadow.logins (person_id) where forgotten_at is null;
grant update (forgotten_at) on meadow.logins to meadow_app;

-- 4. network_marks
create table if not exists meadow.network_marks (
  mark        bytea not null check (octet_length(mark) = 32),
  kind        text not null check (kind in ('seed', 'name')),
  created_at  timestamptz not null default now()
);
create index if not exists network_marks_mark_idx on meadow.network_marks (mark, kind, created_at);
alter table meadow.network_marks enable row level security;
grant select, insert on meadow.network_marks to meadow_app;
drop policy if exists meadow_app_all on meadow.network_marks;
create policy meadow_app_all on meadow.network_marks as permissive for all to meadow_app using (true) with check (true);
