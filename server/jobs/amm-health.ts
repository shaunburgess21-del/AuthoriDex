/**
 * AMM operational health check — shared module.
 *
 * Read-only SQL audit consumable from two surfaces:
 *
 *   - scripts/amm-health-check.ts   (CLI wrapper, pretty-prints + exit code)
 *   - POST /api/cron/amm-health-check (Railway / external scheduler;
 *                                      JSON envelope, advisory-only)
 *
 * Checks (kept aligned with ops/AMM_MONITORING_RUNBOOK.md):
 *   1. Orphan credit_ledger rows — metadata.marketId references a market
 *      that no longer exists.
 *   2. AMM seed-return drift — for RESOLVED amm markets in the last
 *      `lookbackDays` days, creditedToHouse should equal
 *      houseSeedAmount + totalUserCreditsIn − payoutLiability
 *      (within 1 credit rounding tolerance).
 *   3. Stuck markets — CLOSED_PENDING for > 24h.
 *   4. Negative credits — any profile with predict_credits < 0.
 *   5. Duplicate idempotency keys in credit_ledger in the last 24h.
 *   6. Agent pause state — warn (not fail) if paused.
 *
 * Failure semantics: any check returning status="fail" makes the overall
 * result `ok=false`. "warn" rows do NOT flip ok — operators should still
 * eyeball them, but they don't trip a cron alarm. Uncaught errors thrown
 * inside this function should be allowed to propagate to the caller; the
 * script wrapper / cron endpoint is responsible for surfacing them.
 */

import { and, eq, lt, sql } from "drizzle-orm";
import { db } from "../db";
import {
  agentRuntimeState,
  ammHealthCheckRuns,
  predictionMarkets,
  profiles,
} from "@shared/schema";

export type CheckStatus = "pass" | "warn" | "fail";

export interface CheckResult {
  name: string;
  status: CheckStatus;
  details: string;
  rowCount?: number;
  sample?: unknown[];
}

export interface HealthCheckResult {
  ok: boolean;
  passed: number;
  warned: number;
  failed: number;
  total: number;
  lookbackDays: number;
  durationMs: number;
  checks: CheckResult[];
}

export interface RunAmmHealthCheckOptions {
  lookbackDays?: number;
}

export type AmmHealthSource = "scheduler" | "cron" | "manual";

export interface PersistOptions {
  source: AmmHealthSource;
  triggeredBy?: string | null;
}

const DEFAULT_LOOKBACK_DAYS = 30;

export async function runAmmHealthCheck(
  opts: RunAmmHealthCheckOptions = {},
): Promise<HealthCheckResult> {
  const lookbackDays = Number.isFinite(opts.lookbackDays) && (opts.lookbackDays as number) > 0
    ? Math.floor(opts.lookbackDays as number)
    : DEFAULT_LOOKBACK_DAYS;

  const startedAt = Date.now();
  const checks: CheckResult[] = [];

  checks.push(await checkOrphanLedger());
  checks.push(await checkSeedReturnDrift(lookbackDays));
  checks.push(await checkStuckMarkets());
  checks.push(await checkNegativeCredits());
  checks.push(await checkDuplicateIdemKeys());
  checks.push(await checkAgentPause());

  const passed = checks.filter((c) => c.status === "pass").length;
  const warned = checks.filter((c) => c.status === "warn").length;
  const failed = checks.filter((c) => c.status === "fail").length;

  return {
    ok: failed === 0,
    passed,
    warned,
    failed,
    total: checks.length,
    lookbackDays,
    durationMs: Date.now() - startedAt,
    checks,
  };
}

// ---------------------------------------------------------------------------
// Check 1: orphan credit_ledger rows
// ---------------------------------------------------------------------------
async function checkOrphanLedger(): Promise<CheckResult> {
  // We only audit rows whose metadata.marketId is set. Some rows (sign-up
  // bonuses, manual admin adjustments, jackpot ticket refunds for markets
  // that pre-date the snapshot) intentionally omit marketId. Run COUNT
  // first so rowCount reflects reality even when there are more than the
  // sample-size cap (10 rows here).
  const countResult = (await db.execute(sql`
    SELECT COUNT(*)::int AS total
    FROM credit_ledger cl
    WHERE cl.metadata->>'marketId' IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM prediction_markets pm
        WHERE pm.id = cl.metadata->>'marketId'
      )
  `)).rows as unknown as Array<{ total: number }>;
  const count = countResult[0]?.total ?? 0;

  const sampleRows =
    count > 0
      ? ((await db.execute(sql`
          SELECT cl.id,
                 cl.metadata->>'marketId' AS market_id,
                 cl.txn_type,
                 cl.created_at
          FROM credit_ledger cl
          WHERE cl.metadata->>'marketId' IS NOT NULL
            AND NOT EXISTS (
              SELECT 1 FROM prediction_markets pm
              WHERE pm.id = cl.metadata->>'marketId'
            )
          ORDER BY cl.created_at DESC
          LIMIT 10
        `)).rows as unknown as Array<{
          id: string;
          market_id: string;
          txn_type: string;
          created_at: Date;
        }>)
      : [];

  return {
    name: "Orphan credit_ledger rows",
    status: count === 0 ? "pass" : "fail",
    rowCount: count,
    details:
      count === 0
        ? "No credit_ledger rows reference deleted markets."
        : `Found ${count} ledger row(s) whose metadata.marketId points to a deleted market. These imply a market was hard-deleted while keeping its ledger trail — usually a sunset/wipe script side effect, but worth verifying.`,
    sample: sampleRows,
  };
}

