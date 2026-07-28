/**
 * Shared AMM open-position aggregators for PredictPage / PredictTab cards.
 *
 * `topPositionByMarket` keeps the largest `currentValue` per market —
 * the historical "banner P&L" behaviour for single-side markets
 * (Up/Down, H2H, binary World).
 *
 * `positionTotalsByMarket` sums across all open legs on a market —
 * used by multi-outcome World cards (and Category Race when we want
 * a true rollup) so "Your pick / Multiple picks" reflects the whole
 * holding, not just one leg.
 */

export interface AmmOpenPositionLike {
  marketId: string;
  entryId?: string;
  entryLabel?: string;
  netShares?: number;
  netCreditsIn: number;
  currentValue: number;
  unrealisedPnl: number;
}

export type AmmPositionTotals = {
  count: number;
  unrealisedPnl: number;
  netCreditsIn: number;
  /** Entry label of the sole open leg when count === 1; else undefined. */
  soleEntryLabel?: string;
  soleEntryId?: string;
};

/**
 * Per-market top position by `currentValue` (ties keep the first seen).
 */
export function topPositionByMarket<T extends AmmOpenPositionLike>(
  positions: readonly T[],
): Map<string, T> {
  const map = new Map<string, T>();
  for (const p of positions) {
    const existing = map.get(p.marketId);
    if (!existing || p.currentValue > existing.currentValue) {
      map.set(p.marketId, p);
    }
  }
  return map;
}

/**
 * Per-market summed P&L + cost basis across all open legs.
 *
 * Summing independent `unrealisedPnl` quotes slightly over-estimates
 * true simultaneous liquidation on an LMSR book (selling one leg
 * moves the others). Detail pages remain authoritative.
 */
export function positionTotalsByMarket(
  positions: readonly AmmOpenPositionLike[],
): Map<string, AmmPositionTotals> {
  const map = new Map<string, AmmPositionTotals>();
  for (const p of positions) {
    const existing = map.get(p.marketId);
    if (!existing) {
      map.set(p.marketId, {
        count: 1,
        unrealisedPnl: Number.isFinite(p.unrealisedPnl) ? p.unrealisedPnl : 0,
        netCreditsIn: Number.isFinite(p.netCreditsIn) ? p.netCreditsIn : 0,
        soleEntryLabel: p.entryLabel,
        soleEntryId: p.entryId,
      });
      continue;
    }
    existing.count += 1;
    existing.unrealisedPnl += Number.isFinite(p.unrealisedPnl) ? p.unrealisedPnl : 0;
    existing.netCreditsIn += Number.isFinite(p.netCreditsIn) ? p.netCreditsIn : 0;
    existing.soleEntryLabel = undefined;
    existing.soleEntryId = undefined;
  }
  return map;
}
