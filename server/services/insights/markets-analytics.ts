/**
 * Platform-wide market analytics for Insights Markets tab.
 */
import { sql } from "drizzle-orm";
import { db } from "../../db";
import type {
  ContestedMarket,
  InsightsMarketsAnalytics,
  MarketsCalibrationBucket,
  OpenInterestRow,
} from "@shared/insights/types";
import { withDiscoverCache } from "./discover-cache";

function normalizeMarketTypeLabel(marketType: string): string {
  if (marketType === "gainer") return "race";
  return marketType;
}

function displayMarketType(marketType: string): string {
  const n = normalizeMarketTypeLabel(marketType);
  if (n === "race") return "Race";
  return n.charAt(0).toUpperCase() + n.slice(1);
}

function displayCategory(category: string): string {
  if (category === "gainer") return "Race";
  if (!category || category === "Other") return "Other";
  return category.charAt(0).toUpperCase() + category.slice(1);
}

async function loadPlatformCalibration(): Promise<InsightsMarketsAnalytics["calibration"]> {
  const result = await db.execute(sql`
    WITH settled AS (
      SELECT
        mb.status,
        CASE
          WHEN mb.price_per_share IS NOT NULL
            AND mb.price_per_share::numeric > 0
            AND mb.price_per_share::numeric <= 1
          THEN mb.price_per_share::numeric
          WHEN mb.potential_payout IS NOT NULL
            AND mb.stake_amount > 0
            AND mb.potential_payout::numeric / mb.stake_amount::numeric > 1
          THEN LEAST(0.99::numeric, 1 / (mb.potential_payout::numeric / mb.stake_amount::numeric))
          ELSE NULL
        END AS implied_p
      FROM market_bets mb
      WHERE mb.status IN ('won', 'lost')
    ),
    bucketed AS (
      SELECT
        LEAST(9, FLOOR(implied_p * 10))::int AS bucket_idx,
        status,
        implied_p
      FROM settled
      WHERE implied_p IS NOT NULL
    )
    SELECT
      bucket_idx,
      COUNT(*)::int AS cnt,
      SUM(CASE WHEN status = 'won' THEN 1 ELSE 0 END)::int AS wins,
      AVG(POWER(implied_p - CASE WHEN status = 'won' THEN 1 ELSE 0 END, 2))::float AS avg_brier
    FROM bucketed
    GROUP BY bucket_idx
    ORDER BY bucket_idx
  `);

  const countResult = await db.execute(sql`
    SELECT
      COUNT(*)::int AS total_settled,
      COUNT(*) FILTER (
        WHERE NOT (
          (price_per_share IS NOT NULL AND price_per_share::numeric > 0 AND price_per_share::numeric <= 1)
          OR (
            potential_payout IS NOT NULL
            AND stake_amount > 0
            AND potential_payout::numeric / stake_amount::numeric > 1
          )
        )
      )::int AS excluded_no_price
    FROM market_bets
    WHERE status IN ('won', 'lost')
  `);

  const rows =
    (Array.isArray(result) ? result : (result as { rows: Record<string, unknown>[] }).rows) ?? [];
  const countRow = (
    Array.isArray(countResult)
      ? countResult[0]
      : (countResult as { rows: Record<string, unknown>[] }).rows?.[0]
  ) as Record<string, unknown> | undefined;

  const buckets: MarketsCalibrationBucket[] = rows.map((row) => {
    const idx = Number(row.bucket_idx ?? 0);
    const count = Number(row.cnt ?? 0);
    const wins = Number(row.wins ?? 0);
    const label = `${idx * 10}-${idx * 10 + 10}%`;
    return {
      label,
      predictedMid: idx * 0.1 + 0.05,
      count,
      actualWinRate: count > 0 ? wins / count : 0,
      avgBrier: Number(row.avg_brier ?? 0),
    };
  });

  return {
    buckets,
    totalSettled: Number(countRow?.total_settled ?? 0),
    excludedNoPrice: Number(countRow?.excluded_no_price ?? 0),
  };
}

type ContestedRow = {
  market_id: string;
  slug: string;
  title: string;
  market_type: string;
  engine: string;
  contested_score: number;
};

function mapContestedRows(result: unknown): ContestedRow[] {
  const rows =
    (Array.isArray(result)
      ? result
      : (result as { rows: Record<string, unknown>[] }).rows) ?? [];
  return rows.map((row) => ({
    market_id: String(row.market_id),
    slug: String(row.slug),
    title: String(row.title),
    market_type: String(row.market_type),
    engine: String(row.engine),
    contested_score: Number(row.contested_score),
  }));
}

