-- Per-user notification preferences. One row per user; lazy-created on
-- first GET /api/me/notification-preferences. In-app channel toggles are
-- live; email + push columns are reserved for Phase 2 (the UI shows them
-- as disabled "Coming soon"). Storing them now keeps the data model
-- multi-channel from day one without a follow-up migration.

CREATE TABLE IF NOT EXISTS public.notification_preferences (
  user_id varchar PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,

  predictions_in_app boolean NOT NULL DEFAULT true,
  favorites_in_app boolean NOT NULL DEFAULT true,
  social_in_app boolean NOT NULL DEFAULT true,
  account_in_app boolean NOT NULL DEFAULT true,
  system_in_app boolean NOT NULL DEFAULT true,

  predictions_email boolean NOT NULL DEFAULT false,
  favorites_email boolean NOT NULL DEFAULT false,
  social_email boolean NOT NULL DEFAULT false,
  account_email boolean NOT NULL DEFAULT false,
  system_email boolean NOT NULL DEFAULT false,

  predictions_push boolean NOT NULL DEFAULT false,
  favorites_push boolean NOT NULL DEFAULT false,
  social_push boolean NOT NULL DEFAULT false,
  account_push boolean NOT NULL DEFAULT false,
  system_push boolean NOT NULL DEFAULT false,

  updated_at timestamp NOT NULL DEFAULT now()
);

ALTER TABLE public.notification_preferences ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'notification_preferences'
      AND policyname = 'notification_preferences_owner_all'
  ) THEN
    CREATE POLICY "notification_preferences_owner_all" ON public.notification_preferences
      FOR ALL
      TO authenticated
      USING (auth.uid()::text = user_id)
      WITH CHECK (auth.uid()::text = user_id);
  END IF;
END $$;
