import { db } from "../db";
import { apiCache, ingestionRuns, ammHealthCheckRuns } from "@shared/schema";
import { sql, lt, and } from "drizzle-orm";
import {
  WHY_TRENDING_MAX_STALE_HOURS,
  WHY_TRENDING_SUMMARY_CACHE_PREFIX,
} from "../services/why-trending-stale";

const SNAPSHOT_RETENTION_DAYS = 90;
const INGESTION_RUN_RETENTION_DAYS = 60;
// Page-view analytics are fine-grained; keep ~6 months by default, overridable
// via PAGE_VIEW_RETENTION_DAYS for installs that want to run thinner/thicker.
// Unbounded growth here caused the table to become the largest in the DB.
const PAGE_VIEW_RETENTION_DAYS = (() => {
  const raw = parseInt((process.env.PAGE_VIEW_RETENTION_DAYS ?? "180").trim(), 10);
  return Number.isFinite(raw) && raw >= 7 && raw <= 730 ? raw : 180;
})();
// AMM price snapshots grew to 1.4GB/3.1M rows with no pruning. Every read
// path is short-window: detail charts + sparklines use the last 7 days,
// insights biggest-movers compares against 24h ago, OG previews take the
// latest row per entry. 30 days keeps a wide safety margin over all of them.
const AMM_PRICE_SNAPSHOT_RETENTION_DAYS = 30;
// Terminal scheduled agent actions (executed / failed / skipped /
// world_abstained...) are kept 90 days for debugging and the admin agent
// tiles. The agent runner only reads decision payloads for currently-open
// markets, so old terminal rows are safe to drop. `pending`/`in_progress`
// rows are never touched regardless of age.
const AGENT_ACTION_RETENTION_DAYS = 90;
const AMM_HEALTH_RUN_RETENTION_DAYS = 60;
const CLEANUP_BATCH_SIZE = 1000;

export interface RetentionCleanupResult {
  snapshotsDeleted: number;
  cacheEntriesDeleted: number;
  ingestionRunsDeleted: number;
  pageViewsDeleted: number;
  ammPriceSnapshotsDeleted: number;
  agentActionsDeleted: number;
  ammHealthRunsDeleted: number;
  durationMs: number;
}

