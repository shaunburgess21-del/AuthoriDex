/**
 * House account + AMM seed/return helpers.
 *
 * Phase 2 of the parimutuel -> AMM rebuild. The "house" is a singleton
 * profile (`__house__`, fixed UUID below) that holds virtual liquidity
 * used to seed every AMM market at open and absorbs net P&L at
 * settlement.
 *
 *   open      -> debit `ceil(b · ln(N))` from house, credit AMM,
 *                insert `market_amm_state` row with q = 0.
 *   settle    -> credit house with (seed + totalUserCreditsIn − payout
 *                liability). Phase 3 wires this into market-resolver.
 *
 * Both flows are idempotent via `credit_ledger.idempotency_key` so
 * retries are safe.
 */

import { eq, sql } from "drizzle-orm";
import {
  creditLedger,
  marketAmmState,
  predictionMarkets,
  profiles,
} from "@shared/schema";
import { initialSeedCost, seedB } from "@shared/lib/amm/lmsr";
import { db } from "../db";
import { getTargetMaxLoss } from "../config/amm";

/**
 * Singleton profile that owns virtual liquidity for every AMM market.
 * Created idempotently in migration 0052_amm_phase_2.sql. Listings,
 * leaderboards, mentions etc. should filter `WHERE NOT is_house`
 * the same way they filter `WHERE NOT is_agent`.
 */
export const HOUSE_PROFILE_ID = "00000000-0000-0000-0000-0000000000aa";

/**
 * Narrow tx-shape the helpers below need. Both the top-level `db` and
 * the `tx` argument from `db.transaction(async tx => ...)` satisfy it,
 * so callers can either pass `db` directly (helper opens its own
 * transaction) or thread an existing tx through.
 */
type DbOrTx = Pick<typeof db, "select" | "insert" | "update">;

export interface SeedAmmMarketInput {
  marketId: string;
  marketType?: string | null;
  /** Entry IDs in canonical order. Length defines numOutcomes. */
  entryIdsInOrder: string[];
  /** Override the default `targetMaxLoss` for this market. */
  targetMaxLoss?: number | null;
}

export interface SeedAmmMarketResult {
  marketId: string;
  liquidityB: number;
  houseSeedAmount: number;
  /** True if this call actually performed the seed; false if the
   *  market was already seeded (idempotent retry no-op). */
  seeded: boolean;
}

// ---------------------------------------------------------------------------
// Pure-function pieces (also exported for unit testing)
// ---------------------------------------------------------------------------

/**
 * Build the initial AMM state shape: every entry starts at 0 shares.
 * Pure function — no DB, no side effects. Returned in the format the
 * `market_amm_state` row expects.
 */
export function buildInitialQVector(entryIdsInOrder: string[]): {
  outcomeOrder: string[];
  shareQuantities: Record<string, number>;
} {
  if (!Array.isArray(entryIdsInOrder) || entryIdsInOrder.length < 2) {
    throw new Error(
      `[ammHouse] buildInitialQVector requires >= 2 entry IDs, got ${entryIdsInOrder?.length ?? "non-array"}`,
    );
  }
  const seen = new Set<string>();
  const shareQuantities: Record<string, number> = {};
  for (const id of entryIdsInOrder) {
    if (typeof id !== "string" || id.length === 0) {
      throw new Error(`[ammHouse] entry IDs must be non-empty strings, got ${id}`);
    }
    if (seen.has(id)) {
      throw new Error(`[ammHouse] duplicate entry ID in outcomeOrder: ${id}`);
    }
    seen.add(id);
    shareQuantities[id] = 0;
  }
  return { outcomeOrder: entryIdsInOrder.slice(), shareQuantities };
}

/**
 * Pick the LMSR liquidity parameter `b` and the integer credit seed
 * cost for a market. Pure — composes `getTargetMaxLoss` (config
 * lookup) with `seedB` and `initialSeedCost` (Phase 1 math).
 *
 * Cost is rounded UP at the credit-debit boundary (favours house,
 * standard AMM convention).
 */
export function pickB(
  numOutcomes: number,
  marketType?: string | null,
  override?: number | null,
): { liquidityB: number; houseSeedAmount: number; targetMaxLoss: number } {
  const targetMaxLoss = getTargetMaxLoss(marketType, override);
  const liquidityB = seedB(numOutcomes, targetMaxLoss);
  const houseSeedAmount = Math.ceil(initialSeedCost(numOutcomes, liquidityB));
  return { liquidityB, houseSeedAmount, targetMaxLoss };
}

// ---------------------------------------------------------------------------
// DB-touching seed helper
// ---------------------------------------------------------------------------

