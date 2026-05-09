/**
 * AMM trade execution helpers — Phase 3 of the parimutuel -> AMM rebuild.
 *
 * `executeBuy` and `executeSell` own the canonical sequence:
 *   1. SELECT FOR UPDATE on `market_amm_state` (serializes concurrent
 *      trades on the same market).
 *   2. Validate market state (engine, status, closeAt, visibility).
 *   3. Compute the trade math via `shared/lib/amm/positions.ts` +
 *      `shared/lib/amm/lmsr.ts`.
 *   4. Atomic profile credit/debit (with balance check on buys).
 *   5. UPDATE `market_amm_state` (q vector + totalUserCreditsIn).
 *   6. INSERT `market_bets` row capturing the trade.
 *   7. INSERT `credit_ledger` row (idempotent on `amm_buy_${betId}` /
 *      `amm_sell_${betId}`).
 *
 * Both functions accept an optional outer transaction (`tx`) for
 * composition; if not provided they open their own. The math and
 * rounding live in `shared/lib/amm/positions.ts` so the math-only
 * tests in `tests/amm-trades.test.ts` cover the same path the routes
 * use.
 */

import { and, eq, sql } from "drizzle-orm";
import {
  creditLedger,
  marketAmmState,
  marketBets,
  marketEntries,
  predictionMarkets,
  profiles,
} from "@shared/schema";
import {
  type AmmStateSnapshot,
  indexOfEntry,
  projectQ,
  quoteBuy,
  quoteSell,
} from "@shared/lib/amm/positions";
import { pricesAll } from "@shared/lib/amm/lmsr";
import { db } from "../db";

/**
 * Narrow tx-shape the helpers need. Both top-level `db` and the
 * `tx` argument from `db.transaction(async tx => ...)` satisfy it.
 */
type DbOrTx = Pick<typeof db, "select" | "insert" | "update" | "execute">;

/**
 * Minimum integer credits accepted on a buy. Mirrors the parimutuel
 * `MIN_BET_STAKE = 5` constant in `server/routes.ts`. Raised here so
 * tooling and tests can import a single source of truth.
 */
export const MIN_AMM_BUY_CREDITS = 5;

// ---------------------------------------------------------------------------
// Public API — buy
// ---------------------------------------------------------------------------

export interface ExecuteBuyInput {
  marketId: string;
  userId: string;
  entryId: string;
  /** Integer credit budget. Trade will charge `<= creditBudget` due
   *  to the conservative ceil-then-quote in `quoteBuy`. */
  creditBudget: number;
  /** True when the caller is an admin. Bypasses the `visibility='live'`
   *  gate so admins can trade in draft (smoke-test) markets. */
  isAdmin?: boolean;
  /** Optional agent attribution. Set when the caller is the agent
   *  worker so the inserted `market_bets` row joins back to
   *  `agent_configs` for Town Square + admin trade analytics. */
  agentId?: string;
  /** Optional JSONB metadata stamped onto the inserted `market_bets`
   *  row. The agent worker passes `{actionId}` so its idempotency
   *  check (`betMetadata->>'actionId' = ${id}`) catches reclaim-after-
   *  commit races on AMM bets. */
  betMetadata?: Record<string, unknown>;
}

export interface ExecuteBuyResult {
  betId: string;
  sharesPurchased: number;
  chargeCredits: number;
  pricePerShareAvg: number;
  newPrices: Record<string, number>;
  newQ: Record<string, number>;
  newSharePrice: number;
  userBalanceAfter: number;
}

export type TradeError =
  | { error: "validation"; status: 400; message: string }
  | { error: "market_not_found"; status: 404; message: string }
  | { error: "entry_not_found"; status: 404; message: string }
  | { error: "not_amm"; status: 400; message: string }
  | { error: "market_closed"; status: 409; message: string }
  | { error: "visibility_denied"; status: 403; message: string }
  | { error: "trade_too_small"; status: 400; message: string }
  | { error: "insufficient_credits"; status: 409; message: string }
  | { error: "insufficient_shares"; status: 409; message: string };

