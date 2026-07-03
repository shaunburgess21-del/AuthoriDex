-- Market Scout system profile.
--
-- Singleton profile that owns World Market drafts created by the automated
-- Market Scout job (server/jobs/market-scout.ts). Fixed UUID matches
-- SCOUT_PROFILE_ID in that file. Mirrors the AMM house singleton
-- (0052_amm_phase_2.sql) but holds zero credits: the scout never trades,
-- it only appears as `created_by` on scouted drafts — which also means
-- the self-resolution guard never blocks a founder admin from settling
-- scouted markets.
--
-- Idempotent.

INSERT INTO "profiles" (
  "id", "username", "role", "is_public",
  "predict_credits", "rank"
) VALUES (
  '00000000-0000-0000-0000-0000000000bb',
  '__market_scout__', 'system', false,
  0, 'Citizen'
)
ON CONFLICT ("id") DO NOTHING;
