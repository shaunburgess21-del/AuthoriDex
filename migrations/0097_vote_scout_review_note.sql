-- Optional founder feedback on Idea Scout keep/dismiss verdicts.
ALTER TABLE public.vote_scout_ideas
  ADD COLUMN IF NOT EXISTS review_note text;
