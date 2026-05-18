/**
 * Automatic agent loss / drain circuit breaker.
 *
 * Today, every agent below `AGENT_CREDIT_LOW_THRESHOLD` is refilled to
 * `AGENT_CREDIT_TOPUP_TARGET` on a stable per-hour idempotency key
 * (`server/agents/agentRunner.ts:132-141`). A regression in the
 * decision engine, sharp ranker, or sizing curve would silently bleed
 * the house balance against itself with no automatic pause — only the
 * every-15-min AMM-health audit and the manual operator pause stand
 * between the system and a drained treasury.
 *
 * This module periodically computes the house's 24-hour AMM net P&L
 * and trips the global agent kill switch (via `setAgentsPaused`) when
 * losses exceed a configurable threshold. Once tripped, the existing
 * `isAgentsPaused()` check at the top of `runAgentBatch` halts the
 * top-up loop AND the trade-scheduling loop AND the action worker, so
 * a tripped breaker truly stops every drain vector in one switch.
 *
 * Thresholds are tunable at runtime via env, with conservative
 * defaults (50,000 credits absolute OR 20% of current house balance,
 * whichever is smaller). The relative threshold matters more once the
 * house balance grows; the absolute threshold matters more when the
 * balance is small (i.e. early monetisation).
 *
 * Resetting: tripping is one-way at the breaker's discretion. To
 * un-pause, an operator uses POST /api/admin/agents/pause with
 * { paused: false } — same surface as a manual pause. The breaker
 * never auto-resumes; a human must investigate the loss source first.
 */

import { and, eq, sql } from "drizzle-orm";
import { db } from "../db";
import { creditLedger, profiles, adminAuditLog } from "@shared/schema";
import { log } from "../log";
import { captureBackgroundError } from "../sentry";
import { HOUSE_PROFILE_ID } from "../services/amm-house";
import {
  getAgentRuntimeState,
  setAgentsPaused,
} from "./runtime-state";
import {
  evaluateDrainBreaker,
  type DrainBreakerThresholds,
} from "./drainBreaker-evaluate";

export { evaluateDrainBreaker } from "./drainBreaker-evaluate";
export type {
  DrainBreakerThresholds,
  EvaluateDrainBreakerInput,
  EvaluateDrainBreakerOutput,
} from "./drainBreaker-evaluate";

const WINDOW_MS = 24 * 60 * 60 * 1000;

/** AMM-related ledger txn types that affect house P&L. All four are
 *  POSITIVE values from the house wallet's perspective when credited
 *  (e.g. `amm_settle_credit` = winning the seed back), NEGATIVE when
 *  debited (e.g. `amm_payout` = paying a winner). `SUM(amount)` over
 *  these rows for the house user gives the net delta directly. */
const HOUSE_PNL_TXN_TYPES = [
  "amm_seed_debit",
  "amm_payout",
  "amm_void_refund",
  "amm_settle_credit",
] as const;

/** Default absolute threshold: 50k credits of 24h loss trips the
 *  breaker regardless of house balance. Override via env. */
const DEFAULT_ABS_LOSS_CAP_CREDITS = 50_000;

/** Default relative threshold: 20% of current house balance trips
 *  the breaker even if absolute loss is below the cap. Override via
 *  env. Whichever threshold fires first wins. */
const DEFAULT_PCT_LOSS_CAP = 0.2;

function readThresholds(): DrainBreakerThresholds {
  const absRaw = Number(process.env.DRAIN_BREAKER_LOSS_CAP_CREDITS);
  const pctRaw = Number(process.env.DRAIN_BREAKER_LOSS_CAP_PCT);
  return {
    absoluteLossCapCredits:
      Number.isFinite(absRaw) && absRaw > 0 ? absRaw : DEFAULT_ABS_LOSS_CAP_CREDITS,
    pctLossCap:
      Number.isFinite(pctRaw) && pctRaw > 0 && pctRaw <= 1
        ? pctRaw
        : DEFAULT_PCT_LOSS_CAP,
  };
}

export interface DrainBreakerCheckResult {
  /** True when the call resulted in a trip (i.e. agents now paused
   *  because of this run). False if no-op (already paused, or below
   *  threshold). */
  tripped: boolean;
  /** Why we didn't trip on this run, when applicable. */
  reason:
    | "tripped"
    | "already_paused"
    | "below_threshold"
    | "house_profile_missing";
  /** Net house P&L delta over the past 24h. Negative = the house lost
   *  credits. Positive = the house gained. */
  houseDelta24h: number;
  /** Snapshot of the house's current wallet at evaluation time. */
  houseBalance: number;
  /** The two thresholds in force at evaluation time. */
  thresholds: DrainBreakerThresholds;
  /** The applied trip threshold (`min(abs, pct * balance)`). The
   *  breaker trips when `-houseDelta24h >= thresholdApplied`. */
  thresholdApplied: number;
}

