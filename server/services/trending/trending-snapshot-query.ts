import type { TrendingPerson } from "@shared/schema";
import { matchesCategoryFilter, normalizeMarketCategory } from "@shared/constants";
import type { BaselineDiagnostics } from "../../utils/baseline";

export type EnrichedTrendingPerson = TrendingPerson & {
  approvalPct: number | null;
  approvalAvgRating: number | null;
  approvalVotesCount: number | null;
  underratedPct: number | null;
  overratedPct: number | null;
  fairlyRatedPct: number | null;
  valueScore: number | null;
  rankChange: number;
};

export interface TrendingQueryFilters {
  search?: string;
  category?: string;
  sort?: string;
}

export interface TrendingPagination {
  limit?: string;
  offset?: string;
}

const DEFAULT_TRENDING_LIMIT = 200;

/** Pure in-memory filter + sort (same semantics as the legacy route handler). */
export function filterAndSortTrendingPeople(
  people: EnrichedTrendingPerson[],
  filters: TrendingQueryFilters,
): EnrichedTrendingPerson[] {
  let result = people;

  const { search, category, sort } = filters;
  if (search && typeof search === "string") {
    const searchLower = search.toLowerCase();
    result = result.filter(
      (p) =>
        p.name.toLowerCase().includes(searchLower)
        || (p.category && p.category.toLowerCase().includes(searchLower)),
    );
  }

  if (category && typeof category === "string") {
    const canonicalCategory = normalizeMarketCategory(category);
    // "all"/"trending" are UI-only filters, not real categories — leave the
    // list unfiltered rather than relying on matchesCategoryFilter passthrough.
    if (canonicalCategory !== "all" && canonicalCategory !== "trending") {
      result = result.filter((p) =>
        matchesCategoryFilter(p.category, p.secondaryCategories, canonicalCategory),
      );
    }
  }

  if (sort === "rank") {
    result = [...result].sort((a, b) => a.rank - b.rank);
  } else if (sort === "score") {
    result = [...result].sort((a, b) => b.trendScore - a.trendScore);
  } else if (sort === "24h") {
    result = [...result].sort((a, b) => (b.change24h ?? 0) - (a.change24h ?? 0));
  } else if (sort === "7d") {
    result = [...result].sort((a, b) => (b.change7d ?? 0) - (a.change7d ?? 0));
  } else if (sort === "approval") {
    result = [...result].sort((a, b) => {
      const aRating = a.approvalAvgRating ?? null;
      const bRating = b.approvalAvgRating ?? null;
      if (aRating === null && bRating === null) return 0;
      if (aRating === null) return 1;
      if (bRating === null) return -1;
      if (bRating !== aRating) return bRating - aRating;
      return (b.approvalVotesCount ?? 0) - (a.approvalVotesCount ?? 0);
    });
  }

  return result;
}

export function paginateTrendingPeople(
  people: EnrichedTrendingPerson[],
  pagination: TrendingPagination,
): EnrichedTrendingPerson[] {
  const requestedLimit = pagination.limit && typeof pagination.limit === "string"
    ? pagination.limit
    : String(DEFAULT_TRENDING_LIMIT);

  if (requestedLimit === "all") {
    return people;
  }

  const limitNum = parseInt(requestedLimit, 10);
  const offsetNum = pagination.offset && typeof pagination.offset === "string"
    ? parseInt(pagination.offset, 10)
    : 0;

  if (!Number.isNaN(limitNum) && limitNum > 0) {
    return people.slice(offsetNum, offsetNum + limitNum);
  }

  return people;
}

export function applyBaselineDegraded(
  people: EnrichedTrendingPerson[],
  baselineMeta: BaselineDiagnostics,
): EnrichedTrendingPerson[] {
  if (baselineMeta.baseline24hStatus === "normal") {
    return people;
  }
  return people.map((p) => ({ ...p, change24h: null, change7d: null }));
}
