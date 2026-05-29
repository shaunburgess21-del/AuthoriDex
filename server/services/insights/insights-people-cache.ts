import type { TrendingPerson } from "@shared/schema";
import { storage } from "../../storage";
import { INSIGHTS_REQUEST_MEMO_TTL_MS, memoizeAsync } from "./request-memo";

const TRENDING_PEOPLE_MEMO_KEY = "insights:trending-people";

/**
 * Memoized roster read for Insights aggregates only. Ingest / leaderboard paths
 * should keep calling `storage.getTrendingPeople()` directly.
 */
export async function getCachedTrendingPeople(): Promise<TrendingPerson[]> {
  return memoizeAsync(TRENDING_PEOPLE_MEMO_KEY, INSIGHTS_REQUEST_MEMO_TTL_MS, () =>
    storage.getTrendingPeople(),
  );
}
