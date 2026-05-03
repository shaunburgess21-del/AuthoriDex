-- Track whether a user explicitly unsubscribed via one-click email link.
-- This is admin-visible state and intentionally separate from placeholder
-- notification email/push flags so support can verify unsubscribe behavior.

CREATE TABLE IF NOT EXISTS public.email_unsubscribe_state (
  user_id varchar PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
  channel text NOT NULL DEFAULT 'marketing_lifecycle',
  source text NOT NULL DEFAULT 'email_link',
  token_hash text,
  unsubscribed_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS email_unsubscribe_state_unsubscribed_at_idx
  ON public.email_unsubscribe_state (unsubscribed_at DESC);

-- Backend-only table: never queried directly by anon/authenticated clients.
ALTER TABLE public.email_unsubscribe_state DISABLE ROW LEVEL SECURITY;
