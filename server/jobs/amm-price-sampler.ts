/**
 * AMM price sampler — Phase 12 of the parimutuel -> AMM rebuild.
 *
 * Every `SAMPLER_INTERVAL_MS` (default 5 minutes) we walk every OPEN
 * AMM market and append a snapshot of its current marginal prices to
 * `amm_price_snapshots`. Trades themselves write `source='trade'`
 * snapshots inline (`executeBuy`/`executeSell` in `amm-trades.ts`); this
 * job is the floor that keeps the chart visually smooth on quiet
 * markets where no trade has landed for a while.
 *
 * Skip-if-fresh: before inserting we look at the most recent snapshot
 * for the market. If it's younger than `SAMPLER_INTERVAL_MS` (regardless
 * of source) we skip — that way a busy market never grows beyond ~1
 * row/outcome per 5 min from the sampler, and an idle market gets the
 * floor it needs. Trade rows are still written at full resolution.
 *
 * Lock: protected by `withDbAdvisoryLock` so multi-instance Railway
 * deploys can't double-write. Lock key 5_207 picked from the same
 * namespace as other cron locks (LiveTick=5203, etc.).
 */

import { and, desc, eq, sql } from "drizzle-orm";
import { db, withDbAdvisoryLock } from "../db";
import {
  ammPriceSnapshots,
  marketAmmState,
  predictionMarkets,
} from "@shared/schema";
import { currentPrices } from "@shared/lib/amm/positions";
import { writePriceSnapshots } from "../services/amm-trades";

const SAMPLER_INTERVAL_MS = 5 * 60 * 1000;
const SAMPLER_LOCK_KEY = 5_207;

/**
 * Run one sampler pass. Visible for tests / cron-endpoint callers
 * that want to invoke it manually without going through the scheduler.
 *
 * Returns `{ processed, sampled, skipped }` so the cron status
 * endpoint can surface useful telemetry.
 */
export async function runAmmPriceSamplerOnce(): Promise<{
  processed: number;
  sampled: number;
  skipped: number;
}> {
  const cutoff = new Date(Date.now() - SAMPLER_INTERVAL_MS);

  const ammMarkets = await db
    .select({
      marketId: marketAmmState.marketId,
      liquidityB: marketAmmState.liquidityB,
      outcomeOrder: marketAmmState.outcomeOrder,
      shareQuantities: marketAmmState.shareQuantities,
    })
    .from(marketAmmState)
    .innerJoin(
      predictionMarkets,
      eq(marketAmmState.marketId, predictionMarkets.id),
    )
    .where(
      and(
        eq(predictionMarkets.engine, "amm"),
        eq(predictionMarkets.status, "OPEN"),
      ),
    );

  let sampled = 0;
  let skipped = 0;

  for (const row of ammMarkets) {
    // Skip-if-fresh: avoid bloating amm_price_snapshots on markets
    // that have recent trade-sourced rows. One round-trip per market
    // is acceptable here — the sampler is cold-path and runs at a
    // 5-minute cadence.
    const [lastSnap] = await db
      .select({ recordedAt: ammPriceSnapshots.recordedAt })
      .from(ammPriceSnapshots)
      .where(eq(ammPriceSnapshots.marketId, row.marketId))
      .orderBy(desc(ammPriceSnapshots.recordedAt))
      .limit(1);

    if (lastSnap && lastSnap.recordedAt > cutoff) {
      skipped++;
      continue;
    }

    const prices = currentPrices({
      liquidityB: Number(row.liquidityB),
      outcomeOrder: row.outcomeOrder as string[],
      shareQuantities: row.shareQuantities as Record<string, number>,
    });

    await writePriceSnapshots(db, row.marketId, prices, "sampler");
    sampled++;
  }

  if (sampled > 0 || skipped > 0) {
    console.log(
      `[AmmPriceSampler] processed=${ammMarkets.length} sampled=${sampled} skipped=${skipped}`,
    );
  }

  return { processed: ammMarkets.length, sampled, skipped };
}

export async function runAmmPriceSampler(): Promise<{
  processed: number;
  sampled: number;
  skipped: number;
}> {
  const locked = await withDbAdvisoryLock(
    SAMPLER_LOCK_KEY,
    "AmmPriceSampler",
    runAmmPriceSamplerOnce,
  );
  if (!locked.acquired) {
    console.log(
      "[AmmPriceSampler] Skipping tick; another instance holds the lock",
    );
    return { processed: 0, sampled: 0, skipped: 0 };
  }
  return locked.result ?? { processed: 0, sampled: 0, skipped: 0 };
}

let _timer: ReturnType<typeof setInterval> | null = null;

export function startAmmPriceSamplerScheduler() {
  console.log(
    `[AmmPriceSampler] Starting scheduler (every ${SAMPLER_INTERVAL_MS / 60000} min)`,
  );

  // Fire once 30s after boot so first samples land quickly without
  // racing the rest of the boot sequence (and so dev restarts get a
  // fresh point in the chart immediately).
  setTimeout(() => {
    runAmmPriceSampler().catch((e) =>
      console.error("[AmmPriceSampler] Error on initial tick:", e),
    );
  }, 30_000);

  _timer = setInterval(() => {
    runAmmPriceSampler().catch((e) =>
      console.error("[AmmPriceSampler] Error on tick:", e),
    );
  }, SAMPLER_INTERVAL_MS);
}

export function stopAmmPriceSamplerScheduler() {
  if (_timer) {
    clearInterval(_timer);
    _timer = null;
    console.log("[AmmPriceSampler] Scheduler stopped");
  }
}
