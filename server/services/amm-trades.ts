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
import { alias } from "drizzle-orm/pg-core";
import {
  ammPriceSnapshots,
  creditLedger,
  marketAmmState,
  marketBets,
  marketEntries,
  predictionMarkets,
  profiles,
  trackedPeople,
  trendingPeople,
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
import {
  buildBuyReplayResponse,
  buildSellReplayResponse,
} from "./amm-trades-replay";
import {
  checkBuySlippage,
  checkSellSlippage,
} from "./amm-slippage";
import { notifyPriceChange } from "./amm-price-broadcaster";
import {
  formatMarketLead,
  resolvePickContextLabel,
} from "../jobs/notification-market-labels";
import { createNotification } from "./notifications";

const entryPerson = alias(trackedPeople, "amm_trade_entry_person");

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

/**
 * Soft per-call minimum on human-initiated sells (in shares). The
 * executeSell service layer ultimately rejects any sell whose proceeds
 * round below 1 credit — so this floor exists mainly to cut off micro-
 * spam at the route boundary and surface a friendlier validation error
 * BEFORE we spend a DB transaction quoting the LMSR proceeds. The agent
 * worker uses a stricter floor (`MIN_SHARES_TO_SELL = 0.1`) because
 * agents have a budget envelope and shouldn't be exiting in dust; the
 * human floor is gentler so a real user with a thin position can still
 * close it cleanly.
 */
export const MIN_HUMAN_SELL_SHARES = 0.01;

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
  /** Optional client-supplied idempotency key (validated UUID or safe
   *  token — see `server/services/idempotency-key.ts`). When set, the
   *  function looks up an existing `credit_ledger` row keyed on
   *  `amm_buy_client_${id}` for this user; if found, the prior trade
   *  is returned without re-executing. Mirrors the agent worker's
   *  `betMetadata.actionId` pre-check but for human routes. The lookup
   *  runs inside the same locked transaction as the trade itself, so
   *  concurrent retries on the same market serialise via the existing
   *  `SELECT ... FOR UPDATE` on `market_amm_state` and the second one
   *  always observes the first's ledger row. */
  clientRequestId?: string;
  /** Optional client-supplied slippage cap (per-share, 0..1). If the
   *  realised AVERAGE fill price exceeds this value the trade is
   *  aborted with `slippage_exceeded` and no DB mutation happens.
   *  Omitted by the agent runner (agents take whatever fills) so
   *  this is fully backward-compatible with the existing call sites.
   *  See `server/services/amm-slippage.ts` for the exact comparison
   *  semantics. */
  maxPricePerShare?: number;
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
  | { error: "insufficient_shares"; status: 409; message: string }
  // Conflict-of-interest guard: a user who created the market cannot
  // also trade on it. Today this only fires for admins on community
  // markets (where `createdBy` is the approving admin) — native
  // updown/h2h/gainer/jackpot markets are cron-created with a null
  // `createdBy`, so retail and agents are unaffected. Returned as
  // 403 because it's an authorisation refusal, not a runtime error.
  | { error: "self_trade_denied"; status: 403; message: string }
  // Client-supplied slippage protection: if the user passed a
  // `maxPricePerShare` (buy) or `minPricePerShare` (sell), and the
  // realised average fill price would breach that bound, we abort
  // without mutating anything so the client can re-quote or relax
  // tolerance. Returned as 409 (state conflict) so retry logic
  // distinguishes it from a 400 validation error. `quotedAvgPrice`
  // and `capOrFloor` echo back the numbers so the client can show
  // the user the exact gap.
  | {
      error: "slippage_exceeded";
      status: 409;
      message: string;
      quotedAvgPrice: number;
      capOrFloor: number;
    };

export async function executeBuy(
  input: ExecuteBuyInput,
  txOpt?: DbOrTx,
): Promise<ExecuteBuyResult | TradeError> {
  const {
    marketId,
    userId,
    entryId,
    creditBudget,
    isAdmin = false,
    agentId,
    betMetadata,
    clientRequestId,
    maxPricePerShare,
  } = input;

  if (!Number.isInteger(creditBudget) || creditBudget < MIN_AMM_BUY_CREDITS) {
    return {
      error: "validation",
      status: 400,
      message: `creditBudget must be an integer >= ${MIN_AMM_BUY_CREDITS}`,
    };
  }

  const idempotencyKey = clientRequestId
    ? `amm_buy_client_${clientRequestId}`
    : null;

  // Captured by reference so the post-commit notifyPriceChange below
  // can include the market's current liquidity parameter and the
  // post-trade share-quantity vector on the SSE event without
  // re-reading state. Stay `null` if the trade fails before the
  // load lock / state mutation — we just skip the broadcast in
  // those cases.
  let liquidityB: number | null = null;
  let postTradeShareQuantities: Record<string, number> | null = null;

  const run = async (tx: DbOrTx): Promise<ExecuteBuyResult | TradeError> => {
    const ctx = await loadAndLockTradeContext(tx, marketId, entryId, isAdmin, userId);
    if ("error" in ctx) return ctx;
    const { state, b } = ctx;
    liquidityB = b;

    // Idempotency short-circuit. After acquiring the per-market lock
    // (so concurrent retries on the same market serialise) check for
    // an existing ledger row keyed by the client-supplied id. If found,
    // hydrate the response from the original `market_bets` row + the
    // CURRENT post-lock state. Documented compromise: `newPrices` /
    // `newQ` reflect now, not the moment of the original trade — fine
    // for idempotency semantics, which guarantee the client sees a
    // coherent "trade already happened" response, not a frozen replay.
    if (idempotencyKey) {
      const replay = await replayPriorBuy(tx, userId, idempotencyKey, state, b, entryId);
      if (replay) return replay;
    }

    const quote = quoteBuy(state, entryId, creditBudget);
    if (quote.shares <= 0 || quote.chargeCredits < 1) {
      return {
        error: "trade_too_small",
        status: 400,
        message: "Trade size below 1 credit at current price; raise budget.",
      };
    }
    const { shares, chargeCredits, pricePerShareAvg } = quote;

    // Slippage cap check. Lives after the quote but before any
    // mutation so the abort path is a clean no-op. Helper returns
    // ok when no cap was supplied (agent runner, older clients), so
    // this is a strict-superset extension of the existing contract.
    const slippage = checkBuySlippage({
      creditsSpent: chargeCredits,
      sharesOut: shares,
      cap: maxPricePerShare,
    });
    if (!slippage.ok) {
      return {
        error: "slippage_exceeded",
        status: 409,
        message:
          "The market shifted between your quote and execution. Try again for an updated quote. No credits were charged.",
        quotedAvgPrice: slippage.avgPrice,
        capOrFloor: slippage.capOrFloor,
      };
    }

    const [updatedProfile] = await tx
      .update(profiles)
      .set({
        predictCredits: sql`${profiles.predictCredits} - ${chargeCredits}`,
        // Bump the public `totalPredictions` snapshot once per successful
        // buy regardless of caller. The parimutuel `placeMarketBet`
        // helper used to do this for humans; the agent worker used to
        // patch agents afterwards. Centralising it here keeps the
        // counter in lock-step with `market_bets` for both paths and
        // removes the actionWorker double-counting risk.
        totalPredictions: sql`${profiles.totalPredictions} + 1`,
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
    postTradeShareQuantities = newShareQuantities;

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
        // 1 share pays 1 credit at resolution, so the maximum payout if this
        // entry wins equals the share count. Persisting it lets the unified
        // MyPositionCard render "Payout if win" without reaching into AMM
        // internals, and keeps reconciliation / CSV exports honest. Floored
        // to match the integer column type — fractional shares lose at most
        // 0.999 cr of headline payout, well within rounding tolerance.
        potentialPayout: Math.floor(shares),
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
      idempotencyKey: idempotencyKey ?? `amm_buy_${insertedBet.id}`,
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

    await writePriceSnapshots(tx, marketId, newPrices, "trade");

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

  const result = txOpt
    ? await run(txOpt)
    : await db.transaction(async (tx) => run(tx as DbOrTx));

  // Tier 1.1: best-effort price broadcast. Fires AFTER the transaction
  // commits so SSE subscribers can't observe a price that gets rolled
  // back. Wrapped in try/catch so a broken broadcaster (or a listener
  // that throws) never surfaces to the caller or rolls back the trade.
  // Skipped on error results and idempotent replays — replays return
  // current state without a real price change, so notifying again
  // would just produce a duplicate event.
  if (!("error" in result) && liquidityB != null && postTradeShareQuantities != null) {
    try {
      notifyPriceChange(marketId, {
        outcomePrices: result.newPrices,
        shareQuantities: postTradeShareQuantities,
        liquidityB,
        lastTradeAt: new Date().toISOString(),
      });
    } catch (err) {
      console.error("[amm-trades] notifyPriceChange after buy failed (non-fatal):", err);
    }
  }
  return result;
}

// ---------------------------------------------------------------------------
// Buy retry replay
// ---------------------------------------------------------------------------

/**
 * Look up an existing buy by `(userId, idempotencyKey)` and, if found,
 * rebuild the response shape `executeBuy` would have returned. Returns
 * `null` if no prior trade matches — caller proceeds normally.
 *
 * Runs inside the same transaction so the AMM state used to compute
 * the (current) price vector matches the lock acquired by
 * `loadAndLockTradeContext`. `userBalanceAfter` reflects the CURRENT
 * balance (the original deduction has long since settled). This is
 * the documented compromise — clients retrying get coherent live
 * data, not a frozen snapshot.
 */
async function replayPriorBuy(
  tx: DbOrTx,
  userId: string,
  idempotencyKey: string,
  state: AmmStateSnapshot,
  b: number,
  expectedEntryId: string,
): Promise<ExecuteBuyResult | null> {
  const [prior] = await tx
    .select({ metadata: creditLedger.metadata })
    .from(creditLedger)
    .where(
      and(
        eq(creditLedger.userId, userId),
        eq(creditLedger.idempotencyKey, idempotencyKey),
      ),
    )
    .limit(1);
  if (!prior) return null;

  const priorBetId = (prior.metadata as { betId?: string } | null)?.betId;
  if (typeof priorBetId !== "string" || priorBetId.length === 0) {
    return null;
  }

  const [bet] = await tx
    .select({
      id: marketBets.id,
      entryId: marketBets.entryId,
      shareCount: marketBets.shareCount,
      stakeAmount: marketBets.stakeAmount,
      pricePerShare: marketBets.pricePerShare,
    })
    .from(marketBets)
    .where(eq(marketBets.id, priorBetId))
    .limit(1);
  if (!bet) return null;

  const [walletRow] = await tx
    .select({ predictCredits: profiles.predictCredits })
    .from(profiles)
    .where(eq(profiles.id, userId))
    .limit(1);

  // Defensive entryId mismatch handling lives in buildBuyReplayResponse:
  // if the client reuses the same key against a DIFFERENT entryId (UI
  // bug — shouldn't happen because `useIdempotencyKey` includes entryId
  // in its dep tuple), the builder returns null. Returning null here
  // doesn't short-circuit — the caller proceeds with the new request,
  // which then trips the `(userId, idempotencyKey)` unique constraint
  // at ledger-insert time and rolls the whole tx back. The user sees a
  // 500, but no duplicate trade lands. Less elegant than a structured
  // error response, but the path is purely defensive against a UI
  // regression — we accept the trade-off to keep the happy path simple.
  return buildBuyReplayResponse({
    bet,
    walletRow: walletRow ?? null,
    state,
    liquidityB: b,
    expectedEntryId,
  });
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
  /** Optional metadata persisted to `market_bets.bet_metadata`. The
   *  agent worker passes `{ actionId }` here so the worker's claim/
   *  reclaim idempotency check can find existing sell rows the same
   *  way it finds buy rows — see `executeAction` in actionWorker.ts. */
  betMetadata?: Record<string, unknown>;
  /** Optional client-supplied idempotency key — see `ExecuteBuyInput.
   *  clientRequestId` for the full contract. Ledger keys are scoped
   *  to the operation: `amm_sell_client_${id}` for sells, so the same
   *  string can be safely re-used by a client that intends buy+sell
   *  flows tied to one modal session. */
  clientRequestId?: string;
  /** Optional client-supplied slippage floor (per-share, 0..1). If
   *  the realised AVERAGE per-share proceeds fall below this value,
   *  the sell aborts with `slippage_exceeded`. Mirror of
   *  `ExecuteBuyInput.maxPricePerShare`. */
  minPricePerShare?: number;
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
  const {
    marketId,
    userId,
    entryId,
    shares,
    isAdmin = false,
    agentId,
    betMetadata,
    clientRequestId,
    minPricePerShare,
  } = input;

  if (!Number.isFinite(shares) || shares <= 0) {
    return {
      error: "validation",
      status: 400,
      message: "shares must be a positive finite number",
    };
  }

  const idempotencyKey = clientRequestId
    ? `amm_sell_client_${clientRequestId}`
    : null;

  // See executeBuy: captured for the post-commit SSE broadcast below.
  let liquidityB: number | null = null;
  let postTradeShareQuantities: Record<string, number> | null = null;

  const run = async (tx: DbOrTx): Promise<ExecuteSellResult | TradeError> => {
    const ctx = await loadAndLockTradeContext(tx, marketId, entryId, isAdmin, userId);
    if ("error" in ctx) return ctx;
    const { state, b } = ctx;
    liquidityB = b;

    // Idempotency short-circuit. See `executeBuy` for the contract.
    if (idempotencyKey) {
      const replay = await replayPriorSell(tx, userId, marketId, idempotencyKey, state, b, entryId);
      if (replay) return replay;
    }

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

    // Slippage floor check. Same pattern as the buy path: ok when
    // no floor was supplied, abort cleanly when the realised
    // average per-share proceeds fall below tolerance.
    const slippage = checkSellSlippage({
      creditsReceived: proceeds,
      sharesIn: sharesToSell,
      floor: minPricePerShare,
    });
    if (!slippage.ok) {
      return {
        error: "slippage_exceeded",
        status: 409,
        message:
          "The market shifted between your quote and execution. Try again for an updated quote. Your shares were not sold.",
        quotedAvgPrice: slippage.avgPrice,
        capOrFloor: slippage.capOrFloor,
      };
    }

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
    postTradeShareQuantities = newShareQuantities;

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
        ...(betMetadata ? { betMetadata } : {}),
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
      idempotencyKey: idempotencyKey ?? `amm_sell_${insertedBet.id}`,
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

    await writePriceSnapshots(tx, marketId, newPrices, "trade");

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

  const result = txOpt
    ? await run(txOpt)
    : await db.transaction(async (tx) => run(tx as DbOrTx));

  // Tier 1.1: best-effort price broadcast after a successful sell.
  // See `executeBuy` for rationale (post-commit, try/catch, skip on
  // errors / idempotent replays).
  if (!("error" in result) && liquidityB != null && postTradeShareQuantities != null) {
    try {
      notifyPriceChange(marketId, {
        outcomePrices: result.newPrices,
        shareQuantities: postTradeShareQuantities,
        liquidityB,
        lastTradeAt: new Date().toISOString(),
      });
    } catch (err) {
      console.error("[amm-trades] notifyPriceChange after sell failed (non-fatal):", err);
    }
  }

  // Tier 1.7: persistent "you got filled" bell-notification on
  // position-closing human sells. Gated tightly so:
  //   - replays (postTradeShareQuantities==null) do not duplicate
  //   - errors and validation rejects bail
  //   - agent sells are skipped (no human to read it)
  //   - nested-transaction callers skip too — when invoked with an
  //     outer `txOpt`, this post-commit block fires before the outer
  //     transaction has actually committed, so a rollback would leave
  //     an orphan notification row referencing a trade that never
  //     persisted. Today no caller passes `txOpt`; the gate is
  //     defensive.
  //   - partial sells (remainingShares > epsilon) only get the in-
  //     modal toast — the bell would be noisy for users who trim
  //     positions in slices.
  if (
    !("error" in result) &&
    postTradeShareQuantities != null &&
    !agentId &&
    !txOpt &&
    result.remainingShares < 1e-6
  ) {
    try {
      // Two parallel reads — keep the join semantics honest. `slug` is
      // the URL-facing identifier; the resolver follows the same
      // pattern (see emitResolutionSideEffects → marketMeta.slug).
      const [entryRow] = await db
        .select({
          entryLabel: marketEntries.label,
          candidateName: entryPerson.name,
          personName: trendingPeople.name,
          marketTitle: predictionMarkets.title,
          marketSlug: predictionMarkets.slug,
          marketType: predictionMarkets.marketType,
        })
        .from(marketEntries)
        .innerJoin(
          predictionMarkets,
          eq(marketEntries.marketId, predictionMarkets.id),
        )
        .leftJoin(entryPerson, eq(marketEntries.personId, entryPerson.id))
        .leftJoin(
          trendingPeople,
          eq(predictionMarkets.personId, trendingPeople.id),
        )
        .where(eq(marketEntries.id, entryId))
        .limit(1);

      const marketTitle = entryRow?.marketTitle ?? "Your market";
      const marketSlug = entryRow?.marketSlug ?? null;
      const entryLabel = entryRow?.entryLabel ?? "position";
      const contextLabel = resolvePickContextLabel({
        marketType: entryRow?.marketType ?? "binary",
        candidateName: entryRow?.candidateName ?? null,
        entryLabel,
        personName: entryRow?.personName ?? null,
      });
      const href = marketSlug ? `/markets/${marketSlug}` : `/me/predictions`;
      const marketLead = formatMarketLead(marketTitle, contextLabel);

      const sharesText =
        result.sharesSold >= 1
          ? result.sharesSold.toFixed(2)
          : result.sharesSold.toFixed(4);

      await createNotification({
        userId,
        kind: "trade_executed",
        title: `Position closed — ${result.proceeds.toLocaleString("en-US")} credits`,
        body: `${marketLead} — sold ${sharesText} shares.`,
        href,
        entityType: "market",
        entityId: marketId,
        marketId,
        metadata: {
          action: "sell",
          betId: result.betId,
          proceeds: result.proceeds,
          sharesSold: result.sharesSold,
          entryLabel,
          candidateName: entryRow?.candidateName ?? null,
        },
        idempotencyKey: `trade_executed:${result.betId}`,
      });
    } catch (err) {
      console.error("[amm-trades] trade_executed notification failed (non-fatal):", err);
    }
  }
  return result;
}

// ---------------------------------------------------------------------------
// Sell retry replay
// ---------------------------------------------------------------------------

/**
 * Sell-side counterpart of `replayPriorBuy`. Same locking + freshness
 * contract — see that function for the documented compromise on
 * `newPrices` reflecting current state.
 *
 * `remainingShares` is recomputed from `market_bets` for this user
 * rather than cached from the prior trade because the user may have
 * traded again in the interim (e.g. closed out the rest of the
 * position). Returning a stale `remainingShares` would mislead the
 * client's "position closed" UX, so we always recompute.
 */
async function replayPriorSell(
  tx: DbOrTx,
  userId: string,
  marketId: string,
  idempotencyKey: string,
  state: AmmStateSnapshot,
  b: number,
  expectedEntryId: string,
): Promise<ExecuteSellResult | null> {
  const [prior] = await tx
    .select({ metadata: creditLedger.metadata })
    .from(creditLedger)
    .where(
      and(
        eq(creditLedger.userId, userId),
        eq(creditLedger.idempotencyKey, idempotencyKey),
      ),
    )
    .limit(1);
  if (!prior) return null;

  const priorBetId = (prior.metadata as { betId?: string } | null)?.betId;
  if (typeof priorBetId !== "string" || priorBetId.length === 0) {
    return null;
  }

  const [bet] = await tx
    .select({
      id: marketBets.id,
      entryId: marketBets.entryId,
      shareCount: marketBets.shareCount,
      pricePerShare: marketBets.pricePerShare,
      payoutAmount: marketBets.payoutAmount,
    })
    .from(marketBets)
    .where(eq(marketBets.id, priorBetId))
    .limit(1);
  if (!bet) return null;

  const [walletRow] = await tx
    .select({ predictCredits: profiles.predictCredits })
    .from(profiles)
    .where(eq(profiles.id, userId))
    .limit(1);

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
        eq(marketBets.entryId, expectedEntryId),
      ),
    );

  // entryId-mismatch fall-through behaviour matches `replayPriorBuy`;
  // see that function for the rationale.
  return buildSellReplayResponse({
    bet,
    walletRow: walletRow ?? null,
    positionRows,
    state,
    liquidityB: b,
    expectedEntryId,
  });
}

// ---------------------------------------------------------------------------
// Price-snapshot writer (Phase 12)
// ---------------------------------------------------------------------------

/**
 * Append one snapshot row per outcome into `amm_price_snapshots`. Used
 * by both buy/sell paths (`source = 'trade'`) and by the price sampler
 * cron (`source = 'sampler'`).
 *
 * Inserts happen inside the same transaction as the trade so we either
 * record the full post-trade price vector or none of it. A bulk insert
 * keeps round-trip count constant per trade regardless of outcome
 * count.
 *
 * Defensive: invalid prices (non-finite, negative, > 1 + epsilon) are
 * skipped rather than crashing the trade. The chart can survive missing
 * points; the trade must not fail because of a chart-feed quirk.
 */
export async function writePriceSnapshots(
  tx: DbOrTx,
  marketId: string,
  prices: Record<string, number>,
  source: "trade" | "sampler",
): Promise<void> {
  const rows: Array<{
    marketId: string;
    entryId: string;
    price: string;
    source: string;
  }> = [];
  for (const [entryId, price] of Object.entries(prices)) {
    if (!Number.isFinite(price)) continue;
    if (price < 0 || price > 1 + 1e-6) continue;
    rows.push({
      marketId,
      entryId,
      price: price.toString(),
      source,
    });
  }
  if (rows.length === 0) return;
  await tx.insert(ammPriceSnapshots).values(rows);
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
  userId: string,
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
      createdBy: predictionMarkets.createdBy,
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

  // Self-trade guard. The market's `createdBy` is only populated for
  // community markets (the approving admin) — cron-created native
  // markets have it as null, so retail and agents are never blocked
  // by this. Refuse the trade if the caller created the market; the
  // approver should hand the trade to someone else (or, if they want
  // a position for liquidity reasons, do it via a non-admin
  // identity). Keeps the conflict-of-interest surface clean before
  // monetisation goes live.
  if (market.createdBy && market.createdBy === userId) {
    return {
      error: "self_trade_denied",
      status: 403,
      message: `Cannot trade on a market you created (market ${marketId}).`,
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
