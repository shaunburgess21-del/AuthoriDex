/**
 * Pre-warms Insights api_cache entries so page loads avoid cold-compute
 * stampedes and long-running analytics queries on the request path.
 */
import { DEFAULT_INSIGHTS_FILTERS } from "@shared/insights/filters";
import { loadInsightsRankings } from "../services/insights/rankings";
import { loadMarketsAnalytics } from "../services/insights/markets-analytics";
import { loadInsightsOverview } from "../services/insights/overview";
import { loadVolatility } from "../services/insights/volatility";
import { withDiscoverCache } from "../services/insights/discover-cache";
import { maybeHardRefreshInsightsStory } from "./insights-story-cron";

export interface InsightsCacheCronResult {
  warmed: string[];
  failed: string[];
  durationMs: number;
}

const WARM_TASKS: Array<{ name: string; run: () => Promise<unknown> }> = [
  // Movers board (default) plus its 7d toggle and the News / Wikipedia boards
  // users hit most — warming them avoids the cold ~160-person signal compute
  // on the request path.
  { name: "rankings", run: () => loadInsightsRankings(DEFAULT_INSIGHTS_FILTERS, null) },
  {
    name: "rankings:movers-7d",
    run: () =>
      loadInsightsRankings({ ...DEFAULT_INSIGHTS_FILTERS, window: "7d" }, null),
  },
  {
    name: "rankings:news",
    run: () =>
      loadInsightsRankings({ ...DEFAULT_INSIGHTS_FILTERS, source: "news" }, null),
  },
  {
    name: "rankings:wiki",
    run: () =>
      loadInsightsRankings({ ...DEFAULT_INSIGHTS_FILTERS, source: "wiki" }, null),
  },
  { name: "markets", run: () => loadMarketsAnalytics() },
  { name: "volatility", run: () => withDiscoverCache("volatility", loadVolatility) },
  { name: "overview", run: () => loadInsightsOverview(null) },
  // Hard-refresh the briefing if a new live #1 gainer isn't named in it yet
  // (rate-limited to once per scheduled slot inside the helper).
  { name: "story:hard-refresh", run: () => maybeHardRefreshInsightsStory() },
];

export async function runInsightsCacheCronRefresh(): Promise<InsightsCacheCronResult> {
  const start = Date.now();
  const warmed: string[] = [];
  const failed: string[] = [];

  // Independent steps: one slow/failing loader (e.g. volatility) must not
  // block the others from refreshing their cache entries.
  for (const task of WARM_TASKS) {
    try {
      await task.run();
      warmed.push(task.name);
    } catch (err: any) {
      failed.push(task.name);
      console.error(`[insights cache] ${task.name} warm failed:`, err?.message ?? err);
    }
  }

  return { warmed, failed, durationMs: Date.now() - start };
}
