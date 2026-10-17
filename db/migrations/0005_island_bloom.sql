-- The tropical flower's new name, from 17 Oct 2026: its species key "tefiti" becomes "island" (the Island Bloom), at
-- the owner's request, so nothing on the site leans on a film character's name. The flower itself is unchanged.
--
-- 1. plants.species: a planting under the old key moves to the new one (the database holds no plants today; this is
--    for safety), and the check then lists the six keys lib/server/validate.ts SPECIES_IDS accepts. 0001_foundation.sql
--    created the check without a name, so it carries Postgres's default name, plants_species_check.
-- 2. Checkpoints are left alone. They are a cache whose saved state may still name the old key, but SIM_VERSION 7
--    (this rename only) makes the server rebuild every SIM_VERSION 6 checkpoint from its planting row, which names the
--    new key after step 1, and its events.
--
-- db/lockdown.sql runs after this file inside the same transaction (scripts/migrate.mjs) and asserts the result.
-- Idempotent.

alter table meadow.plants drop constraint if exists plants_species_check;
update meadow.plants set species = 'island' where species = 'tefiti';
alter table meadow.plants add constraint plants_species_check
  check (species in ('rose', 'sundrop', 'magnolia', 'marigold', 'island', 'jasmine'));