async function loadTopPairsForMarkets(
  marketIds: string[],
  engine: "amm" | "parimutuel",
): Promise<Map<string, ContestedMarket["topPair"]>> {
  if (marketIds.length === 0) return new Map();

  if (engine === "amm") {
    const result = await db.execute(sql`
      WITH latest AS (
        SELECT me.market_id, me.id AS entry_id, me.label, lp.price
        FROM market_entries me
        CROSS JOIN LATERAL (
          SELECT aps.price::float AS price
          FROM amm_price_snapshots aps
          WHERE aps.market_id = me.market_id AND aps.entry_id = me.id
          ORDER BY aps.recorded_at DESC
          LIMIT 1
        ) lp
        WHERE me.market_id = ANY(${marketIds})
      ),
      ranked AS (
        SELECT
          market_id,
          label,
          price,
          ROW_NUMBER() OVER (
            PARTITION BY market_id
            ORDER BY ABS(price - 0.5) ASC
          ) AS rn
        FROM latest
      )
      SELECT market_id, label, price
      FROM ranked
      WHERE rn <= 2
      ORDER BY market_id, rn
    `);
    const rows =
      (Array.isArray(result) ? result : (result as { rows: Record<string, unknown>[] }).rows) ??
      [];
    const map = new Map<string, ContestedMarket["topPair"]>();
    for (const row of rows) {
      const mid = String(row.market_id);
      const pair = map.get(mid) ?? [];
      pair.push({
        label: String(row.label ?? "Outcome"),
        pct: Math.round(Number(row.price ?? 0) * 100),
      });
      map.set(mid, pair);
    }
    return map;
  }

  const result = await db.execute(sql`
    WITH stakes AS (
      SELECT
        me.market_id,
        me.label,
        (me.total_stake::numeric + COALESCE(me.no_stake::numeric, 0)) AS stake
      FROM market_entries me
      WHERE me.market_id = ANY(${marketIds})
    ),
    totals AS (
      SELECT market_id, SUM(stake) AS total_stake
      FROM stakes
      GROUP BY market_id
      HAVING SUM(stake) > 0
    ),
    shares AS (
      SELECT
        s.market_id,
        s.label,
        s.stake / t.total_stake AS share,
        ROW_NUMBER() OVER (PARTITION BY s.market_id ORDER BY s.stake DESC) AS rn
      FROM stakes s
      INNER JOIN totals t ON t.market_id = s.market_id
    )
    SELECT market_id, label, share
    FROM shares
    WHERE rn <= 2
    ORDER BY market_id, rn
  `);
  const rows =
    (Array.isArray(result) ? result : (result as { rows: Record<string, unknown>[] }).rows) ?? [];
  const map = new Map<string, ContestedMarket["topPair"]>();
  for (const row of rows) {
    const mid = String(row.market_id);
    const pair = map.get(mid) ?? [];
    pair.push({
      label: String(row.label ?? "Outcome"),
      pct: Math.round(Number(row.share ?? 0) * 100),
    });
    map.set(mid, pair);
  }
  return map;
}

async function loadContestedByEngine(
  engine: "amm" | "parimutuel",
  limit: number,
): Promise<ContestedMarket[]> {
  let contestedRows: ContestedRow[] = [];

  if (engine === "amm") {
    const result = await db.execute(sql`
      WITH latest AS (
        SELECT pm.id AS market_id, me.id AS entry_id, lp.price
        FROM prediction_markets pm
        JOIN market_entries me ON me.market_id = pm.id
        CROSS JOIN LATERAL (
          SELECT aps.price::float AS price
          FROM amm_price_snapshots aps
          WHERE aps.market_id = pm.id AND aps.entry_id = me.id
          ORDER BY aps.recorded_at DESC
          LIMIT 1
        ) lp
        WHERE pm.status = 'OPEN' AND pm.engine = 'amm'
      ),
      scores AS (
        SELECT market_id, MIN(ABS(price - 0.5)) AS contested_score
        FROM latest
        GROUP BY market_id
      )
      SELECT
        pm.id AS market_id,
        pm.slug,
        pm.title,
        pm.market_type,
        pm.engine,
        s.contested_score::float AS contested_score
      FROM scores s
      INNER JOIN prediction_markets pm ON pm.id = s.market_id
      ORDER BY s.contested_score ASC
      LIMIT ${limit}
    `);
    contestedRows = mapContestedRows(result);
  } else {
    const result = await db.execute(sql`
      WITH stakes AS (
        SELECT
          me.market_id,
          me.id AS entry_id,
          (me.total_stake::numeric + COALESCE(me.no_stake::numeric, 0)) AS stake
        FROM market_entries me
        INNER JOIN prediction_markets pm ON pm.id = me.market_id
        WHERE pm.status = 'OPEN' AND pm.engine = 'parimutuel'
      ),
      totals AS (
        SELECT market_id, SUM(stake) AS total_stake
        FROM stakes
        GROUP BY market_id
        HAVING SUM(stake) > 0
      ),
      shares AS (
        SELECT s.market_id, s.stake / t.total_stake AS share
        FROM stakes s
        INNER JOIN totals t ON t.market_id = s.market_id
      ),
      scores AS (
        SELECT market_id, (MAX(share) - MIN(share))::float AS contested_score
        FROM shares
        GROUP BY market_id
      )
      SELECT
        pm.id AS market_id,
        pm.slug,
        pm.title,
        pm.market_type,
        pm.engine,
        s.contested_score
      FROM scores s
      INNER JOIN prediction_markets pm ON pm.id = s.market_id
      ORDER BY s.contested_score ASC
      LIMIT ${limit}
    `);
    contestedRows = mapContestedRows(result);
  }

  const ids = contestedRows.map((r) => r.market_id);
  const pairs = await loadTopPairsForMarkets(ids, engine);

  return contestedRows.map((r) => ({
    marketId: r.market_id,
    slug: r.slug,
    title: r.title,
    marketType: r.market_type,
    engine: r.engine as "amm" | "parimutuel",
    score: Number(r.contested_score),
    topPair: pairs.get(r.market_id) ?? [],
  }));
}

