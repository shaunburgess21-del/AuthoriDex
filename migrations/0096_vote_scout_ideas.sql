-- Vote Scout / Idea Scout: admin-only ideation drafts for Matchups,
-- Sentiment Polls, and Opinion Polls. Never auto-publishes.
CREATE TABLE IF NOT EXISTS public.vote_scout_ideas (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  content_type text NOT NULL,
  mode text NOT NULL,
  payload jsonb NOT NULL,
  image_prompt text,
  rationale text,
  fit_score integer,
  suggested_end_at timestamp,
  status text NOT NULL DEFAULT 'new',
  reviewed_by varchar REFERENCES public.profiles(id) ON DELETE SET NULL,
  reviewed_at timestamp,
  created_at timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS vote_scout_ideas_status_created_idx
  ON public.vote_scout_ideas (status, created_at);
CREATE INDEX IF NOT EXISTS vote_scout_ideas_content_type_idx
  ON public.vote_scout_ideas (content_type);
CREATE INDEX IF NOT EXISTS vote_scout_ideas_mode_idx
  ON public.vote_scout_ideas (mode);

-- Backend-only via service role / Express; no anon policies.
ALTER TABLE public.vote_scout_ideas ENABLE ROW LEVEL SECURITY;