/**
 * Live check + optional trip. Designed to be called by the periodic
 * scheduler (every 15 min) and by the manual cron endpoint.
 *
 * Idempotent for the "already paused" case — won't try to re-pause
 * an already-paused cohort, and won't overwrite the pause reason if
 * a human paused for a different cause.
 */
export async function checkAndTripDrainBreaker(): Promise<DrainBreakerCheckResult> {
  const thresholds = readThresholds();

  // Read house balance + prior pause state up front. These are two
  // separate reads (different tables) but both small singleton-style
  // queries so the cost is negligible.
  const [houseProfile] = await db
    .select({ predictCredits: profiles.predictCredits })
    .from(profiles)
    .where(eq(profiles.id, HOUSE_PROFILE_ID))
    .limit(1);

  if (!houseProfile) {
    return {
      tripped: false,
      reason: "house_profile_missing",
      houseDelta24h: 0,
      houseBalance: 0,
      thresholds,
      thresholdApplied: 0,
    };
  }

  const houseBalance = houseProfile.predictCredits;

  const cutoff = new Date(Date.now() - WINDOW_MS);
  const [delta] = await db
    .select({
      total: sql<string>`COALESCE(SUM(${creditLedger.amount}), 0)`,
    })
    .from(creditLedger)
    .where(
      and(
        eq(creditLedger.userId, HOUSE_PROFILE_ID),
        sql`${creditLedger.txnType} IN ('amm_seed_debit','amm_payout','amm_void_refund','amm_settle_credit')`,
        sql`${creditLedger.createdAt} >= ${cutoff}`,
      ),
    );
  const houseDelta24h = Number(delta?.total ?? 0);

  const { trip, thresholdApplied } = evaluateDrainBreaker({
    houseDelta24h,
    houseBalance,
    thresholds,
  });

  if (!trip) {
    return {
      tripped: false,
      reason: "below_threshold",
      houseDelta24h,
      houseBalance,
      thresholds,
      thresholdApplied,
    };
  }

  const priorState = await getAgentRuntimeState();
  if (priorState.paused) {
    // Already paused — could be a manual pause or a prior auto-trip.
    // Either way we don't overwrite. The audit trail of the original
    // pause stays intact.
    return {
      tripped: false,
      reason: "already_paused",
      houseDelta24h,
      houseBalance,
      thresholds,
      thresholdApplied,
    };
  }

  const reasonText =
    `auto_drawdown_breaker: 24h house P&L = ${houseDelta24h} credits ` +
    `(loss of ${Math.round(-houseDelta24h)} > threshold ${Math.round(thresholdApplied)}; ` +
    `abs cap ${thresholds.absoluteLossCapCredits}, pct cap ${(thresholds.pctLossCap * 100).toFixed(0)}% of balance ${houseBalance})`;

  await setAgentsPaused({
    paused: true,
    reason: reasonText,
    actorId: null,
  });

  // Audit-log the auto-trip with the same shape as a manual pause so
  // the unified /admin/audit-log view treats them consistently. Best-
  // effort — the pause itself already committed.
  try {
    await db.insert(adminAuditLog).values({
      adminId: HOUSE_PROFILE_ID, // System actor (no real admin user)
      actionType: "agents_auto_drain_breaker_trip",
      targetTable: "agent_runtime_state",
      targetId: "global",
      previousData: { paused: false },
      newData: { paused: true, reason: reasonText },
      metadata: {
        houseDelta24h,
        houseBalance,
        thresholdApplied,
        thresholds,
      },
    });
  } catch (auditErr) {
    log(`[DrainBreaker] Audit-log insert failed (trip still committed): ${auditErr instanceof Error ? auditErr.message : String(auditErr)}`);
  }

  captureBackgroundError(new Error("DrainBreaker tripped"), {
    houseDelta24h,
    houseBalance,
    thresholdApplied,
    thresholds,
  });

  log(`[DrainBreaker] TRIPPED — ${reasonText}`);

  return {
    tripped: true,
    reason: "tripped",
    houseDelta24h,
    houseBalance,
    thresholds,
    thresholdApplied,
  };
}
