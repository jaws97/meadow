-- Disney Garden backend foundation: the private "meadow" schema and its event-sourced tables.
--
-- Everything lives in the schema "meadow", which Supabase's Data API does not expose (it serves "public" only). Only
-- server code reaches these tables, through the private connection string; 0002_lockdown.sql revokes every privilege
-- from anon and authenticated and asserts it. Row-level security is enabled on every table here with no policies at
-- all, so even a role that somehow gained a grant would read nothing (the server's own role owns the tables and is not
-- subject to RLS).
--
-- The model: a person has one garden; a garden holds plants (one plot for now, room for more); a plant is its planting
-- row plus an append-only stream of player events, replayed against the hour-by-hour weather store (written once, never
-- changed). A checkpoint caches the replayed state at some hour so a visit only steps the hours since; it is a cache, and
-- can always be rebuilt from the planting, the events and the weather.
--
-- Idempotent: safe to run again (create ... if not exists, create or replace, drop trigger if exists).

create schema if not exists meadow;

-- Applied migrations; the runner (scripts/migrate.mjs) creates this too before it applies anything.
create table if not exists meadow.schema_migrations (
  version     text primary key,
  name        text not null,
  checksum    text not null,
  applied_at  timestamptz not null default now()
);

-- People: just a first name, and whether it shows in the shared Meadow ("A friend" otherwise).
create table if not exists meadow.people (
  id                 uuid primary key default gen_random_uuid(),
  first_name         text not null check (char_length(first_name) between 1 and 32),
  show_name          boolean not null default true,
  -- SHA-256 of the client's seed request id, so a retried POST /api/seed (a lost response on party Wi-Fi) returns the
  -- same person instead of planting a second seed
  seed_request_hash  bytea unique check (seed_request_hash is null or octet_length(seed_request_hash) = 32),
  created_at         timestamptz not null default now()
);

-- Device sessions: the httpOnly cookie carries a random 32-byte token; only its SHA-256 is stored.
create table if not exists meadow.sessions (
  token_hash    bytea primary key check (octet_length(token_hash) = 32),
  person_id     uuid not null references meadow.people (id) on delete cascade,
  created_at    timestamptz not null default now(),
  last_seen_at  timestamptz not null default now(),
  revoked_at    timestamptz
);
create index if not exists sessions_person_idx on meadow.sessions (person_id);

-- Personal garden links: open your garden on another device (a laptop, an iPad). Reusable until revoked; only the
-- SHA-256 of the token is stored, so a lost link can be replaced but never read back.
create table if not exists meadow.garden_links (
  token_hash    bytea primary key check (octet_length(token_hash) = 32),
  person_id     uuid not null references meadow.people (id) on delete cascade,
  created_at    timestamptz not null default now(),
  last_used_at  timestamptz,
  use_count     integer not null default 0,
  revoked_at    timestamptz
);
create index if not exists garden_links_person_idx on meadow.garden_links (person_id);

-- One garden per person.
create table if not exists meadow.gardens (
  id          uuid primary key default gen_random_uuid(),
  person_id   uuid not null unique references meadow.people (id) on delete cascade,
  created_at  timestamptz not null default now()
);

-- Plants. plot_index is the plant's place in the shared Meadow, handed out in planting order from the inner rings
-- outward (the ring geometry is a constant table shared with the Meadow: lib/server/plots.ts). planted_h is the game hour
-- the seed went in (hours since 10 Nov 2026 00:00 IST; negative only for rehearsal plants planted before the party).
-- generation mirrors the replayed state (1 for the first seed, 2 after a replant), kept for the Meadow snapshot.
create table if not exists meadow.plants (
  id           uuid primary key default gen_random_uuid(),
  garden_id    uuid not null references meadow.gardens (id) on delete cascade,
  garden_slot  smallint not null default 0 check (garden_slot >= 0),
  species      text not null check (species in ('rose', 'sundrop', 'magnolia', 'marigold', 'tefiti', 'jasmine')),
  seed         text not null check (char_length(seed) between 1 and 64),
  plot_index   integer not null unique check (plot_index >= 0),
  planted_h    integer not null,
  sim_version  smallint not null,
  generation   smallint not null default 1 check (generation >= 1),
  created_at   timestamptz not null default now(),
  unique (garden_id, garden_slot)
);

