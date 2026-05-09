/**
 * AMM client helpers — Phase 4 of the parimutuel -> AMM rebuild.
 *
 * Thin wrappers around the isomorphic math in `shared/lib/amm/positions.ts`
 * + a React Query hook so cards / detail pages / modals can render live
 * LMSR quotes without re-implementing the math client-side.
 *
 * The math (`quoteBuy`, `quoteSell`, `summarizePosition`, `currentPrices`)
 * runs on whatever `AmmStateSnapshot` the caller hands in — typically the
 * `ammState` block returned by `/api/native-markets/:type` or
 * `/api/markets/:id`. No fetch happens inside the helpers; that's by
 * design so cards can render off the snapshot they already have without
 * triggering extra round-trips.
 */

import { useQuery } from "@tanstack/react-query";
import {
  type AmmStateSnapshot,
  type AmmTradeRow,
  currentPrices,
  quoteBuy as quoteBuyMath,
  quoteSell as quoteSellMath,
  summarizePosition as summarizePositionMath,
} from "@shared/lib/amm/positions";

/** Shape returned by `/api/markets/:id` and embedded in list responses. */
export interface ApiAmmStateBlock {
  liquidityB: number;
  outcomeOrder: string[];
  shareQuantities: Record<string, number>;
  houseSeedAmount?: number;
  totalUserCreditsIn?: number;
  prices?: Record<string, number>;
  updatedAt?: string;
}

/**
 * Project an API `ammState` block into the canonical snapshot shape
 * the math helpers expect. Returns `null` for falsy input so callers
 * can chain `if (!snap) return ...`.
 */
export function snapshotFromApi(block: ApiAmmStateBlock | null | undefined): AmmStateSnapshot | null {
  if (!block) return null;
  return {
    liquidityB: Number(block.liquidityB),
    outcomeOrder: block.outcomeOrder.slice(),
    shareQuantities: { ...block.shareQuantities },
  };
}

/**
 * Marginal price per outcome (entryId -> price in [0, 1]). Convenience
 * passthrough so callers don't have to import from `@shared`.
 */
export function pricesFor(state: AmmStateSnapshot): Record<string, number> {
  return currentPrices(state);
}

/**
 * Convert a price in [0, 1] to a "Yes %" label, e.g. `0.6234` -> "62%".
 * Used for the probability bars on cards + detail pages.
 */
export function priceToPercent(price: number, fractionDigits = 0): string {
  if (!Number.isFinite(price)) return "—";
  const pct = Math.max(0, Math.min(100, price * 100));
  return `${pct.toFixed(fractionDigits)}%`;
}

/** Polymarket-style two-sided bar widths for a binary AMM market. */
export function binaryBarWidths(prices: Record<string, number>, entryIds: [string, string]): [number, number] {
  const a = Math.max(0, Math.min(1, Number(prices[entryIds[0]] ?? 0)));
  const b = Math.max(0, Math.min(1, Number(prices[entryIds[1]] ?? 0)));
  const total = a + b;
  if (total <= 0) return [50, 50];
  return [+((a / total) * 100).toFixed(2), +((b / total) * 100).toFixed(2)];
}

// ---------------------------------------------------------------------------
// Quote helpers — re-exports keep the import surface tiny
// ---------------------------------------------------------------------------

export const quoteBuy = quoteBuyMath;
export const quoteSell = quoteSellMath;
export const summarizePosition = summarizePositionMath;

export type { AmmStateSnapshot, AmmTradeRow };

// ---------------------------------------------------------------------------
// React Query hook — polling AMM state for a single market
// ---------------------------------------------------------------------------

interface MarketDetailResponse {
  market: {
    id: string;
    engine: "parimutuel" | "amm" | string;
  };
  entries: Array<{ id: string; label: string; displayOrder?: number }>;
  ammState: ApiAmmStateBlock | null;
}

/**
 * Polls `GET /api/markets/:id` every `intervalMs` (default 5s) so the
 * AMM state stays fresh while a user is staring at a card or detail
 * page. Returns the unified market detail payload (entries + ammState
 * + market). When the market is not AMM, `data.ammState` is null —
 * caller should check before treating the response as live.
 *
 * Disable polling per-call with `enabled=false` (e.g. once a user has
 * opened the StakeModal we may want a slower cadence to keep CPU low).
 */
export function usePollingAmmState(
  marketId: string | null | undefined,
  options: { intervalMs?: number; enabled?: boolean } = {},
) {
  const { intervalMs = 5000, enabled = true } = options;
  return useQuery<MarketDetailResponse>({
    queryKey: ["/api/markets", marketId],
    enabled: !!marketId && enabled,
    refetchInterval: enabled ? intervalMs : false,
    refetchIntervalInBackground: false,
    staleTime: Math.min(intervalMs, 2_000),
  });
}

/**
 * Lightweight quote derivation that callers can use directly off the
 * polling hook's data: returns the snapshot + a buy quote for the
 * selected entry / budget. Returns `null` when state is missing or
 * the entry isn't in the market (defensive — caller should check).
 */
export function deriveBuyQuote(
  block: ApiAmmStateBlock | null | undefined,
  entryId: string | null,
  creditBudget: number,
) {
  const snap = snapshotFromApi(block);
  if (!snap || !entryId) return null;
  if (!snap.outcomeOrder.includes(entryId)) return null;
  if (!Number.isFinite(creditBudget) || creditBudget <= 0) return null;
  return quoteBuyMath(snap, entryId, creditBudget);
}

export function deriveSellQuote(
  block: ApiAmmStateBlock | null | undefined,
  entryId: string | null,
  shares: number,
) {
  const snap = snapshotFromApi(block);
  if (!snap || !entryId) return null;
  if (!snap.outcomeOrder.includes(entryId)) return null;
  if (!Number.isFinite(shares) || shares <= 0) return null;
  return quoteSellMath(snap, entryId, shares);
}
