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

export interface H2HCalibrationResult {
  totalResolved: number;
  /** Mean final LMSR price on the entry that won at resolution. */
  avgWinnerFinalPrice: number | null;
  /** Winners with final price <= 0.55 (pre-fix baseline ~53%). */
  winnersPricedAtOrBelow55: number;
  winnersTotal: number;
}

export async function fetchH2HCalibration(
  lookbackDays = 30,
): Promise<H2HCalibrationResult> {
  const rows = await db.execute(sql`
    WITH base AS (
      SELECT
        pm.id AS market_id,
        mas.liquidity_b::numeric AS b,
        mas.share_quantities AS sq
      FROM prediction_markets pm
      JOIN market_amm_state mas ON mas.market_id = pm.id
      WHERE pm.engine = 'amm'
        AND pm.market_type = 'h2h'
        AND pm.status = 'RESOLVED'
        AND pm.resolved_at > now() - make_interval(days => ${lookbackDays})
    ),
    e AS (
      SELECT
        b.market_id,
        b.b,
        me.id AS entry_id,
        me.resolution_status,
        COALESCE((b.sq->>me.id::text)::numeric, 0) AS q
      FROM base b
      JOIN market_entries me ON me.market_id = b.market_id
    ),
    mx AS (
      SELECT market_id, max(q) AS qmax FROM e GROUP BY market_id
    ),
    ex AS (
      SELECT
        e.*,
        exp((e.q - mx.qmax) / NULLIF(e.b, 0)) AS w
      FROM e
      JOIN mx ON mx.market_id = e.market_id
    ),
    priced AS (
      SELECT
        market_id,
        resolution_status,
        w / NULLIF(SUM(w) OVER (PARTITION BY market_id), 0) AS price
      FROM ex
    )
    SELECT
      count(*) FILTER (WHERE resolution_status = 'winner')::int AS n_winners,
      round(avg(price) FILTER (WHERE resolution_status = 'winner'), 3)::float AS avg_winner_price,
      count(*) FILTER (WHERE resolution_status = 'winner' AND price <= 0.55)::int AS winners_le_55
    FROM priced
  `);

  const row = rows.rows[0] as {
    n_winners: number;
    avg_winner_price: number | null;
    winners_le_55: number;
  } | undefined;

  return {
    totalResolved: Number(row?.n_winners ?? 0),
    avgWinnerFinalPrice: row?.avg_winner_price ?? null,
    winnersPricedAtOrBelow55: Number(row?.winners_le_55 ?? 0),
    winnersTotal: Number(row?.n_winners ?? 0),
  };
}
