/**
 * Per-user calibration from settled market_bets (Brier-style buckets).
 * No pre-aggregated user Brier table exists — computed on read.
 */
import { db } from "../../db";
import {
  marketBets,
  marketEntries,
  predictionMarkets,
  profiles,
  trackedPeople,
  userVotes,
} from "@shared/schema";
import { and, eq, inArray, sql } from "drizzle-orm";

export interface CalibrationBucket {
  label: string;
  predictedMid: number;
  count: number;
  actualWinRate: number;
  avgBrier: number;
}

export interface VoteBehaviourBlock {
  totalVotes: number;
  averageRating: number | null;
  histogram: Array<{ rating: number; count: number }>;
  topCategories: Array<{ category: string; count: number; avgRating: number }>;
}

export interface EarlyCallHighlight {
  personId: string;
  personName: string;
  personAvatar: string | null;
  kind: "bet" | "vote";
  rankAtAction: number;
  currentRank: number;
  message: string;
}

export interface UserInsightsBreakdown {
  calibration: CalibrationBucket[];
  byMarketType: Array<{
    marketType: string;
    resolved: number;
    won: number;
    netCredits: number;
    winRate: number;
  }>;
  byCategory: Array<{
    category: string;
    resolved: number;
    won: number;
    winRate: number;
  }>;
  voteBehaviour: VoteBehaviourBlock;
  percentileVsPlatform: {
    percentile: number | null;
    cohortSize: number;
    qualifies: boolean;
  };
  earlyCalls: EarlyCallHighlight[];
}

function impliedProbability(
  pricePerShare: string | null,
  stakeAmount: number,
  potentialPayout: number | null,
): number | null {
  const price = pricePerShare != null ? Number(pricePerShare) : null;
  if (price != null && price > 0 && price <= 1) return price;
  if (potentialPayout != null && stakeAmount > 0) {
    const odds = potentialPayout / stakeAmount;
    if (odds > 1) return Math.min(0.99, 1 / odds);
  }
  return null;
}

