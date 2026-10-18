-- The seventh seed, from 18 Oct 2026: the Lotus, a sacred lotus grown in its own koi pond under its own model
-- (lib/sim/pond.ts, POND_VERSION 1).
--
-- 1. plants.species: the check lists the seven keys lib/server/validate.ts SPECIES_IDS accepts. Its name is Postgres's
--    default, plants_species_check (0001_foundation.sql created it unnamed; 0005_island_bloom.sql re-created it by name).
--    No row changes.
-- 2. Nothing else. plant_events.kind is unchanged: the lotus's "Top up" is a water event and "Tend the pond" (the koi's
--    pinch and the aphid rinse) a tend event. checkpoints.sim_version stays a smallint: a lotus checkpoint stores 1001
--    (1000 + POND_VERSION), the six soil flowers 7, so the server rebuilds any checkpoint written by another model.
--
-- The order, because the dev server, Preview and production share one database:
--   1. deploy the unknown-species guard on its own (lib/server/species-guard.ts, with SPECIES_IDS still the six), so
--      production skips a species it cannot step instead of failing the shared Meadow snapshot;
--   2. apply this migration;
--   3. deploy the build that offers the Lotus.
-- A build that offers the Lotus against a database without this migration answers a Lotus planting with a calm 409
-- (seed_not_ready, lib/server/garden.ts plantSeed) and plants nothing.
--
-- db/lockdown.sql runs after this file inside the same transaction (scripts/migrate.mjs) and asserts the result.
-- Idempotent.

alter table meadow.plants drop constraint if exists plants_species_check;
alter table meadow.plants add constraint plants_species_check
  check (species in ('rose', 'sundrop', 'magnolia', 'marigold', 'island', 'jasmine', 'lotus'));