/**
 * Seed an AMM market: insert the `market_amm_state` row, debit the
 * house account, write a credit-ledger entry. All inside a single
 * transaction (or the caller's tx if one is provided). Idempotent on
 * `idempotencyKey = amm_seed_${marketId}` so a retry after a partial
 * crash returns the existing state without double-debiting.
 *
 * Caller must:
 *   - Have already inserted the `prediction_markets` row with
 *     `engine = 'amm'`.
 *   - Have already inserted the `market_entries` rows whose IDs are
 *     passed in `entryIdsInOrder`.
 *
 * Phase 3 will wire this into the buy/sell endpoints (lazy seed on
 * first trade) or into market creation (eager seed at open).
 */
export async function seedAmmMarket(
  input: SeedAmmMarketInput,
  txOpt?: DbOrTx,
): Promise<SeedAmmMarketResult> {
  const { marketId, entryIdsInOrder } = input;
  const numOutcomes = entryIdsInOrder.length;

  const { outcomeOrder, shareQuantities } = buildInitialQVector(entryIdsInOrder);
  const { liquidityB, houseSeedAmount } = pickB(numOutcomes, input.marketType, input.targetMaxLoss);

  const idempotencyKey = `amm_seed_${marketId}`;

  const run = async (tx: DbOrTx): Promise<SeedAmmMarketResult> => {
    // Idempotency check: if the credit-ledger row already exists we've
    // already seeded this market. Just return the stored b/seed without
    // touching anything.
    const existingLedger = await tx
      .select({ amount: creditLedger.amount })
      .from(creditLedger)
      .where(
        sql`${creditLedger.userId} = ${HOUSE_PROFILE_ID} AND ${creditLedger.idempotencyKey} = ${idempotencyKey}`,
      )
      .limit(1);
    if (existingLedger.length > 0) {
      const [existingState] = await tx
        .select({
          liquidityB: marketAmmState.liquidityB,
          houseSeedAmount: marketAmmState.houseSeedAmount,
        })
        .from(marketAmmState)
        .where(eq(marketAmmState.marketId, marketId))
        .limit(1);
      // Hard data-consistency check: if the ledger row exists but the
      // state row doesn't, something has corrupted our bookkeeping (the
      // two writes are inside the same transaction, so either both
      // landed or neither did). Fail loud rather than silently
      // returning recomputed (possibly mismatched) values.
      if (!existingState) {
        throw new Error(
          `[ammHouse] Data inconsistency for market ${marketId}: amm_seed_debit ledger row exists ` +
          `but market_amm_state row is missing. Manual repair required.`,
        );
      }
      return {
        marketId,
        liquidityB: Number(existingState.liquidityB),
        houseSeedAmount: existingState.houseSeedAmount,
        seeded: false,
      };
    }

    // Insert AMM state. ON CONFLICT DO NOTHING covers a race where two
    // concurrent calls both pass the ledger check — the loser silently
    // skips the insert; the credit-ledger insert below will then fail
    // its unique-key check and the loser's outer transaction rolls back
    // cleanly.
    await tx
      .insert(marketAmmState)
      .values({
        marketId,
        liquidityB: liquidityB.toString(),
        outcomeOrder,
        shareQuantities,
        houseSeedAmount,
        totalUserCreditsIn: "0",
      })
      .onConflictDoNothing({ target: marketAmmState.marketId });

    // Atomic decrement-with-balance-check on the house profile. If the
    // house ever runs dry on virtual credits, this will fail with
    // "house insufficient credits" and the whole transaction rolls
    // back — better than silently running a negative balance.
    const [updatedHouse] = await tx
      .update(profiles)
      .set({
        predictCredits: sql`${profiles.predictCredits} - ${houseSeedAmount}`,
      })
      .where(
        sql`${profiles.id} = ${HOUSE_PROFILE_ID} AND ${profiles.predictCredits} >= ${houseSeedAmount}`,
      )
      .returning({ predictCredits: profiles.predictCredits });

    if (!updatedHouse) {
      throw new Error(
        `[ammHouse] House profile is missing or has insufficient credits to seed market ${marketId} ` +
        `(needed ${houseSeedAmount}). Top up the house or apply migration 0052 first.`,
      );
    }

    await tx.insert(creditLedger).values({
      userId: HOUSE_PROFILE_ID,
      txnType: "amm_seed_debit",
      amount: -houseSeedAmount,
      walletType: "VIRTUAL",
      balanceAfter: updatedHouse.predictCredits,
      source: "amm_seed",
      idempotencyKey,
      metadata: {
        marketId,
        liquidityB,
        numOutcomes,
        marketType: input.marketType ?? null,
      },
    });

    return { marketId, liquidityB, houseSeedAmount, seeded: true };
  };

  if (txOpt) return run(txOpt);
  return db.transaction(async (tx) => run(tx as DbOrTx));
}

// ---------------------------------------------------------------------------
// Settlement-time seed return
// ---------------------------------------------------------------------------

export interface ReturnAmmSeedInput {
  marketId: string;
  /**
   * Total credits paid out to user share-holders at settlement
   * (= q[winnerIdx] in LMSR, ceiled per share at the route boundary).
   */
  payoutLiability: number;
}

