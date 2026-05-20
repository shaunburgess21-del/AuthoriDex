// Pure Google Trends timeseries window helpers (no DB / API deps).

export interface TrendsTimeseriesPoint {
  date: string;
  interest: number;
}

const LATEST_TAIL_FRACTION = 1 / 6;
const LATEST_TAIL_MAX_POINTS = 30;
const LATEST_TAIL_MIN_POINTS = 4;

/** Shared head/tail window size for interest smoothing (~4h at `now 1-d`). */
export function trendsWindowSize(seriesLength: number): number {
  return Math.min(
    LATEST_TAIL_MAX_POINTS,
    Math.max(LATEST_TAIL_MIN_POINTS, Math.floor(seriesLength * LATEST_TAIL_FRACTION)),
  );
}

export function computeTrendsWindowMeans(series: TrendsTimeseriesPoint[]): {
  latestInterest: number;
  prevWindowInterest: number;
  /** Mean of all points in the `now 1-d` series (same peak normalisation). */
  avg24hInterest: number;
} {
  if (series.length === 0) {
    return { latestInterest: 0, prevWindowInterest: 0, avg24hInterest: 0 };
  }
  const win = Math.min(trendsWindowSize(series.length), series.length);
  const lastWindow = series.slice(-win);
  const firstWindow = series.slice(0, win);
  const latestInterest = lastWindow.length > 0
    ? lastWindow.reduce((s, x) => s + x.interest, 0) / lastWindow.length
    : 0;
  const prevWindowInterest = firstWindow.length > 0
    ? firstWindow.reduce((s, x) => s + x.interest, 0) / firstWindow.length
    : 0;
  const avg24hInterest = series.reduce((s, x) => s + x.interest, 0) / series.length;
  return { latestInterest, prevWindowInterest, avg24hInterest };
}

// ---------------------------------------------------------------------------
// Ingest cadence gate (12h SerpApi fetch interval)
// ---------------------------------------------------------------------------

/** Must match ingest gate and stay below serpapi_trends api_cache TTL (6h). */
export const TRENDS_FETCH_INTERVAL_MS = 12 * 60 * 60 * 1000;

/**
 * Whether ingest should call SerpApi for Google Trends this cycle.
 * `lastFetchAt` is the latest real fetch time (not carry-forward snapshot time).
 */
export function shouldFetchGoogleTrends(
  lastFetchAt: Date | null,
  nowMs = Date.now(),
  intervalMs = TRENDS_FETCH_INTERVAL_MS,
): boolean {
  if (lastFetchAt == null) return true;
  const lastMs = lastFetchAt.getTime();
  if (!Number.isFinite(lastMs)) return true;
  return nowMs - lastMs >= intervalMs;
}
