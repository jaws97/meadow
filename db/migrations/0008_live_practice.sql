-- Practice plantings on the live site, from 20 Oct 2026: until the game clock starts (10 Nov 00:00 IST) every planting
-- through the production deployment is a practice one, so colleagues can test the live site with the party link
-- (lib/server/env.ts). The live Meadow shows those practice plants, but never the ones planted through the local dev
-- server or a Preview, which share this database: a developer's 60 seeded test gardens must not appear on the party
-- screen or in the Meadow colleagues are testing, and production must not catch them up.
--
-- 1. plants.live_practice: true for a practice plant planted through production, set when the plant is inserted (like
--    plants.rehearsal, never inferred later). A check keeps it to practice plants. Existing rows read false: on
--    20 Oct 2026 the shared database held no plants at all.
-- 2. Nothing else. No row changes.
--
-- Apply this before deploying the build that writes the column; the build before it never names the column, so it
-- keeps working meanwhile.
--
-- db/lockdown.sql runs after this file inside the same transaction (scripts/migrate.mjs) and asserts the result.
-- Idempotent.

alter table meadow.plants add column if not exists live_practice boolean not null default false;
alter table meadow.plants drop constraint if exists plants_live_practice_check;
alter table meadow.plants add constraint plants_live_practice_check check (rehearsal or not live_practice);
