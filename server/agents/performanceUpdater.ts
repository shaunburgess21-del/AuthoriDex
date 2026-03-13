/**
 * Called after market resolution. Updates Brier scores and category stats for agent bets.
 * Category is taken from the MARKET, not the agent's specialties.
 */

import { db } from "../db";
import { marketBets, agentConfigs, agentPerformance, predictionMarkets } from "@shared/schema";
import { eq, and, isNotNull, sql } from "drizzle-orm";
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
      // Use != null so that a confidence of exactly 0 is not treated as missing
      const conf = bet.confidence != null ? parseFloat(String(bet.confidence)) : 0.5;

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

      // Memory note for high-confidence outcomes — wrapped so a failure here
      // does not abort scoring for remaining bets in the loop
      if (conf > 0.7) {
        const direction = isCorrect ? "correctly" : "incorrectly";
        await addMemory(bet.agentId, {
          memoryType: "recent_outcome",
          content: `${direction} predicted a ${primaryCategory} market with ${Math.round(conf * 100)}% confidence.`,
          category: primaryCategory,
        }).catch((memErr: unknown) => {
          log(`[AgentPerformance] addMemory failed for agent ${bet.agentId}: ${memErr instanceof Error ? memErr.message : memErr}`);
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
  const initCategoryScores = {
    [category]: {
      correct: isCorrect ? 1 : 0,
      total: 1,
      avg_brier: brierScore,
    },
  };

  // Build a safe JSON literal for the new category entry
  const newCatJson = JSON.stringify(initCategoryScores[category]);
  const catKey = category.replace(/'/g, "''"); // escape single quotes for SQL literal

  await db
    .insert(agentPerformance)
    .values({
      agentId,
      periodStart,
      periodEnd,
      // On insert, totalResolved = 1. totalEntered is incremented at bet placement;
      // here we leave it at 1 as the baseline for the first resolved bet.
      totalEntered: 1,
      totalResolved: 1,
      correct: isCorrect ? 1 : 0,
      avgBrierScore: brierScore.toFixed(4),
      accuracy: isCorrect ? "1.0000" : "0.0000",
      categoryScores: initCategoryScores,
    })
    .onConflictDoUpdate({
      target: [agentPerformance.agentId, agentPerformance.periodStart, agentPerformance.periodEnd],
      set: {
        // totalEntered is incremented at bet-placement; only totalResolved grows here
        totalResolved: sql`${agentPerformance.totalResolved} + 1`,
        correct: sql`${agentPerformance.correct} + ${isCorrect ? 1 : 0}`,
        avgBrierScore: sql`CASE WHEN ${agentPerformance.totalResolved} > 0
          THEN ((${agentPerformance.avgBrierScore}::numeric * ${agentPerformance.totalResolved} + ${brierScore}) / (${agentPerformance.totalResolved} + 1))::text
          ELSE ${brierScore.toFixed(4)}
        END`,
        accuracy: sql`CASE WHEN (${agentPerformance.totalResolved} + 1) > 0
          THEN ((${agentPerformance.correct} + ${isCorrect ? 1 : 0})::numeric / (${agentPerformance.totalResolved} + 1))::text
          ELSE '0.0000'
        END`,
        // Use jsonb_set to update only the specific category key rather than
        // overwriting the whole object with ||, which erases prior category history
        categoryScores: sql`jsonb_set(
          COALESCE(${agentPerformance.categoryScores}, '{}'::jsonb),
          ${sql.raw(`'{${catKey}}'`)},
          jsonb_build_object(
            'correct',   COALESCE((${agentPerformance.categoryScores}->>'${sql.raw(catKey)}')::jsonb->>'correct', '0')::int + ${isCorrect ? 1 : 0},
            'total',     COALESCE((${agentPerformance.categoryScores}->'${sql.raw(catKey)}'->'total')::int, 0) + 1,
            'avg_brier', CASE
              WHEN COALESCE((${agentPerformance.categoryScores}->'${sql.raw(catKey)}'->'total')::int, 0) > 0
              THEN (
                (COALESCE((${agentPerformance.categoryScores}->'${sql.raw(catKey)}'->'avg_brier')::numeric, 0)
                  * COALESCE((${agentPerformance.categoryScores}->'${sql.raw(catKey)}'->'total')::int, 0)
                  + ${brierScore})
                / (COALESCE((${agentPerformance.categoryScores}->'${sql.raw(catKey)}'->'total')::int, 0) + 1)
              )
              ELSE ${brierScore}
            END
          ),
          true
        )`,
        updatedAt: new Date(),
      },
    });
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
