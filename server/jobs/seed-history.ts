import { db } from "../db";
import { trendSnapshots, trendingPeople } from "@shared/schema";

/**
 * DEPRECATED: Historical snapshot seeding is disabled.
 * 
 * This function previously wrote raw trendScore values with random variations
 * to trend_snapshots, bypassing the stabilization logic in trendScore.ts.
 * This caused wild score fluctuations (e.g., 56k → 560k within hours).
 * 
 * All snapshot writing is now handled exclusively by ingest.ts, which:
 * - Fetches real data from Wikipedia/GDELT/Serper APIs
 * - Applies ±5% hourly rate limiting
 * - Applies EMA smoothing (alpha=0.04)
 * - Uses 7-day Wikipedia average for stable mass scores
 * 
 * Historical data will accumulate naturally over time as ingest.ts runs hourly.
 * 
 * @deprecated Do not use - function returns immediately without writing data
 */
export async function seedHistoricalSnapshots(daysBack: number = 7): Promise<{ created: number }> {
  console.log(`[Seed] DISABLED - Historical seeding bypasses stabilization logic.`);
  console.log(`[Seed] Snapshots are now written only by ingest.ts with rate limiting and EMA smoothing.`);
  console.log(`[Seed] Historical data will accumulate naturally as the ingestion job runs hourly.`);
  
  return { created: 0 };
}
