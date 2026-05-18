/**
 * Input gating for the sharp LLM ranker.
 *
 * The ranker's job is to flag the highest-edge markets in each sweep so
 * sharp-band agents skip their random-abstain on those picks. With only
 * `SHARP_RANKER_TOP_N` slots per sweep, every slot the LLM spends on a
 * market the agents *can't act on* is a wasted slot.
 *
 * `actionWorker.ts` already hard-skips community-market actions when
 * `WORLD_MARKETS_LLM_ENABLED=false` (see the "World markets paused"
 * branch around line 182). Without this filter the ranker would still
 * happily return McGregor / Drake-Kendrick / foldable-iPhone picks that
 * never become trades. This shifts the ranker's attention back onto
 * the markets agents will actually trade this sweep.
 *
 * When `WORLD_MARKETS_LLM_ENABLED` flips back on, the filter is a no-op
 * and community markets re-enter the ranker pool automatically.
 *
 * Kept as a pure helper so the gating rule can be locked down with a
 * unit test rather than relying on observing prod logs.
 */

export interface RankableMarketShape {
  marketType: string;
}

export interface FilterOptions {
  worldMarketsLlmEnabled: boolean;
}

export interface FilterResult<T extends RankableMarketShape> {
  /** Markets that should be passed to the LLM ranker this sweep. */
  kept: T[];
  /** Markets the gate decided not to send. Returned (not just dropped)
   *  so the caller can log the exact count + IDs for ops auditability. */
  dropped: T[];
}

/**
 * Apply ranker-input gating rules.
 *
 * Today this filters community (World) markets when their kill switch is
 * off. Extending the gate with future rules (e.g. "skip markets ending
 * in < 5 minutes") should be additive — keep each rule as its own clear
 * branch and update the doc above when adding one.
 */
export function filterRankableMarketsForRanker<T extends RankableMarketShape>(
  markets: T[],
  opts: FilterOptions,
): FilterResult<T> {
  if (opts.worldMarketsLlmEnabled) {
    return { kept: markets, dropped: [] };
  }
  const kept: T[] = [];
  const dropped: T[] = [];
  for (const m of markets) {
    if (m.marketType === "community") {
      dropped.push(m);
    } else {
      kept.push(m);
    }
  }
  return { kept, dropped };
}
