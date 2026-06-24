-- Secondary category labels + insight_votes unique constraint
--
-- Captures schema state that was previously applied ad-hoc:
--   1. secondary_categories text[] on the 7 category-bearing tables. This is a
--      filtering/discovery overlay only (the displayed pill stays the primary
--      `category`); no scoring, market, or settlement logic reads it.
--   2. The insight_votes (user_id, insight_id) unique constraint that backs the
--      one-vote-per-user-per-insight invariant.
--
-- Authored idempotently (IF NOT EXISTS / DO $$ guard) so re-running against an
-- environment that already has these objects is a safe no-op, and a fresh DB
-- gets them with no truncation.

ALTER TABLE public.tracked_people
  ADD COLUMN IF NOT EXISTS secondary_categories text[] NOT NULL DEFAULT '{}';
--> statement-breakpoint

ALTER TABLE public.trending_people
  ADD COLUMN IF NOT EXISTS secondary_categories text[] NOT NULL DEFAULT '{}';
--> statement-breakpoint

ALTER TABLE public.face_offs
  ADD COLUMN IF NOT EXISTS secondary_categories text[] NOT NULL DEFAULT '{}';
--> statement-breakpoint

ALTER TABLE public.trending_polls
  ADD COLUMN IF NOT EXISTS secondary_categories text[] NOT NULL DEFAULT '{}';
--> statement-breakpoint

ALTER TABLE public.opinion_polls
  ADD COLUMN IF NOT EXISTS secondary_categories text[] NOT NULL DEFAULT '{}';
--> statement-breakpoint

ALTER TABLE public.prediction_markets
  ADD COLUMN IF NOT EXISTS secondary_categories text[] NOT NULL DEFAULT '{}';
--> statement-breakpoint

ALTER TABLE public.induction_candidates
  ADD COLUMN IF NOT EXISTS secondary_categories text[] NOT NULL DEFAULT '{}';
--> statement-breakpoint

-- De-dup any (user_id, insight_id) collisions before adding the constraint,
-- keeping the most recent vote. No-op when there are no duplicates.
DELETE FROM public.insight_votes a
USING public.insight_votes b
WHERE a.user_id = b.user_id
  AND a.insight_id = b.insight_id
  AND a.voted_at < b.voted_at;
--> statement-breakpoint

-- Break exact voted_at ties (keep lowest id) so the unique add can't fail.
DELETE FROM public.insight_votes a
USING public.insight_votes b
WHERE a.user_id = b.user_id
  AND a.insight_id = b.insight_id
  AND a.voted_at = b.voted_at
  AND a.id > b.id;
--> statement-breakpoint

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'insight_votes_user_id_insight_id_unique'
      AND conrelid = 'public.insight_votes'::regclass
  ) THEN
    ALTER TABLE public.insight_votes
      ADD CONSTRAINT insight_votes_user_id_insight_id_unique UNIQUE (user_id, insight_id);
  END IF;
END $$;
