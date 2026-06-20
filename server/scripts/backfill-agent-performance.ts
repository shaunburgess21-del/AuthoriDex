/**
 * Backfill `agent_performance` from historical resolved native AMM markets.
 *
 * The live writer (`scoreResolvedMarket`) was effectively a no-op in production
 * for a long time, so `agent_performance` is empty. This recomputes per-agent,
 * per-week Brier / accuracy / category telemetry directly from `market_bets`
 * + the winning entry, bucketed by the WEEK OF `resolved_at` (not now()), and
 * upserts absolute aggregates so the script is idempotent.
 *
 * Semantics mirror the live writer for homogeneity with future rows:
 *   - every agent bet row (buy AND sell) counts as one data point
 *   - correct = (bet.entry_id === winning entry id)
 *   - Brier = (confidence - outcome)^2, confidence defaults to 0.5 when null
 *   - category = the market's category
 *
 * Scope: native AMM markets only (updown / h2h / gainer). Jackpot is
 * parimutuel and never fed the writer, so it is excluded.
 *
 * Default = DRY RUN. Pass --apply to write.
 *
 *   npx tsx --env-file=.env server/scripts/backfill-agent-performance.ts
 *   npx tsx --env-file=.env server/scripts/backfill-agent-performance.ts --apply
 */

import { and, eq, inArray, isNotNull } from "drizzle-orm";
import { db } from "../db";
import {
  agentConfigs,
  agentPerformance,
  marketBets,
  marketEntries,
  predictionMarkets,
} from "@shared/schema";
// Reuse the live writer's period bucketing so backfilled rows land on the exact
// same (period_start, period_end) keys future live writes will use — they must
// match for the upsert to merge instead of duplicating.
import { getPeriodStart, getPeriodEnd } from "../agents/performanceUpdater";

const APPLY = process.argv.includes("--apply");

interface CatAgg {
  correct: number;
  total: number;
  sumBrier: number;
}
interface Agg {
  agentId: string;
  periodStart: Date;
  periodEnd: Date;
  total: number;
  correct: number;
  sumBrier: number;
  categories: Map<string, CatAgg>;
}

