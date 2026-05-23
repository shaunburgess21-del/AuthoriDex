/**
 * Canonical user-facing prediction stats for /me, /api/me/predictions,
 * and profiles.win_rate / profiles.total_predictions snapshots.
 *
 * Filters and result classification match GET /api/me/predictions.
 * Badge thresholds still count raw market_bets rows (see badges.ts).
 */

import { and, eq, sql } from "drizzle-orm";
import type { SQL } from "drizzle-orm";
import { db } from "../db";
import {
  marketBets,
  marketEntries,
  predictionMarkets,
  profiles,
} from "@shared/schema";
import {
  classifyPredictionResult,
  roundWinRatePercent,
} from "@shared/lib/profile-prediction-stats";

export type { PredictionResult, PredictionResultInput } from "@shared/lib/profile-prediction-stats";
export { classifyPredictionResult, roundWinRatePercent } from "@shared/lib/profile-prediction-stats";

export interface UserFacingPredictionStats {
  total: number;
  won: number;
  lost: number;
  refunded: number;
  pending: number;
  winRate: number;
  netCredits: number;
  bestCategory: string | null;
}

/** Drizzle WHERE fragments for owner-facing prediction rows. */
export function userFacingPredictionsWhere(userId: string): SQL[] {
  return [
    eq(marketBets.userId, userId),
    sql`${predictionMarkets.visibility} NOT IN ('draft', 'hidden')`,
    sql`NOT (${predictionMarkets.visibility} = 'archived' AND ${marketBets.status} = 'active')`,
  ];
}

export async function computeUserFacingPredictionStats(
  userId: string,
): Promise<UserFacingPredictionStats> {
  const rows = await db
    .select({
      betStatus: marketBets.status,
      stakeAmount: marketBets.stakeAmount,
      payoutAmount: marketBets.payoutAmount,
      potentialPayout: marketBets.potentialPayout,
      marketStatus: predictionMarkets.status,
      marketCategory: predictionMarkets.category,
      entryResolutionStatus: marketEntries.resolutionStatus,
    })
    .from(marketBets)
    .innerJoin(predictionMarkets, eq(marketBets.marketId, predictionMarkets.id))
    .innerJoin(marketEntries, eq(marketBets.entryId, marketEntries.id))
    .where(and(...userFacingPredictionsWhere(userId)));

  let won = 0;
  let lost = 0;
  let refunded = 0;
  let pending = 0;
  let netCredits = 0;
  const categoryWins: Record<string, number> = {};

  for (const row of rows) {
    const { result, payout } = classifyPredictionResult({
      marketStatus: row.marketStatus,
      betStatus: row.betStatus,
      entryResolutionStatus: row.entryResolutionStatus,
      stakeAmount: row.stakeAmount,
      payoutAmount: row.payoutAmount,
      potentialPayout: row.potentialPayout,
    });

    if (result === "won") {
      won += 1;
      netCredits += payout - (row.stakeAmount ?? 0);
      if (row.marketCategory) {
        categoryWins[row.marketCategory] = (categoryWins[row.marketCategory] ?? 0) + 1;
      }
    } else if (result === "lost") {
      lost += 1;
      netCredits -= row.stakeAmount ?? 0;
    } else if (result === "refunded") {
      refunded += 1;
    } else {
      pending += 1;
    }
  }

  const bestCategory =
    Object.keys(categoryWins).length > 0
      ? Object.entries(categoryWins).sort((a, b) => b[1] - a[1])[0][0]
      : null;

  return {
    total: rows.length,
    won,
    lost,
    refunded,
    pending,
    winRate: roundWinRatePercent(won, lost),
    netCredits,
    bestCategory,
  };
}

/** Persist user-facing totals to profiles (win_rate, total_predictions). */
export async function syncProfilePredictionStats(userId: string): Promise<void> {
  if (!userId) return;
  try {
    const stats = await computeUserFacingPredictionStats(userId);
    await db
      .update(profiles)
      .set({
        winRate: stats.winRate,
        totalPredictions: stats.total,
      })
      .where(eq(profiles.id, userId));
  } catch (err) {
    console.error("[profile-prediction-stats] syncProfilePredictionStats failed", {
      userId,
      err,
    });
  }
}
