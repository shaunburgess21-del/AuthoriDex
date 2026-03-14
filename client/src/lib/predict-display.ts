export function getRecentActivityMarketPath(marketSlug?: string | null): string {
  return marketSlug ? `/markets/${marketSlug}` : "/predict";
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
