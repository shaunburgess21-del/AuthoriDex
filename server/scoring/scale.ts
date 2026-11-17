/**
 * Fame Index scale — the single place that defines how big a trend score is.
 *
 * The composite `baseScore` is a 0..100 number. It is multiplied by
 * `FAME_INDEX_SCALE` to produce the integer shown on the leaderboard, so the
 * top of the board sits around 80,000 and the hard ceiling is 100,000.
 *
 * Nov 2026 — rescaled from x10,000 (ceiling 1,000,000) to x1,000 so the public
 * number reads as tens of thousands rather than hundreds of thousands. All
 * stored history was divided by 10 in the same cutover by
 * `ops/rescale-scores-div10.ts`. Ranks, percentage moves and market outcomes
 * are unaffected because every consumer works on ratios; only code that holds
 * an ABSOLUTE score threshold depends on this scale, and those thresholds
 * should be derived from (or sit next to) the constants below.
 */

/** Multiplier applied to the 0..100 composite to produce the Fame Index. */
export const FAME_INDEX_SCALE = 1_000;

/** Hard ceiling for a Fame Index (composite of 100). */
export const FAME_INDEX_MAX = 100 * FAME_INDEX_SCALE;

/**
 * Write-time sanity floor: a real ingest averages roughly 46,000 across the
 * roster, so an average below this means the inputs collapsed (provider
 * outage, mock data) and the run must not overwrite the leaderboard.
 */
export const MIN_PLAUSIBLE_AVG_FAME_INDEX = 5 * FAME_INDEX_SCALE;

/**
 * True when stored scores are still on the legacy x10,000 scale.
 *
 * On the current scale nothing can exceed `FAME_INDEX_MAX` (the engine clamps
 * to it), whereas the legacy leaderboard topped out near 800,000 — so the
 * maximum stored value is an unambiguous discriminator.
 *
 * Scoring must never run against legacy-scale history: the cross-snapshot EMA
 * blends the new raw score with the previous stored one, so a single mixed
 * tick would write a meaningless value into `trend_snapshots` and every
 * 24h / 7d change and open market would be computed against it.
 */
export function isLegacyFameScale(maxStoredFameIndex: number | null | undefined): boolean {
  return (
    typeof maxStoredFameIndex === "number" &&
    Number.isFinite(maxStoredFameIndex) &&
    maxStoredFameIndex > FAME_INDEX_MAX
  );
}