export async function executeBuy(
  input: ExecuteBuyInput,
  txOpt?: DbOrTx,
): Promise<ExecuteBuyResult | TradeError> {
  const { marketId, userId, entryId, creditBudget, isAdmin = false, agentId, betMetadata } = input;

  if (!Number.isInteger(creditBudget) || creditBudget < MIN_AMM_BUY_CREDITS) {
    return {
      error: "validation",
      status: 400,
      message: `creditBudget must be an integer >= ${MIN_AMM_BUY_CREDITS}`,
    };
  }

  const run = async (tx: DbOrTx): Promise<ExecuteBuyResult | TradeError> => {
    const ctx = await loadAndLockTradeContext(tx, marketId, entryId, isAdmin);
    if ("error" in ctx) return ctx;
    const { state, b } = ctx;

    const quote = quoteBuy(state, entryId, creditBudget);
    if (quote.shares <= 0 || quote.chargeCredits < 1) {
      return {
        error: "trade_too_small",
        status: 400,
        message: "Trade size below 1 credit at current price; raise budget.",
      };
    }
    const { shares, chargeCredits, pricePerShareAvg } = quote;

    const [updatedProfile] = await tx
      .update(profiles)
      .set({
        predictCredits: sql`${profiles.predictCredits} - ${chargeCredits}`,
      })
      .where(
        sql`${profiles.id} = ${userId} AND ${profiles.predictCredits} >= ${chargeCredits}`,
      )
      .returning({ predictCredits: profiles.predictCredits });

    if (!updatedProfile) {
      return {
        error: "insufficient_credits",
        status: 409,
        message: `Insufficient credits (need ${chargeCredits}).`,
      };
    }

    const newShareQuantities = { ...state.shareQuantities };
    newShareQuantities[entryId] = (newShareQuantities[entryId] ?? 0) + shares;

    await tx
      .update(marketAmmState)
      .set({
        shareQuantities: newShareQuantities,
        totalUserCreditsIn: sql`${marketAmmState.totalUserCreditsIn} + ${chargeCredits}`,
        updatedAt: new Date(),
      })
      .where(eq(marketAmmState.marketId, marketId));

    const [insertedBet] = await tx
      .insert(marketBets)
      .values({
        marketId,
        entryId,
        userId,
        agentId: agentId ?? null,
        stakeAmount: chargeCredits,
        actionType: "buy",
        shareCount: shares.toString(),
        pricePerShare: pricePerShareAvg.toString(),
        direction: "yes",
        status: "active",
        betMetadata: betMetadata ?? null,
      })
      .returning({ id: marketBets.id });

    await tx.insert(creditLedger).values({
      userId,
      txnType: "amm_buy",
      amount: -chargeCredits,
      walletType: "VIRTUAL",
      balanceAfter: updatedProfile.predictCredits,
      // Audit trail: agent bets log under `agent_action` so the
      // existing reconciliation reports + admin filters can split
      // human flow from agent flow without joining `agent_configs`.
      source: agentId ? "agent_action" : "user_action",
      idempotencyKey: `amm_buy_${insertedBet.id}`,
      metadata: {
        marketId,
        entryId,
        betId: insertedBet.id,
        shares,
        ...(agentId ? { agentId } : {}),
      },
    });

    const newQObj = { ...newShareQuantities };
    const newQArr = state.outcomeOrder.map((id) => newQObj[id] ?? 0);
    const newPricesArr = pricesAll(newQArr, b);
    const newPrices: Record<string, number> = {};
    for (let i = 0; i < state.outcomeOrder.length; i++) {
      newPrices[state.outcomeOrder[i]] = newPricesArr[i];
    }

    return {
      betId: insertedBet.id,
      sharesPurchased: shares,
      chargeCredits,
      pricePerShareAvg,
      newPrices,
      newQ: newQObj,
      newSharePrice: newPrices[entryId] ?? 0,
      userBalanceAfter: updatedProfile.predictCredits,
    };
  };

  if (txOpt) return run(txOpt);
  return db.transaction(async (tx) => run(tx as DbOrTx));
}

// ---------------------------------------------------------------------------
// Public API — sell
// ---------------------------------------------------------------------------

export interface ExecuteSellInput {
  marketId: string;
  userId: string;
  entryId: string;
  /** Fractional share count to sell. Must be > 0 and <= user's
   *  current netShares for this entry. */
  shares: number;
  isAdmin?: boolean;
  /** Optional agent attribution. Set when the caller is the agent
   *  worker so the inserted `market_bets` sell row joins back to
   *  `agent_configs` for Town Square + admin trade analytics. */
  agentId?: string;
}

export interface ExecuteSellResult {
  betId: string;
  sharesSold: number;
  proceeds: number;
  pricePerShareAvg: number;
  newPrices: Record<string, number>;
  newQ: Record<string, number>;
  newSharePrice: number;
  userBalanceAfter: number;
  remainingShares: number;
}