// ---------------------------------------------------------------------------
// Check 2: AMM seed-return drift
// ---------------------------------------------------------------------------
async function checkSeedReturnDrift(lookbackDays: number): Promise<CheckResult> {
  const cutoff = new Date(Date.now() - lookbackDays * 24 * 60 * 60 * 1000);
  // Require BOTH `creditedToHouse` and `payoutLiability` keys before
  // computing drift — a row missing one would arithmetic-cast to NULL
  // and silently get filtered out, hiding a real issue.
  const rows = (await db.execute(sql`
    WITH resolved AS (
      SELECT
        pm.id,
        pm.title,
        (pm.resolution_notes::jsonb->>'creditedToHouse')::numeric  AS credited_to_house,
        (pm.resolution_notes::jsonb->>'payoutLiability')::numeric  AS payout_liability,
        mas.house_seed_amount,
        mas.total_user_credits_in
      FROM prediction_markets pm
      LEFT JOIN market_amm_state mas ON mas.market_id = pm.id
      WHERE pm.status = 'RESOLVED'
        AND pm.engine = 'amm'
        AND pm.resolved_at > ${cutoff}
        AND pm.resolution_notes IS NOT NULL
        -- resolutionNotes is a free-text column. The AMM resolver writes
        -- JSON objects, but pre-AMM and some admin-manual rows contain
        -- plain text (e.g. "Auto-resolution blocked"). Guard the ::jsonb
        -- cast so a single bad row doesn't crash the audit.
        AND pm.resolution_notes ~ '^\\s*\\{'
        AND pm.resolution_notes::jsonb ? 'creditedToHouse'
        AND pm.resolution_notes::jsonb ? 'payoutLiability'
        AND mas.house_seed_amount IS NOT NULL
    )
    SELECT
      id,
      title,
      credited_to_house,
      house_seed_amount,
      total_user_credits_in,
      payout_liability,
      (credited_to_house - house_seed_amount - total_user_credits_in + payout_liability) AS drift
    FROM resolved
    WHERE ABS(
      credited_to_house - house_seed_amount - total_user_credits_in + payout_liability
    ) > 1
    ORDER BY ABS(
      credited_to_house - house_seed_amount - total_user_credits_in + payout_liability
    ) DESC
    LIMIT 50
  `)).rows as unknown as Array<{
    id: string;
    title: string;
    drift: number;
    credited_to_house: number;
    house_seed_amount: number;
    total_user_credits_in: number;
    payout_liability: number;
  }>;

  return {
    name: `AMM seed-return drift (last ${lookbackDays}d)`,
    status: rows.length === 0 ? "pass" : "fail",
    rowCount: rows.length,
    details:
      rows.length === 0
        ? `All RESOLVED AMM markets in the last ${lookbackDays} days have seed-return arithmetic within 1 credit.`
        : `Found ${rows.length} market(s) with > 1 credit drift between creditedToHouse and (houseSeed + totalUserCreditsIn − payoutLiability). Investigate before further deploys.`,
    sample: rows.slice(0, 3),
  };
}

// ---------------------------------------------------------------------------
// Check 3: stuck markets (CLOSED_PENDING > 24h)
// ---------------------------------------------------------------------------
async function checkStuckMarkets(): Promise<CheckResult> {
  const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const stuck = await db
    .select({
      id: predictionMarkets.id,
      slug: predictionMarkets.slug,
      title: predictionMarkets.title,
      marketType: predictionMarkets.marketType,
      endAt: predictionMarkets.endAt,
    })
    .from(predictionMarkets)
    .where(
      and(
        eq(predictionMarkets.status, "CLOSED_PENDING"),
        lt(predictionMarkets.endAt, cutoff),
      ),
    );

  return {
    name: "Stuck CLOSED_PENDING markets (> 24h)",
    status: stuck.length === 0 ? "pass" : "fail",
    rowCount: stuck.length,
    details:
      stuck.length === 0
        ? "No markets stuck in CLOSED_PENDING for over 24h."
        : `Found ${stuck.length} market(s) that hit endAt > 24h ago but haven't resolved. The cron may be wedged, or these markets need manual resolution.`,
    sample: stuck.slice(0, 5).map((m) => ({
      id: m.id,
      type: m.marketType,
      title: m.title,
      endAt: m.endAt,
    })),
  };
}

