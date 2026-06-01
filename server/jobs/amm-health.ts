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
 *   7. Tie-void rate — per-type rate of `amm_auto_tie` voids in the
 *      lookback window. Warns at 5%, fails at 10%.
 *   8. Up/Down calibration — avg |actual win rate − final UP price| on
 *      decided buckets (warn >0.12, fail >0.20).
 *   9. Live convergence (advisory) — open markets: |fair − price| on
 *      decided weekly moves (warn only; never fails `ok`).
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
  checks.push(await checkTieVoidRate(lookbackDays));
  checks.push(await checkMarketCalibration(lookbackDays));
  checks.push(await checkLiveConvergence());

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
  //
  // Reconciled orphans (rows with a matching
  // `amm_orphan_seed_reconciliation` ledger entry — written by
  // `ops/reconcile-orphan-amm-seeds.ts`) are excluded from the failure
  // count: the seed has been refunded to the house and the orphan is
  // closed out, even though the original debit row stays on the ledger
  // as an audit trail. The check still reports the reconciled count
  // separately so operators can see history at a glance.
  const countResult = (await db.execute(sql`
    SELECT
      COUNT(*) FILTER (
        WHERE NOT EXISTS (
          SELECT 1 FROM credit_ledger r
          WHERE r.txn_type = 'amm_orphan_seed_reconciliation'
            AND r.metadata->>'originalMarketId' = cl.metadata->>'marketId'
        )
      )::int AS unreconciled,
      COUNT(*) FILTER (
        WHERE EXISTS (
          SELECT 1 FROM credit_ledger r
          WHERE r.txn_type = 'amm_orphan_seed_reconciliation'
            AND r.metadata->>'originalMarketId' = cl.metadata->>'marketId'
        )
      )::int AS reconciled
    FROM credit_ledger cl
    WHERE cl.metadata->>'marketId' IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM prediction_markets pm
        WHERE pm.id = cl.metadata->>'marketId'
      )
  `)).rows as unknown as Array<{ unreconciled: number; reconciled: number }>;
  const unreconciled = countResult[0]?.unreconciled ?? 0;
  const reconciled = countResult[0]?.reconciled ?? 0;

  const sampleRows =
    unreconciled > 0
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
            AND NOT EXISTS (
              SELECT 1 FROM credit_ledger r
              WHERE r.txn_type = 'amm_orphan_seed_reconciliation'
                AND r.metadata->>'originalMarketId' = cl.metadata->>'marketId'
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

  return buildOrphanLedgerCheckResult({ unreconciled, reconciled, sampleRows });
}

/**
 * Pure result-builder for `checkOrphanLedger`. Split out so the
 * status / message logic can be unit-tested without spinning up a DB.
 *
 * Reconciled orphans (those with a matching
 * `amm_orphan_seed_reconciliation` ledger row) do NOT trip the check —
 * the seed has been refunded and the orphan is closed out, even though
 * the original debit row stays on the ledger as an audit trail.
 */
export function buildOrphanLedgerCheckResult(input: {
  unreconciled: number;
  reconciled: number;
  sampleRows: unknown[];
}): CheckResult {
  const { unreconciled, reconciled, sampleRows } = input;
  const reconciledSuffix =
    reconciled > 0 ? ` (${reconciled} previously reconciled orphan${reconciled === 1 ? "" : "s"} ignored)` : "";

  return {
    name: "Orphan credit_ledger rows",
    status: unreconciled === 0 ? "pass" : "fail",
    rowCount: unreconciled,
    details:
      unreconciled === 0
        ? `No unreconciled credit_ledger rows reference deleted markets${reconciledSuffix}.`
        : `Found ${unreconciled} unreconciled ledger row(s) whose metadata.marketId points to a deleted market${reconciledSuffix}. These imply a market was hard-deleted while keeping its ledger trail — usually a sunset/wipe script side effect. If the orphans are amm_seed_debit rows, run \`npm run amm:reconcile-orphans\` to refund the house and clear the alarm.`,
    sample: sampleRows,
  };
}

