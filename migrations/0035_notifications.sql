-- In-app notifications system: per-user inbox of events.
-- Multi-channel ready (in_app today; email/push columns reserved on
-- notification_preferences in 0036). Insertion is server-side only via
-- the service role; clients only read/update their own rows.
--
-- Idempotency: (user_id, idempotency_key) is unique so derivation jobs
-- (rank crossings, hot mover, etc.) can re-run safely without spamming.

CREATE TABLE IF NOT EXISTS public.notifications (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id varchar NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  kind text NOT NULL,
  category text NOT NULL,
  title text NOT NULL,
  body text,
  href text,
  actor_user_id varchar,
  entity_type text,
  entity_id text,
  metadata jsonb,
  priority integer NOT NULL DEFAULT 0,
  group_key text,
  idempotency_key text NOT NULL,
  seen_at timestamp,
  read_at timestamp,
  dismissed_at timestamp,
  created_at timestamp NOT NULL DEFAULT now(),
  CONSTRAINT notifications_user_idempotency_unique UNIQUE (user_id, idempotency_key)
);

-- Hot path: list unread notifications newest-first per user.
CREATE INDEX IF NOT EXISTS notifications_user_unread_idx
  ON public.notifications (user_id, read_at, created_at DESC);

-- Used by the bell badge and the archive page filtering by category.
CREATE INDEX IF NOT EXISTS notifications_user_kind_idx
  ON public.notifications (user_id, kind, created_at DESC);

CREATE INDEX IF NOT EXISTS notifications_user_category_idx
  ON public.notifications (user_id, category, created_at DESC);

-- Lets us efficiently exclude soft-dismissed rows from the inbox view
-- without scanning the whole row set.
CREATE INDEX IF NOT EXISTS notifications_user_active_idx
  ON public.notifications (user_id, created_at DESC)
  WHERE dismissed_at IS NULL;

ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;

-- Read policy: each user can only see their own notifications.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'notifications'
      AND policyname = 'notifications_owner_select'
  ) THEN
    CREATE POLICY "notifications_owner_select" ON public.notifications
      FOR SELECT
      TO authenticated
      USING (auth.uid()::text = user_id);
  END IF;
END $$;

-- Update policy: users can mark their own notifications read/seen/dismissed.
-- Inserts are intentionally NOT exposed to authenticated — the service
-- role (server) is the only writer.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'notifications'
      AND policyname = 'notifications_owner_update'
  ) THEN
    CREATE POLICY "notifications_owner_update" ON public.notifications
      FOR UPDATE
      TO authenticated
      USING (auth.uid()::text = user_id)
      WITH CHECK (auth.uid()::text = user_id);
  END IF;
END $$;

-- Enable Realtime broadcast so the client-side useNotificationsRealtime
-- hook can subscribe to inserts filtered by user_id. Wrapped to be a
-- no-op on databases that don't have the supabase_realtime publication
-- (e.g. plain Postgres dev instances) so this migration is portable.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime')
     AND NOT EXISTS (
       SELECT 1 FROM pg_publication_tables
       WHERE pubname = 'supabase_realtime'
         AND schemaname = 'public'
         AND tablename = 'notifications'
     ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.notifications;
  END IF;
END $$;
