/**
 * Live native AMM convergence diagnostics — open markets only.
 * Up/Down: lock-in fair from pct vs open. H2H: lock-in fair from score ratio.
 */

import { eq, inArray, sql } from "drizzle-orm";
import { db } from "../db";
import { marketEntries, trendingPeople } from "@shared/schema";
import {
  computeLockInFairUp,
  fairH2HByEntryId,
  fairGainerByEntryId,
  favoredH2HFromFairMap,
  hoursUntilEnd,
  LOCKIN_DECISIVE_PCT,
} from "./lockInFair";
import {
  ARB_MIN_EDGE_PP,
  LOCKIN_H2H_DECISIVE_FAIR,
  LOCKIN_H2H_SIGMA_1D,
  LOCKIN_H2H_BETA,
  LOCKIN_GAINER_DECISIVE_FAIR,
  LOCKIN_GAINER_SIGMA_1D,
  LOCKIN_GAINER_BETA,
} from "./constants";

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

export interface LiveH2HConvergenceMarketRow {
  marketId: string;
  title: string | null;
  hoursRemaining: number;
  favoredLabel: string | null;
  favoredFair: number | null;
  favoredPrice: number | null;
  gap: number | null;
  scoreRatio: number | null;
  volume: number;
  liquidityB: number;
}

export interface LiveH2HConvergenceResult {
  markets: LiveH2HConvergenceMarketRow[];
  summary: LiveConvergenceSummary;
  sampledAt: string;
}

export interface LiveGainerConvergenceMarketRow {
  marketId: string;
  title: string | null;
  hoursRemaining: number;
  entryCount: number;
  favoredLabel: string | null;
  favoredFair: number | null;
  favoredPrice: number | null;
  gap: number | null;
  leaderPctOpen: number | null;
  volume: number;
  liquidityB: number;
}

export interface LiveGainerConvergenceResult {
  markets: LiveGainerConvergenceMarketRow[];
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

function lmsrEntryPrice(
  b: number,
  sq: Record<string, number>,
  entryId: string,
  entryIds: string[],
): number {
  if (!Number.isFinite(b) || b <= 0 || entryIds.length === 0) {
    return 1 / Math.max(1, entryIds.length);
  }
  const qs = entryIds.map((id) => Number(sq[id] ?? 0));
  const maxQ = Math.max(...qs);
  const weights = qs.map((q) => Math.exp((q - maxQ) / b));
  const sum = weights.reduce((a, w) => a + w, 0);
  if (sum <= 0) return 1 / entryIds.length;
  const idx = entryIds.indexOf(entryId);
  return idx >= 0 ? weights[idx]! / sum : 1 / entryIds.length;
}

function summarizeConvergenceGaps<T extends {
  gap: number | null;
  volume: number;
  favoredFair: number | null;
}>(
  markets: T[],
  isDecided: (m: T) => boolean,
): LiveConvergenceSummary {
  const withFair = markets.filter((m) => m.gap != null);
  const decided = withFair.filter(isDecided);
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
    openMarkets: markets.length,
    withFair: withFair.length,
    decidedCount: decided.length,
    decidedMispricedCount: mispriced.length,
    decidedMispricedPct:
      decided.length > 0 ? mispriced.length / decided.length : null,
    avgAbsGapOnDecided,
    avgGapOnDecided,
    roughUnderpricingExposure,
    arbEligibleCount: arbEligible.length,
  };
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

  return {
    markets,
    summary: summarizeConvergenceGaps(markets, (m) =>
      m.pctChangeVsOpen != null &&
      Math.abs(m.pctChangeVsOpen) >= LOCKIN_DECISIVE_PCT,
    ),
    sampledAt: now.toISOString(),
  };
}

