/**
 * Up/Down market warm-start priors.
 *
 * When a new weekly Up/Down market is created, the AMM state opens at
 * `q = [0, 0]` which makes the marginal price exactly 50/50 — even when
 * the underlying person's 7-day Trend Score change strongly suggests
 * the market should NOT open at coin-flip. The first agent to fire on
 * a clearly-trending market then collects free shares of the favoured
 * side at 0.50, sharps drain the cold-start gap, and the house pays
 * for the imbalance through resolution.
 *
 * This module closes that gap by having the house "warm-buy" a small
 * position on the side the 7-day signal favours, BEFORE any user or
 * agent trades. The market then opens at e.g. 60/40 instead of 50/50,
 * which:
 *
 *   - aligns initial pricing with the data the agents already use,
 *   - removes the cold-start sharp edge,
 *   - explicitly costs the house ~600-1600 credits per market opened
 *     (visible in the credit ledger, NOT silently absorbed),
 *   - if the prior is correct, the warmed shares ARE the winning side
 *     and pay back more than they cost (positive expected return on
 *     the warm-start itself).
 *
 * --------------------------------------------------------------------------
 * Audit-trail design (per post-launch hardening sprint plan, item 7)
 * --------------------------------------------------------------------------
 *   - `credit_ledger.txn_type` = `'amm_warmstart_debit'` (NOT `'amm_buy'`)
 *     so the warm-start cost is filterable separately from human/agent
 *     trades, and the seed-return drift audit can include it cleanly.
 *   - `credit_ledger.idempotency_key` = `amm_warmstart_${marketId}` (NOT
 *     the per-bet `amm_buy_${betId}` shape). Survives market-open retries
 *     idempotently on the MARKET — same lifecycle that re-runs seeding.
 *   - `market_bets.bet_metadata` = `{ source: 'house_warm_start',
 *     priorSignal: 'scoreDelta7d', priorMagnitude, targetPrice }` so a
 *     future analysis can answer "did warm-starts help" without joining
 *     the credit_ledger.
 *
 * --------------------------------------------------------------------------
 * Scope guardrails
 * --------------------------------------------------------------------------
 *   - Up/Down per-person markets only. H2H and gainer/race priors are
 *     fuzzier (multiple people, each with their own delta) and the cost
 *     scales with N. v1 is binary-only.
 *   - Hard-capped at 60/40 target. Over-committing the prior gives sharps
 *     free money WHEN the signal is wrong — which it will be on some
 *     fraction of markets.
 *   - Driven by `scoreDelta7d` (the same signal the deterministic agent
 *     engine uses), NOT `pctChangeVsOpen` which is 0 by definition at
 *     open.
 *   - Gated behind `WARM_START_PRIORS_ENABLED` env var (default false)
 *     so we can ship the code and validate the persona-band P&L tile
 *     before turning it on globally.
 */

import { and, eq, sql } from "drizzle-orm";
import {
  creditLedger,
  marketAmmState,
  marketBets,
  profiles,
  trendingPeople,
} from "@shared/schema";
import { buyCost } from "@shared/lib/amm/lmsr";
import type { db as DbType } from "../db";
import { db } from "../db";
import { log } from "../log";
import { HOUSE_PROFILE_ID } from "./amm-house";

type DbOrTx = Pick<typeof DbType, "select" | "insert" | "update">;

// ---------------------------------------------------------------------------
// Feature flag + tunable thresholds
// ---------------------------------------------------------------------------

/**
 * Lenient flag parser. Mirrors `envFlag` in `server/agents/constants.ts`
 * so e.g. `WARM_START_PRIORS_ENABLED=TRUE` in Railway works correctly.
 */
function envFlag(value: string | undefined): boolean {
  if (typeof value !== "string") return false;
  const v = value.trim().toLowerCase();
  return v === "true" || v === "1" || v === "yes" || v === "on";
}

/**
 * Master kill-switch for warm-start priors. Default OFF so a deploy of
 * this code is a pure no-op until the operator flips the flag once the
 * persona-band P&L tile shows the cold-start gap really is leaking value.
 */
export const WARM_START_PRIORS_ENABLED = envFlag(process.env.WARM_START_PRIORS_ENABLED);