export async function runRetentionCleanup(): Promise<RetentionCleanupResult> {
  const startTime = Date.now();
  console.log("[Retention] Starting cleanup job...");

  let snapshotsDeleted = 0;
  let cacheEntriesDeleted = 0;
  let ingestionRunsDeleted = 0;
  let pageViewsDeleted = 0;
  let ammPriceSnapshotsDeleted = 0;
  let agentActionsDeleted = 0;
  let ammHealthRunsDeleted = 0;

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

  // 2. Delete expired api_cache entries, with a grace window for Why Trending
  // summaries so short Serper outages do not wipe the last-known UI content.
  // why_trending_lock:* / why_trending_ratelimit:* use underscores and are
  // pruned with the normal expired-row path.
  try {
    const now = new Date();
    const whyTrendingCutoff = new Date(
      now.getTime() - WHY_TRENDING_MAX_STALE_HOURS * 60 * 60 * 1000,
    );

    const summaryPrefixLike = `${WHY_TRENDING_SUMMARY_CACHE_PREFIX}%`;

    const deletedOther = await db
      .delete(apiCache)
      .where(
        and(
          lt(apiCache.expiresAt, now),
          sql`${apiCache.cacheKey} NOT LIKE ${summaryPrefixLike}`,
        ),
      );
    const otherCount = Number((deletedOther as any).rowCount ?? 0);

    const deletedWhyTrending = await db
      .delete(apiCache)
      .where(
        and(
          sql`${apiCache.cacheKey} LIKE ${summaryPrefixLike}`,
          lt(apiCache.fetchedAt, whyTrendingCutoff),
        ),
      );
    const whyTrendingCount = Number((deletedWhyTrending as any).rowCount ?? 0);

    cacheEntriesDeleted = otherCount + whyTrendingCount;
    console.log(
      `[Retention] Deleted ${cacheEntriesDeleted} api_cache entries ` +
        `(${otherCount} expired non-why_trending, ${whyTrendingCount} why_trending older than ${WHY_TRENDING_MAX_STALE_HOURS}h)`,
    );
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

  // 5. Prune old amm_price_snapshots. Batched — this is the largest table
  // in the DB; uses the amm_price_snapshots_recorded_at_idx age index.
  try {
    const priceCutoff = new Date();
    priceCutoff.setDate(priceCutoff.getDate() - AMM_PRICE_SNAPSHOT_RETENTION_DAYS);

    let deletedInBatch = 0;
    do {
      const result = await db.execute(sql`
        DELETE FROM amm_price_snapshots
        WHERE id IN (
          SELECT id FROM amm_price_snapshots
          WHERE recorded_at < ${priceCutoff}
          LIMIT ${CLEANUP_BATCH_SIZE}
        )
      `);
      deletedInBatch = Number(result.rowCount ?? 0);
      ammPriceSnapshotsDeleted += deletedInBatch;
    } while (deletedInBatch === CLEANUP_BATCH_SIZE);

    console.log(`[Retention] Deleted ${ammPriceSnapshotsDeleted} amm_price_snapshots older than ${AMM_PRICE_SNAPSHOT_RETENTION_DAYS} days`);
  } catch (err) {
    console.error("[Retention] Error pruning amm_price_snapshots:", err);
  }

  // 6. Prune terminal scheduled_agent_actions. Non-terminal rows
  // (pending / in_progress) are excluded no matter how old they are —
  // the action worker owns their lifecycle.
  try {
    const actionCutoff = new Date();
    actionCutoff.setDate(actionCutoff.getDate() - AGENT_ACTION_RETENTION_DAYS);

    let deletedInBatch = 0;
    do {
      const result = await db.execute(sql`
        DELETE FROM scheduled_agent_actions
        WHERE id IN (
          SELECT id FROM scheduled_agent_actions
          WHERE created_at < ${actionCutoff}
            AND status NOT IN ('pending', 'in_progress')
          LIMIT ${CLEANUP_BATCH_SIZE}
        )
      `);
      deletedInBatch = Number(result.rowCount ?? 0);
      agentActionsDeleted += deletedInBatch;
    } while (deletedInBatch === CLEANUP_BATCH_SIZE);

    console.log(`[Retention] Deleted ${agentActionsDeleted} terminal scheduled_agent_actions older than ${AGENT_ACTION_RETENTION_DAYS} days`);
  } catch (err) {
    console.error("[Retention] Error pruning scheduled_agent_actions:", err);
  }

  // 7. Prune old amm_health_check_runs (admin dashboard history).
  try {
    const healthCutoff = new Date();
    healthCutoff.setDate(healthCutoff.getDate() - AMM_HEALTH_RUN_RETENTION_DAYS);

    const deleted = await db
      .delete(ammHealthCheckRuns)
      .where(lt(ammHealthCheckRuns.startedAt, healthCutoff));
    ammHealthRunsDeleted = Number((deleted as any).rowCount ?? 0);
    console.log(`[Retention] Deleted ${ammHealthRunsDeleted} amm_health_check_runs older than ${AMM_HEALTH_RUN_RETENTION_DAYS} days`);
  } catch (err) {
    console.error("[Retention] Error pruning amm_health_check_runs:", err);
  }

  const durationMs = Date.now() - startTime;
  console.log(`[Retention] Cleanup complete in ${durationMs}ms`);

  return {
    snapshotsDeleted,
    cacheEntriesDeleted,
    ingestionRunsDeleted,
    pageViewsDeleted,
    ammPriceSnapshotsDeleted,
    agentActionsDeleted,
    ammHealthRunsDeleted,
    durationMs,
  };
}

// Daily in-process scheduler. Until Phase 2 this job was only reachable via
// POST /api/cron/retention-cleanup, which no external cron was calling — so
// retention never actually ran in production and amm_price_snapshots grew
// unbounded. The cron endpoint remains for DISABLE_SCHEDULERS installs.
const CLEANUP_INTERVAL_MS = 24 * 60 * 60 * 1000;

let _timer: ReturnType<typeof setInterval> | null = null;

export function startRetentionCleanupScheduler() {
  console.log("[Retention] Starting scheduler (daily)");

  // First run 10 minutes after boot: late enough to stay clear of the
  // boot-time startup tasks, early enough that a daily-restarting install
  // still gets its cleanup.
  setTimeout(() => {
    runRetentionCleanup().catch((e) =>
      console.error("[Retention] Error on initial run:", e),
    );
  }, 10 * 60 * 1000);

  _timer = setInterval(() => {
    runRetentionCleanup().catch((e) =>
      console.error("[Retention] Error on scheduled run:", e),
    );
  }, CLEANUP_INTERVAL_MS);
}

export function stopRetentionCleanupScheduler() {
  if (_timer) {
    clearInterval(_timer);
    _timer = null;
  }
}