export async function fetchLiveH2HConvergence(
  now: Date = new Date(),
): Promise<LiveH2HConvergenceResult> {
  const marketRows = await db.execute(sql`
    SELECT
      pm.id AS market_id,
      pm.title,
      pm.end_at,
      mas.liquidity_b,
      mas.share_quantities AS sq,
      COALESCE(mas.total_user_credits_in, 0)::float AS volume
    FROM prediction_markets pm
    INNER JOIN market_amm_state mas ON mas.market_id = pm.id
    WHERE pm.engine = 'amm'
      AND pm.market_type = 'h2h'
      AND pm.status = 'OPEN'
      AND pm.visibility = 'live'
      AND pm.end_at > ${now}
  `);

  const marketIds = (marketRows.rows as Array<{ market_id: string }>).map(
    (r) => r.market_id,
  );
  if (marketIds.length === 0) {
    return {
      markets: [],
      summary: summarizeConvergenceGaps([], () => false),
      sampledAt: now.toISOString(),
    };
  }

  const entryRows = await db
    .select({
      marketId: marketEntries.marketId,
      entryId: marketEntries.id,
      label: marketEntries.label,
      score: trendingPeople.fameIndex,
    })
    .from(marketEntries)
    .leftJoin(trendingPeople, eq(trendingPeople.id, marketEntries.personId))
    .where(inArray(marketEntries.marketId, marketIds));

  const entriesByMarket = new Map<
    string,
    Array<{ id: string; label: string | null; score: number | null }>
  >();
  for (const row of entryRows) {
    const list = entriesByMarket.get(row.marketId) ?? [];
    list.push({ id: row.entryId, label: row.label, score: row.score });
    entriesByMarket.set(row.marketId, list);
  }

  const markets: LiveH2HConvergenceMarketRow[] = [];

  for (const row of marketRows.rows as Array<{
    market_id: string;
    title: string | null;
    end_at: Date | string;
    liquidity_b: string | number;
    sq: Record<string, number>;
    volume: number;
  }>) {
    const entries = entriesByMarket.get(row.market_id) ?? [];
    if (entries.length !== 2) continue;
    const [eA, eB] = entries;
    if (
      eA.score == null ||
      !Number.isFinite(eA.score) ||
      eB.score == null ||
      !Number.isFinite(eB.score)
    ) {
      continue;
    }

    const b = Number(row.liquidity_b);
    const sq = row.sq ?? {};
    const entryIds = [eA.id, eB.id];
    const endAt =
      row.end_at instanceof Date ? row.end_at : new Date(row.end_at);
    const hrs = hoursUntilEnd(endAt, now);
    const fairMap = fairH2HByEntryId(
      eA.id,
      eA.score,
      eB.id,
      eB.score,
      hrs,
      LOCKIN_H2H_SIGMA_1D,
      LOCKIN_H2H_BETA,
    );
    const favored = favoredH2HFromFairMap(fairMap);
    if (!favored) continue;

    const favoredPrice = lmsrEntryPrice(b, sq, favored.entryId, entryIds);
    const gap = favored.fair - favoredPrice;
    const favoredEntry = entries.find((e) => e.id === favored.entryId);

    markets.push({
      marketId: row.market_id,
      title: row.title,
      hoursRemaining: hrs,
      favoredLabel: favoredEntry?.label ?? null,
      favoredFair: favored.fair,
      favoredPrice,
      gap,
      scoreRatio: eA.score / eB.score,
      volume: Number(row.volume) || 0,
      liquidityB: b,
    });
  }

  markets.sort((a, b) => Math.abs(b.gap ?? 0) - Math.abs(a.gap ?? 0));

  return {
    markets,
    summary: summarizeConvergenceGaps(markets, (m) =>
      m.favoredFair != null && m.favoredFair >= LOCKIN_H2H_DECISIVE_FAIR,
    ),
    sampledAt: now.toISOString(),
  };
}

