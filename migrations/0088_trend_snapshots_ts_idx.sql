-- Global time index on trend_snapshots. The existing indexes all lead with
-- person_id, so global-time queries (SELECT MAX(timestamp) in the staleness
-- monitor + /api/system/freshness, and the retention DELETE's
-- `WHERE timestamp < cutoff`) were full scans averaging ~2.5s in prod.
-- Mirrors index("trend_snapshots_ts_idx") in shared/schema.ts.
-- Idempotent (IF NOT EXISTS) so re-running on deploy is a safe no-op.
-- Not CONCURRENTLY: db-deploy-migrate.cjs runs each migration in a txn.

CREATE INDEX IF NOT EXISTS trend_snapshots_ts_idx
  ON public.trend_snapshots ("timestamp" DESC);