export interface ReturnAmmSeedResult {
  marketId: string;
  /** Credits returned to house for this market (can be negative —
   *  represents a house loss bounded by `b · ln(N)`). */
  creditedToHouse: number;
  /** True if this call performed the credit; false on idempotent retry. */
  returned: boolean;
}

/**
 * Settle the house wallet for an AMM market. Called once per market
 * from `amm-resolver.ts::resolveAmmMarket` (both the winner-payout
 * path and the void/refund path). Live and exercised in production.
 *
 * Behaviour:
 *   - Computes `creditedToHouse = round(houseSeed + totalUserCreditsIn − payoutLiability)`.
 *   - Credits `HOUSE_PROFILE_ID`'s `predictCredits` and writes a
 *     `credit_ledger` row with `txnType='amm_settle_credit'` and
 *     `idempotencyKey='amm_settle_${marketId}'`.
 *   - Idempotent on retry — re-invocation after a partial crash returns
 *     the previously-credited amount with `returned=false`.
 *
 * The returned amount can be negative (house took an LMSR loss bounded
 * by `b · ln(N)`); the credit_ledger always stores the signed amount.
 *
 * The same audit fields (`creditedToHouse`, `payoutLiability`) are also
 * stamped into `prediction_markets.resolution_notes` by the auto-resolver
 * so the seed-return drift health check (`server/jobs/amm-health.ts`) can
 * reconcile every native auto-resolved market without re-querying the
 * ledger.
 */
export async function returnAmmSeedAtSettlement(
  input: ReturnAmmSeedInput,
  txOpt?: DbOrTx,
): Promise<ReturnAmmSeedResult> {
  const { marketId, payoutLiability } = input;
  if (!Number.isFinite(payoutLiability) || payoutLiability < 0) {
    throw new Error(
      `[ammHouse] payoutLiability must be a non-negative finite number, got ${payoutLiability}`,
    );
  }

  const idempotencyKey = `amm_settle_${marketId}`;

  const run = async (tx: DbOrTx): Promise<ReturnAmmSeedResult> => {
    const existingLedger = await tx
      .select({ amount: creditLedger.amount })
      .from(creditLedger)
      .where(
        sql`${creditLedger.userId} = ${HOUSE_PROFILE_ID} AND ${creditLedger.idempotencyKey} = ${idempotencyKey}`,
      )
      .limit(1);
    if (existingLedger.length > 0) {
      return {
        marketId,
        creditedToHouse: existingLedger[0].amount,
        returned: false,
      };
    }

    const [state] = await tx
      .select({
        houseSeedAmount: marketAmmState.houseSeedAmount,
        totalUserCreditsIn: marketAmmState.totalUserCreditsIn,
      })
      .from(marketAmmState)
      .where(eq(marketAmmState.marketId, marketId))
      .limit(1);

    if (!state) {
      throw new Error(`[ammHouse] No AMM state for market ${marketId} — cannot settle`);
    }

    // Verify the market is actually an AMM market before crediting
    // the house from its seed pool.
    const [market] = await tx
      .select({ engine: predictionMarkets.engine })
      .from(predictionMarkets)
      .where(eq(predictionMarkets.id, marketId))
      .limit(1);
    if (!market || market.engine !== "amm") {
      throw new Error(
        `[ammHouse] Market ${marketId} is not an AMM market (engine=${market?.engine ?? "null"}); ` +
        `refusing to credit house from non-AMM seed.`,
      );
    }

    const totalIn = Number(state.totalUserCreditsIn);
    if (!Number.isFinite(totalIn)) {
      throw new Error(
        `[ammHouse] market_amm_state.total_user_credits_in is not a finite number for ${marketId}: ${state.totalUserCreditsIn}`,
      );
    }
    // Net credited back: AMM holding (seed + creditsIn) minus payout.
    const creditedToHouse = Math.round(state.houseSeedAmount + totalIn - payoutLiability);

    const [updatedHouse] = await tx
      .update(profiles)
      .set({
        predictCredits: sql`${profiles.predictCredits} + ${creditedToHouse}`,
      })
      .where(eq(profiles.id, HOUSE_PROFILE_ID))
      .returning({ predictCredits: profiles.predictCredits });

    if (!updatedHouse) {
      throw new Error(`[ammHouse] House profile ${HOUSE_PROFILE_ID} not found`);
    }

    await tx.insert(creditLedger).values({
      userId: HOUSE_PROFILE_ID,
      txnType: "amm_settle_credit",
      amount: creditedToHouse,
      walletType: "VIRTUAL",
      balanceAfter: updatedHouse.predictCredits,
      source: "amm_settle",
      idempotencyKey,
      metadata: {
        marketId,
        houseSeedAmount: state.houseSeedAmount,
        totalUserCreditsIn: totalIn,
        payoutLiability,
      },
    });

    return { marketId, creditedToHouse, returned: true };
  };

  if (txOpt) return run(txOpt);
  return db.transaction(async (tx) => run(tx as DbOrTx));
}