-- Player events, append-only. h is the game hour the event belongs to (applied at the start of that hour's step).
-- client_event_id makes retries idempotent per plant. actor_id is the giver of a sprinkle: deliberately not a foreign
-- key, so the log never changes when a person is removed and a replay always gives the same plant.
create table if not exists meadow.plant_events (
  id               bigint generated always as identity primary key,
  plant_id         uuid not null references meadow.plants (id) on delete cascade,
  h                integer not null,
  kind             text not null check (kind in ('water', 'sprinkle', 'shade', 'cover', 'feed', 'tend', 'talk', 'revive', 'replant')),
  amount           smallint check (amount in (0, 1)),
  actor_id         uuid,
  client_event_id  text not null check (client_event_id ~ '^[A-Za-z0-9_.:-]{8,64}$'),
  created_at       timestamptz not null default now(),
  unique (plant_id, client_event_id),
  check ((kind in ('shade', 'cover')) = (amount is not null)),
  check ((kind = 'sprinkle') = (actor_id is not null))
);
-- the catch-up hot path: one plant's events from its checkpoint hour on
create index if not exists plant_events_plant_h_idx on meadow.plant_events (plant_id, h, id);

-- Bangalore weather at the Disney office, one row per game hour (the Open-Meteo row stamped at the END of the hour),
-- normalised to lib/sim's HourWeather. Written once and never changed; double precision keeps every value exactly the
-- number the model steps.
create table if not exists meadow.weather_hours (
  h           integer primary key,
  t_c         double precision not null,
  rh_pct      double precision not null,
  precip_mm   double precision not null,
  sw_wm2      double precision not null,
  et0_mm      double precision not null,
  wind_kmh    double precision not null,
  soil_t_c    double precision not null,
  is_day      smallint not null check (is_day in (0, 1)),
  source      text not null,
  fetched_at  timestamptz not null default now()
);

-- The replayed state of a plant at hour h: a cache of planting + events + weather. version is the optimistic
-- concurrency token: every save and every new event bumps it, so a catch-up computed from stale inputs never lands.
create table if not exists meadow.checkpoints (
  plant_id     uuid primary key references meadow.plants (id) on delete cascade,
  h            integer not null,
  state        jsonb not null,
  sim_version  smallint not null,
  version      integer not null default 0,
  updated_at   timestamptz not null default now()
);

-- Sprinkles from friends: one per giver per IST day, whichever plant it goes to. The model counts only the first two
-- a plant receives each day; the rest are visual wishes.
create table if not exists meadow.sprinkles (
  id          bigint generated always as identity primary key,
  giver_id    uuid not null references meadow.people (id) on delete cascade,
  plant_id    uuid not null references meadow.plants (id) on delete cascade,
  ist_day     date not null,
  h           integer not null,
  event_id    bigint references meadow.plant_events (id) on delete cascade,
  created_at  timestamptz not null default now(),
  unique (giver_id, ist_day)
);
create index if not exists sprinkles_plant_day_idx on meadow.sprinkles (plant_id, ist_day);

-- Write-once guards: the event log and the weather store refuse updates (deletes stay possible for maintenance and
-- cascade from their owners).
create or replace function meadow.forbid_update() returns trigger
  language plpgsql
  set search_path = pg_catalog
as $$
begin
  raise exception 'meadow.%: rows are written once and never changed', tg_table_name using errcode = '55000';
end
$$;

drop trigger if exists plant_events_append_only on meadow.plant_events;
create trigger plant_events_append_only before update on meadow.plant_events
  for each row execute function meadow.forbid_update();

drop trigger if exists weather_hours_write_once on meadow.weather_hours;
create trigger weather_hours_write_once before update on meadow.weather_hours
  for each row execute function meadow.forbid_update();

-- Row-level security on every table, with no policies: nothing but the owning server role can see a row.
alter table meadow.schema_migrations enable row level security;
alter table meadow.people enable row level security;
alter table meadow.sessions enable row level security;
alter table meadow.garden_links enable row level security;
alter table meadow.gardens enable row level security;
alter table meadow.plants enable row level security;
alter table meadow.plant_events enable row level security;
alter table meadow.weather_hours enable row level security;
alter table meadow.checkpoints enable row level security;
alter table meadow.sprinkles enable row level security;
