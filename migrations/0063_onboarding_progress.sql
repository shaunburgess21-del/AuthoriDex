-- Multi-step onboarding flow — progress tracking.
--
-- Adds two columns to `profiles`:
--   onboarding_step          — highest step the user has reached (0..5).
--                              Steps: 0 Welcome, 1 Year, 2 Gender,
--                              3 Country, 4 Interests, 5 Completion.
--   onboarding_completed_at  — timestamp when the user reached the
--                              completion screen. NULL = still in flow.
--                              The NewUserGate keys on this — only users
--                              with a non-null timestamp are released
--                              into the rest of the app.
--
-- Numbered 0063 because two unrelated 0062_*.sql files already live in
-- this directory (the journal lists 0062_parimutuel_sunset_creation_gates;
-- 0062_demographic_visibility_split was applied out-of-band). Bumping past
-- the collision keeps the journal monotonic.
--
-- Backfill: every existing user with `tos_accepted_at` set is treated as
-- a completed-onboarding account so they don't get sent back through the
-- flow on next login. We mirror tos_accepted_at into
-- onboarding_completed_at so the historical "they accepted ToS at T"
-- timeline is preserved on the new column instead of stamping NOW().

ALTER TABLE "profiles"
  ADD COLUMN IF NOT EXISTS "onboarding_step" integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "onboarding_completed_at" timestamptz DEFAULT NULL;

UPDATE "profiles"
   SET "onboarding_completed_at" = "tos_accepted_at",
       "onboarding_step" = 5
 WHERE "tos_accepted_at" IS NOT NULL
   AND "onboarding_completed_at" IS NULL;
