-- Persisted log of every AMM operational health-check run. See
-- `shared/schema.ts -> ammHealthCheckRuns` and `server/jobs/amm-health.ts`
-- for the full audit logic. Backs the admin "Operations" sub-tab in the
-- AMM dashboard, which surfaces:
--   - latest run (status header + per-check cards)
--   - last 24h trend strip (one cell per run, colour-coded by overall status)
--
-- Three writers, all going through `runAndPersistAmmHealthCheck()`:
--   1. server/index.ts                  in-process scheduler (every 15 min)
--   2. server/route-modules/cron-routes POST /api/cron/amm-health-check (external)
--   3. server/routes.ts                 POST /api/admin/amm/operational-health/run (manual)
--
-- Storage budget: ~96 rows/day at the 15-min scheduler cadence. With the
-- per-check sample arrays compressed to ~2 KB per row, that's ~70 KB/day,
-- ~25 MB/year. No retention sweep yet — add later if it ever matters.

CREATE TABLE IF NOT EXISTS "amm_health_check_runs" (
  "id" varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  "started_at" timestamp NOT NULL DEFAULT now(),
  "duration_ms" integer NOT NULL,
  "ok" boolean NOT NULL,
  "total" integer NOT NULL,
  "passed" integer NOT NULL,
  "warned" integer NOT NULL,
  "failed" integer NOT NULL,
  "lookback_days" integer NOT NULL,
  "source" text NOT NULL,
  "triggered_by" varchar REFERENCES "profiles"("id") ON DELETE SET NULL,
  "checks" jsonb NOT NULL,
  "created_at" timestamp NOT NULL DEFAULT now(),
  CONSTRAINT amm_health_check_runs_source_chk
    CHECK ("source" IN ('scheduler','cron','manual'))
);

-- Single index covers both the "latest" point lookup and the "last N hours"
-- range scan used by the trend chart. Postgres serves the singleton case as
-- ORDER BY started_at DESC LIMIT 1 directly off the index.
CREATE INDEX IF NOT EXISTS "amm_health_runs_started_at_idx"
  ON "amm_health_check_runs" ("started_at" DESC);