async function loadVoteBehaviour(userId: string): Promise<VoteBehaviourBlock> {
  const votes = await db
    .select({
      rating: userVotes.rating,
      category: trackedPeople.category,
    })
    .from(userVotes)
    .innerJoin(trackedPeople, eq(trackedPeople.id, userVotes.personId))
    .where(eq(userVotes.userId, userId));

  if (votes.length === 0) {
    return {
      totalVotes: 0,
      averageRating: null,
      histogram: [],
      topCategories: [],
    };
  }

  const histMap = new Map<number, number>();
  const catMap = new Map<string, { count: number; sum: number }>();
  let ratingSum = 0;

  for (const v of votes) {
    ratingSum += v.rating;
    histMap.set(v.rating, (histMap.get(v.rating) ?? 0) + 1);
    const cat = v.category?.trim() || "Other";
    const cm = catMap.get(cat) ?? { count: 0, sum: 0 };
    cm.count++;
    cm.sum += v.rating;
    catMap.set(cat, cm);
  }

  const histogram = Array.from({ length: 10 }, (_, i) => ({
    rating: i + 1,
    count: histMap.get(i + 1) ?? 0,
  })).filter((h) => h.count > 0);

  const topCategories = Array.from(catMap.entries())
    .map(([category, v]) => ({
      category,
      count: v.count,
      avgRating: v.count > 0 ? v.sum / v.count : 0,
    }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 3);

  return {
    totalVotes: votes.length,
    averageRating: votes.length > 0 ? ratingSum / votes.length : null,
    histogram,
    topCategories,
  };
}

async function loadPercentile(userId: string): Promise<UserInsightsBreakdown["percentileVsPlatform"]> {
  const result = await db.execute(sql`
    WITH cohort AS (
      SELECT
        id,
        PERCENT_RANK() OVER (ORDER BY win_rate) AS pct_rank
      FROM profiles
      WHERE total_predictions >= 10
    )
    SELECT
      (SELECT COUNT(*)::int FROM cohort) AS cohort_size,
      (SELECT pct_rank FROM cohort WHERE id = ${userId}) AS user_pct,
      (SELECT total_predictions >= 10 FROM profiles WHERE id = ${userId}) AS qualifies
  `);

  const row = (
    Array.isArray(result) ? result[0] : (result as { rows: Record<string, unknown>[] }).rows?.[0]
  ) as Record<string, unknown> | undefined;

  const cohortSize = Number(row?.cohort_size ?? 0);
  const qualifies = Boolean(row?.qualifies);
  const userPct = row?.user_pct != null ? Number(row.user_pct) : null;

  return {
    percentile: userPct != null ? Math.round(userPct * 100) : null,
    cohortSize,
    qualifies,
  };
}

async function loadEarlyCalls(userId: string): Promise<EarlyCallHighlight[]> {
  const result = await db.execute(sql`
    WITH user_events AS (
      SELECT
        me.person_id,
        tp.name AS person_name,
        tp.avatar AS person_avatar,
        mb.created_at AS action_at,
        'bet'::text AS kind
      FROM market_bets mb
      INNER JOIN market_entries me ON me.id = mb.entry_id
      INNER JOIN trending_people tp ON tp.id = me.person_id
      WHERE mb.user_id = ${userId}
        AND mb.status = 'won'
        AND me.person_id IS NOT NULL
      UNION ALL
      SELECT
        uv.person_id,
        tp.name AS person_name,
        tp.avatar AS person_avatar,
        uv.voted_at AS action_at,
        'vote'::text AS kind
      FROM user_votes uv
      INNER JOIN trending_people tp ON tp.id = uv.person_id
      WHERE uv.user_id = ${userId}
        AND uv.rating >= 8
    ),
    hourly_ranks AS (
      SELECT
        person_id,
        timestamp,
        RANK() OVER (
          PARTITION BY timestamp
          ORDER BY fame_index DESC NULLS LAST
        )::int AS rnk
      FROM trend_snapshots
      WHERE snapshot_origin = 'ingest'
        AND timestamp = date_trunc('hour', timestamp)
        AND fame_index IS NOT NULL
        AND timestamp >= NOW() - INTERVAL '90 days'
    ),
    ranked_events AS (
      SELECT
        ue.person_id,
        ue.person_name,
        ue.kind,
        ue.action_at,
        (
          SELECT hr.rnk
          FROM hourly_ranks hr
          WHERE hr.person_id = ue.person_id
            AND hr.timestamp <= date_trunc('hour', ue.action_at)
          ORDER BY hr.timestamp DESC
          LIMIT 1
        ) AS rank_at_action,
        tp.rank AS current_rank
      FROM user_events ue
      INNER JOIN trending_people tp ON tp.id = ue.person_id
    )
    SELECT *
    FROM (
      SELECT DISTINCT ON (person_id)
        person_id,
        person_name,
        person_avatar,
        kind,
        rank_at_action,
        current_rank
      FROM ranked_events
      WHERE rank_at_action > 30
        AND current_rank <= 10
        AND rank_at_action IS NOT NULL
      ORDER BY person_id, (rank_at_action - current_rank) DESC
    ) best_per_person
    ORDER BY (rank_at_action - current_rank) DESC
    LIMIT 5
  `);

  const rows =
    (Array.isArray(result) ? result : (result as { rows: Record<string, unknown>[] }).rows) ?? [];

  return rows.map((row) => {
    const personId = String(row.person_id);
    const personName = String(row.person_name ?? "");
    const kind = row.kind === "vote" ? "vote" : "bet";
    const rankAtAction = Number(row.rank_at_action ?? 0);
    const currentRank = Number(row.current_rank ?? 0);
    const actionLabel = kind === "vote" ? "voted highly on" : "predicted on";
    return {
      personId,
      personName,
      personAvatar: (row.person_avatar as string) ?? null,
      kind: kind as "bet" | "vote",
      rankAtAction,
      currentRank,
      message: `You ${actionLabel} ${personName} at rank ${rankAtAction} — now top ${currentRank}.`,
    };
  });
}

export async function loadUserInsightsBreakdown(userId: string): Promise<UserInsightsBreakdown> {
  const [bets, voteBehaviour, percentileVsPlatform, earlyCalls] = await Promise.all([
    db
      .select({
        status: marketBets.status,
        stakeAmount: marketBets.stakeAmount,
        payoutAmount: marketBets.payoutAmount,
        potentialPayout: marketBets.potentialPayout,
        pricePerShare: marketBets.pricePerShare,
        marketType: predictionMarkets.marketType,
        category: predictionMarkets.category,
        resolutionStatus: marketEntries.resolutionStatus,
      })
      .from(marketBets)
      .innerJoin(predictionMarkets, eq(predictionMarkets.id, marketBets.marketId))
      .innerJoin(marketEntries, eq(marketEntries.id, marketBets.entryId))
      .where(
        and(eq(marketBets.userId, userId), inArray(marketBets.status, ["won", "lost"])),
      )
      .limit(500),
    loadVoteBehaviour(userId),
    loadPercentile(userId),
    loadEarlyCalls(userId),
  ]);

  const bucketMap = new Map<string, { count: number; wins: number; brierSum: number }>();
  const typeMap = new Map<string, { resolved: number; won: number; net: number }>();
  const catMap = new Map<string, { resolved: number; won: number }>();

  for (const bet of bets) {
    const won = bet.status === "won";
    const p = impliedProbability(bet.pricePerShare, bet.stakeAmount, bet.potentialPayout);
    const outcome = won ? 1 : 0;

    if (p != null) {
      const bucketIdx = Math.min(9, Math.floor(p * 10));
      const label = `${bucketIdx * 10}-${bucketIdx * 10 + 10}%`;
      const b = bucketMap.get(label) ?? { count: 0, wins: 0, brierSum: 0 };
      b.count++;
      if (won) b.wins++;
      b.brierSum += (p - outcome) ** 2;
      bucketMap.set(label, b);
    }

    const mt = bet.marketType ?? "unknown";
    const tm = typeMap.get(mt) ?? { resolved: 0, won: 0, net: 0 };
    tm.resolved++;
    if (won) tm.won++;
    tm.net += (bet.payoutAmount ?? 0) - bet.stakeAmount;
    typeMap.set(mt, tm);

    const cat = bet.category ?? "Other";
    const cm = catMap.get(cat) ?? { resolved: 0, won: 0 };
    cm.resolved++;
    if (won) cm.won++;
    catMap.set(cat, cm);
  }

  const calibration: CalibrationBucket[] = Array.from(bucketMap.entries()).map(
    ([label, b]) => ({
      label,
      predictedMid: parseInt(label, 10) / 100 + 0.05,
      count: b.count,
      actualWinRate: b.count > 0 ? b.wins / b.count : 0,
      avgBrier: b.count > 0 ? b.brierSum / b.count : 0,
    }),
  );

  return {
    calibration,
    byMarketType: Array.from(typeMap.entries()).map(([marketType, v]) => ({
      marketType,
      resolved: v.resolved,
      won: v.won,
      netCredits: v.net,
      winRate: v.resolved > 0 ? v.won / v.resolved : 0,
    })),
    byCategory: Array.from(catMap.entries()).map(([category, v]) => ({
      category,
      resolved: v.resolved,
      won: v.won,
      winRate: v.resolved > 0 ? v.won / v.resolved : 0,
    })),
    voteBehaviour,
    percentileVsPlatform,
    earlyCalls,
  };
}