export async function fetchLiveGainerConvergence(
  now: Date = new Date(),
): Promise<LiveGainerConvergenceResult> {
  const marketRows = await db.execute(sql`
    SELECT
      pm.id AS market_id,
      pm.title,
      pm.end_at,
      pm.created_at,
      mas.liquidity_b,
      mas.share_quantities AS sq,
      COALESCE(mas.total_user_credits_in, 0)::float AS volume
    FROM prediction_markets pm
    INNER JOIN market_amm_state mas ON mas.market_id = pm.id
    WHERE pm.engine = 'amm'
      AND pm.market_type = 'gainer'
      AND pm.status = 'OPEN'
      AND pm.visibility = 'live'
      AND pm.end_at > ${now}
  `);

  const marketIds = (marketRows.rows as Array<{ market_id: string }>).map(
    (r) => r.market_id,
  );
  if (marketIds.length === 0) {
    return {
      markets: [],
      summary: summarizeConvergenceGaps([], () => false),
      sampledAt: now.toISOString(),
    };
  }

  const entryRows = await db
    .select({
      marketId: marketEntries.marketId,
      entryId: marketEntries.id,
      label: marketEntries.label,
      personId: marketEntries.personId,
      currentFame: trendingPeople.fameIndex,
    })
    .from(marketEntries)
    .leftJoin(trendingPeople, eq(trendingPeople.id, marketEntries.personId))
    .where(inArray(marketEntries.marketId, marketIds));

  const entriesByMarket = new Map<
    string,
    Array<{
      id: string;
      label: string | null;
      personId: string | null;
      currentFame: number | null;
    }>
  >();
  for (const row of entryRows) {
    const list = entriesByMarket.get(row.marketId) ?? [];
    list.push({
      id: row.entryId,
      label: row.label,
      personId: row.personId,
      currentFame: row.currentFame,
    });
    entriesByMarket.set(row.marketId, list);
  }

  const markets: LiveGainerConvergenceMarketRow[] = [];

  for (const row of marketRows.rows as Array<{
    market_id: string;
    title: string | null;
    end_at: Date | string;
    created_at: Date | string | null;
    liquidity_b: string | number;
    sq: Record<string, number>;
    volume: number;
  }>) {
    const entries = entriesByMarket.get(row.market_id) ?? [];
    if (entries.length < 2) continue;

    const createdAt =
      row.created_at instanceof Date
        ? row.created_at
        : row.created_at
          ? new Date(row.created_at)
          : null;

    const pctByEntryId: Record<string, number | null | undefined> = {};
    let leaderPct: number | null = null;

    for (const entry of entries) {
      if (!entry.personId) {
        pctByEntryId[entry.id] = null;
        continue;
      }
      let openingScore: number | null = null;
      if (createdAt) {
        const openRows = await db.execute(sql`
          SELECT fame_index AS opening_score
          FROM trend_snapshots
          WHERE person_id = ${entry.personId}
            AND timestamp <= ${createdAt}
          ORDER BY timestamp DESC
          LIMIT 1
        `);
        const openRow = openRows.rows[0] as { opening_score: number } | undefined;
        openingScore =
          openRow?.opening_score != null && Number.isFinite(openRow.opening_score)
            ? Number(openRow.opening_score)
            : null;
      }
      const fame = entry.currentFame;
      if (
        openingScore != null &&
        openingScore > 0 &&
        fame != null &&
        Number.isFinite(fame)
      ) {
        const pct = (fame - openingScore) / openingScore;
        pctByEntryId[entry.id] = pct;
        if (leaderPct == null || pct > leaderPct) leaderPct = pct;
      } else {
        pctByEntryId[entry.id] = null;
      }
    }

    const b = Number(row.liquidity_b);
    const sq = row.sq ?? {};
    const entryIds = entries.map((e) => e.id);
    const endAt =
      row.end_at instanceof Date ? row.end_at : new Date(row.end_at);
    const hrs = hoursUntilEnd(endAt, now);
    const fairMap = fairGainerByEntryId(
      pctByEntryId,
      hrs,
      LOCKIN_GAINER_SIGMA_1D,
      LOCKIN_GAINER_BETA,
    );
    const favored = favoredH2HFromFairMap(fairMap);
    if (!favored) continue;

    const favoredPrice = lmsrEntryPrice(b, sq, favored.entryId, entryIds);
    const gap = favored.fair - favoredPrice;
    const favoredEntry = entries.find((e) => e.id === favored.entryId);

    markets.push({
      marketId: row.market_id,
      title: row.title,
      hoursRemaining: hrs,
      entryCount: entries.length,
      favoredLabel: favoredEntry?.label ?? null,
      favoredFair: favored.fair,
      favoredPrice,
      gap,
      leaderPctOpen: leaderPct,
      volume: Number(row.volume) || 0,
      liquidityB: b,
    });
  }

  markets.sort((a, b) => Math.abs(b.gap ?? 0) - Math.abs(a.gap ?? 0));

  return {
    markets,
    summary: summarizeConvergenceGaps(markets, (m) =>
      m.favoredFair != null && m.favoredFair >= LOCKIN_GAINER_DECISIVE_FAIR,
    ),
    sampledAt: now.toISOString(),
  };
}

/** Thresholds for advisory health check (never fail `ok`). */
export const LIVE_CONVERGENCE_MISPRICED_WARN_PCT = 0.35;
export const LIVE_CONVERGENCE_AVG_GAP_WARN = 0.12;
