export function getRecentActivityMarketPath(
  marketSlug?: string | null,
  marketType?: string | null
): string {
  if (!marketSlug) return "/predict";

  // Route supported market activity to detail pages.
  if (
    marketType === "community" ||
    marketType === "updown" ||
    marketType === "h2h" ||
    marketType === "gainer" ||
    marketType === "jackpot"
  ) {
    return `/markets/${marketSlug}`;
  }

  return "/predict";
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
