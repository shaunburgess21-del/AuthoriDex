/**
 * Full prediction-leaderboard rank map for a time window.
 * Used by Weekly Wrap rank snapshots (period=all).
 */

import { and, inArray, sql } from "drizzle-orm";
import { db } from "../db";
import { marketBets, profiles } from "@shared/schema";

export type LeaderboardPeriod = "week" | "all";

/**
 * Returns every ranked user id → 1-based rank for the given period.
 * Sort order matches GET /api/leaderboard/users.
 */
export async function getUserLeaderboardRanksForPeriod(
  period: LeaderboardPeriod,
): Promise<Map<string, number>> {
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
    const synthetic = {
      userId,
      jackpotPnl: 0,
      jackpotVolume: 0,
    };
    statsByUser.set(userId, synthetic);
    statsRows.push(synthetic);
  }

  if (statsRows.length === 0) return new Map();

  const userIds = statsRows.map((r) => r.userId);
  const profileRows = await db
    .select({
      id: profiles.id,
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

  const ranks = new Map<string, number>();
  statsRows.forEach((row, index) => {
    ranks.set(row.userId, index + 1);
  });
  return ranks;
}
