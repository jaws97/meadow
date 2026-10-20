-- The eighth seed, from 20 Oct 2026: the Pink Lily, a pink Oriental lily of our own (no film), a soil flower grown in
-- the garden bed by the soil model like the other six (lib/sim/model.ts, SIM_VERSION 7, unchanged).
--
-- 1. plants.species: the check lists the eight keys lib/server/validate.ts SPECIES_IDS accepts, in its order (the lily
--    after the jasmine, the lotus still last). Its name is Postgres's default, plants_species_check (0001_foundation.sql
--    created it unnamed; 0005_island_bloom.sql and 0006_lotus.sql re-created it by name). No row changes.
-- 2. Nothing else. plant_events.kind is unchanged: the lily is cared for with the bed's own actions. A lily checkpoint
--    stores sim_version 7, as the six other soil flowers do (the lotus 1001), so no checkpoint is rebuilt.
--
-- The order, because the dev server, Preview and production share one database:
--   1. apply this migration;
--   2. deploy the build that offers the Pink Lily.
-- No guard-first deploy is needed this time: the unknown-species guard (lib/server/species-guard.ts) has been live since
-- the Lotus, so a build that does not know the lily (the live one until step 2, or one rolled back past it) leaves a
-- lily out of the shared Meadow snapshot instead of failing it. And the build that offers the lily sends a lily only to
-- a page that says it knows eight seeds (?seeds=8, species-guard.ts seenBy), so a Meadow tab left open across the
-- deploy never meets one it cannot draw. A build that offers the lily against a database without
-- this migration answers a lily planting with a calm 409 (seed_not_ready, lib/server/garden.ts plantSeed) and plants
-- nothing.
--
-- The live site keeps running while this is applied, and re-creating the check takes an exclusive lock on meadow.plants
-- (held only for the moment it takes to check the rows). Waiting for that lock behind a long query would queue every
-- request that reads the plants behind this migration, so it waits at most 3 seconds and otherwise fails and rolls back
-- with nothing changed: run scripts/migrate.mjs again a moment later. The limit lasts only for this transaction.
--
-- db/lockdown.sql runs after this file inside the same transaction (scripts/migrate.mjs) and asserts the result.
-- Idempotent.

set local lock_timeout = '3s';

alter table meadow.plants drop constraint if exists plants_species_check;
alter table meadow.plants add constraint plants_species_check
  check (species in ('rose', 'sundrop', 'magnolia', 'marigold', 'island', 'jasmine', 'lily', 'lotus'));