async function loadContestedMarkets(limit = 8): Promise<InsightsMarketsAnalytics["contested"]> {
  const [amm, parimutuel] = await Promise.all([
    loadContestedByEngine("amm", limit),
    loadContestedByEngine("parimutuel", limit),
  ]);
  return { amm, parimutuel };
}

async function loadOpenInterest(): Promise<InsightsMarketsAnalytics["openInterest"]> {
  const ammResult = await db.execute(sql`
    SELECT
      pm.market_type,
      COALESCE(pm.category, 'Other') AS category,
      SUM(mas.total_user_credits_in::numeric) AS oi,
      COUNT(DISTINCT pm.id)::int AS market_count
    FROM market_amm_state mas
    INNER JOIN prediction_markets pm ON pm.id = mas.market_id
    WHERE pm.status = 'OPEN'
    GROUP BY pm.market_type, COALESCE(pm.category, 'Other')
  `);

  const pariResult = await db.execute(sql`
    SELECT
      pm.market_type,
      COALESCE(pm.category, 'Other') AS category,
      SUM(me.total_stake::numeric + COALESCE(me.no_stake::numeric, 0)) AS oi,
      COUNT(DISTINCT pm.id)::int AS market_count
    FROM market_entries me
    INNER JOIN prediction_markets pm ON pm.id = me.market_id
    WHERE pm.status = 'OPEN' AND pm.engine = 'parimutuel'
    GROUP BY pm.market_type, COALESCE(pm.category, 'Other')
  `);

  const ammRows =
    (Array.isArray(ammResult) ? ammResult : (ammResult as { rows: Record<string, unknown>[] }).rows) ??
    [];
  const pariRows =
    (Array.isArray(pariResult) ? pariResult : (pariResult as { rows: Record<string, unknown>[] }).rows) ??
    [];

  type Agg = { total: number; marketCount: number };
  const byType = new Map<string, Agg>();
  const byCategoryMap = new Map<string, Agg>();

  const ingest = (rows: Record<string, unknown>[]) => {
    for (const row of rows) {
      const oi = Number(row.oi ?? 0);
      const mc = Number(row.market_count ?? 0);
      const mt = normalizeMarketTypeLabel(String(row.market_type ?? "unknown"));
      const cat = displayCategory(String(row.category ?? "Other"));

      const tm = byType.get(mt) ?? { total: 0, marketCount: 0 };
      tm.total += oi;
      tm.marketCount += mc;
      byType.set(mt, tm);

      const cm = byCategoryMap.get(cat) ?? { total: 0, marketCount: 0 };
      cm.total += oi;
      cm.marketCount += mc;
      byCategoryMap.set(cat, cm);
    }
  };

  ingest(ammRows);
  ingest(pariRows);

  const byMarketType: OpenInterestRow[] = Array.from(byType.entries())
    .map(([key, v]) => ({
      key,
      label: displayMarketType(key),
      total: Math.round(v.total),
      marketCount: v.marketCount,
    }))
    .sort((a, b) => b.total - a.total);

  const byCategory = Array.from(byCategoryMap.entries())
    .map(([key, v]) => ({
      key,
      label: key,
      total: Math.round(v.total),
      marketCount: v.marketCount,
    }))
    .sort((a, b) => b.total - a.total);

  const total = byMarketType.reduce((s, r) => s + r.total, 0);

  return { total, byMarketType, byCategory };
}

export async function loadMarketsAnalytics(): Promise<InsightsMarketsAnalytics> {
  return withDiscoverCache("markets:analytics", async () => {
    const [calibration, contested, openInterest] = await Promise.all([
      loadPlatformCalibration(),
      loadContestedMarkets(8),
      loadOpenInterest(),
    ]);
    return { calibration, contested, openInterest };
  });
}