async function main() {
  console.log(`[backfill] agent_performance backfill — mode=${APPLY ? "APPLY" : "DRY RUN"}`);

  const validAgentIds = new Set(
    (await db.select({ id: agentConfigs.id }).from(agentConfigs)).map((r) => r.id),
  );

  const markets = await db
    .select({
      id: predictionMarkets.id,
      category: predictionMarkets.category,
      resolvedAt: predictionMarkets.resolvedAt,
    })
    .from(predictionMarkets)
    .where(
      and(
        eq(predictionMarkets.status, "RESOLVED"),
        eq(predictionMarkets.engine, "amm"),
        inArray(predictionMarkets.marketType, ["updown", "h2h", "gainer"]),
        isNotNull(predictionMarkets.resolvedAt),
      ),
    );

  console.log(`[backfill] Found ${markets.length} resolved native AMM markets.`);

  const aggByKey = new Map<string, Agg>();
  let scannedBets = 0;
  let marketsWithoutWinner = 0;

  for (const market of markets) {
    const [winner] = await db
      .select({ id: marketEntries.id })
      .from(marketEntries)
      .where(and(eq(marketEntries.marketId, market.id), eq(marketEntries.resolutionStatus, "winner")))
      .limit(1);
    if (!winner) {
      // Voided / tie markets have no winner entry — nothing to score.
      marketsWithoutWinner++;
      continue;
    }

    const bets = await db
      .select({
        entryId: marketBets.entryId,
        agentId: marketBets.agentId,
        confidence: marketBets.confidence,
      })
      .from(marketBets)
      .where(and(eq(marketBets.marketId, market.id), isNotNull(marketBets.agentId)));

    const refDate = new Date(market.resolvedAt as Date);
    const start = getPeriodStart(refDate);
    const end = getPeriodEnd(refDate);
    const category = market.category ?? "general";

    for (const bet of bets) {
      if (!bet.agentId || !validAgentIds.has(bet.agentId)) continue;
      scannedBets++;

      const isCorrect = bet.entryId === winner.id;
      const outcome = isCorrect ? 1 : 0;
      const parsed = bet.confidence != null ? parseFloat(String(bet.confidence)) : 0.5;
      const conf = Number.isFinite(parsed) ? parsed : 0.5;
      const brier = Math.pow(conf - outcome, 2);

      const key = `${bet.agentId}|${start.toISOString()}|${end.toISOString()}`;
      let agg = aggByKey.get(key);
      if (!agg) {
        agg = {
          agentId: bet.agentId,
          periodStart: start,
          periodEnd: end,
          total: 0,
          correct: 0,
          sumBrier: 0,
          categories: new Map(),
        };
        aggByKey.set(key, agg);
      }
      agg.total++;
      agg.correct += isCorrect ? 1 : 0;
      agg.sumBrier += brier;

      let cat = agg.categories.get(category);
      if (!cat) {
        cat = { correct: 0, total: 0, sumBrier: 0 };
        agg.categories.set(category, cat);
      }
      cat.total++;
      cat.correct += isCorrect ? 1 : 0;
      cat.sumBrier += brier;
    }
  }

  const rows = Array.from(aggByKey.values());
  console.log(
    `[backfill] Aggregated ${scannedBets} agent bets into ${rows.length} (agent x week) rows ` +
      `across ${aggByKey.size} buckets. Skipped ${marketsWithoutWinner} markets without a winner entry.`,
  );

  // Sample output for sanity.
  for (const r of rows.slice(0, 5)) {
    console.log(
      `[backfill]   agent=${r.agentId} period=${r.periodStart.toISOString().slice(0, 10)}..${r.periodEnd
        .toISOString()
        .slice(0, 10)} total=${r.total} correct=${r.correct} avgBrier=${(r.sumBrier / r.total).toFixed(4)}`,
    );
  }

  if (!APPLY) {
    console.log("[backfill] DRY RUN — no rows written. Re-run with --apply to persist.");
    process.exit(0);
  }

  let written = 0;
  let failed = 0;
  for (const r of rows) {
    try {
      const avgBrier = r.sumBrier / r.total;
      const accuracy = r.correct / r.total;
      const categoryScores: Record<string, { correct: number; total: number; avg_brier: number }> = {};
      for (const [catName, c] of r.categories) {
        categoryScores[catName] = {
          correct: c.correct,
          total: c.total,
          avg_brier: c.sumBrier / c.total,
        };
      }

      await db
        .insert(agentPerformance)
        .values({
          agentId: r.agentId,
          periodStart: r.periodStart,
          periodEnd: r.periodEnd,
          totalEntered: r.total,
          totalResolved: r.total,
          correct: r.correct,
          avgBrierScore: avgBrier.toFixed(4),
          accuracy: accuracy.toFixed(4),
          categoryScores,
        })
        .onConflictDoUpdate({
          target: [agentPerformance.agentId, agentPerformance.periodStart, agentPerformance.periodEnd],
          set: {
            totalEntered: r.total,
            totalResolved: r.total,
            correct: r.correct,
            avgBrierScore: avgBrier.toFixed(4),
            accuracy: accuracy.toFixed(4),
            categoryScores,
            updatedAt: new Date(),
          },
        });
      written++;
    } catch (err) {
      failed++;
      console.error(
        `[backfill] Failed to upsert agent=${r.agentId} period=${r.periodStart.toISOString().slice(0, 10)}: ` +
          `${err instanceof Error ? err.message : err}`,
      );
    }
  }

  console.log(`[backfill] APPLY complete — upserted ${written} agent_performance rows${failed > 0 ? `, ${failed} failed` : ""}.`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error("[backfill] Fatal:", err);
  process.exit(1);
});
