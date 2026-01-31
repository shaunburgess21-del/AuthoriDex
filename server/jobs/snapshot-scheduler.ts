import { db } from "../db";
import { trackedPeople, trendSnapshots, apiCache, trendingPeople } from "@shared/schema";
import { eq, desc } from "drizzle-orm";
import { computeTrendScore } from "../scoring/trendScore";

/**
 * DEPRECATED: This scheduler is no longer used for writing snapshots.
 * 
 * Snapshots are now ONLY written by ingest.ts to prevent duplicate/conflicting
 * data points that cause jagged trend graphs.
 * 
 * This function is kept for backwards compatibility but now just logs a message.
 * The ingestion scheduler (running ingest.ts every 60 minutes) is the single
 * source of truth for trend snapshots.
 */
export async function captureHourlySnapshots(): Promise<{ captured: number; errors: number }> {
  console.log("[Snapshot] DEPRECATED: Snapshots are now captured by ingest.ts only.");
  console.log("[Snapshot] This scheduler is disabled to prevent duplicate data points.");
  return { captured: 0, errors: 0 };
}

let snapshotInterval: NodeJS.Timeout | null = null;

// Serverless mode detection
const SERVERLESS_MODE = process.env.SERVERLESS_MODE === "true" || process.env.VERCEL === "1";

export function startSnapshotScheduler(intervalMs: number = 60 * 60 * 1000) {
  // DISABLED: Snapshots are now captured by ingest.ts only
  console.log("[Snapshot] Scheduler DISABLED - snapshots are captured by ingestion job only.");
  return;
}

export function stopSnapshotScheduler() {
  if (snapshotInterval) {
    clearInterval(snapshotInterval);
    snapshotInterval = null;
    console.log("[Snapshot] Scheduler stopped");
  }
}
