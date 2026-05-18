/**
 * Pure response builders for the idempotent-trade replay path.
 *
 * Extracted from `amm-trades.ts` so the defensive guards (entryId
 * mismatch, missing walletRow fallback, remainingShares clamp) can be
 * exercised in unit tests without a database. The DB-reading shell
 * still lives in `replayPriorBuy` / `replayPriorSell`; this module
 * is intentionally side-effect free so callers can build a response
 * from any source of rows (real DB, fixture, mock).
 *
 * Both builders return `null` on entryId mismatch — the caller
 * interprets that as "no clean replay possible, fall through and let
 * the unique constraint on (userId, idempotencyKey) trip". See
 * `replayPriorBuy` for the rationale on that compromise.
 */

import type { AmmStateSnapshot } from "@shared/lib/amm/positions";
import { pricesAll } from "@shared/lib/amm/lmsr";
// `import type` is erased at runtime, so this stays free of the
// circular-import hazard even though amm-trades.ts pulls in the
// builders below.
import type {
  ExecuteBuyResult,
  ExecuteSellResult,
} from "./amm-trades";

export interface BuildBuyReplayInput {
  bet: {
    id: string;
    entryId: string;
    shareCount: string | null;
    stakeAmount: number | null;
    pricePerShare: string | null;
  };
  walletRow: { predictCredits: number } | null;
  state: AmmStateSnapshot;
  liquidityB: number;
  expectedEntryId: string;
}

export function buildBuyReplayResponse(
  input: BuildBuyReplayInput,
): ExecuteBuyResult | null {
  const { bet, walletRow, state, liquidityB, expectedEntryId } = input;

  if (bet.entryId !== expectedEntryId) return null;

  const newPrices = computePriceMap(state, liquidityB);

  return {
    betId: bet.id,
    sharesPurchased: Number(bet.shareCount ?? 0),
    chargeCredits: Number(bet.stakeAmount ?? 0),
    pricePerShareAvg: Number(bet.pricePerShare ?? 0),
    newPrices,
    newQ: { ...state.shareQuantities },
    newSharePrice: newPrices[expectedEntryId] ?? 0,
    userBalanceAfter: walletRow ? walletRow.predictCredits : 0,
  };
}

export interface BuildSellReplayInput {
  bet: {
    id: string;
    entryId: string;
    shareCount: string | null;
    pricePerShare: string | null;
    payoutAmount: number | null;
  };
  walletRow: { predictCredits: number } | null;
  /** All of the user's buy/sell rows for (marketId, entryId). Used to
   *  recompute remainingShares from scratch — see `replayPriorSell` for
   *  why we don't cache it on the prior bet. Rows with actionType
   *  other than "buy"/"sell" or non-finite shareCount are ignored. */
  positionRows: ReadonlyArray<{
    actionType: string | null;
    shareCount: string | null;
  }>;
  state: AmmStateSnapshot;
  liquidityB: number;
  expectedEntryId: string;
}

export function buildSellReplayResponse(
  input: BuildSellReplayInput,
): ExecuteSellResult | null {
  const {
    bet,
    walletRow,
    positionRows,
    state,
    liquidityB,
    expectedEntryId,
  } = input;

  if (bet.entryId !== expectedEntryId) return null;

  const newPrices = computePriceMap(state, liquidityB);

  let netShares = 0;
  for (const row of positionRows) {
    if (row.actionType !== "buy" && row.actionType !== "sell") continue;
    const sc = Number(row.shareCount ?? 0);
    if (!Number.isFinite(sc)) continue;
    netShares += row.actionType === "buy" ? sc : -sc;
  }

  return {
    betId: bet.id,
    sharesSold: Number(bet.shareCount ?? 0),
    proceeds: Number(bet.payoutAmount ?? 0),
    pricePerShareAvg: Number(bet.pricePerShare ?? 0),
    newPrices,
    newQ: { ...state.shareQuantities },
    newSharePrice: newPrices[expectedEntryId] ?? 0,
    userBalanceAfter: walletRow ? walletRow.predictCredits : 0,
    remainingShares: Math.max(0, netShares),
  };
}

function computePriceMap(
  state: AmmStateSnapshot,
  liquidityB: number,
): Record<string, number> {
  const qArr = state.outcomeOrder.map(
    (id) => state.shareQuantities[id] ?? 0,
  );
  const pricesArr = pricesAll(qArr, liquidityB);
  const out: Record<string, number> = {};
  for (let i = 0; i < state.outcomeOrder.length; i++) {
    out[state.outcomeOrder[i]] = pricesArr[i];
  }
  return out;
}
