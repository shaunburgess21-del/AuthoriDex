/**
 * Called after market resolution. Updates Brier scores and category stats for agent bets.
 * Category is taken from the MARKET, not the agent's specialties.
 */

import { db } from "../db";
import { marketBets, agentConfigs, agentPerformance, predictionMarkets } from "@shared/schema";
import { eq, and, isNotNull } from "drizzle-orm";
import { addMemory } from "./memoryManager";
import { log } from "../log";

export async function scoreResolvedMarket(
  marketId: string,
  winnerEntryId: string
): Promise<void> {
  try {
    const agentBets = await db
      .select({
        betId: marketBets.id,
        entryId: marketBets.entryId,
        agentId: marketBets.agentId,
        confidence: marketBets.confidence,
        userId: marketBets.userId,
      })
      .from(marketBets)
      .where(and(eq(marketBets.marketId, marketId), isNotNull(marketBets.agentId)));

    if (!agentBets.length) return;

    const [market] = await db
      .select({ category: predictionMarkets.category })
      .from(predictionMarkets)
      .where(eq(predictionMarkets.id, marketId))
      .limit(1);

    const primaryCategory = market?.category ?? "general";

    const periodStart = getPeriodStart();
    const periodEnd = getPeriodEnd();

    for (const bet of agentBets) {
      if (!bet.agentId) continue;

      const isCorrect = bet.entryId === winnerEntryId;
      const outcome = isCorrect ? 1.0 : 0.0;
      const conf = bet.confidence ? parseFloat(String(bet.confidence)) : 0.5;

      // Brier score: (confidence - outcome)^2
      const brierScore = Math.pow(conf - outcome, 2);

      await upsertAgentPerformance(
        bet.agentId,
        periodStart,
        periodEnd,
        isCorrect,
        brierScore,
        primaryCategory
      );

      // Memory note for high-confidence outcomes
      if (conf > 0.7) {
        const direction = isCorrect ? "correctly" : "incorrectly";
        await addMemory(bet.agentId, {
          memoryType: "recent_outcome",
          content: `${direction} predicted a ${primaryCategory} market with ${Math.round(conf * 100)}% confidence.`,
          category: primaryCategory,
        });
      }
    }

    log(
      `[AgentPerformance] Scored ${agentBets.length} agent bets for market ${marketId}`
    );
  } catch (err) {
    console.error(
      "[AgentPerformance] Failed to score market:",
      marketId,
      err instanceof Error ? err.message : err
    );
  }
}

async function upsertAgentPerformance(
  agentId: string,
  periodStart: Date,
  periodEnd: Date,
  isCorrect: boolean,
  brierScore: number,
  category: string
): Promise<void> {
  const [existing] = await db
    .select()
    .from(agentPerformance)
    .where(
      and(
        eq(agentPerformance.agentId, agentId),
        eq(agentPerformance.periodStart, periodStart),
        eq(agentPerformance.periodEnd, periodEnd)
      )
    )
    .limit(1);

  if (existing) {
    const newResolved = existing.totalResolved + 1;
    const newCorrect = existing.correct + (isCorrect ? 1 : 0);
    const oldBrier = existing.avgBrierScore
      ? parseFloat(String(existing.avgBrierScore))
      : 0;
    const newBrier =
      existing.totalResolved > 0
        ? (oldBrier * existing.totalResolved + brierScore) / newResolved
        : brierScore;

    const categoryScores = (existing.categoryScores as Record<string, any>) ?? {};
    const cat = categoryScores[category] ?? {
      correct: 0,
      total: 0,
      avg_brier: 0,
    };
    cat.total++;
    if (isCorrect) cat.correct++;
    cat.avg_brier =
      ((cat.avg_brier * (cat.total - 1)) + brierScore) / cat.total;
    categoryScores[category] = cat;

    await db
      .update(agentPerformance)
      .set({
        totalResolved: newResolved,
        correct: newCorrect,
        avgBrierScore: newBrier.toFixed(4),
        accuracy: (newCorrect / newResolved).toFixed(4),
        categoryScores,
        updatedAt: new Date(),
      })
      .where(eq(agentPerformance.id, existing.id));
  } else {
    await db.insert(agentPerformance).values({
      agentId,
      periodStart,
      periodEnd,
      totalEntered: 1,
      totalResolved: 1,
      correct: isCorrect ? 1 : 0,
      avgBrierScore: brierScore.toFixed(4),
      accuracy: isCorrect ? "1.0000" : "0.0000",
      categoryScores: {
        [category]: {
          correct: isCorrect ? 1 : 0,
          total: 1,
          avg_brier: brierScore,
        },
      },
    });
  }
}

function getPeriodStart(): Date {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - d.getUTCDay());
  d.setUTCHours(0, 0, 0, 0);
  return d;
}

function getPeriodEnd(): Date {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + (6 - d.getUTCDay()));
  d.setUTCHours(23, 59, 59, 999);
  return d;
}
