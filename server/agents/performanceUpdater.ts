/**
 * Called after market resolution. Updates Brier scores and category stats for agent bets.
 * Category is taken from the MARKET, not the agent's specialties.
 */

import { db } from "../db";
import { marketBets, agentConfigs, agentPerformance, predictionMarkets } from "@shared/schema";
import { eq, and, isNotNull, ne, sql } from "drizzle-orm";
import { addMemory } from "./memoryManager";
import { log } from "../log";

export interface ScoreResolvedMarketResult {
  total: number;
  scored: number;
  failed: number;
}

export async function scoreResolvedMarket(
  marketId: string,
  winnerEntryId: string
): Promise<ScoreResolvedMarketResult> {
  const result: ScoreResolvedMarketResult = { total: 0, scored: 0, failed: 0 };
  try {
    // Score buys (and any non-AMM rows) but exclude sells: a sell is position
    // management, not a fresh directional prediction, so it shouldn't count
    // toward Brier/accuracy. For AMM markets this leaves only buy rows.
    const agentBets = await db
      .select({
        betId: marketBets.id,
        entryId: marketBets.entryId,
        agentId: marketBets.agentId,
        confidence: marketBets.confidence,
        pricePerShare: marketBets.pricePerShare,
        userId: marketBets.userId,
      })
      .from(marketBets)
      .where(
        and(
          eq(marketBets.marketId, marketId),
          isNotNull(marketBets.agentId),
          ne(marketBets.actionType, "sell"),
        ),
      );

    result.total = agentBets.length;
    if (!agentBets.length) return result;

    const [market] = await db
      .select({ category: predictionMarkets.category, resolvedAt: predictionMarkets.resolvedAt })
      .from(predictionMarkets)
      .where(eq(predictionMarkets.id, marketId))
      .limit(1);

    const primaryCategory = market?.category ?? "general";

    // Bucket by the market's resolvedAt week (not "now") so a resolution that
    // lands just after a week boundary is still credited to the correct week,
    // and so live writes share the exact same period rows as the backfill.
    const refDate = market?.resolvedAt ? new Date(market.resolvedAt) : new Date();
    const periodStart = getPeriodStart(refDate);
    const periodEnd = getPeriodEnd(refDate);

    for (const bet of agentBets) {
      if (!bet.agentId) continue;

      // Per-bet isolation: a single bad bet (e.g. an unexpected upsert error)
      // must never abort scoring for the remaining bets. Previously one throw
      // would bubble to the outer catch and silently zero out the whole
      // market's telemetry — the most likely reason `agent_performance` was
      // empty in production despite the writer being wired up.
      try {
        const isCorrect = bet.entryId === winnerEntryId;
        const outcome = isCorrect ? 1.0 : 0.0;
        // Predicted probability the entry wins. AMM trades store this as
        // price_per_share (the LMSR implied probability at trade time);
        // legacy/parimutuel rows use `confidence`. Fall back to the 0.5 prior
        // only if neither is present. != null so an exact 0 isn't treated as
        // missing.
        const rawProb =
          bet.pricePerShare != null
            ? parseFloat(String(bet.pricePerShare))
            : bet.confidence != null
              ? parseFloat(String(bet.confidence))
              : 0.5;
        // Clamp to [0,1]; a non-finite value would yield a NaN Brier score,
        // which numeric(6,4) rejects on insert.
        const conf = Number.isFinite(rawProb) ? Math.min(1, Math.max(0, rawProb)) : 0.5;

        // Brier score: (predicted probability - outcome)^2
        const brierScore = Math.pow(conf - outcome, 2);

        await upsertAgentPerformance(
          bet.agentId,
          periodStart,
          periodEnd,
          isCorrect,
          brierScore,
          primaryCategory
        );
        result.scored++;

        // Memory note for high-confidence outcomes — wrapped so a failure here
        // does not abort scoring for remaining bets in the loop
        if (conf > 0.7) {
          const direction = isCorrect ? "correctly" : "incorrectly";
          await addMemory(bet.agentId, {
            memoryType: "recent_outcome",
            content: `${direction} predicted a ${primaryCategory} market with ${Math.round(conf * 100)}% confidence.`,
            category: primaryCategory,
          }).catch((memErr: unknown) => {
            log(`[AgentPerformance] addMemory failed for agent ${bet.agentId} on market ${marketId}: ${memErr instanceof Error ? memErr.stack ?? memErr.message : memErr}`);
          });
        }
      } catch (betErr) {
        result.failed++;
        log(
          `[AgentPerformance] Failed to score bet ${bet.betId} (agent ${bet.agentId}) on market ${marketId}: ` +
            `${betErr instanceof Error ? betErr.stack ?? betErr.message : betErr}`
        );
      }
    }

    log(
      `[AgentPerformance] Scored ${result.scored}/${result.total} agent bets for market ${marketId}` +
        (result.failed > 0 ? ` (${result.failed} failed)` : "")
    );
    return result;
  } catch (err) {
    // Loud, full-stack logging via the shared logger (not console.error, which
    // can be lost in the production log pipeline). Re-thrown so the
    // fire-and-forget call-site `.catch` also records it.
    log(
      `[AgentPerformance] Failed to score market ${marketId}: ${err instanceof Error ? err.stack ?? err.message : err}`
    );
    throw err;
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

  await db
    .insert(agentPerformance)
    .values({
      agentId,
      periodStart,
      periodEnd,
      // This writer only fires at resolution, so each scored buy is both
      // "entered" and "resolved" — keep the counters in lockstep (the backfill
      // sets totalEntered = totalResolved too).
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
        totalEntered: sql`${agentPerformance.totalEntered} + 1`,
        totalResolved: sql`${agentPerformance.totalResolved} + 1`,
        correct: sql`${agentPerformance.correct} + ${isCorrect ? 1 : 0}`,
        // The CASE result MUST be numeric: avg_brier_score / accuracy are numeric
        // columns and Postgres type-checks the whole INSERT … ON CONFLICT DO
        // UPDATE statement at analyze time. A text-typed expression here (the
        // previous `::text` casts) made EVERY upsert fail — even the first
        // insert with no conflict — which is why agent_performance had 0 rows.
        avgBrierScore: sql`(CASE WHEN ${agentPerformance.totalResolved} > 0
          THEN (${agentPerformance.avgBrierScore}::numeric * ${agentPerformance.totalResolved} + ${brierScore}) / (${agentPerformance.totalResolved} + 1)
          ELSE ${brierScore}
        END)::numeric`,
        accuracy: sql`(CASE WHEN (${agentPerformance.totalResolved} + 1) > 0
          THEN (${agentPerformance.correct} + ${isCorrect ? 1 : 0})::numeric / (${agentPerformance.totalResolved} + 1)
          ELSE 0
        END)::numeric`,
        // Use jsonb_set with parameterized path (no sql.raw / manual escaping)
        categoryScores: sql`jsonb_set(
          COALESCE(${agentPerformance.categoryScores}, '{}'::jsonb),
          ARRAY[${category}]::text[],
          jsonb_build_object(
            'correct',   COALESCE((${agentPerformance.categoryScores}->>${category})::jsonb->>'correct', '0')::int + ${isCorrect ? 1 : 0},
            'total',     COALESCE((${agentPerformance.categoryScores}->${category}->'total')::int, 0) + 1,
            'avg_brier', CASE
              WHEN COALESCE((${agentPerformance.categoryScores}->${category}->'total')::int, 0) > 0
              THEN (
                (COALESCE((${agentPerformance.categoryScores}->${category}->'avg_brier')::numeric, 0)
                  * COALESCE((${agentPerformance.categoryScores}->${category}->'total')::int, 0)
                  + ${brierScore})
                / (COALESCE((${agentPerformance.categoryScores}->${category}->'total')::int, 0) + 1)
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

export function getPeriodStart(ref: Date = new Date()): Date {
  const d = new Date(ref);
  d.setUTCDate(d.getUTCDate() - d.getUTCDay());
  d.setUTCHours(0, 0, 0, 0);
  return d;
}

export function getPeriodEnd(ref: Date = new Date()): Date {
  const d = new Date(ref);
  d.setUTCDate(d.getUTCDate() + (6 - d.getUTCDay()));
  d.setUTCHours(23, 59, 59, 999);
  return d;
}
