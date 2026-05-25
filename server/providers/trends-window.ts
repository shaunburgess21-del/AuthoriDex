// Pure Google Trends timeseries window helpers (no DB / API deps).

export interface TrendsTimeseriesPoint {
  date: string;
  interest: number;
}

/** SerpApi `date` param for activity + day-over-day delta (one shared peak scale). */
export const TRENDS_SERPAPI_WINDOW = "now 7-d";

/** Persisted on snapshots so routes/UI only use comparable day-over-day deltas. */
export const TRENDS_DELTA_METHOD = "latest_24h_vs_previous_24h";

const MS_PER_24H = 24 * 60 * 60 * 1000;

function meanInterest(points: TrendsTimeseriesPoint[]): number {
  if (points.length === 0) return 0;
  return points.reduce((s, x) => s + x.interest, 0) / points.length;
}

/**
 * Day-over-day means from one `now 7-d` response (same peak normalisation).
 * - latestInterest: mean of points in the latest 24h ending at the series end
 * - prevWindowInterest: mean of points in the prior 24h
 * - avgWindowInterest: mean over the full returned series (7d momentum baseline)
 */
export function computeTrendsDayOverDayMeans(
  series: TrendsTimeseriesPoint[],
): {
  latestInterest: number;
  prevWindowInterest: number;
  avgWindowInterest: number;
} {
  if (series.length === 0) {
    return { latestInterest: 0, prevWindowInterest: 0, avgWindowInterest: 0 };
  }

  const sorted = [...series].sort(
    (a, b) => new Date(a.date).getTime() - new Date(b.date).getTime(),
  );
  const endMs = new Date(sorted[sorted.length - 1].date).getTime();
  if (!Number.isFinite(endMs)) {
    return { latestInterest: 0, prevWindowInterest: 0, avgWindowInterest: 0 };
  }

  const latestStart = endMs - MS_PER_24H;
  const prevStart = endMs - 2 * MS_PER_24H;

  const latestPoints: TrendsTimeseriesPoint[] = [];
  const prevPoints: TrendsTimeseriesPoint[] = [];
  for (const p of sorted) {
    const t = new Date(p.date).getTime();
    if (!Number.isFinite(t)) continue;
    if (t > latestStart && t <= endMs) latestPoints.push(p);
    else if (t > prevStart && t <= latestStart) prevPoints.push(p);
  }

  return {
    latestInterest: meanInterest(latestPoints),
    prevWindowInterest: meanInterest(prevPoints),
    avgWindowInterest: meanInterest(sorted),
  };
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
