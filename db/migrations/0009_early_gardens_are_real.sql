-- Gardens planted before the party are real, from 20 Oct 2026: the owner asked that the first plantings on the live site
-- (open since 20 Oct for anyone with the party link) "also grow" rather than be practice ones. The build before this
-- one marked them plants.rehearsal and plants.live_practice (0008); the build this follows plants real gardens and never
-- reads live_practice.
--
-- 1. The live site's practice plantings become real: rehearsal = false. (scripts/convert-early-gardens.mjs, run first,
--    also moves them from the outer end of the rings to the inner plots real plantings take; this catches any left.)
-- 2. Checkpoints of every plant planted before the party hour are rebuilt from their planting (sim_version 0 makes the
--    server replay them, lib/server/catchup.ts baseState): they were written with the soil model's old "not yet" marks
--    (-1, -99), which collide with real hours before 10 Nov; the model now sets those marks below the planting hour
--    (lib/sim/model.ts createPlant), so a flower that opens before 10 Nov keeps that hour. The new build already
--    rebuilds such a state by itself (lib/sim/plant.ts isCurrentState); this makes sure every one is. Plantings on or
--    after 10 Nov are untouched (none existed on 20 Oct).
-- 3. plants.live_practice and its check go: the live Meadow never shows practice plants now (lib/server/env.ts).
--
-- Apply only once the build that no longer names live_practice is live (the one before it inserts the column).
--
-- db/lockdown.sql runs after this file inside the same transaction (scripts/migrate.mjs) and asserts the result.
-- Idempotent.

do $$
begin
  if exists (select 1 from information_schema.columns
             where table_schema = 'meadow' and table_name = 'plants' and column_name = 'live_practice') then
    -- both at once: plants_live_practice_check (rehearsal or not live_practice) holds until it is dropped below
    execute 'update meadow.plants set rehearsal = false, live_practice = false where live_practice';
  end if;
end $$;

-- version moves on too, so a catch-up already computed from the old checkpoint fails its optimistic check and reloads
-- rather than writing the old marks back (as recordCare and sprinkle invalidate a checkpoint)
update meadow.checkpoints set sim_version = 0, version = version + 1
  where plant_id in (select id from meadow.plants where planted_h < 15) and sim_version <> 0;

alter table meadow.plants drop constraint if exists plants_live_practice_check;
alter table meadow.plants drop column if exists live_practice;
