-- Vote Scout Approve to Draft: track created draft ids.
ALTER TABLE public.vote_scout_ideas
  ADD COLUMN IF NOT EXISTS approved_as_id text;
ALTER TABLE public.vote_scout_ideas
  ADD COLUMN IF NOT EXISTS approved_as_type text;
