/**
 * Headline/cover image for World Markets (OpenMarketCard, MarketDetailPage).
 * Person-linked markets should show the live curate avatar (`linkedPersonAvatar`)
 * ahead of a stale stored `coverImageUrl`.
 */
export type MarketHeadlineImageSource = {
  personId?: string | null;
  coverImageUrl?: string | null;
  linkedPersonAvatar?: string | null;
};

export function resolveMarketHeadlineImageUrl(market: MarketHeadlineImageSource): string | null {
  const cover = market.coverImageUrl ?? null;
  const linked = market.linkedPersonAvatar ?? null;
  if (market.personId) {
    return linked || cover;
  }
  return cover || linked;
}
