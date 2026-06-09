import { normalizeMarketCategory } from "../constants";

export type WebSentimentSortDir = "desc" | "asc";

export interface WebSentimentFilterRow {
  id: string;
  name: string;
  category: string | null;
  positivePct: number;
}

export interface WebSentimentFilterOptions {
  search: string;
  category: string;
  favoriteIds: ReadonlySet<string>;
  sortDir: WebSentimentSortDir;
}

export function filterWebSentimentRows<T extends WebSentimentFilterRow>(
  rows: T[],
  options: WebSentimentFilterOptions,
): T[] {
  const { search, category, favoriteIds, sortDir } = options;
  const query = search.trim().toLowerCase();

  let filtered = rows;

  if (query) {
    filtered = filtered.filter((row) => row.name.toLowerCase().includes(query));
  }

  if (category === "favorites") {
    filtered = filtered.filter((row) => favoriteIds.has(row.id));
  } else if (category !== "all" && category !== "trending") {
    const norm = normalizeMarketCategory(category);
    filtered = filtered.filter(
      (row) => row.category && normalizeMarketCategory(row.category) === norm,
    );
  }

  return [...filtered].sort((a, b) =>
    sortDir === "asc" ? a.positivePct - b.positivePct : b.positivePct - a.positivePct,
  );
}

/** Rank map from a DESC-sorted filtered list (1 = highest sentiment %). */
export function buildWebSentimentLeaderboardRankMap(
  descSortedFilteredRows: readonly WebSentimentFilterRow[],
): Map<string, number> {
  return new Map(descSortedFilteredRows.map((row, idx) => [row.id, idx + 1]));
}
