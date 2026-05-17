/**
 * Headline/cover image for World Markets (OpenMarketCard, MarketDetailPage).
 *
 * Resolution order: curated `coverImageUrl` first, then the linked person's
 * live curate avatar as a fallback. Most World Markets are topical (e.g.
 * "Ballon d'Or", "World Cup Winner", "Apple foldable iPhone") and benefit
 * from a hand-picked cover even when a primary person is linked. Markets
 * where the question is genuinely about a single celebrity (e.g. "Will
 * Conor McGregor fight in 2026?") simply leave `coverImageUrl` unset and
 * naturally fall through to the person avatar.
 */
export type MarketHeadlineImageSource = {
  personId?: string | null;
  coverImageUrl?: string | null;
  linkedPersonAvatar?: string | null;
};

export function resolveMarketHeadlineImageUrl(market: MarketHeadlineImageSource): string | null {
  return market.coverImageUrl ?? market.linkedPersonAvatar ?? null;
}
