/**
 * Pure cascade winner logic (no DB / provider imports — safe for unit tests).
 */

export type CascadeNewsSource = "currents" | "dataforseo_news" | "serper_news" | "gdelt";

/** First non-zero in cascade priority order; null if all zero. */
export function pickCascadeWinningSource(counts: {
  currents: number;
  dataforseo: number;
  serper: number;
  gdelt: number;
}): CascadeNewsSource | null {
  if (counts.currents > 0) return "currents";
  if (counts.dataforseo > 0) return "dataforseo_news";
  if (counts.serper > 0) return "serper_news";
  if (counts.gdelt > 0) return "gdelt";
  return null;
}