export async function executeSell(
  input: ExecuteSellInput,
  txOpt?: DbOrTx,
): Promise<ExecuteSellResult | TradeError> {
  const { marketId, userId, entryId, shares, isAdmin = false, agentId } = input;

  if (!Number.isFinite(shares) || shares <= 0) {
    return {
      error: "validation",
      status: 400,
      message: "shares must be a positive finite number",
    };
  }

  const run = async (tx: DbOrTx): Promise<ExecuteSellResult | TradeError> => {
    const ctx = await loadAndLockTradeContext(tx, marketId, entryId, isAdmin);
    if ("error" in ctx) return ctx;
    const { state, b } = ctx;

    const positionRows = await tx
      .select({
        actionType: marketBets.actionType,
        shareCount: marketBets.shareCount,
      })
      .from(marketBets)
      .where(
        and(
          eq(marketBets.userId, userId),
          eq(marketBets.marketId, marketId),
          eq(marketBets.entryId, entryId),
        ),
      );

    let netShares = 0;
    for (const row of positionRows) {
      if (row.actionType !== "buy" && row.actionType !== "sell") continue;
      const sc = Number(row.shareCount ?? 0);
      if (!Number.isFinite(sc)) continue;
      netShares += row.actionType === "buy" ? sc : -sc;
    }

    // Allow a hair of floating-point slop so users can "sell all" with
    // a UI-supplied client-computed netShares even if drift is 1e-9.
    const SHARE_EPSILON = 1e-6;
    if (shares > netShares + SHARE_EPSILON) {
      return {
        error: "insufficient_shares",
        status: 409,
        message: `You only hold ${netShares.toFixed(6)} shares of this entry; cannot sell ${shares}.`,
      };
    }
    const sharesToSell = Math.min(shares, netShares);

    const quote = quoteSell(state, entryId, sharesToSell);
    if (quote.proceeds < 1) {
      return {
        error: "trade_too_small",
        status: 400,
        message: "Sell proceeds round to zero credits; sell more shares.",
      };
    }
    const { proceeds, pricePerShareAvg } = quote;

    const [updatedProfile] = await tx
      .update(profiles)
      .set({
        predictCredits: sql`${profiles.predictCredits} + ${proceeds}`,
      })
      .where(eq(profiles.id, userId))
      .returning({ predictCredits: profiles.predictCredits });

    if (!updatedProfile) {
      return {
        error: "validation",
        status: 400,
        message: `User profile ${userId} not found`,
      };
    }

    const newShareQuantities = { ...state.shareQuantities };
    const remainingMarketShares =
      (newShareQuantities[entryId] ?? 0) - sharesToSell;
    // Clamp to 0 to avoid negative q from float drift; LMSR is
    // mathematically impossible to drive negative through legal sells
    // (proceeds = 0 at q[i] = 0), but defensive against rounding.
    newShareQuantities[entryId] = Math.max(0, remainingMarketShares);

    await tx
      .update(marketAmmState)
      .set({
        shareQuantities: newShareQuantities,
        totalUserCreditsIn: sql`${marketAmmState.totalUserCreditsIn} - ${proceeds}`,
        updatedAt: new Date(),
      })
      .where(eq(marketAmmState.marketId, marketId));

    // Sell rows are realized at creation: status='settled', payoutAmount
    // already records the credits returned. Keeps the settlement pass
    // simple — it only walks 'active' buy rows.
    const [insertedBet] = await tx
      .insert(marketBets)
      .values({
        marketId,
        entryId,
        userId,
        agentId: agentId ?? null,
        stakeAmount: -proceeds,
        actionType: "sell",
        shareCount: sharesToSell.toString(),
        pricePerShare: pricePerShareAvg.toString(),
        direction: "yes",
        status: "settled",
        payoutAmount: proceeds,
        settledAt: new Date(),
      })
      .returning({ id: marketBets.id });

    await tx.insert(creditLedger).values({
      userId,
      txnType: "amm_sell",
      amount: proceeds,
      walletType: "VIRTUAL",
      balanceAfter: updatedProfile.predictCredits,
      // See `executeBuy` rationale: agent flows are tagged so audit
      // queries can split human vs agent volume without joining agents.
      source: agentId ? "agent_action" : "user_action",
      idempotencyKey: `amm_sell_${insertedBet.id}`,
      metadata: {
        marketId,
        entryId,
        betId: insertedBet.id,
        shares: sharesToSell,
        ...(agentId ? { agentId } : {}),
      },
    });

    const newQObj = { ...newShareQuantities };
    const newQArr = state.outcomeOrder.map((id) => newQObj[id] ?? 0);
    const newPricesArr = pricesAll(newQArr, b);
    const newPrices: Record<string, number> = {};
    for (let i = 0; i < state.outcomeOrder.length; i++) {
      newPrices[state.outcomeOrder[i]] = newPricesArr[i];
    }

    return {
      betId: insertedBet.id,
      sharesSold: sharesToSell,
      proceeds,
      pricePerShareAvg,
      newPrices,
      newQ: newQObj,
      newSharePrice: newPrices[entryId] ?? 0,
      userBalanceAfter: updatedProfile.predictCredits,
      remainingShares: Math.max(0, netShares - sharesToSell),
    };
  };

  if (txOpt) return run(txOpt);
  return db.transaction(async (tx) => run(tx as DbOrTx));
}

