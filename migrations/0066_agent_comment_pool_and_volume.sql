-- Agent comment volume: reduce per-sweep comment chance by ~25% for the V2 cohort.
-- Hybrid parent pool (recent + random explore) is code-only in commentParentPool.ts.
--
-- Targets ~7–8 quality comments/day (down from ~10). weeklyCommentCap unchanged.
-- Idempotent: safe to re-run. Only touches V2 cohort rows with simulation_profile JSON.

UPDATE "agent_configs"
SET "simulation_profile" = jsonb_set(
  "simulation_profile",
  '{dailyCommentChance}',
  CASE
    WHEN "simulation_profile" ->> 'personaBand' = 'noisy' THEN '0.034'::jsonb
    WHEN "simulation_profile" ->> 'personaBand' = 'casual' THEN '0.020'::jsonb
    ELSE '0.013'::jsonb
  END,
  true
),
"updated_at" = NOW()
WHERE "simulation_profile" IS NOT NULL
  AND "simulation_profile" ->> 'cohortId' = 'v2-2026-prelaunch';
