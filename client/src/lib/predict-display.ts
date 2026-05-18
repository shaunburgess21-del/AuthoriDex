export { getRecentActivityMarketPath } from "@shared/lib/market-paths";

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
