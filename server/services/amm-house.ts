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
  marketEntries,
  predictionMarkets,
  profiles,
} from "@shared/schema";
import {
  cost,
  initialSeedCost,
  normalizeSeedPrices,
  seedB,
  seedBFromPrices,
  seedQFromPrices,
} from "@shared/lib/amm/lmsr";
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
  /**
   * Optional target opening prices aligned with `entryIdsInOrder`
   * (Market Scout price-matched seeding). When provided and valid, the
   * market opens at these prices via a virtual q₀ vector instead of
   * uniform 1/N. Worst-case house loss stays exactly `targetMaxLoss`.
   * Invalid/missing → silent fallback to the uniform path.
   */
  initialPrices?: number[] | null;
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

/**
 * Compute the full initial AMM state for a market: `b`, the integer
 * house seed, and the initial q vector. When `initialPrices` is a
 * valid vector (Market Scout imports), the market opens price-matched
 * via a virtual q₀ (see `shared/lib/amm/lmsr.ts` derivation); worst-
 * case house loss stays exactly `targetMaxLoss` on both paths. Pure —
 * exported for unit testing.
 */
export function pickSeedState(
  entryIdsInOrder: string[],
  marketType?: string | null,
  targetMaxLossOverride?: number | null,
  initialPrices?: number[] | null,
): {
  liquidityB: number;
  houseSeedAmount: number;
  targetMaxLoss: number;
  outcomeOrder: string[];
  shareQuantities: Record<string, number>;
  priceMatched: boolean;
} {
  const numOutcomes = entryIdsInOrder.length;
  const { outcomeOrder, shareQuantities } = buildInitialQVector(entryIdsInOrder);

  const normPrices = normalizeSeedPrices(initialPrices ?? null, numOutcomes);
  if (!normPrices) {
    const uniform = pickB(numOutcomes, marketType, targetMaxLossOverride);
    return { ...uniform, outcomeOrder, shareQuantities, priceMatched: false };
  }

  const targetMaxLoss = getTargetMaxLoss(marketType, targetMaxLossOverride);
  const liquidityB = seedBFromPrices(normPrices, targetMaxLoss);
  const q0 = seedQFromPrices(normPrices, liquidityB);
  for (let i = 0; i < outcomeOrder.length; i++) {
    shareQuantities[outcomeOrder[i]] = q0[i];
  }
  // House deposits C(q₀) = worst-case loss (min q₀ = 0). Rounded UP at
  // the credit boundary, same convention as the uniform path.
  const houseSeedAmount = Math.ceil(cost(q0, liquidityB));
  return { liquidityB, houseSeedAmount, targetMaxLoss, outcomeOrder, shareQuantities, priceMatched: true };
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

  const { outcomeOrder, shareQuantities, liquidityB, houseSeedAmount, priceMatched } = pickSeedState(
    entryIdsInOrder,
    input.marketType,
    input.targetMaxLoss,
    input.initialPrices,
  );

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
        ...(priceMatched ? { priceMatched: true, initialPrices: input.initialPrices } : {}),
      },
    });

    return { marketId, liquidityB, houseSeedAmount, seeded: true };
  };

  if (txOpt) return run(txOpt);
  return db.transaction(async (tx) => run(tx as DbOrTx));
}

/**
 * Read `metadata.source.pricesAtImport` from a market row's metadata —
 * the consensus prices captured when the Market Scout imported the
 * market from an external source (aligned with entry displayOrder).
 * Returns null when absent/malformed so callers fall back to uniform
 * seeding. Exported for unit testing.
 */
export function readPricesAtImport(metadata: unknown): number[] | null {
  if (!metadata || typeof metadata !== "object") return null;
  const source = (metadata as Record<string, unknown>).source;
  if (!source || typeof source !== "object") return null;
  const prices = (source as Record<string, unknown>).pricesAtImport;
  if (!Array.isArray(prices) || prices.length < 2) return null;
  if (prices.some((p) => typeof p !== "number" || !Number.isFinite(p) || p < 0)) return null;
  return prices as number[];
}

/**
 * Verify that the market's CURRENT entry labels still line up with the
 * `metadata.source.outcomeMapping` captured at import (which shares its
 * ordering with `pricesAtImport`). An admin who reordered or replaced
 * entries after import would otherwise get the source prices applied to
 * the wrong outcomes. Missing mapping (non-scouted market) or any
 * positional mismatch → false → caller seeds uniform. Exported for
 * unit testing.
 */
export function entriesMatchImportMapping(
  metadata: unknown,
  entryLabelsInOrder: string[],
): boolean {
  if (!metadata || typeof metadata !== "object") return false;
  const source = (metadata as Record<string, unknown>).source;
  if (!source || typeof source !== "object") return false;
  const mapping = (source as Record<string, unknown>).outcomeMapping;
  if (!Array.isArray(mapping) || mapping.length !== entryLabelsInOrder.length) return false;
  return mapping.every((m, i) => {
    if (!m || typeof m !== "object") return false;
    const current = entryLabelsInOrder[i]?.trim().toLowerCase();
    if (!current) return false;
    const { entryLabel, sourceLabel } = m as { entryLabel?: unknown; sourceLabel?: unknown };
    return [entryLabel, sourceLabel].some(
      (l) => typeof l === "string" && l.trim().toLowerCase() === current,
    );
  });
}

