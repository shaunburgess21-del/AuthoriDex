/**
 * Canonical SPA paths for market detail pages. Keep in sync with
 * client routing (App.tsx) and notification deep links.
 */
export function getRecentActivityMarketPath(
  marketSlug?: string | null,
  marketType?: string | null,
  marketId?: string | null,
): string {
  switch (marketType) {
    case "community":
      return marketSlug ? `/markets/${marketSlug}` : "/predict";
    case "updown":
      return marketId ? `/predict/updown/${marketId}` : "/predict";
    case "h2h":
      return marketId ? `/predict/h2h/${marketId}` : "/predict";
    case "gainer":
      return marketId ? `/predict/race/${marketId}` : "/predict";
    case "jackpot":
      return "/predict";
    default:
      return "/predict";
  }
}
