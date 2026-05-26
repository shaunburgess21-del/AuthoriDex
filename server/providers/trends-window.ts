// Pure Google Trends timeseries window helpers (no DB / API deps).

export interface TrendsTimeseriesPoint {
  date: string;
  interest: number;
}

/**
 * SerpApi `date` param. May 2026: switched from `now 7-d` to `now 1-d` so the
 * 0-100 score is normalized to the person's busiest hour over the LAST 24h —
 * exactly matching the curve users see on Google Trends "Past 24 hours" view.
 * Day-over-day deltas (which were the only reason for the wider window) were
 * removed from the UI when we made the card score-only.
 */
export const TRENDS_SERPAPI_WINDOW = "now 1-d";

/**
 * Sentinel persisted on snapshots so routes/UI only render values from the
 * current methodology. Bumped from "latest_24h_vs_previous_24h" when we moved
 * to `now 1-d` + last-3h-mean — old snapshots fail the gate and are ignored
 * until refreshed by the next ingest tick (≤12h).
 */
export const TRENDS_DELTA_METHOD = "current_3h_mean_on_now_1d";

const MS_PER_HOUR = 60 * 60 * 1000;
const CURRENT_WINDOW_HOURS = 3;
const MS_PER_CURRENT_WINDOW = CURRENT_WINDOW_HOURS * MS_PER_HOUR;

function meanInterest(points: TrendsTimeseriesPoint[]): number {
  if (points.length === 0) return 0;
  return points.reduce((s, x) => s + x.interest, 0) / points.length;
}

/**
 * Current interest reading from a `now 1-d` SerpApi response.
 *
 * - `currentInterest`: mean of the points in the last ~3 hours of the series.
 *   This is the headline "right now" number on the Google Trends card. We
 *   smooth across 3 hours instead of using the single latest hourly point so
 *   one quiet/loud hour doesn't whip the score around.
 * - `avgWindowInterest`: mean over the full returned series (~24 hourly points
 *   on `now 1-d`). Used as a baseline denominator for the dormant intra-day
 *   momentum ratio. Persisted in `trendsAvg7d` for backwards compatibility
 *   with the existing diagnostics field name (semantics is now "24h mean",
 *   not "7d mean").
 */
export function computeTrendsCurrentInterest(
  series: TrendsTimeseriesPoint[],
): {
  currentInterest: number;
  avgWindowInterest: number;
} {
  if (series.length === 0) {
    return { currentInterest: 0, avgWindowInterest: 0 };
  }

  const sorted = [...series].sort(
    (a, b) => new Date(a.date).getTime() - new Date(b.date).getTime(),
  );
  const endMs = new Date(sorted[sorted.length - 1].date).getTime();
  if (!Number.isFinite(endMs)) {
    return { currentInterest: 0, avgWindowInterest: 0 };
  }

  const currentStart = endMs - MS_PER_CURRENT_WINDOW;
  const currentPoints: TrendsTimeseriesPoint[] = [];
  for (const p of sorted) {
    const t = new Date(p.date).getTime();
    if (!Number.isFinite(t)) continue;
    if (t > currentStart && t <= endMs) currentPoints.push(p);
  }

  // Fallback: if for some reason fewer than 1 point lands in the 3h window
  // (very sparse series), use the single most recent point so we never report
  // 0 when we have data.
  const fallbackTail = currentPoints.length > 0
    ? currentPoints
    : sorted.slice(-1);

  return {
    currentInterest: meanInterest(fallbackTail),
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
