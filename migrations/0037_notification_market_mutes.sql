-- Per-user "mute updates from this market" preferences.
--
-- Composes with the broader category toggles in `notification_preferences`:
-- a category like "predictions" covers all market-related signals, but a
-- user occasionally wants to drop a specific market they've left running
-- (e.g. a hate-watch jackpot ticket they don't want to get pinged about
-- closing). One row per (user, market) makes that addressable, indexable,
-- and trivial to enumerate for the settings panel.
--
-- Cascading delete on both sides: when a user is deleted we drop their
-- mute list; when a market is deleted (rare — usually we soft-archive)
-- the row goes with it. Either way no stale rows linger.

CREATE TABLE IF NOT EXISTS public.notification_market_mutes (
  user_id varchar NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  market_id varchar NOT NULL REFERENCES public.prediction_markets(id) ON DELETE CASCADE,
  created_at timestamp NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, market_id)
);

CREATE INDEX IF NOT EXISTS idx_notification_market_mutes_user ON public.notification_market_mutes(user_id);
CREATE INDEX IF NOT EXISTS idx_notification_market_mutes_market ON public.notification_market_mutes(market_id);

ALTER TABLE public.notification_market_mutes ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'notification_market_mutes'
      AND policyname = 'notification_market_mutes_owner_all'
  ) THEN
    CREATE POLICY "notification_market_mutes_owner_all" ON public.notification_market_mutes
      FOR ALL
      TO authenticated
      USING (auth.uid()::text = user_id)
      WITH CHECK (auth.uid()::text = user_id);
  END IF;
END $$;
