-- Opinion Poll Option Suggestions
-- Community-suggested options awaiting admin approval. Users suggest a missing
-- option on an existing opinion poll, the community upvotes suggestions, and an
-- admin promotes a suggestion into a real opinion_poll_options row.
--
-- Both tables are server-only (written exclusively by the API via the Drizzle
-- service-role connection, never queried directly by the client). We enable RLS
-- without policies to match the posture of opinion_polls / opinion_poll_options
-- / opinion_poll_votes (migration 0029).

CREATE TABLE IF NOT EXISTS public.opinion_poll_option_suggestions (
  id                  varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  poll_id             varchar NOT NULL REFERENCES public.opinion_polls(id) ON DELETE CASCADE,
  name                text NOT NULL,
  image_url           text,
  person_id           varchar REFERENCES public.tracked_people(id) ON DELETE SET NULL,
  suggested_by        varchar NOT NULL,
  status              text NOT NULL DEFAULT 'pending',
  reviewed_by         varchar,
  reviewed_at         timestamp,
  admin_notes         text,
  approved_option_id  varchar,
  created_at          timestamp NOT NULL DEFAULT now(),
  updated_at          timestamp NOT NULL DEFAULT now()
);
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS opinion_poll_option_suggestions_poll_status_idx
  ON public.opinion_poll_option_suggestions (poll_id, status);
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS opinion_poll_option_suggestions_suggested_by_idx
  ON public.opinion_poll_option_suggestions (suggested_by);
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS public.opinion_poll_option_suggestion_votes (
  id              varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  suggestion_id   varchar NOT NULL REFERENCES public.opinion_poll_option_suggestions(id) ON DELETE CASCADE,
  poll_id         varchar NOT NULL REFERENCES public.opinion_polls(id) ON DELETE CASCADE,
  user_id         varchar NOT NULL,
  created_at      timestamp NOT NULL DEFAULT now(),
  CONSTRAINT opinion_poll_option_suggestion_votes_unique UNIQUE (suggestion_id, user_id)
);
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS opinion_poll_option_suggestion_votes_suggestion_idx
  ON public.opinion_poll_option_suggestion_votes (suggestion_id);
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS opinion_poll_option_suggestion_votes_poll_idx
  ON public.opinion_poll_option_suggestion_votes (poll_id);
--> statement-breakpoint

ALTER TABLE public.opinion_poll_option_suggestions ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint

ALTER TABLE public.opinion_poll_option_suggestion_votes ENABLE ROW LEVEL SECURITY;
