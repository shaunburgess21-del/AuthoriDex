/**
 * Resolves the canonical baseline score for a prediction market.
 *
 * Resolution order (most-trusted first):
 *   1. `market.baselineScore` — denormalized integer column on
 *      `prediction_markets`. Cheapest to read and the source we should
 *      prefer for new markets.
 *   2. `market.metadata.openingScore.score` — original metadata blob
 *      written at market creation. Authoritative for older rows that
 *      pre-date the denormalized column.
 *   3. Last-resort heuristic from `change7d`. Returns the *correct*
 *      percentage inverse (P_then = P_now / (1 + pct/100)). This is
 *      approximate — `change7d` is a 7-day rolling delta, not the
 *      market's open-week period — so callers should treat the value
 *      as a best-effort fallback for legacy markets that lost their
 *      opening snapshot. Only fires when an obviously-usable
 *      `currentScore` and a non-zero `change7d` are available.
 *   4. Otherwise `null` so the caller can decide how to render.
 *
 * Historical bug: several callsites used to compute
 *   `currentScore - Math.floor(currentScore * change7d / 100)`
 * which is `currentScore × (1 - pct/100)` — the wrong inverse for a
 * percentage gain. The leaderboard's Predict modal in particular never
 * read the canonical sources at all and always returned this broken
 * value. This helper is the single replacement for those snippets.
 */
export interface MarketBaselineSource {
  baselineScore?: number | null;
  metadata?: {
    openingScore?: {
      score?: number | null;
    } | null;
  } | null;
  person?: {
    change7d?: number | null;
  } | null;
}

export function getMarketBaselineScore(
  market: MarketBaselineSource,
  currentScore: number,
): number | null {
  const denorm = market.baselineScore;
  if (typeof denorm === "number" && Number.isFinite(denorm) && denorm > 0) {
    return Math.round(denorm);
  }

  const stored = market.metadata?.openingScore?.score;
  if (typeof stored === "number" && Number.isFinite(stored) && stored > 0) {
    return Math.round(stored);
  }

  const change7d = Number(market.person?.change7d ?? 0);
  if (
    Number.isFinite(currentScore) &&
    currentScore > 0 &&
    Number.isFinite(change7d) &&
    change7d !== 0
  ) {
    return Math.round(currentScore / (1 + change7d / 100));
  }

  return null;
}
