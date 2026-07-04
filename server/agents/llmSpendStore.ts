/**
 * DB persistence for the daily LLM budget counters (`llm_daily_spend`).
 *
 * Deliberately a separate module from worldMarketBudget / nativeMarketBudget:
 * those stay dependency-free (pure in-memory) so their test suites run
 * without a database. The budget modules dynamically import this store when
 * `initBudgetPersistence()` is called from the server boot path, then
 * write-through every reserve/release and hydrate on boot/rollover.
 *
 * All writes are atomic increments via upsert, so concurrent processes
 * (redeploy overlap, multi-instance) converge on one true daily total.
 */
import { sql } from "drizzle-orm";
import { db } from "../db";

export interface PersistedSpend {
  spendUsd: number;
  calls: number;
}

/** Read the persisted counters for one (feature, UTC day). */
export async function loadPersistedSpend(
  feature: string,
  day: string,
): Promise<PersistedSpend | null> {
  const result = await db.execute(sql`
    SELECT spend_usd, calls
    FROM llm_daily_spend
    WHERE feature = ${feature} AND day = ${day}
    LIMIT 1
  `);
  const row = result.rows?.[0] as
    | { spend_usd?: string | number; calls?: string | number }
    | undefined;
  if (!row) return null;
  return {
    spendUsd: Number(row.spend_usd) || 0,
    calls: Number(row.calls) || 0,
  };
}

/**
 * Atomically apply a spend delta (positive = reserve, negative = release)
 * and return the new persisted total so the caller can reconcile its
 * in-memory counter upward if another process moved the total first.
 * GREATEST(…, 0) guards against a release racing ahead of its reserve.
 */
export async function persistSpendDelta(
  feature: string,
  day: string,
  deltaUsd: number,
  deltaCalls: number,
): Promise<PersistedSpend | null> {
  // Explicit casts: without them Postgres unifies GREATEST($n, 0) to
  // integer and rejects fractional dollar amounts.
  const result = await db.execute(sql`
    INSERT INTO llm_daily_spend (feature, day, spend_usd, calls)
    VALUES (${feature}, ${day}, GREATEST(${deltaUsd}::numeric, 0), GREATEST(${deltaCalls}::int, 0))
    ON CONFLICT (feature, day) DO UPDATE SET
      spend_usd = GREATEST(llm_daily_spend.spend_usd + ${deltaUsd}::numeric, 0),
      calls = GREATEST(llm_daily_spend.calls + ${deltaCalls}::int, 0),
      updated_at = NOW()
    RETURNING spend_usd, calls
  `);
  const row = result.rows?.[0] as
    | { spend_usd?: string | number; calls?: string | number }
    | undefined;
  if (!row) return null;
  return {
    spendUsd: Number(row.spend_usd) || 0,
    calls: Number(row.calls) || 0,
  };
}
