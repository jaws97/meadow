-- Google sign-in, from 22 Oct 2026 (lib/server/login.ts, login-rules.ts, google.ts): a garden can be kept on a Google
-- account, so signing in on any device opens it, and once sign-in is on, a seed planted without the party link needs
-- an account that keeps no garden yet. Nothing about the account is stored but its Google number, scrambled with a key
-- that lives on Vercel alone (MEADOW_LOGIN_KEY, HMAC-SHA-256): never an email, a name or a picture.
--
-- 1. meadow.logins: the garden each account keeps. One garden for each account (the key) and one account for each
--    garden (person_id unique). last_used_at moves when the account opens its garden on a device.
-- 2. meadow.login_starts: an account signed in on a device that holds no garden yet, for the seed planted next there
--    (an hour, login-rules.ts LOGIN_START_MAX_AGE_S): only the SHA-256 of the device's cookie token is stored, as for
--    sessions and garden links, and used_at marks it spent (the app role cannot delete; scripts/prune-identity.mjs
--    removes old rows).
-- 3. meadow_app may read and add rows, and change only those two times. Row-level security and the app's one policy,
--    as on every other table (0003_party_hardening.sql).
--
-- The order, because the dev server, Preview and production share one database:
--   1. apply this migration (scripts/migrate.mjs);
--   2. deploy the build that offers Google sign-in. Until its settings are on Vercel (GOOGLE_CLIENT_ID,
--      GOOGLE_CLIENT_SECRET, MEADOW_LOGIN_KEY), that build plants as before, without signing in.
-- New tables only, so the live site is not held up while this is applied.
--
-- db/lockdown.sql runs after this file inside the same transaction (scripts/migrate.mjs) and asserts the result.
-- Idempotent.

create table if not exists meadow.logins (
  subject_hash  bytea primary key check (octet_length(subject_hash) = 32),
  person_id     uuid not null unique references meadow.people (id) on delete cascade,
  created_at    timestamptz not null default now(),
  last_used_at  timestamptz not null default now()
);

create table if not exists meadow.login_starts (
  token_hash    bytea primary key check (octet_length(token_hash) = 32),
  subject_hash  bytea not null check (octet_length(subject_hash) = 32),
  created_at    timestamptz not null default now(),
  used_at       timestamptz
);

alter table meadow.logins enable row level security;
alter table meadow.login_starts enable row level security;

grant select, insert on meadow.logins, meadow.login_starts to meadow_app;
grant update (last_used_at) on meadow.logins to meadow_app;
grant update (used_at) on meadow.login_starts to meadow_app;

drop policy if exists meadow_app_all on meadow.logins;
create policy meadow_app_all on meadow.logins as permissive for all to meadow_app using (true) with check (true);
drop policy if exists meadow_app_all on meadow.login_starts;
create policy meadow_app_all on meadow.login_starts as permissive for all to meadow_app using (true) with check (true);
