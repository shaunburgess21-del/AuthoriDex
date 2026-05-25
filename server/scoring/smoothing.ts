/**
 * Tick-series smoothing for ingest → trend score inputs.
 * Reduces sawtooth from single-article 24h window boundary crossings.
 */

export const NEWS_SMOOTHING_WINDOW = 3;

/**
 * Mean of the last `windowSize` values in `series` (including the final
 * element, which is typically the current tick). When fewer than
 * `windowSize` points exist, returns the latest value (cold start).
 */
export function smoothLastNTicks(
  series: number[],
  windowSize: number = NEWS_SMOOTHING_WINDOW,
): number | null {
  if (series.length === 0) return null;
  const n = Math.max(1, Math.floor(windowSize));
  if (series.length < n) {
    return series[series.length - 1]!;
  }
  const slice = series.slice(-n);
  const sum = slice.reduce((a, b) => a + b, 0);
  return sum / slice.length;
}

/**
 * Collect the last N numeric values per key from time-ordered rows.
 */
export function appendToRecentSeriesMap(
  map: Map<string, number[]>,
  key: string,
  value: number,
  maxLen: number = 5,
): void {
  if (!Number.isFinite(value)) return;
  const arr = map.get(key) ?? [];
  arr.push(value);
  while (arr.length > maxLen) arr.shift();
  map.set(key, arr);
}