/**
 * `scoreDelta7d` magnitude thresholds for picking the target price. The
 * column is stored as percentage points (e.g. `5.0` = +5%). Below the
 * MIN threshold we skip warm-start entirely — noise dominates and warm-
 * starting on a noise signal is the worst-case "house funds the sharp's
 * exit" scenario. The STRONG threshold opens up the more-aggressive
 * 60/40 prior; between MIN and STRONG we use a softer 55/45.
 *
 * Why these specific numbers:
 *   - ±2pp: a typical week's noise-floor on the Trend Score. Anything
 *     below this is statistical noise, not signal.
 *   - ±5pp: roughly a 1-sigma weekly move on the highest-volume
 *     celebrities. Past this point the trend is real enough to be
 *     worth the more-aggressive prior.
 */
export const WARM_START_MIN_DELTA_PCT = 2.0;
export const WARM_START_STRONG_DELTA_PCT = 5.0;

/**
 * Target prices, hard-capped. NEVER raise these above 0.65 — sharps
 * eat the difference when the prior is wrong, and the warm-start cost
 * scales steeply (the LMSR cost-to-shift is convex). 0.55 / 0.60 keeps
 * the house's per-market exposure to ~600-1600 credits each.
 */
export const WARM_START_SOFT_TARGET = 0.55;
export const WARM_START_STRONG_TARGET = 0.60;

/**
 * Picks the warm-start target for a given 7-day delta. Returns null
 * when the delta is below threshold (no warm-start fires).
 *
 *   `targetPrice`: marginal price the warmed side should open at.
 *   `direction`:   "up" or "down" — which side to warm-buy.
 *   `magnitude`:   absolute delta in percentage points, persisted for
 *                  later analysis ("did stronger signals out-earn?").
 *
 * Pure function — exported for unit testing.
 */
export function pickWarmStartTarget(
  scoreDelta7dPct: number | null | undefined,
): { targetPrice: number; direction: "up" | "down"; magnitude: number } | null {
  if (
    scoreDelta7dPct == null ||
    !Number.isFinite(scoreDelta7dPct) ||
    Math.abs(scoreDelta7dPct) < WARM_START_MIN_DELTA_PCT
  ) {
    return null;
  }
  const magnitude = Math.abs(scoreDelta7dPct);
  const direction: "up" | "down" = scoreDelta7dPct > 0 ? "up" : "down";
  const targetPrice =
    magnitude >= WARM_START_STRONG_DELTA_PCT
      ? WARM_START_STRONG_TARGET
      : WARM_START_SOFT_TARGET;
  return { targetPrice, direction, magnitude };
}

/**
 * For a binary market starting at q = [0, 0], the shares to buy on side
 * `i` to move that side's marginal price to `targetPrice` solves
 *
 *     targetPrice = exp(q_i / b) / (exp(q_i / b) + 1)
 *   → q_i = b · ln(targetPrice / (1 - targetPrice))
 *
 * The cost of those shares from a clean q is then `buyCost(q=[0,0], i, q_i, b)`.
 *
 * Pure helper — exported for unit testing.
 */
