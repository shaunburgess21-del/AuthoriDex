-- Hot-path indexes for the admin audit log and credit ledger.
--
-- Two unrelated queries motivate this migration; bundled together
-- because they're tiny additive index-only changes:
--
--   1. `GET /api/admin/audit-log` (server/routes.ts:12318) lists rows
--      from `admin_audit_log` ordered by `created_at DESC` with a
--      LIMIT. The table has no declared indexes today (see
--      shared/schema.ts:1547), so even a 50-row LIMIT triggers a full
--      seq scan + sort. Adding a `(created_at DESC)` index turns the
--      listing into an index-only top-N. The companion
--      `(admin_id, created_at DESC)` covers per-admin filtering when
--      we surface a "who did what" view (see comment 0.1 in plan).
--
--   2. `GET /api/admin/amm/house` (server/routes.ts:23190) and the
--      AMM settlement audit query at server/routes.ts:23771 filter
--      `credit_ledger` by `txn_type` (sometimes IN-list, sometimes
--      equality). The existing `(user_id, created_at)` index helps
--      house-scoped variants but not the txn_type-first queries.
--      Adding `(txn_type, created_at DESC)` makes those queries
--      planner-friendly and is also a useful general-purpose
--      analytics index for "all amm_payout rows in the last 24h"
--      style questions.
--
-- Idempotency: every statement uses `IF NOT EXISTS` so this is safe
-- to re-run.
--
-- Why not CONCURRENTLY: the deploy-time migration runner wraps each
-- migration in a transaction (see scripts/db-deploy-migrate.cjs),
-- which forbids `CREATE INDEX CONCURRENTLY`. Both tables are
-- small-to-medium in current production scale (alpha user base) and
-- the brief acquire-share lock is acceptable. Migration 0039 set
-- this precedent.

CREATE INDEX IF NOT EXISTS admin_audit_log_created_at_idx
  ON public.admin_audit_log (created_at DESC);

CREATE INDEX IF NOT EXISTS admin_audit_log_admin_id_created_at_idx
  ON public.admin_audit_log (admin_id, created_at DESC);

CREATE INDEX IF NOT EXISTS credit_ledger_txn_type_created_at_idx
  ON public.credit_ledger (txn_type, created_at DESC);
