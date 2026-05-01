/**
 * Resolve the correct detail-page path for a market that appeared in the
 * recent-activity / Town Square feed.
 *
 * Each native market type has its own dedicated detail page that's wired
 * to the right betting UI (H2H pick-a-side, Up/Down, Category Race,
 * Jackpot exact score). The generic /markets/:slug page is the
 * Community / World Market detail UI — designed for Yes/No outcomes —
 * and routing native markets through it produces a broken layout
 * (head-to-head shown as "Person A: Yes/No, Person B: Yes/No").
 *
 *   community   -> /markets/:slug              (World Markets)
 *   updown      -> /predict/updown/:marketId
 *   h2h         -> /predict/h2h/:marketId
 *   gainer      -> /predict/race/:marketId
 *   jackpot     -> /predict                    (no detail page exists)
 *
 * Anything unrecognised falls back to /predict.
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
      // No dedicated jackpot detail page; the jackpot hero lives on the
      // main predict page.
      return "/predict";
    default:
      return "/predict";
  }
}

export function formatSignedPercent(value: number, fractionDigits = 1): string {
  if (!Number.isFinite(value)) return "--";
  const sign = value >= 0 ? "+" : "";
  return `${sign}${value.toFixed(fractionDigits)}%`;
}

export function formatSignedPoints(value: number): string {
  if (!Number.isFinite(value)) return "--";
  const sign = value >= 0 ? "+" : "";
  return `${sign}${value.toLocaleString("en-US")}`;
}

export function shouldRenderCrowdSentiment(value?: number | null): boolean {
  return value != null;
}
