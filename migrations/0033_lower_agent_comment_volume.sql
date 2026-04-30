-- Lower comment volume for the V2 agent cohort.
--
-- Background: comments now go through GPT (gpt-5.4) with full surface
-- context, so we want fewer but higher-quality comments. Previous defaults
-- targeted ~22 comments/day platform-wide, which read chatty and bot-like
-- on real prediction markets. We're tightening to ~3-6 quality comments/day.
--
-- Idempotent: safe to re-run. Only touches V2 cohort rows that have a
-- simulation_profile JSON, leaves any legacy / null profile untouched.

UPDATE "agent_configs"
SET "simulation_profile" = jsonb_set(
  jsonb_set(
    "simulation_profile",
    '{weeklyCommentCap}',
    '1'::jsonb,
    true
  ),
  '{dailyCommentChance}',
  CASE
    WHEN "simulation_profile" ->> 'personaBand' = 'noisy' THEN '0.14'::jsonb
    WHEN "simulation_profile" ->> 'personaBand' = 'casual' THEN '0.08'::jsonb
    ELSE '0.05'::jsonb
  END,
  true
),
"updated_at" = NOW()
WHERE "simulation_profile" IS NOT NULL
  AND "simulation_profile" ->> 'cohortId' = 'v2-2026-prelaunch';
