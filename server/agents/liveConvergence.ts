/**
 * Live Up/Down AMM convergence diagnostics — open markets only.
 * Compares current UP price to lock-in fair value from trend vs weekly open.
 */

import { sql } from "drizzle-orm";
import { db } from "../db";
import {
  computeLockInFairUp,
  hoursUntilEnd,
  LOCKIN_DECISIVE_PCT,
} from "./lockInFair";
import { ARB_MIN_EDGE_PP } from "./constants";

/** |fair − price| above this counts as mispriced (10pp, same as lock-in decisive band). */
const MISPRICED_GAP_PP = LOCKIN_DECISIVE_PCT;

export interface LiveConvergenceMarketRow {
  marketId: string;
  title: string | null;
  personId: string | null;
  hoursRemaining: number;
  pctChangeVsOpen: number | null;
  upPrice: number;
  fairUp: number | null;
  /** Fair probability on the favoured (model) side. */
  favoredFair: number | null;
  /** Current AMM price on the favoured side. */
  favoredPrice: number | null;
  /** favouredFair - favoredPrice (positive = underpriced vs model). */
  gap: number | null;
  volume: number;
  liquidityB: number;
  favoredSide: "up" | "down" | null;
}

export interface LiveConvergenceSummary {
  openMarkets: number;
  withFair: number;
  decidedCount: number;
  decidedMispricedCount: number;
  /** Share of decided markets with |gap| > MISPRICED_GAP_PP (10pp). */
  decidedMispricedPct: number | null;
  avgAbsGapOnDecided: number | null;
  avgGapOnDecided: number | null;
  /** Sum of max(0, gap) * volume on decided markets (rough arb opportunity scale). */
  roughUnderpricingExposure: number;
  /** Markets where gap > ARB_EDGE_PP (arb would trade). */
  arbEligibleCount: number;
}

export interface LiveConvergenceResult {
  markets: LiveConvergenceMarketRow[];
  summary: LiveConvergenceSummary;
  sampledAt: string;
}

function lmsrUpPrice(
  b: number,
  sq: Record<string, number>,
  upId: string,
  downId: string,
): number {
  const qu = Number(sq[upId] ?? 0);
  const qd = Number(sq[downId] ?? 0);
  if (!Number.isFinite(b) || b <= 0) return 0.5;
  const eu = Math.exp(qu / b);
  const ed = Math.exp(qd / b);
  const denom = eu + ed;
  return denom > 0 ? eu / denom : 0.5;
}

export async function fetchLiveUpDownConvergence(
  now: Date = new Date(),
): Promise<LiveConvergenceResult> {
  const rows = await db.execute(sql`
    SELECT
      pm.id AS market_id,
      pm.title,
      pm.person_id,
      pm.end_at,
      mas.liquidity_b,
      mas.share_quantities AS sq,
      COALESCE(mas.total_user_credits_in, 0)::float AS volume,
      up_e.id AS up_id,
      down_e.id AS down_id,
      tp.fame_index AS current_fame,
      (pm.metadata->'openingScore'->>'score')::float AS opening_score
    FROM prediction_markets pm
    INNER JOIN market_amm_state mas ON mas.market_id = pm.id
    INNER JOIN market_entries up_e
      ON up_e.market_id = pm.id AND lower(up_e.label) = 'up'
    INNER JOIN market_entries down_e
      ON down_e.market_id = pm.id AND lower(down_e.label) = 'down'
    LEFT JOIN trending_people tp ON tp.id = pm.person_id
    WHERE pm.engine = 'amm'
      AND pm.market_type = 'updown'
      AND pm.status = 'OPEN'
      AND pm.visibility = 'live'
      AND pm.end_at > ${now}
  `);

  const markets: LiveConvergenceMarketRow[] = [];

  for (const row of rows.rows as Array<{
    market_id: string;
    title: string | null;
    person_id: string | null;
    end_at: Date | string;
    liquidity_b: string | number;
    sq: Record<string, number>;
    volume: number;
    up_id: string;
    down_id: string;
    current_fame: number | null;
    opening_score: number | null;
  }>) {
    const b = Number(row.liquidity_b);
    const sq = row.sq ?? {};
    const upPrice = lmsrUpPrice(b, sq, row.up_id, row.down_id);
    const downPrice = 1 - upPrice;

    const opening = row.opening_score;
    const fame = row.current_fame;
    let pctChangeVsOpen: number | null = null;
    if (
      opening != null &&
      Number.isFinite(opening) &&
      opening > 0 &&
      fame != null &&
      Number.isFinite(fame)
    ) {
      pctChangeVsOpen = (fame - opening) / opening;
    }

    const endAt =
      row.end_at instanceof Date ? row.end_at : new Date(row.end_at);
    const hrs = hoursUntilEnd(endAt, now);
    const fairUp = computeLockInFairUp(pctChangeVsOpen, hrs);

    let favoredSide: "up" | "down" | null = null;
    let favoredFair: number | null = null;
    let favoredPrice: number | null = null;
    let gap: number | null = null;

    if (fairUp != null && pctChangeVsOpen != null) {
      if (pctChangeVsOpen >= 0) {
        favoredSide = "up";
        favoredFair = fairUp;
        favoredPrice = upPrice;
      } else {
        favoredSide = "down";
        favoredFair = 1 - fairUp;
        favoredPrice = downPrice;
      }
      gap = favoredFair - favoredPrice;
    }

    markets.push({
      marketId: row.market_id,
      title: row.title,
      personId: row.person_id,
      hoursRemaining: hrs,
      pctChangeVsOpen,
      upPrice,
      fairUp,
      favoredFair,
      favoredPrice,
      gap,
      volume: Number(row.volume) || 0,
      liquidityB: b,
      favoredSide,
    });
  }

  markets.sort((a, b) => Math.abs(b.gap ?? 0) - Math.abs(a.gap ?? 0));

  const withFair = markets.filter((m) => m.gap != null);
  const decided = withFair.filter(
    (m) =>
      m.pctChangeVsOpen != null &&
      Math.abs(m.pctChangeVsOpen) >= LOCKIN_DECISIVE_PCT,
  );
  const mispriced = decided.filter(
    (m) => m.gap != null && Math.abs(m.gap) > MISPRICED_GAP_PP,
  );
  const arbEligible = decided.filter(
    (m) => m.gap != null && m.gap > ARB_MIN_EDGE_PP,
  );

  const avgAbsGapOnDecided =
    decided.length > 0
      ? decided.reduce((s, m) => s + Math.abs(m.gap!), 0) / decided.length
      : null;
  const avgGapOnDecided =
    decided.length > 0
      ? decided.reduce((s, m) => s + m.gap!, 0) / decided.length
      : null;

  const roughUnderpricingExposure = decided.reduce(
    (s, m) => s + Math.max(0, m.gap ?? 0) * (m.volume || 0),
    0,
  );

  return {
    markets,
    summary: {
      openMarkets: markets.length,
      withFair: withFair.length,
      decidedCount: decided.length,
      decidedMispricedCount: mispriced.length,
      decidedMispricedPct:
        decided.length > 0
          ? mispriced.length / decided.length
          : null,
      avgAbsGapOnDecided,
      avgGapOnDecided,
      roughUnderpricingExposure,
      arbEligibleCount: arbEligible.length,
    },
    sampledAt: now.toISOString(),
  };
}

/** Thresholds for advisory health check (never fail `ok`). */
export const LIVE_CONVERGENCE_MISPRICED_WARN_PCT = 0.35;
export const LIVE_CONVERGENCE_AVG_GAP_WARN = 0.12;
