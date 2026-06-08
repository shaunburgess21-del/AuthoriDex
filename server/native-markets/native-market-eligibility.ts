/** Pure helpers for weekly native market roster eligibility (no DB). */

export function getNativeMarketEligibilityWindow(weekMonday: Date): {
  windowStart: Date;
  windowEnd: Date;
} {
  const windowEnd = weekMonday;
  const windowStart = new Date(weekMonday.getTime() - 7 * 24 * 60 * 60 * 1000);
  return { windowStart, windowEnd };
}

/** Minimum official ingest samples in the 7 days before Monday market generation. */
export function getMinRecentIngestSamplesForNativeMarkets(): number {
  const raw = Number(process.env.NATIVE_MARKET_MIN_RECENT_INGEST_SAMPLES);
  return Number.isFinite(raw) && raw >= 1 ? Math.floor(raw) : 24;
}
