-- Ranks overhaul (Sprint: ranks rebuild).
--
-- Adds a single column that closes the long-standing gap in the rank
-- state machine:
--
--   * highest_rank — peak rank the user has ever reached, by name.
--     Survives any future threshold rebalance that demotes users at
--     the bottom of a tier so we can show "your peak was N" in the
--     UI without relying on the notifications log (which is
--     idempotency-keyed on (user, rank) and would not survive a
--     re-promotion to the same tier).
--
-- Backfill: copy the current rank into highest_rank for every row.
-- That's the safest approximation today because there is no
-- demotion path in the code, so current rank IS the historical peak
-- for existing users. Future migrations that change thresholds
-- should leave this column alone (no recomputation) — preserving
-- the "I once was Maven" memory is the whole point.
--
-- Companion change: server/scripts/seed-gamification.ts now imports
-- the canonical ladder from shared/rank-config.ts, and the
-- `ranks` table is reseeded against the rebalanced thresholds in
-- the same change-set.

ALTER TABLE "profiles"
  ADD COLUMN IF NOT EXISTS "highest_rank" text;

UPDATE "profiles"
SET "highest_rank" = "rank"
WHERE "highest_rank" IS NULL;
