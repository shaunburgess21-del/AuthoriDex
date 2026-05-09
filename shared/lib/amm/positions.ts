/**
 * AMM position + quote helpers.
 *
 * Pure functions that bridge the persistence shape (`market_amm_state`
 * JSONB + `market_bets` rows) and the LMSR engine. Imported by both
 * the server (buy/sell endpoints, settlement) and the client (live
 * quote rendering for Phase 4 UI), so the math lives in exactly one
 * place. Zero I/O — every input is a plain JS value the caller has
 * already loaded.
 *
 * --------------------------------------------------------------------------
 * Conventions
 * --------------------------------------------------------------------------
 * - Shares are fractional (Number, ~15 sig figs). Credits are integer at
 *   the persistence boundary; this module returns Number costs/proceeds
 *   for the caller to ceil/floor at the credit-debit boundary.
 * - `outcomeOrder` defines the canonical projection from the JSONB blob
 *   to the LMSR `q[]` vector. NEVER reorder it after a market is seeded.
 * - `quoteBuy` returns the conservative (lower-bound) share count whose
 *   `Math.ceil(buyCost)` is guaranteed `<= creditBudget`. Callers can
 *   trust the returned `chargeCredits` is what they should debit.
 */

import { buyCost, pricesAll, sellProceeds, sharesForCost } from "./lmsr";

export interface AmmStateSnapshot {
  /** LMSR liquidity parameter `b`, set once at seed time. */
  liquidityB: number;
  /** Entry IDs in the canonical order used for the `q[]` projection. */
  outcomeOrder: string[];
  /** Per-entry fractional share count. Must contain every id in outcomeOrder. */
  shareQuantities: Record<string, number>;
}

/**
 * Project the JSONB shape into the flat `q[]` the LMSR engine needs.
 * Missing entries default to 0 (defensive — should never happen in
 * practice because `seedAmmMarket` initialises every entry to 0).
 */
export function projectQ(state: AmmStateSnapshot): number[] {
  return state.outcomeOrder.map((id) => Number(state.shareQuantities[id] ?? 0));
}

/**
 * Look up the `q[]` index for an entry id. Returns -1 if the entry
 * isn't part of this market's outcomeOrder (caller must validate).
 */
export function indexOfEntry(state: AmmStateSnapshot, entryId: string): number {
  return state.outcomeOrder.indexOf(entryId);
}

/**
 * Compute current marginal prices keyed by entry id. Useful for both
 * server responses and client price displays.
 */
export function currentPrices(state: AmmStateSnapshot): Record<string, number> {
  const q = projectQ(state);
  const ps = pricesAll(q, state.liquidityB);
  const out: Record<string, number> = {};
  for (let i = 0; i < state.outcomeOrder.length; i++) {
    out[state.outcomeOrder[i]] = ps[i];
  }
  return out;
}

// ---------------------------------------------------------------------------
// Position aggregation from market_bets rows
// ---------------------------------------------------------------------------

/**
 * Shape of the trade rows summarized by `summarizePosition`. The fields
 * line up with the AMM-relevant subset of `market_bets`:
 *   actionType: 'buy' | 'sell'
 *   shareCount: positive in both directions; sign is in actionType
 *   stakeAmount: signed credits flow (positive on buy, negative on sell)
 */
export interface AmmTradeRow {
  entryId: string;
  actionType: "buy" | "sell";
  shareCount: number;
  stakeAmount: number;
}

export interface AmmPositionSummary {
  /** Net shares held (buys minus sells). Always >= 0 in valid state
   *  because the sell endpoint rejects sells > holdings. */
  netShares: number;
  /** Net credits the user has put into this entry (positive = paid in,
   *  negative = received more from sells than they paid in). */
  netCreditsIn: number;
}

/**
 * Group AMM bets into per-entry net positions for ONE user. Caller
 * must pre-filter to a single user and a single market — this helper
 * just sums by entryId.
 *
 * Empty input -> empty Map. Buy increments netShares and netCreditsIn;
 * sell decrements netShares and decrements netCreditsIn (because
 * `stakeAmount` is stored negative on sells, summing it gives the
 * correct net credits-in).
 */
