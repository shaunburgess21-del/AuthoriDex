-- Idempotent catch-up for P0 content moderation schema.
-- Mirrors migrations/0100_content_moderation.sql for `npm run db:ensure`.

DO $$ BEGIN
  CREATE TYPE comment_moderation_status AS ENUM ('visible', 'hidden');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE moderation_decision AS ENUM ('allow', 'review', 'auto_hide');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE moderation_event_status AS ENUM ('pending', 'approved', 'removed', 'dismissed');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE public.comments
  ADD COLUMN IF NOT EXISTS moderation_status comment_moderation_status NOT NULL DEFAULT 'visible';

CREATE INDEX IF NOT EXISTS comments_moderation_status_idx
  ON public.comments (moderation_status);

CREATE TABLE IF NOT EXISTS public.moderation_events (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  content_type text NOT NULL,
  content_id varchar NOT NULL,
  author_id varchar,
  decision moderation_decision NOT NULL,
  status moderation_event_status NOT NULL DEFAULT 'pending',
  provider text NOT NULL,
  flagged boolean NOT NULL DEFAULT false,
  scores jsonb,
  matched_categories jsonb,
  sample_text text,
  metadata jsonb,
  reviewed_by varchar,
  reviewed_at timestamptz,
  review_note text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS moderation_events_status_created_idx
  ON public.moderation_events (status, created_at DESC);

CREATE INDEX IF NOT EXISTS moderation_events_content_idx
  ON public.moderation_events (content_type, content_id);

CREATE INDEX IF NOT EXISTS moderation_events_author_idx
  ON public.moderation_events (author_id);

ALTER TABLE public.moderation_events ENABLE ROW LEVEL SECURITY;
