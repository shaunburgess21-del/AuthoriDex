import { normalizeMarketCategory } from "@shared/constants";

export type CommunityCategoryFilter = string;

export function openMarketPool(m: {
  entries?: Array<{ totalStake?: unknown; noStake?: unknown }>;
}): number {
  return (m.entries ?? []).reduce(
    (sum, e) => sum + Number(e.totalStake ?? 0) + Number(e.noStake ?? 0),
    0,
  );
}

export function communityTrendingCompare(
  a: { activeParticipantCount?: unknown },
  b: { activeParticipantCount?: unknown },
  aPool: number,
  bPool: number,
): number {
  const betDiff =
    Number(b.activeParticipantCount ?? 0) - Number(a.activeParticipantCount ?? 0);
  if (betDiff !== 0) return betDiff;
  return bPool - aPool;
}

export function filterCommunityMarkets(
  markets: any[],
  category: CommunityCategoryFilter,
  search: string,
  favoriteIds: Set<string>,
  passesMyPositions: (marketId: string) => boolean,
): any[] {
  const searchLower = search.trim().toLowerCase();

  return markets
    .filter((m: any) => {
      const categoryMatch =
        category === "all" ||
        category === "trending" ||
        (category === "favorites"
          ? !!m.personId && favoriteIds.has(m.personId)
          : normalizeMarketCategory(m.category) === category);

      const searchMatch =
        !searchLower || m.title?.toLowerCase().includes(searchLower);

      return categoryMatch && searchMatch && passesMyPositions(m.id);
    })
    .sort((a: any, b: any) =>
      category === "trending"
        ? communityTrendingCompare(
            a,
            b,
            openMarketPool(a),
            openMarketPool(b),
          )
        : 0,
    );
}

/** Chip id to select when restoring a market card on mobile (back navigation). */
export function communityChipForMarket(
  market: { category?: string | null; personId?: string | null },
  favoriteIds: Set<string>,
): CommunityCategoryFilter {
  if (market.personId && favoriteIds.has(market.personId)) {
    return "favorites";
  }
  return normalizeMarketCategory(market.category);
}
