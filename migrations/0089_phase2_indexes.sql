-- Phase 2 performance & cost controls.
--
-- 1) Three indexes for production hotspots:
--    - amm_price_snapshots(recorded_at): the new retention DELETE prunes by
--      age; existing indexes all lead with market_id so an age-bounded
--      delete would seq-scan ~3M rows without this.
--    - market_bets(status, settled_at): leaderboard period filters and the
--      weekly digest query on settled bets — settled_at was unindexed.
--    - market_bets(user_id, created_at DESC): /api/me/predictions and the
--      profile bet tabs (ORDER BY created_at DESC per user); the existing
--      (user_id, status) index can't serve the ordering.
--    Mirrors index(...) declarations in shared/schema.ts.
--
-- 2) llm_daily_spend: persisted daily LLM budget counters, keyed by
--    (feature, day). Replaces the in-memory-only counters in
--    server/agents/worldMarketBudget.ts / nativeMarketBudget.ts whose caps
--    reset on every redeploy. Backend-only (service role); RLS enabled with
--    no policies, matching the other backend tables (migration 0074).
--
-- Idempotent (IF NOT EXISTS) so re-running on deploy is a safe no-op.
-- Not CONCURRENTLY: db-deploy-migrate.cjs runs each migration in a txn.

CREATE INDEX IF NOT EXISTS amm_price_snapshots_recorded_at_idx
  ON public.amm_price_snapshots (recorded_at);

CREATE INDEX IF NOT EXISTS market_bets_status_settled_at_idx
  ON public.market_bets (status, settled_at);

CREATE INDEX IF NOT EXISTS market_bets_user_created_idx
  ON public.market_bets (user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS public.llm_daily_spend (
  feature text NOT NULL,
  day date NOT NULL,
  spend_usd numeric NOT NULL DEFAULT 0,
  calls integer NOT NULL DEFAULT 0,
  updated_at timestamp NOT NULL DEFAULT now(),
  CONSTRAINT llm_daily_spend_pk PRIMARY KEY (feature, day)
);

ALTER TABLE public.llm_daily_spend ENABLE ROW LEVEL SECURITY;
