/**
 * Top-N users on the prediction leaderboard for a time window.
 * Extracted from GET /api/leaderboard/users (week/all realised P&L ranking).
 */

import { and, inArray, sql } from "drizzle-orm";
import { db } from "../db";
import { marketBets, profiles } from "@shared/schema";

export type TopPredictorRow = {
  rank: number;
  username: string;
  displayName: string;
  totalPnl: number;
};

export async function getTopPredictorsForPeriod(
  period: "week" | "all",
  limit: number,
): Promise<TopPredictorRow[]> {
  let periodFilter = sql`TRUE`;
  let settledAfter: Date | undefined;
  if (period === "week") {
    settledAfter = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    periodFilter = sql`${marketBets.settledAt} >= ${settledAfter}`;
  }

  const statsRows = await db
    .select({
      userId: marketBets.userId,
      jackpotPnl: sql<number>`
        SUM(CASE
          WHEN ${marketBets.actionType} = 'parimutuel' AND ${marketBets.status} = 'won'
            THEN COALESCE(${marketBets.payoutAmount}, ${marketBets.potentialPayout}, 0) - ${marketBets.stakeAmount}
          WHEN ${marketBets.actionType} = 'parimutuel' AND ${marketBets.status} = 'lost'
            THEN -${marketBets.stakeAmount}
          ELSE 0
        END)`.as("jackpot_pnl"),
      jackpotVolume: sql<number>`SUM(CASE
        WHEN ${marketBets.actionType} = 'parimutuel' AND ${marketBets.status} IN ('won','lost')
          THEN ${marketBets.stakeAmount}
        ELSE 0
      END)`.as("jackpot_volume"),
      winCount: sql<number>`COUNT(*) FILTER (WHERE ${marketBets.status} = 'won')`.as("win_count"),
      totalResolved: sql<number>`COUNT(*) FILTER (WHERE ${marketBets.status} IN ('won', 'lost'))`.as(
        "total_resolved",
      ),
    })
    .from(marketBets)
    .where(
      and(
        inArray(marketBets.status, ["won", "lost", "settled"]),
        periodFilter,
      ),
    )
    .groupBy(marketBets.userId)
    .having(
      sql`COUNT(*) FILTER (WHERE ${marketBets.status} IN ('won', 'lost', 'settled')) > 0`,
    );

  const { loadAmmAggregatePnlPerUser } = await import("./amm-positions");
  const ammByUser = await loadAmmAggregatePnlPerUser({ settledAfter });

  const statsByUser = new Map(statsRows.map((r) => [r.userId, r]));
  for (const [userId, ammPnl] of ammByUser.entries()) {
    if (statsByUser.has(userId)) continue;
    if (settledAfter && ammPnl.turnover < 1) continue;
    statsByUser.set(userId, {
      userId,
      jackpotPnl: 0,
      jackpotVolume: 0,
      winCount: 0,
      totalResolved: 0,
    });
    statsRows.push({
      userId,
      jackpotPnl: 0,
      jackpotVolume: 0,
      winCount: 0,
      totalResolved: 0,
    });
  }

  if (statsRows.length === 0) return [];

  const userIds = statsRows.map((r) => r.userId);
  const profileRows = await db
    .select({
      id: profiles.id,
      username: profiles.username,
      isPublic: profiles.isPublic,
      positionsPublic: profiles.positionsPublic,
      createdAt: profiles.createdAt,
    })
    .from(profiles)
    .where(inArray(profiles.id, userIds));
  const profileMap = new Map(profileRows.map((p) => [p.id, p]));

  const realisedFor = (uid: string): number => {
    const sr = statsByUser.get(uid);
    const amm = ammByUser.get(uid);
    return (
      (Number(sr?.jackpotPnl) || 0) +
      (amm?.realisedFromSells ?? 0) +
      (amm?.realisedFromResolution ?? 0)
    );
  };
  const includeUnrealised = period === "all";
  const unrealisedFor = (uid: string): number =>
    includeUnrealised ? (ammByUser.get(uid)?.unrealised ?? 0) : 0;
  const volumeFor = (uid: string): number => {
    const sr = statsByUser.get(uid);
    const amm = ammByUser.get(uid);
    return (Number(sr?.jackpotVolume) || 0) + (amm?.turnover ?? 0);
  };

  statsRows.sort((a, b) => {
    const aTotal = realisedFor(a.userId) + unrealisedFor(a.userId);
    const bTotal = realisedFor(b.userId) + unrealisedFor(b.userId);
    const pnlDiff = bTotal - aTotal;
    if (pnlDiff !== 0) return pnlDiff;
    const volDiff = volumeFor(b.userId) - volumeFor(a.userId);
    if (volDiff !== 0) return volDiff;
    const aCreatedAt =
      profileMap.get(a.userId)?.createdAt?.getTime?.() ?? Number.MAX_SAFE_INTEGER;
    const bCreatedAt =
      profileMap.get(b.userId)?.createdAt?.getTime?.() ?? Number.MAX_SAFE_INTEGER;
    if (aCreatedAt !== bCreatedAt) return aCreatedAt - bCreatedAt;
    return a.userId.localeCompare(b.userId);
  });

  const top = statsRows.slice(0, limit);
  return top.map((r, i) => {
    const profile = profileMap.get(r.userId);
    const isPublic = profile?.isPublic ?? true;
    const positionsPublic = profile?.positionsPublic ?? true;
    const shouldReveal = isPublic && positionsPublic;
    const realisedPnl = realisedFor(r.userId);
    const unrealisedPnl = unrealisedFor(r.userId);
    const totalPnl = realisedPnl + unrealisedPnl;
    return {
      rank: i + 1,
      username: shouldReveal ? (profile?.username ?? "anonymous") : "private",
      displayName: shouldReveal ? (profile?.username ?? "Anonymous") : "Private Predictor",
      totalPnl: Math.round(totalPnl),
    };
  });
}
