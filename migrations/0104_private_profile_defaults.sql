-- New accounts default to a private profile and hidden open predictions.
--
-- `ALTER COLUMN ... SET DEFAULT` changes the default for future inserts
-- only. It does not rewrite existing rows. There is intentionally no
-- UPDATE on profiles — saved privacy settings stay as they are.
--
-- POST /api/profile/sync also sets both flags false on the insert, so a
-- new account is private even if this migration has not run yet.
-- Simulation agents set the columns true themselves and are not affected.

ALTER TABLE public.profiles
  ALTER COLUMN is_public SET DEFAULT false;
--> statement-breakpoint

ALTER TABLE public.profiles
  ALTER COLUMN positions_public SET DEFAULT false;
--> statement-breakpoint

-- Help chat quotes xp_actions.description. Replace only the known stale
-- 1–10 sentence. A description an admin has edited is left alone.
UPDATE public.xp_actions
SET description = 'Agree, Neutral, or Disagree on a sentiment poll'
WHERE action_key = 'vote_sentiment'
  AND description IN (
    'Vote on celebrity sentiment (1-10 scale)',
    'Vote on celebrity sentiment (1–10 scale)'
  );
