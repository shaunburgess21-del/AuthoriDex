/**
 * Server-side fame-index scale. The numbers themselves live in
 * `shared/fame-scale.ts` (the jackpot form imports the same ceiling). This
 * file adds the ingest guardrails that only the server needs.
 *
 * Nov 2026 — rescaled from x10,000 (ceiling 1,000,000) to x1,000. Stored
 * history is divided by 10 in the same cutover by `ops/rescale-scores-div10.ts`.
 */

import { FAME_INDEX_MAX, FAME_INDEX_SCALE } from "@shared/fame-scale";

export { FAME_INDEX_MAX, FAME_INDEX_SCALE };

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