export function summarizePosition(bets: AmmTradeRow[]): Map<string, AmmPositionSummary> {
  const out = new Map<string, AmmPositionSummary>();
  for (const bet of bets) {
    const sign = bet.actionType === "buy" ? 1 : -1;
    const slot = out.get(bet.entryId) ?? { netShares: 0, netCreditsIn: 0 };
    slot.netShares += sign * bet.shareCount;
    slot.netCreditsIn += bet.stakeAmount;
    out.set(bet.entryId, slot);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Quote previews (pure, used by both server endpoints and client UI)
// ---------------------------------------------------------------------------

export interface BuyQuote {
  /** Fractional share count the user receives. May be 0 if the
   *  budget is too small to cover even 1 credit of cost. */
  shares: number;
  /** Integer credits to debit. Ceiled from `buyCost`, guaranteed
   *  `<= creditBudget` (favours house, matches the rounding
   *  convention from the AMM rebuild plan). */
  chargeCredits: number;
  /** Average price per share for this trade (`chargeCredits / shares`).
   *  Returns 0 when `shares === 0`. */
  pricePerShareAvg: number;
  /** Marginal prices AFTER the trade lands, keyed by entry id. */
  newPrices: Record<string, number>;
}

export interface SellQuote {
  /** Integer credits to credit back to the user. Floored from
   *  `sellProceeds` (favours house). */
  proceeds: number;
  pricePerShareAvg: number;
  newPrices: Record<string, number>;
}

/**
 * Preview a buy without mutating state. Pure — caller passes the
 * current `AmmStateSnapshot` and an integer credit budget; we return
 * the conservative shares and the exact integer charge.
 *
 * Edge cases:
 *  - `creditBudget < 1` returns shares=0, chargeCredits=0.
 *  - Entry not in this market throws — caller must validate.
 *  - `shares === 0` after bisection (budget too small for even 1
 *    credit at this price) returns shares=0, chargeCredits=0; the
 *    server route layer translates this to a 400 "trade too small".
 */
export function quoteBuy(
  state: AmmStateSnapshot,
  entryId: string,
  creditBudget: number,
): BuyQuote {
  const idx = indexOfEntry(state, entryId);
  if (idx < 0) {
    throw new Error(`[ammPositions] entryId ${entryId} not in market outcomeOrder`);
  }
  if (!Number.isFinite(creditBudget) || creditBudget < 1) {
    return zeroBuyQuote(state);
  }
  const q = projectQ(state);
  const b = state.liquidityB;
  const rawShares = sharesForCost(q, idx, creditBudget, b);
  if (rawShares <= 0) return zeroBuyQuote(state);

  const cost = buyCost(q, idx, rawShares, b);
  const chargeCredits = Math.ceil(cost);
  if (chargeCredits < 1) return zeroBuyQuote(state);

  const newQ = q.slice();
  newQ[idx] += rawShares;
  const newPricesArr = pricesAll(newQ, b);
  const newPrices: Record<string, number> = {};
  for (let i = 0; i < state.outcomeOrder.length; i++) {
    newPrices[state.outcomeOrder[i]] = newPricesArr[i];
  }

  return {
    shares: rawShares,
    chargeCredits,
    pricePerShareAvg: chargeCredits / rawShares,
    newPrices,
  };
}

function zeroBuyQuote(state: AmmStateSnapshot): BuyQuote {
  return {
    shares: 0,
    chargeCredits: 0,
    pricePerShareAvg: 0,
    newPrices: currentPrices(state),
  };
}

/**
 * Preview a sell without mutating state. Caller has already verified
 * the user holds `>= shares` of `entryId`. Returns floored integer
 * proceeds (favours house). Throws if `entryId` isn't in the market
 * or `shares` is not a positive finite number.
 */
export function quoteSell(
  state: AmmStateSnapshot,
  entryId: string,
  shares: number,
): SellQuote {
  const idx = indexOfEntry(state, entryId);
  if (idx < 0) {
    throw new Error(`[ammPositions] entryId ${entryId} not in market outcomeOrder`);
  }
  if (!Number.isFinite(shares) || shares <= 0) {
    throw new Error(`[ammPositions] shares must be a positive finite number, got ${shares}`);
  }
  const q = projectQ(state);
  const b = state.liquidityB;
  const rawProceeds = sellProceeds(q, idx, shares, b);
  const proceeds = Math.floor(Math.max(rawProceeds, 0));

  const newQ = q.slice();
  newQ[idx] -= shares;
  const newPricesArr = pricesAll(newQ, b);
  const newPrices: Record<string, number> = {};
  for (let i = 0; i < state.outcomeOrder.length; i++) {
    newPrices[state.outcomeOrder[i]] = newPricesArr[i];
  }

  return {
    proceeds,
    pricePerShareAvg: proceeds > 0 ? proceeds / shares : 0,
    newPrices,
  };
}