// ---------------------------------------------------------------------------
// Check 4: negative profile credits
// ---------------------------------------------------------------------------
async function checkNegativeCredits(): Promise<CheckResult> {
  const negs = await db
    .select({
      id: profiles.id,
      username: profiles.username,
      predictCredits: profiles.predictCredits,
    })
    .from(profiles)
    .where(sql`predict_credits < 0`);

  return {
    name: "Profiles with negative predict_credits",
    status: negs.length === 0 ? "pass" : "fail",
    rowCount: negs.length,
    details:
      negs.length === 0
        ? "No profiles in the red."
        : `Found ${negs.length} profile(s) with predict_credits < 0. Likely indicates a missed FOR UPDATE somewhere — every debit path should refuse to drop below 0.`,
    sample: negs.slice(0, 5),
  };
}

// ---------------------------------------------------------------------------
// Check 5: duplicate idempotency keys (last 24h)
// ---------------------------------------------------------------------------
async function checkDuplicateIdemKeys(): Promise<CheckResult> {
  const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const rows = (await db.execute(sql`
    SELECT
      idempotency_key,
      COUNT(*)::int AS attempts,
      array_agg(DISTINCT txn_type) AS txn_types,
      MIN(created_at) AS first,
      MAX(created_at) AS last
    FROM credit_ledger
    WHERE created_at > ${cutoff}
      AND idempotency_key IS NOT NULL
    GROUP BY idempotency_key
    HAVING COUNT(*) > 1
    ORDER BY attempts DESC
    LIMIT 20
  `)).rows as unknown as Array<{
    idempotency_key: string;
    attempts: number;
    txn_types: string[];
    first: Date;
    last: Date;
  }>;

  // In the happy path the unique constraint should make this impossible
  // (only one row can land), so any rows here likely indicate the
  // constraint isn't actually live, or the data is from before it was
  // applied. Treat as warn rather than fail because it doesn't imply
  // money moved twice.
  return {
    name: "Duplicate idempotency keys (last 24h)",
    status: rows.length === 0 ? "pass" : "warn",
    rowCount: rows.length,
    details:
      rows.length === 0
        ? "No duplicate idempotency_key rows in the last 24h — unique constraint is doing its job."
        : `Found ${rows.length} idempotency key(s) appearing more than once. Investigate whether the unique constraint is active — duplicates should have been blocked.`,
    sample: rows.slice(0, 3),
  };
}

// ---------------------------------------------------------------------------
// Check 6: agent runtime state — pause warning
// ---------------------------------------------------------------------------
async function checkAgentPause(): Promise<CheckResult> {
  const [state] = await db
    .select()
    .from(agentRuntimeState)
    .where(eq(agentRuntimeState.id, "global"))
    .limit(1);

  if (!state) {
    return {
      name: "Agent runtime state",
      status: "warn",
      details: "No agent_runtime_state row found. Agents may be unmanaged.",
    };
  }

  if (!state.paused) {
    return {
      name: "Agent runtime state",
      status: "pass",
      details: "Agents are active (paused=false).",
    };
  }

  const reason = state.reason ?? "(no reason set)";
  const since = state.pausedAt ? `since ${state.pausedAt.toISOString()}` : "(no pausedAt set)";
  return {
    name: "Agent runtime state",
    status: "warn",
    details: `Agents are PAUSED ${since}. Reason: ${reason}. If this was intentional, ignore. Otherwise resume via Supabase.`,
  };
}

// ---------------------------------------------------------------------------
// Persistence — write each run to amm_health_check_runs so the admin
// "Operations" sub-tab can render a 24h trend strip without re-running the
// audit on every page load.
// ---------------------------------------------------------------------------

/**
 * Persist a completed health-check run. Best-effort — failures here are
 * logged but never propagated back to the caller, so a transient DB hiccup
 * (or a missing migration on a dev DB) doesn't break the audit semantics.
 *
 * Writes the full `CheckResult[]` into `checks` as JSONB. The `started_at`
 * column defaults to now() on insert which approximates the run's start
 * time within ~queryDuration of reality — exact enough for trend bucketing.
 */
export async function persistAmmHealthRun(
  result: HealthCheckResult,
  source: AmmHealthSource,
  triggeredBy: string | null = null,
): Promise<void> {
  await db.insert(ammHealthCheckRuns).values({
    durationMs: result.durationMs,
    ok: result.ok,
    total: result.total,
    passed: result.passed,
    warned: result.warned,
    failed: result.failed,
    lookbackDays: result.lookbackDays,
    source,
    triggeredBy,
    checks: result.checks,
  });
}

/**
 * Convenience wrapper: run the audit and then persist the result. Used by
 * the in-process scheduler, the cron endpoint, and the admin "Run now"
 * button so all three surfaces feed the same history table without each
 * having to know the persist helper exists.
 *
 * Persist failures are caught and logged — the original `HealthCheckResult`
 * is always returned to the caller regardless of persist outcome. This keeps
 * the unit-tested pure path (`runAmmHealthCheck`) decoupled from any DB
 * write behaviour.
 */
export async function runAndPersistAmmHealthCheck(
  opts: RunAmmHealthCheckOptions & PersistOptions,
): Promise<HealthCheckResult> {
  const result = await runAmmHealthCheck(opts);
  try {
    await persistAmmHealthRun(result, opts.source, opts.triggeredBy ?? null);
  } catch (err) {
    console.warn(
      `[AmmHealth] Persist failed (source=${opts.source}); audit result still returned to caller:`,
      err,
    );
  }
  return result;
}
