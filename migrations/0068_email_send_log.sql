-- Durable idempotency log for outbound emails. Prevents duplicate sends when
-- cron jobs or webhooks retry across process restarts / Railway deploys.
-- Backend-only: never queried by authenticated clients.

CREATE TABLE IF NOT EXISTS public.email_send_log (
  idempotency_key text PRIMARY KEY,
  user_id varchar REFERENCES public.profiles(id) ON DELETE CASCADE,
  category text NOT NULL,
  template text NOT NULL,
  sent_at timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS email_send_log_user_sent_at_idx
  ON public.email_send_log (user_id, sent_at DESC);

ALTER TABLE public.email_send_log DISABLE ROW LEVEL SECURITY;