/**
 * Seed a world (community) market when it goes live. No-op if AMM state
 * already exists (idempotent).
 *
 * Scout-imported markets (with `metadata.source.pricesAtImport`) open
 * price-matched to the source market's consensus instead of uniform
 * 1/N — otherwise an obviously-decided event would open at coin-flip
 * odds and early traders could farm the gap. The price lookup is
 * best-effort: any mismatch falls back to uniform seeding.
 */
export async function ensureWorldMarketAmmSeeded(
  marketId: string,
  entryIdsInOrder: string[],
  txOpt?: DbOrTx,
): Promise<void> {
  const conn = txOpt ?? db;
  const [existing] = await conn
    .select({ marketId: marketAmmState.marketId })
    .from(marketAmmState)
    .where(eq(marketAmmState.marketId, marketId))
    .limit(1);
  if (existing) return;

  let initialPrices: number[] | null = null;
  try {
    const [marketRow] = await conn
      .select({ metadata: predictionMarkets.metadata })
      .from(predictionMarkets)
      .where(eq(predictionMarkets.id, marketId))
      .limit(1);
    const prices = readPricesAtImport(marketRow?.metadata);
    // Alignment guards: pricesAtImport is stored aligned with entry
    // displayOrder, which is exactly the order of entryIdsInOrder at
    // both call sites. A length mismatch — or entry labels that no
    // longer line up with the import's outcomeMapping (admin edited or
    // reordered entries before publishing) — means the price vector
    // can't be trusted; fall back to uniform rather than guess.
    if (prices && prices.length === entryIdsInOrder.length) {
      const entryRows = await conn
        .select({ id: marketEntries.id, label: marketEntries.label })
        .from(marketEntries)
        .where(eq(marketEntries.marketId, marketId));
      const labelById = new Map(entryRows.map((e) => [e.id, e.label]));
      const labelsInOrder = entryIdsInOrder.map((id) => labelById.get(id) ?? "");
      if (entriesMatchImportMapping(marketRow?.metadata, labelsInOrder)) {
        initialPrices = prices;
      }
    }
  } catch {
    initialPrices = null;
  }

  await seedAmmMarket(
    { marketId, marketType: "community", entryIdsInOrder, initialPrices },
    txOpt,
  );
}

/**
 * Keep an already-seeded AMM state's outcomeOrder / shareQuantities in
 * sync when an admin adds or removes a zero-share outcome (typically
 * toggling "Other" on a live World Market).
 *
 * - Missing entry IDs are appended with q=0.
 * - Extra entry IDs are dropped only when their share quantity is ~0
 *   (never silently erase open positions).
 *
 * No-op when no AMM state row exists (still draft / unseeded).
 */
export async function syncAmmOutcomeOrderWithEntries(
  marketId: string,
  entryIdsInOrder: string[],
  txOpt?: DbOrTx,
): Promise<{ added: string[]; removed: string[]; skippedNonZero: string[] }> {
  const conn = txOpt ?? db;
  const [existing] = await conn
    .select({
      outcomeOrder: marketAmmState.outcomeOrder,
      shareQuantities: marketAmmState.shareQuantities,
    })
    .from(marketAmmState)
    .where(eq(marketAmmState.marketId, marketId))
    .limit(1);

  if (!existing) {
    return { added: [], removed: [], skippedNonZero: [] };
  }

  const prevOrder = (existing.outcomeOrder as string[] | null) ?? [];
  const shares = {
    ...((existing.shareQuantities as Record<string, number> | null) ?? {}),
  };
  const desired = entryIdsInOrder.slice();
  const desiredSet = new Set(desired);
  const prevSet = new Set(prevOrder);

  const added: string[] = [];
  const removed: string[] = [];
  const skippedNonZero: string[] = [];

  let nextOrder = prevOrder.filter((id) => {
    if (desiredSet.has(id)) return true;
    const q = Number(shares[id] ?? 0);
    if (Math.abs(q) > 1e-9) {
      skippedNonZero.push(id);
      return true; // keep — caller must not delete the entry either
    }
    delete shares[id];
    removed.push(id);
    return false;
  });

  for (const id of desired) {
    if (prevSet.has(id) || nextOrder.includes(id)) continue;
    nextOrder.push(id);
    shares[id] = 0;
    added.push(id);
  }

  // Prefer the caller's display order for IDs we still hold.
  const orderedDesired = desired.filter((id) => nextOrder.includes(id));
  const leftovers = nextOrder.filter((id) => !desiredSet.has(id));
  nextOrder = [...orderedDesired, ...leftovers];

  if (added.length === 0 && removed.length === 0) {
    return { added, removed, skippedNonZero };
  }

  await conn
    .update(marketAmmState)
    .set({
      outcomeOrder: nextOrder,
      shareQuantities: shares,
      updatedAt: new Date(),
    })
    .where(eq(marketAmmState.marketId, marketId));

  return { added, removed, skippedNonZero };
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