// ---------------------------------------------------------------------------
// Shared validation + locking helper
// ---------------------------------------------------------------------------

interface TradeContext {
  state: AmmStateSnapshot;
  b: number;
}

/**
 * Acquires a row-level X lock on `market_amm_state` and validates the
 * market is in a tradeable state. Returns the projected state snapshot
 * the trade math operates on, or a structured error.
 *
 * Locking strategy: we do `SELECT ... FOR UPDATE` on the AMM state
 * row (one per AMM market). Concurrent buys/sells on the SAME market
 * serialize; trades on different markets stay parallel. The
 * accompanying market row is fetched without `FOR UPDATE` because we
 * only read its status/closeAt/visibility — admin resolve takes its
 * own lock when it needs to mutate.
 */
async function loadAndLockTradeContext(
  tx: DbOrTx,
  marketId: string,
  entryId: string,
  isAdmin: boolean,
): Promise<TradeContext | TradeError> {
  // FOR UPDATE on market_amm_state. Drizzle's chained `.for("update")`
  // is supported on PG selects.
  const lockedState = await tx
    .select({
      liquidityB: marketAmmState.liquidityB,
      outcomeOrder: marketAmmState.outcomeOrder,
      shareQuantities: marketAmmState.shareQuantities,
    })
    .from(marketAmmState)
    .where(eq(marketAmmState.marketId, marketId))
    .for("update")
    .limit(1);

  if (lockedState.length === 0) {
    return {
      error: "not_amm",
      status: 400,
      message: `Market ${marketId} has no AMM state — not a tradeable AMM market.`,
    };
  }

  const stateRow = lockedState[0];
  const b = Number(stateRow.liquidityB);
  if (!Number.isFinite(b) || b <= 0) {
    return {
      error: "validation",
      status: 400,
      message: `Market ${marketId} has invalid liquidity_b=${stateRow.liquidityB}`,
    };
  }
  const state: AmmStateSnapshot = {
    liquidityB: b,
    outcomeOrder: stateRow.outcomeOrder as string[],
    shareQuantities: stateRow.shareQuantities as Record<string, number>,
  };

  const [market] = await tx
    .select({
      engine: predictionMarkets.engine,
      status: predictionMarkets.status,
      closeAt: predictionMarkets.closeAt,
      endAt: predictionMarkets.endAt,
      visibility: predictionMarkets.visibility,
    })
    .from(predictionMarkets)
    .where(eq(predictionMarkets.id, marketId))
    .limit(1);

  if (!market) {
    return { error: "market_not_found", status: 404, message: `Market ${marketId} not found.` };
  }
  if (market.engine !== "amm") {
    return { error: "not_amm", status: 400, message: `Market ${marketId} is not an AMM market.` };
  }
  if (market.status !== "OPEN") {
    return {
      error: "market_closed",
      status: 409,
      message: `Market ${marketId} is ${market.status}; trading disabled.`,
    };
  }
  const closeAtMs = market.closeAt ? new Date(market.closeAt).getTime() : null;
  if (closeAtMs !== null && closeAtMs <= Date.now()) {
    return {
      error: "market_closed",
      status: 409,
      message: `Market ${marketId} closed at ${market.closeAt!.toISOString()}.`,
    };
  }
  if (market.visibility !== "live" && !isAdmin) {
    return {
      error: "visibility_denied",
      status: 403,
      message: `Market ${marketId} is not yet open to public trading.`,
    };
  }

  if (indexOfEntry(state, entryId) < 0) {
    // Sanity check: confirm the entry exists in market_entries before
    // returning a generic "not in this market" — gives admins a clearer
    // signal when the AMM state is drifting from market entries.
    const [entryRow] = await tx
      .select({ id: marketEntries.id })
      .from(marketEntries)
      .where(
        and(eq(marketEntries.id, entryId), eq(marketEntries.marketId, marketId)),
      )
      .limit(1);
    if (!entryRow) {
      return {
        error: "entry_not_found",
        status: 404,
        message: `Entry ${entryId} not found in market ${marketId}.`,
      };
    }
    return {
      error: "validation",
      status: 400,
      message: `Entry ${entryId} exists but is not in this market's AMM outcomeOrder. Contact support.`,
    };
  }

  // Sanity-project to confirm the q vector is well-formed.
  void projectQ(state);

  return { state, b };
}
