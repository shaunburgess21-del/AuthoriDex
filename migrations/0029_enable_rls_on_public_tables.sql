-- Enable Row Level Security on all currently non-RLS tables in public schema.
-- Source of truth list captured from:
--   SELECT tablename
--   FROM pg_tables
--   WHERE schemaname = 'public' AND rowsecurity = false
--   ORDER BY tablename;
--
-- Strategy:
-- - Backend-only tables: enable RLS without adding policies (blocks anon Data API access).
-- - Frontend-queried user tables: add owner-only policies for authenticated users.
--
-- NOTE: user_votes.user_id and user_favourites.user_id are varchar, so auth.uid()
-- must be cast to text in policy predicates.

-- Backend-only tables (RLS enabled, no policies)
ALTER TABLE public.admin_audit_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agent_configs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agent_memory ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agent_performance ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.api_cache ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.approval_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.card_related_people ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.celebrity_images ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.celebrity_metrics ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.celebrity_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.celebrity_value_votes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.comment_reports ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.comment_votes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.comments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.community_insights ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.credit_ledger ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.face_off_votes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.face_offs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.image_flags ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.image_votes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.induction_candidates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.induction_cycle_results ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.induction_votes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ingestion_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.insight_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.insight_votes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.market_bets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.market_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.opinion_poll_options ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.opinion_poll_votes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.opinion_polls ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.page_views ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.platform_insights ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.platform_status ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.prediction_markets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.profile_item_privacy ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ranks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.scheduled_agent_actions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.schema_migrations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sentiment_votes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.suggestions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tier1_overrides ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tracked_people ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.trend_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.trending_people ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.trending_poll_votes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.trending_polls ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.votes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.xp_actions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.xp_ledger ENABLE ROW LEVEL SECURITY;

-- User-owned frontend tables (RLS enabled with owner-only policies)
ALTER TABLE public.user_votes ENABLE ROW LEVEL SECURITY;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'user_votes'
      AND policyname = 'user_votes_owner_all'
  ) THEN
    CREATE POLICY "user_votes_owner_all" ON public.user_votes
      FOR ALL
      TO authenticated
      USING (auth.uid()::text = user_id)
      WITH CHECK (auth.uid()::text = user_id);
  END IF;
END $$;

ALTER TABLE public.user_favourites ENABLE ROW LEVEL SECURITY;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'user_favourites'
      AND policyname = 'user_favourites_owner_all'
  ) THEN
    CREATE POLICY "user_favourites_owner_all" ON public.user_favourites
      FOR ALL
      TO authenticated
      USING (auth.uid()::text = user_id)
      WITH CHECK (auth.uid()::text = user_id);
  END IF;
END $$;
