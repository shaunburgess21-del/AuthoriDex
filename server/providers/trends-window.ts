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
 * dropped; the card's +/-% chip now derives from the intra-day momentumRatio
 * (current 3h vs same-response 24h mean) instead.
 */
export const TRENDS_SERPAPI_WINDOW = "now 1-d";

/**
 * DataForSEO `time_range` for explore/live. May 2026: switched from `past_day`
 * (hourly) to `past_30_days` (daily) — the hourly series is normalized to the
 * day's peak hour, so a "current 3h mean" read at a UTC trough returned ~0 for
 * the whole roster (pure time-of-day bias). Daily points carry no time-of-day
 * bias, giving a stable recent-vs-baseline momentum.
 */
export const TRENDS_DFS_WINDOW = "past_30_days";

/**
 * Sentinel persisted on snapshots so routes/UI only render values from the
 * current methodology. Bumped May 2026 when ingest moved from SerpApi to
 * DataForSEO Trends — old snapshots fail the gate and are ignored until
 * refreshed by the next ingest tick (≤12h).
 * v2: per-request fetch (the batched 100-tasks/POST only ever covered the
 * first keyword per chunk).
 * v3: `past_30_days` daily series, recent-7d vs prior baseline (drops the
 * time-of-day-biased "current 3h on past_day" reading). Bump forces re-fetch.
 */
export const TRENDS_DELTA_METHOD = "dfs_recent7d_vs_prior_30d_v3";

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

/** Recent-window length (days) for the `past_30_days` daily momentum reading. */
const TRENDS_RECENT_DAYS = 7;

/**
 * Daily-granularity momentum from a `past_30_days` series (one point per day,
 * normalized 0-100 to the window's peak day). Unlike the hourly `past_day`
 * series, daily points carry no time-of-day bias, so the reading is stable
 * regardless of when ingest samples.
 *
 * - `currentInterest`: mean of the most recent `recentDays` daily points — the
 *   headline "recent search interest" (0-100, relative to the 30-day peak).
 * - `avgWindowInterest`: mean of the PRIOR days (before the recent window) as a
 *   momentum baseline; falls back to the full-series mean for short series.
 */
export function computeTrendsDailyMomentum(
  series: TrendsTimeseriesPoint[],
  recentDays = TRENDS_RECENT_DAYS,
): { currentInterest: number; avgWindowInterest: number } {
  if (series.length === 0) return { currentInterest: 0, avgWindowInterest: 0 };
  const sorted = [...series].sort(
    (a, b) => new Date(a.date).getTime() - new Date(b.date).getTime(),
  );
  const recent = sorted.slice(-recentDays);
  const prior = sorted.slice(0, -recentDays);
  return {
    currentInterest: meanInterest(recent),
    avgWindowInterest: prior.length > 0 ? meanInterest(prior) : meanInterest(sorted),
  };
}

/** Default dead zone for UI display: hide +/-% chip when within this band of 1.0. */
export const TRENDS_MOMENTUM_DEAD_ZONE_PCT = 10;

/**
 * Convert persisted `momentumRatio` (current 3h mean / same-response 24h mean) to a
 * signed percent delta for pills and chips. Both inputs come from one SerpApi
 * `now 1-d` response, so there is no fetch-over-fetch drift or time-of-day
 * normalization mismatch.
 *
 * @param momentumRatio - interest / max(avg24hMean, 1), capped at 10× in ingest
 * @param hasCurrentMethod - snapshot uses TRENDS_DELTA_METHOD sentinel
 */
export function computeTrendsMomentumDeltaPct(
  momentumRatio: number,
  hasCurrentMethod: boolean,
  deadZonePct = TRENDS_MOMENTUM_DEAD_ZONE_PCT,
): number {
  if (!hasCurrentMethod || !Number.isFinite(momentumRatio) || momentumRatio <= 0) {
    return 0;
  }
  const raw = Math.round((momentumRatio - 1) * 100);
  return Math.abs(raw) <= deadZonePct ? 0 : raw;
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
