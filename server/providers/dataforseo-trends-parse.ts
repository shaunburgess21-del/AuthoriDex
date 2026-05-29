// Pure DataForSEO Trends explore/live parsers (no DB / env deps).

import {
  computeTrendsCurrentInterest,
  type TrendsTimeseriesPoint,
} from "./trends-window";

export interface TrendsBatchResult {
  personId: string;
  timeseries: TrendsTimeseriesPoint[];
  currentInterest: number;
  avgWindowInterest: number;
}

/** Map one explore/live task → hourly timeseries points. */
export function parseDataForSeoTrendsExploreTask(task: unknown): TrendsTimeseriesPoint[] {
  const t = task as { status_code?: number; result?: Array<{ items?: unknown[] }> };
  if (t?.status_code !== 20000) return [];

  const items = t.result?.[0]?.items;
  if (!Array.isArray(items)) return [];

  const graph = items.find((i) => Array.isArray((i as { data?: unknown }).data)) as
    | { data?: Array<{ timestamp?: number; values?: number[] }> }
    | undefined;
  const data = graph?.data;
  if (!Array.isArray(data)) return [];

  const series: TrendsTimeseriesPoint[] = [];
  for (const point of data) {
    const ts = point.timestamp;
    if (ts == null || !Number.isFinite(ts)) continue;
    const raw = point.values?.[0];
    const interest = typeof raw === "number" && Number.isFinite(raw) ? raw : 0;
    series.push({ date: new Date(ts * 1000).toISOString(), interest });
  }
  return series;
}

export function trendsBatchResultFromSeries(
  personId: string,
  series: TrendsTimeseriesPoint[],
): TrendsBatchResult {
  if (series.length === 0) {
    return { personId, timeseries: [], currentInterest: 0, avgWindowInterest: 0 };
  }
  const { currentInterest, avgWindowInterest } = computeTrendsCurrentInterest(series);
  return { personId, timeseries: series, currentInterest, avgWindowInterest };
}
