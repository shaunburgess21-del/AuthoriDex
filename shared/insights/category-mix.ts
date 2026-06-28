import { getMarketCategoryLabel, normalizeMarketCategory } from "../constants";
import type { InsightsCategoryMix } from "./types";

export const CATEGORY_MIX_TOP_N = 50;

export function buildCategoryMix(
  people: Array<{ category?: string | null; rank?: number | null }>,
  topN = CATEGORY_MIX_TOP_N,
): InsightsCategoryMix {
  const top = [...people]
    .sort((a, b) => (a.rank ?? 999) - (b.rank ?? 999))
    .slice(0, topN);

  const counts = new Map<string, { category: string; label: string; count: number }>();
  for (const person of top) {
    const category = normalizeMarketCategory(person.category);
    const label = getMarketCategoryLabel(person.category);
    const current = counts.get(category) ?? { category, label, count: 0 };
    current.count += 1;
    counts.set(category, current);
  }

  const sampleSize = top.length;
  const segments = Array.from(counts.values())
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label))
    .map((row) => ({
      category: row.category,
      label: row.label,
      count: row.count,
      pct: sampleSize > 0 ? Math.round((row.count / sampleSize) * 100) : 0,
    }));

  return { topN: sampleSize, segments };
}
