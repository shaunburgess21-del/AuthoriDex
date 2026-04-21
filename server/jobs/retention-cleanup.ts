import { db } from "../db";
import { trendSnapshots, apiCache, ingestionRuns, pageViews } from "@shared/schema";
import { sql, lt, and } from "drizzle-orm";

const SNAPSHOT_RETENTION_DAYS = 90;
const INGESTION_RUN_RETENTION_DAYS = 60;
// Page-view analytics are fine-grained; keep ~6 months by default, overridable
// via PAGE_VIEW_RETENTION_DAYS for installs that want to run thinner/thicker.
// Unbounded growth here caused the table to become the largest in the DB.
const PAGE_VIEW_RETENTION_DAYS = (() => {
  const raw = parseInt((process.env.PAGE_VIEW_RETENTION_DAYS ?? "180").trim(), 10);
  return Number.isFinite(raw) && raw >= 7 && raw <= 730 ? raw : 180;
})();
const CLEANUP_BATCH_SIZE = 1000;

export interface RetentionCleanupResult {
  snapshotsDeleted: number;
  cacheEntriesDeleted: number;
  ingestionRunsDeleted: number;
  pageViewsDeleted: number;
  durationMs: number;
}

export async function runRetentionCleanup(): Promise<RetentionCleanupResult> {
  const startTime = Date.now();
  console.log("[Retention] Starting cleanup job...");

  let snapshotsDeleted = 0;
  let cacheEntriesDeleted = 0;
  let ingestionRunsDeleted = 0;
  let pageViewsDeleted = 0;

  // 1. Prune old trend_snapshots (keep last N days)
  try {
    const snapshotCutoff = new Date();
    snapshotCutoff.setDate(snapshotCutoff.getDate() - SNAPSHOT_RETENTION_DAYS);

    let deletedInBatch = 0;
    do {
      const result = await db.execute(sql`
        DELETE FROM trend_snapshots
        WHERE id IN (
          SELECT id FROM trend_snapshots
          WHERE timestamp < ${snapshotCutoff}
          LIMIT ${CLEANUP_BATCH_SIZE}
        )
      `);
      deletedInBatch = Number(result.rowCount ?? 0);
      snapshotsDeleted += deletedInBatch;
    } while (deletedInBatch === CLEANUP_BATCH_SIZE);

    console.log(`[Retention] Deleted ${snapshotsDeleted} trend_snapshots older than ${SNAPSHOT_RETENTION_DAYS} days`);
  } catch (err) {
    console.error("[Retention] Error pruning trend_snapshots:", err);
  }

  // 2. Delete expired api_cache entries
  try {
    const now = new Date();
    const deleted = await db
      .delete(apiCache)
      .where(lt(apiCache.expiresAt, now));
    cacheEntriesDeleted = Number((deleted as any).rowCount ?? 0);
    console.log(`[Retention] Deleted ${cacheEntriesDeleted} expired api_cache entries`);
  } catch (err) {
    console.error("[Retention] Error pruning api_cache:", err);
  }

  // 3. Delete old ingestion_runs (keep recent for debugging)
  try {
    const runCutoff = new Date();
    runCutoff.setDate(runCutoff.getDate() - INGESTION_RUN_RETENTION_DAYS);

    const deleted = await db
      .delete(ingestionRuns)
      .where(and(
        lt(ingestionRuns.startedAt, runCutoff),
        sql`${ingestionRuns.status} != 'running'`
      ));
    ingestionRunsDeleted = Number((deleted as any).rowCount ?? 0);
    console.log(`[Retention] Deleted ${ingestionRunsDeleted} ingestion_runs older than ${INGESTION_RUN_RETENTION_DAYS} days`);
  } catch (err) {
    console.error("[Retention] Error pruning ingestion_runs:", err);
  }

  // 4. Prune old page_views analytics. Batched because this table can grow
  // into the millions on busy installs; unbounded DELETE would hurt WAL/latency.
  try {
    const pageViewCutoff = new Date();
    pageViewCutoff.setDate(pageViewCutoff.getDate() - PAGE_VIEW_RETENTION_DAYS);

    let deletedInBatch = 0;
    do {
      const result = await db.execute(sql`
        DELETE FROM page_views
        WHERE id IN (
          SELECT id FROM page_views
          WHERE created_at < ${pageViewCutoff}
          LIMIT ${CLEANUP_BATCH_SIZE}
        )
      `);
      deletedInBatch = Number(result.rowCount ?? 0);
      pageViewsDeleted += deletedInBatch;
    } while (deletedInBatch === CLEANUP_BATCH_SIZE);

    console.log(`[Retention] Deleted ${pageViewsDeleted} page_views older than ${PAGE_VIEW_RETENTION_DAYS} days`);
  } catch (err) {
    console.error("[Retention] Error pruning page_views:", err);
  }

  const durationMs = Date.now() - startTime;
  console.log(`[Retention] Cleanup complete in ${durationMs}ms`);

  return { snapshotsDeleted, cacheEntriesDeleted, ingestionRunsDeleted, pageViewsDeleted, durationMs };
}