export function computeWarmStartShares(
  b: number,
  targetPrice: number,
): { shares: number; cost: number } {
  if (targetPrice <= 0.5 || targetPrice >= 1.0) {
    throw new Error(
      `[ammWarmstart] computeWarmStartShares: targetPrice must be in (0.5, 1.0), got ${targetPrice}`,
    );
  }
  const shares = b * Math.log(targetPrice / (1 - targetPrice));
  const cost = buyCost([0, 0], 0, shares, b);
  return { shares, cost };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface ApplyWarmStartPriorInput {
  marketId: string;
  /** Entry IDs in canonical order. Index 0 must be "Up", index 1 "Down". */
  outcomeOrder: [string, string];
  personId: string;
}

export type WarmStartOutcome =
  | { applied: true; direction: "up" | "down"; targetPrice: number; magnitude: number; shares: number; cost: number; betId: string }
  | { applied: false; reason: "disabled" | "no_signal" | "below_threshold" | "no_state" | "no_house" | "already_applied" | "no_balance" };

/**
 * Run the warm-start path for a freshly-seeded Up/Down market.
 *
 * Idempotent — re-running on the same marketId is a no-op (returns
 * `applied: false, reason: 'already_applied'`). Safe to call from
 * either the cron-driven weekly generator or the per-inductee ensure
 * path; both eventually converge.
 *
 * Designed to be called inside the same transaction as `seedAmmMarket`
 * so the warm-buy is atomic with the seed: either the market is fully
 * seeded + warmed at open, or neither happens. Pass `txOpt` to compose,
 * or omit to let the function open its own transaction.
 */
export async function applyWarmStartPrior(
  input: ApplyWarmStartPriorInput,
  txOpt?: DbOrTx,
): Promise<WarmStartOutcome> {
  if (!WARM_START_PRIORS_ENABLED) {
    return { applied: false, reason: "disabled" };
  }

  const run = async (tx: DbOrTx): Promise<WarmStartOutcome> => {
    // Idempotency short-circuit: ledger row keyed on marketId is the
    // single source of truth for "this market has already been warm-started."
    const idempotencyKey = `amm_warmstart_${input.marketId}`;
    const [existingLedger] = await tx
      .select({ amount: creditLedger.amount })
      .from(creditLedger)
      .where(
        and(
          eq(creditLedger.userId, HOUSE_PROFILE_ID),
          eq(creditLedger.idempotencyKey, idempotencyKey),
        ),
      )
      .limit(1);
    if (existingLedger) {
      return { applied: false, reason: "already_applied" };
    }

    // Load the 7-day delta. `change7d` lives on `trending_people`, in
    // percentage points (e.g. 5.0 = +5%) — same source the deterministic
    // agent decision engine reads.
    const [person] = await tx
      .select({ change7d: trendingPeople.change7d })
      .from(trendingPeople)
      .where(eq(trendingPeople.id, input.personId))
      .limit(1);
    const signal = pickWarmStartTarget(person?.change7d ?? null);
    if (!signal) {
      return {
        applied: false,
        reason: person?.change7d == null ? "no_signal" : "below_threshold",
      };
    }

    // Load market AMM state. Must exist because seedAmmMarket runs
    // before applyWarmStartPrior in the market-generator path. If it
    // doesn't, that's a real bug we want to surface, not silently swallow.
    //
    // We deliberately don't read `totalUserCreditsIn` here — the warm-
    // buy never mutates it (warm-start credits are tracked separately
    // via the dedicated `amm_warmstart_debit` ledger entry; see the
    // module-level docstring + checkSeedReturnDrift).
    const [state] = await tx
      .select({
        liquidityB: marketAmmState.liquidityB,
        shareQuantities: marketAmmState.shareQuantities,
        outcomeOrder: marketAmmState.outcomeOrder,
      })
      .from(marketAmmState)
      .where(eq(marketAmmState.marketId, input.marketId))
      .limit(1);
    if (!state) {
      log(
        `[ammWarmstart] No market_amm_state row for market=${input.marketId}; ` +
          `seedAmmMarket must have failed or wasn't called.`,
      );
      return { applied: false, reason: "no_state" };
    }

    const b = Number(state.liquidityB);
    if (!Number.isFinite(b) || b <= 0) {
      log(`[ammWarmstart] Invalid liquidityB=${state.liquidityB} for market=${input.marketId}`);
      return { applied: false, reason: "no_state" };
    }

    const targetEntryId =
      signal.direction === "up" ? input.outcomeOrder[0] : input.outcomeOrder[1];

    const { shares, cost } = computeWarmStartShares(b, signal.targetPrice);
    const chargeCredits = Math.ceil(cost);

    // Atomic decrement-with-balance-check on the house wallet. Same
    // pattern as seedAmmMarket: if the house can't cover the warm-start,
    // we bail and let the seed continue (market just opens at 50/50,
    // same as before this feature existed). Better than failing the
    // whole market creation.
    const [updatedHouse] = await tx
      .update(profiles)
      .set({
        predictCredits: sql`${profiles.predictCredits} - ${chargeCredits}`,
      })
      .where(
        sql`${profiles.id} = ${HOUSE_PROFILE_ID} AND ${profiles.predictCredits} >= ${chargeCredits}`,
      )
      .returning({ predictCredits: profiles.predictCredits });
    if (!updatedHouse) {
      log(
        `[ammWarmstart] House insufficient credits for warm-start ` +
          `(need ${chargeCredits}) on market=${input.marketId}. Skipping warm-start.`,
      );
      return { applied: false, reason: "no_balance" };
    }

    // Apply the share delta to the canonical q[] vector.
    const newShareQuantities = {
      ...(state.shareQuantities as Record<string, number>),
    };
    newShareQuantities[targetEntryId] =
      (newShareQuantities[targetEntryId] ?? 0) + shares;

    await tx
      .update(marketAmmState)
      .set({
        shareQuantities: newShareQuantities,
        // NOTE: deliberately NOT incrementing totalUserCreditsIn. The
        // warm-start cost is house money, not user money, and is
        // tracked separately via the ledger row + the seed-return
        // drift audit's adjusted formula. Keeps the semantics of
        // `totalUserCreditsIn = net real-user flows` intact.
        updatedAt: new Date(),
      })
      .where(eq(marketAmmState.marketId, input.marketId));

    // Compute the average per-share price for the bet row. Same
    // formula `executeBuy` uses: cost / shares.
    const avgPricePerShare = shares > 0 ? cost / shares : 0;

    const [insertedBet] = await tx
      .insert(marketBets)
      .values({
        marketId: input.marketId,
        entryId: targetEntryId,
        userId: HOUSE_PROFILE_ID,
        agentId: null,
        stakeAmount: chargeCredits,
        actionType: "buy",
        shareCount: shares.toString(),
        pricePerShare: avgPricePerShare.toString(),
        direction: "yes",
        status: "active",
        potentialPayout: Math.floor(shares),
        // Plan-spec'd metadata for future "did warm-starts help" analysis.
        // `entryId` on the bet row already tells us which side was warmed,
        // so we don't restate it here. `priorSignal` names the input
        // signal so a future plan can add e.g. `scoreDelta14d` priors
        // without overloading this field.
        betMetadata: {
          source: "house_warm_start",
          priorSignal: "scoreDelta7d",
          priorMagnitude: signal.magnitude,
          targetPrice: signal.targetPrice,
        },
      })
      .returning({ id: marketBets.id });

    await tx.insert(creditLedger).values({
      userId: HOUSE_PROFILE_ID,
      // New txn type — `amm_warmstart_debit` keeps warm-start
      // outflow distinct from `amm_seed_debit` in audit queries while
      // staying recognisably "the house funded this market" in the
      // categorisation.
      txnType: "amm_warmstart_debit",
      amount: -chargeCredits,
      walletType: "VIRTUAL",
      balanceAfter: updatedHouse.predictCredits,
      source: "system",
      idempotencyKey,
      metadata: {
        marketId: input.marketId,
        entryId: targetEntryId,
        betId: insertedBet.id,
        shares,
        targetPrice: signal.targetPrice,
        priorSignal: "scoreDelta7d",
        priorMagnitude: signal.magnitude,
      },
    });

    return {
      applied: true,
      direction: signal.direction,
      targetPrice: signal.targetPrice,
      magnitude: signal.magnitude,
      shares,
      cost: chargeCredits,
      betId: insertedBet.id,
    };
  };

  return txOpt ? run(txOpt) : db.transaction(async (tx) => run(tx as DbOrTx));
}

// ---------------------------------------------------------------------------
// Helper exposed for audit code — sum total warm-start cost for a
// single market from the credit ledger. Used by `checkSeedReturnDrift`
// to add the warm-start outflow to the expected drift formula.
// ---------------------------------------------------------------------------
export async function getWarmStartCostForMarket(
  marketId: string,
  txOpt?: DbOrTx,
): Promise<number> {
  const exec = (txOpt ?? db) as DbOrTx;
  const rows = await exec
    .select({
      total: sql<string>`COALESCE(SUM(-${creditLedger.amount}), 0)`,
    })
    .from(creditLedger)
    .where(
      and(
        eq(creditLedger.userId, HOUSE_PROFILE_ID),
        eq(creditLedger.txnType, "amm_warmstart_debit"),
        sql`${creditLedger.metadata}->>'marketId' = ${marketId}`,
      ),
    );
  return Number(rows[0]?.total ?? 0);
}

// Re-export the verifier-facing constants for tests + admin tools so the
// "what aggressiveness are we running?" knob has one import path.
export const WARM_START_TUNABLES = {
  MIN_DELTA_PCT: WARM_START_MIN_DELTA_PCT,
  STRONG_DELTA_PCT: WARM_START_STRONG_DELTA_PCT,
  SOFT_TARGET: WARM_START_SOFT_TARGET,
  STRONG_TARGET: WARM_START_STRONG_TARGET,
} as const;
