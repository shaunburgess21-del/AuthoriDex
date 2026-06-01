/**
 * Reliability / calibration diagnostics for Up/Down AMM markets.
 * Read-only SQL — used by amm-health and scripts/market-calibration.ts.
 */

import { sql } from "drizzle-orm";
import { db } from "../db";

export interface CalibrationBucket {
  bin: number;
  n: number;
  avgPriceUp: number;
  actualUpWinRate: number;
  gap: number;
}

export interface MarketCalibrationResult {
  buckets: CalibrationBucket[];
  totalResolved: number;
  avgGapOnDecided: number | null;
  decidedCount: number;
}

export async function fetchUpDownCalibration(
  lookbackDays = 30,
): Promise<MarketCalibrationResult> {
  const rows = await db.execute(sql`
    WITH r AS (
      SELECT
        pm.id,
        (mas.liquidity_b)::numeric AS b,
        mas.share_quantities AS sq,
        (SELECT me.id FROM market_entries me
         WHERE me.market_id = pm.id AND lower(me.label) = 'up' LIMIT 1) AS up_id,
        (SELECT me.id FROM market_entries me
         WHERE me.market_id = pm.id AND lower(me.label) = 'down' LIMIT 1) AS down_id,
        (SELECT me.resolution_status FROM market_entries me
         WHERE me.market_id = pm.id AND lower(me.label) = 'up' LIMIT 1) AS up_status
      FROM prediction_markets pm
      JOIN market_amm_state mas ON mas.market_id = pm.id
      WHERE pm.engine = 'amm'
        AND pm.market_type = 'updown'
        AND pm.status = 'RESOLVED'
        AND pm.resolved_at > now() - make_interval(days => ${lookbackDays})
    ),
    p AS (
      SELECT
        (exp((sq->>up_id)::numeric / b)
          / (exp((sq->>up_id)::numeric / b) + exp((sq->>down_id)::numeric / b))) AS price_up,
        (up_status = 'winner') AS up_won
      FROM r
      WHERE up_id IS NOT NULL AND down_id IS NOT NULL
        AND up_status IN ('winner', 'loser')
    )
    SELECT
      width_bucket(price_up, 0, 1, 10) AS bin,
      count(*)::int AS n,
      round(avg(price_up)::numeric, 3)::float AS avg_price_up,
      round(avg(CASE WHEN up_won THEN 1.0 ELSE 0.0 END)::numeric, 3)::float AS actual_up_win_rate
    FROM p
    GROUP BY bin
    ORDER BY bin
  `);

  const buckets: CalibrationBucket[] = (rows.rows as Array<{
    bin: number;
    n: number;
    avg_price_up: number;
    actual_up_win_rate: number;
  }>).map((row) => ({
    bin: row.bin,
    n: row.n,
    avgPriceUp: row.avg_price_up,
    actualUpWinRate: row.actual_up_win_rate,
    gap: Math.abs(row.actual_up_win_rate - row.avg_price_up),
  }));

  const totalResolved = buckets.reduce((s, b) => s + b.n, 0);
  const decided = buckets.filter((b) => b.avgPriceUp >= 0.55 || b.avgPriceUp <= 0.45);
  const avgGapOnDecided =
    decided.length > 0
      ? decided.reduce((s, b) => s + b.gap, 0) / decided.length
      : null;

  return {
    buckets,
    totalResolved,
    avgGapOnDecided,
    decidedCount: decided.reduce((s, b) => s + b.n, 0),
  };
}
