import type { InsightsFilters } from "@shared/insights/filters";
import { canonicalCacheKey } from "@shared/insights/filters";
import { getInsightsCache, setInsightsCache, INSIGHTS_AGGREGATE_TTL_MS } from "./cache";
import { loadInsightsRankings } from "./rankings";
import { loadInsightsOverview } from "./overview";

export interface InsightsAggregatePayload {
  rankings: Awaited<ReturnType<typeof loadInsightsRankings>>;
  overview: Awaited<ReturnType<typeof loadInsightsOverview>>;
  asOf: string;
}

export async function loadInsightsAggregates(
  filters: InsightsFilters,
  userId?: string | null,
): Promise<InsightsAggregatePayload> {
  const cacheKey = canonicalCacheKey("insights_aggregate", filters);
  const cached = await getInsightsCache<InsightsAggregatePayload>(cacheKey);
  if (cached) return cached;

  const [rankings, overview] = await Promise.all([
    loadInsightsRankings(filters, userId),
    loadInsightsOverview(userId),
  ]);

  const payload: InsightsAggregatePayload = {
    rankings,
    overview,
    asOf: rankings.asOf ?? new Date().toISOString(),
  };

  await setInsightsCache(cacheKey, "insights_aggregate", payload, INSIGHTS_AGGREGATE_TTL_MS);
  return payload;
}
