/**
 * DEPRECATED: Historical snapshot seeding script is disabled.
 * 
 * This script previously wrote snapshots with artificial variations that
 * bypassed the stabilization logic in trendScore.ts, causing wild score
 * fluctuations on the leaderboard (e.g., 56k → 560k within hours).
 * 
 * All snapshot writing is now handled exclusively by ingest.ts, which:
 * - Fetches real data from Wikipedia/GDELT/Serper APIs
 * - Applies ±5% hourly rate limiting (MAX_HOURLY_CHANGE_PERCENT = 0.05)
 * - Applies EMA smoothing (alpha=0.04) for smooth stock-market-style curves
 * - Uses 7-day Wikipedia average for stable mass scores
 * 
 * Historical data will accumulate naturally as ingest.ts runs hourly.
 * 
 * @deprecated Do not run this script - it will exit immediately
 */

async function seedHistoricalSnapshots() {
  console.log("\n⚠️  DEPRECATED: Historical snapshot seeding is disabled.\n");
  console.log("This script previously caused wild score fluctuations by");
  console.log("writing snapshots that bypassed the stabilization logic.\n");
  console.log("All snapshot writing is now handled exclusively by ingest.ts,");
  console.log("which applies:");
  console.log("  - ±5% hourly rate limiting");
  console.log("  - EMA smoothing (alpha=0.04)");
  console.log("  - 7-day Wikipedia average for mass baseline\n");
  console.log("Historical data will accumulate naturally as the ingestion job runs hourly.\n");
  console.log("Exiting without writing any data.\n");
}

seedHistoricalSnapshots()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("Fatal error:", error);
    process.exit(1);
  });
