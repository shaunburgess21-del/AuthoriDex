import type { InsightsRankingRow } from "./types";

/**
 * Merge infinite-scroll pages while dropping duplicate person ids.
 * Live sort shifts between offset pages can surface the same row twice.
 */
export function mergeDedupedRankingRows(
  pages: Array<{ rows: InsightsRankingRow[] }> | undefined,
): InsightsRankingRow[] {
  if (!pages) return [];

  const seen = new Set<string>();
  const merged: InsightsRankingRow[] = [];

  for (const page of pages) {
    for (const row of page.rows) {
      if (seen.has(row.id)) continue;
      seen.add(row.id);
      merged.push(row);
    }
  }

  return merged;
}