// ---------------------------------------------------------------------------
// Check 2: AMM seed-return drift
// ---------------------------------------------------------------------------
//
// Expected balance per resolved market:
//
//   creditedToHouse = houseSeed + warmStartCost + totalUserCreditsIn − payoutLiability
//
// `warmStartCost` is the sum of `amm_warmstart_debit` ledger entries
// for this market (positive number — debits stored negative). Zero on
// markets that didn't trigger a warm-start, AND zero on every market
// resolved before the warm-start feature shipped (the `LEFT JOIN ...
// COALESCE(...) = 0` form below handles both cases identically).
async function checkSeedReturnDrift(lookbackDays: number): Promise<CheckResult> {
  const cutoff = new Date(Date.now() - lookbackDays * 24 * 60 * 60 * 1000);
  // Require BOTH `creditedToHouse` and `payoutLiability` keys before
  // computing drift — a row missing one would arithmetic-cast to NULL
  // and silently get filtered out, hiding a real issue.
  const rows = (await db.execute(sql`
    WITH warmstart AS (
      SELECT
        cl.metadata->>'marketId' AS market_id,
        COALESCE(SUM(-cl.amount), 0)::numeric AS warm_start_cost
      FROM credit_ledger cl
      WHERE cl.txn_type = 'amm_warmstart_debit'
      GROUP BY cl.metadata->>'marketId'
    ),
    resolved AS (
      SELECT
        pm.id,
        pm.title,
        (pm.resolution_notes::jsonb->>'creditedToHouse')::numeric  AS credited_to_house,
        (pm.resolution_notes::jsonb->>'payoutLiability')::numeric  AS payout_liability,
        mas.house_seed_amount,
        mas.total_user_credits_in,
        COALESCE(ws.warm_start_cost, 0)::numeric AS warm_start_cost
      FROM prediction_markets pm
      LEFT JOIN market_amm_state mas ON mas.market_id = pm.id
      LEFT JOIN warmstart ws ON ws.market_id = pm.id
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
      warm_start_cost,
      total_user_credits_in,
      payout_liability,
      (credited_to_house - house_seed_amount - warm_start_cost - total_user_credits_in + payout_liability) AS drift
    FROM resolved
    WHERE ABS(
      credited_to_house - house_seed_amount - warm_start_cost - total_user_credits_in + payout_liability
    ) > 1
    ORDER BY ABS(
      credited_to_house - house_seed_amount - warm_start_cost - total_user_credits_in + payout_liability
    ) DESC
    LIMIT 50
  `)).rows as unknown as Array<{
    id: string;
    title: string;
    drift: number;
    credited_to_house: number;
    house_seed_amount: number;
    warm_start_cost: number;
    total_user_credits_in: number;
    payout_liability: number;
  }>;

  return {
    name: `AMM seed-return drift (last ${lookbackDays}d)`,
    status: rows.length === 0 ? "pass" : "fail",
    rowCount: rows.length,
    details:
      rows.length === 0
        ? `All RESOLVED AMM markets in the last ${lookbackDays} days have seed-return arithmetic within 1 credit (warm-start cost included where applicable).`
        : `Found ${rows.length} market(s) with > 1 credit drift between creditedToHouse and (houseSeed + warmStartCost + totalUserCreditsIn − payoutLiability). Investigate before further deploys.`,
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
// Check 7: tie-void rate per market type
// ---------------------------------------------------------------------------

/**
 * Rate (0-1) above which `checkTieVoidRate` flips a market type to
 * `warn`. 5% on a per-type basis is the operational floor where users
 * start noticing the "I picked the winner and the market voided" feel
 * — set conservatively because gainer/race markets are inherently
 * close-call (3-10 contestants with similar weekly momentum) and a
 * sustained void rate above this band is worth surfacing.
 */
export const TIE_VOID_RATE_WARN_PCT = 0.05;

/**
 * Rate (0-1) above which `checkTieVoidRate` flips a market type to
 * `fail`. 10% is roughly "one in ten resolutions voids on a tie" —
 * past this point either the tie threshold (`GAINER_TIE_EPSILON_PCT`)
 * is too aggressive OR the market type's design needs a tiebreaker
 * rule. Either way, sustained `fail` here should trigger a follow-up
 * plan to add a tiebreaker (e.g. higher absolute score wins).
 */
export const TIE_VOID_RATE_FAIL_PCT = 0.10;

/**
 * Minimum sample size before tie-void rate is reported as anything
 * other than `pass`. With only 1-2 resolved markets in the window a
 * single tied resolution would read as 50-100%, which isn't an actual
 * signal — it's small-sample noise. 10 markets per type is the floor
 * at which a 5% rate represents a real pattern.
 */
const TIE_VOID_RATE_MIN_SAMPLE = 10;

async function checkTieVoidRate(lookbackDays: number): Promise<CheckResult> {
  const cutoff = new Date(Date.now() - lookbackDays * 24 * 60 * 60 * 1000);

  // Tied-resolution voids are identified by
  // `resolution_notes::jsonb->>'outcome' = 'void_tie'`. The `void_reason`
  // column ALSO carries 'amm_auto_tie' briefly inside the AMM resolver,
  // but the cron resolver (server/jobs/market-resolver.ts) immediately
  // overwrites it with a humanized string ('Tie — score unchanged',
  // 'Tie — identical scores', 'Tie — identical top gain percentage') so
  // querying `void_reason` would miss every real tie. The
  // `resolution_notes` JSON outcome field is set by the same outer call
  // and is the reliable signal across updown / h2h / gainer.
  //
  // The `~ '^\s*\{'` cast guard mirrors checkSeedReturnDrift — some
  // legacy / admin rows carry plain-text resolution_notes which would
  // crash the jsonb cast.
  const rows = (await db.execute(sql`
    SELECT
      market_type,
      COUNT(*) FILTER (WHERE status IN ('RESOLVED','VOID'))::int AS settled,
      COUNT(*) FILTER (
        WHERE status = 'VOID'
          AND resolution_notes ~ '^\\s*\\{'
          AND resolution_notes::jsonb->>'outcome' = 'void_tie'
      )::int AS tie_voids
    FROM prediction_markets
    WHERE engine = 'amm'
      AND market_type IN ('updown','h2h','gainer')
      AND resolved_at > ${cutoff}
    GROUP BY market_type
    ORDER BY market_type
  `)).rows as unknown as Array<{
    market_type: string;
    settled: number;
    tie_voids: number;
  }>;

  type Breakdown = {
    market_type: string;
    settled: number;
    tie_voids: number;
    rate: number;
    flag: "pass" | "warn" | "fail" | "low_sample";
  };

  const breakdown: Breakdown[] = rows.map((r) => {
    const rate = r.settled > 0 ? r.tie_voids / r.settled : 0;
    const flag: Breakdown["flag"] =
      r.settled < TIE_VOID_RATE_MIN_SAMPLE
        ? "low_sample"
        : rate >= TIE_VOID_RATE_FAIL_PCT
        ? "fail"
        : rate >= TIE_VOID_RATE_WARN_PCT
        ? "warn"
        : "pass";
    return { market_type: r.market_type, settled: r.settled, tie_voids: r.tie_voids, rate, flag };
  });

  const worst = breakdown.reduce<Breakdown["flag"]>(
    (acc, b) => (b.flag === "fail" ? "fail" : b.flag === "warn" && acc !== "fail" ? "warn" : acc),
    "pass",
  );

  const status: CheckStatus = worst === "fail" ? "fail" : worst === "warn" ? "warn" : "pass";

  const detailLines = breakdown.length === 0
    ? [`No RESOLVED/VOID AMM native markets in the last ${lookbackDays}d.`]
    : breakdown.map((b) => {
        const pct = (b.rate * 100).toFixed(1);
        const tag =
          b.flag === "low_sample"
            ? "sample<10, ignoring"
            : b.flag === "fail"
            ? `>=${(TIE_VOID_RATE_FAIL_PCT * 100).toFixed(0)}% FAIL`
            : b.flag === "warn"
            ? `>=${(TIE_VOID_RATE_WARN_PCT * 100).toFixed(0)}% warn`
            : "ok";
        return `${b.market_type}: ${b.tie_voids}/${b.settled} (${pct}%, ${tag})`;
      });

  return {
    name: `Tie-void rate per market type (last ${lookbackDays}d)`,
    status,
    rowCount: breakdown.reduce((s, b) => s + b.tie_voids, 0),
    details:
      status === "pass"
        ? `Tie-void rate within bounds. ${detailLines.join("; ")}`
        : `Tie-void rate elevated. ${detailLines.join("; ")}. If a market type sustains >${(TIE_VOID_RATE_WARN_PCT * 100).toFixed(0)}% across multiple weeks, consider adding a tiebreaker rule (e.g. higher absolute score wins) instead of voiding.`,
    sample: breakdown,
  };
}

// ---------------------------------------------------------------------------
// Check 8: Up/Down price calibration
// ---------------------------------------------------------------------------
const CALIBRATION_GAP_WARN = 0.12;
const CALIBRATION_GAP_FAIL = 0.20;

async function checkLiveConvergence(): Promise<CheckResult> {
  const {
    fetchLiveUpDownConvergence,
    fetchLiveH2HConvergence,
    fetchLiveGainerConvergence,
    LIVE_CONVERGENCE_AVG_GAP_WARN,
    LIVE_CONVERGENCE_MISPRICED_WARN_PCT,
  } = await import("../agents/liveConvergence.ts");

  const live = await fetchLiveUpDownConvergence();
  const h2h = await fetchLiveH2HConvergence();
  const gainer = await fetchLiveGainerConvergence();
  const { summary } = live;
  const h2hSummary = h2h.summary;
  const gainerSummary = gainer.summary;
  const mispricedPct = summary.decidedMispricedPct;
  const avgGap = summary.avgAbsGapOnDecided;
  const h2hMispricedPct = h2hSummary.decidedMispricedPct;
  const h2hAvgGap = h2hSummary.avgAbsGapOnDecided;
  const gainerMispricedPct = gainerSummary.decidedMispricedPct;
  const gainerAvgGap = gainerSummary.avgAbsGapOnDecided;

  let status: CheckStatus = "pass";
  if (
    (mispricedPct != null && mispricedPct >= LIVE_CONVERGENCE_MISPRICED_WARN_PCT) ||
    (avgGap != null && avgGap >= LIVE_CONVERGENCE_AVG_GAP_WARN) ||
    (h2hMispricedPct != null && h2hMispricedPct >= LIVE_CONVERGENCE_MISPRICED_WARN_PCT) ||
    (h2hAvgGap != null && h2hAvgGap >= LIVE_CONVERGENCE_AVG_GAP_WARN) ||
    (gainerMispricedPct != null && gainerMispricedPct >= LIVE_CONVERGENCE_MISPRICED_WARN_PCT) ||
    (gainerAvgGap != null && gainerAvgGap >= LIVE_CONVERGENCE_AVG_GAP_WARN)
  ) {
    status = "warn";
  }

  const updownDetail =
    summary.decidedCount === 0
      ? "up/down: no decided open markets."
      : `up/down: ${summary.decidedMispricedCount}/${summary.decidedCount} mispriced (${mispricedPct != null ? `${(mispricedPct * 100).toFixed(0)}%` : "n/a"}), avg |gap|=${avgGap?.toFixed(3) ?? "n/a"}`;
  const h2hDetail =
    h2hSummary.decidedCount === 0
      ? "h2h: no decisive open pairings (fav fair < 58%)."
      : `h2h: ${h2hSummary.decidedMispricedCount}/${h2hSummary.decidedCount} mispriced (${h2hMispricedPct != null ? `${(h2hMispricedPct * 100).toFixed(0)}%` : "n/a"}), avg |gap|=${h2hAvgGap?.toFixed(3) ?? "n/a"}`;
  const gainerDetail =
    gainerSummary.decidedCount === 0
      ? "gainer: no decisive open fields (fav fair < 45%)."
      : `gainer: ${gainerSummary.decidedMispricedCount}/${gainerSummary.decidedCount} mispriced (${gainerMispricedPct != null ? `${(gainerMispricedPct * 100).toFixed(0)}%` : "n/a"}), avg |gap|=${gainerAvgGap?.toFixed(3) ?? "n/a"}`;

  return {
    name: "Live native convergence (up/down + h2h + gainer)",
    status,
    rowCount: summary.decidedCount + h2hSummary.decidedCount + gainerSummary.decidedCount,
    details: `${updownDetail}; ${h2hDetail}; ${gainerDetail}. Run: npm run amm:convergence`,
    sample: [
      ...live.markets.slice(0, 3).map((m) => ({
        type: "updown",
        marketId: m.marketId.slice(0, 8),
        gap: m.gap,
        price: m.favoredPrice,
        fair: m.favoredFair,
      })),
      ...h2h.markets.slice(0, 3).map((m) => ({
        type: "h2h",
        marketId: m.marketId.slice(0, 8),
        gap: m.gap,
        price: m.favoredPrice,
        fair: m.favoredFair,
        favored: m.favoredLabel,
      })),
      ...gainer.markets.slice(0, 3).map((m) => ({
        type: "gainer",
        marketId: m.marketId.slice(0, 8),
        gap: m.gap,
        price: m.favoredPrice,
        fair: m.favoredFair,
        favored: m.favoredLabel,
      })),
    ],
  };
}

async function checkMarketCalibration(lookbackDays: number): Promise<CheckResult> {
  const { fetchUpDownCalibration } = await import("../agents/marketCalibration.ts");
  const cal = await fetchUpDownCalibration(lookbackDays);
  const gap = cal.avgGapOnDecided;

  let status: CheckStatus = "pass";
  if (gap != null && gap >= CALIBRATION_GAP_FAIL) status = "fail";
  else if (gap != null && gap >= CALIBRATION_GAP_WARN) status = "warn";

  return {
    name: `Up/Down calibration gap (last ${lookbackDays}d)`,
    status,
    rowCount: cal.totalResolved,
    details:
      gap == null
        ? "Insufficient resolved up/down markets for calibration."
        : `${cal.totalResolved} resolved; avg |actual−price| on decided buckets = ${gap.toFixed(3)} (warn≥${CALIBRATION_GAP_WARN}, fail≥${CALIBRATION_GAP_FAIL}). Run: npx tsx scripts/market-calibration.ts`,
    sample: cal.buckets,
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
