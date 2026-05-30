-- Repair migration: re-create the scaling indexes from migration 0009 that
-- were silently skipped on production, and add one new composite index for
-- the markets-analytics DISTINCT ON query.
--
-- Why this is necessary
-- ----------------------
-- When the project was first deployed via scripts/db-deploy-migrate.cjs it
-- detected a pre-existing `users` table and baselined every migration up to
-- and including BASELINE_TAG = "0011_xp_ledger_user_action_date_idx" as
-- already-applied, without actually running them. That was the correct call
-- for tables/columns that already existed in the Replit-era DB, but it also
-- silently skipped 0009_add_scaling_indexes — and the indexes that migration
-- declared were never actually created in this database.
--
-- We confirmed via pg_indexes that the only indexes currently on
-- trend_snapshots are the PK, the unique constraint on (person_id, timestamp),
-- and trend_snapshots_run_id_idx. The indexes the Drizzle schema declares
-- (person_ts_idx, person_origin_ts_idx) do not exist.
--
-- The user-visible impact: the insights "latest snapshot per person" query
-- runs as a Parallel Seq Scan over the entire 322k-row trend_snapshots
-- table with an external merge sort to disk (~7s cold), and the
-- markets-analytics top-pair query DISTINCT ON (market_id, entry_id) over
-- 1.5M amm_price_snapshots rows times out. Both turn into index scans once
-- the right composite indexes exist.
--
-- This migration is fully idempotent (CREATE INDEX IF NOT EXISTS) so it is
-- safe to re-run.

-- ============================================================================
-- trending_people: leaderboard sort/filter queries
-- ============================================================================
CREATE INDEX IF NOT EXISTS trending_people_rank_idx
  ON public.trending_people (rank);

CREATE INDEX IF NOT EXISTS trending_people_category_idx
  ON public.trending_people (category);

-- ============================================================================
-- trend_snapshots: per-person and per-origin history reads
-- ----------------------------------------------------------------------------
-- person_origin_ts_idx is the one the insights snapshot-batch query was
-- expecting. With it, the WITH-latest CTE in server/services/insights/
-- snapshot-batch.ts becomes an index-only DISTINCT ON instead of a 7s
-- parallel seq scan.
-- ============================================================================
CREATE INDEX IF NOT EXISTS trend_snapshots_person_ts_idx
  ON public.trend_snapshots (person_id, "timestamp" DESC);

CREATE INDEX IF NOT EXISTS trend_snapshots_person_origin_ts_idx
  ON public.trend_snapshots (person_id, snapshot_origin, "timestamp" DESC);

-- ============================================================================
-- amm_price_snapshots: markets-analytics DISTINCT ON (market_id, entry_id)
-- ----------------------------------------------------------------------------
-- The existing (market_id, recorded_at) index does not satisfy the
-- (market_id, entry_id, recorded_at DESC) ordering, so the latest-price-per-
-- entry CTE in server/services/insights/markets-analytics.ts ends up doing
-- a sort over the full 1.5M-row history. This composite index makes it an
-- index-only DISTINCT ON.
-- ============================================================================
CREATE INDEX IF NOT EXISTS amm_price_snapshots_market_entry_time_idx
  ON public.amm_price_snapshots (market_id, entry_id, recorded_at DESC);

-- ============================================================================
-- api_cache: provider-scoped aggregates (e.g. freshness GROUP BY provider)
-- ============================================================================
CREATE INDEX IF NOT EXISTS api_cache_provider_idx
  ON public.api_cache (provider);

-- ============================================================================
-- celebrity_metrics: leaderboard "approval" and "value" sort tabs
-- ============================================================================
CREATE INDEX IF NOT EXISTS celebrity_metrics_approval_idx
  ON public.celebrity_metrics (approval_avg_rating DESC NULLS LAST);

CREATE INDEX IF NOT EXISTS celebrity_metrics_value_idx
  ON public.celebrity_metrics (value_score DESC NULLS LAST);

-- ============================================================================
-- tracked_people: status filter used by ingest and the market generator
-- ============================================================================
CREATE INDEX IF NOT EXISTS tracked_people_status_idx
  ON public.tracked_people (status);

-- ============================================================================
-- sentiment_votes: per-person vote-count aggregations
-- ============================================================================
CREATE INDEX IF NOT EXISTS sentiment_votes_person_idx
  ON public.sentiment_votes (person_id);
