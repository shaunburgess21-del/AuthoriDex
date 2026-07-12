-- Sentiment Poll: Support/Oppose -> Agree/Disagree (full rename).
-- Data-preserving: update stored choice values, then rename seed columns.

-- 1) Vote rows
UPDATE public.trending_poll_votes
SET choice = 'agree', updated_at = NOW()
WHERE choice = 'support';

UPDATE public.trending_poll_votes
SET choice = 'disagree', updated_at = NOW()
WHERE choice = 'oppose';

-- 2) Vote action audit trail
UPDATE public.vote_actions
SET prev_value = 'agree'
WHERE vote_type = 'trending_poll' AND prev_value = 'support';

UPDATE public.vote_actions
SET prev_value = 'disagree'
WHERE vote_type = 'trending_poll' AND prev_value = 'oppose';

UPDATE public.vote_actions
SET next_value = 'agree'
WHERE vote_type = 'trending_poll' AND next_value = 'support';

UPDATE public.vote_actions
SET next_value = 'disagree'
WHERE vote_type = 'trending_poll' AND next_value = 'oppose';

-- 3) Credit ledger metadata.choice — support/oppose are sentiment-poll-specific values
UPDATE public.credit_ledger
SET metadata = jsonb_set(metadata, '{choice}', '"agree"'::jsonb, true)
WHERE metadata IS NOT NULL
  AND metadata->>'choice' = 'support';

UPDATE public.credit_ledger
SET metadata = jsonb_set(metadata, '{choice}', '"disagree"'::jsonb, true)
WHERE metadata IS NOT NULL
  AND metadata->>'choice' = 'oppose';

-- 4) Rename seed columns (idempotent)
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'trending_polls'
      AND column_name = 'seed_support_count'
  ) THEN
    ALTER TABLE public.trending_polls
      RENAME COLUMN seed_support_count TO seed_agree_count;
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'trending_polls'
      AND column_name = 'seed_oppose_count'
  ) THEN
    ALTER TABLE public.trending_polls
      RENAME COLUMN seed_oppose_count TO seed_disagree_count;
  END IF;
END $$;
