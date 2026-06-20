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
 *   - buys are scored; sells are excluded (position management, not a call)
 *   - correct = (bet.entry_id === winning entry id)
 *   - Brier = (predicted prob - outcome)^2, where predicted prob = the AMM
 *     price_per_share (LMSR implied prob), falling back to confidence, then 0.5
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

import { and, eq, inArray, isNotNull, ne } from "drizzle-orm";
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

  if (markets.length === 0) {
    console.log("[backfill] Nothing to do.");
    process.exit(0);
  }

  const marketIds = markets.map((m) => m.id);
  const marketMeta = new Map(markets.map((m) => [m.id, m] as const));

  // Batch-fetch in two queries (winners + agent bets) instead of ~2 queries
  // per market, so this stays fast and observable even with 800+ markets.
  const winnerRows = await db
    .select({ marketId: marketEntries.marketId, id: marketEntries.id })
    .from(marketEntries)
    .where(and(inArray(marketEntries.marketId, marketIds), eq(marketEntries.resolutionStatus, "winner")));
  const winnerByMarket = new Map(winnerRows.map((w) => [w.marketId, w.id] as const));

  const betRows = await db
    .select({
      marketId: marketBets.marketId,
      entryId: marketBets.entryId,
      agentId: marketBets.agentId,
      confidence: marketBets.confidence,
      pricePerShare: marketBets.pricePerShare,
    })
    .from(marketBets)
    .where(
      and(
        inArray(marketBets.marketId, marketIds),
        isNotNull(marketBets.agentId),
        ne(marketBets.actionType, "sell"),
      ),
    );

  const marketsWithoutWinner = markets.filter((m) => !winnerByMarket.has(m.id)).length;
  console.log(
    `[backfill] Fetched ${winnerByMarket.size} winner entries + ${betRows.length} agent buy-bets ` +
      `(sells excluded; ${marketsWithoutWinner} markets have no winner — voided/tie, skipped).`,
  );

  const aggByKey = new Map<string, Agg>();
  let scannedBets = 0;

  for (const bet of betRows) {
    if (!bet.agentId || !validAgentIds.has(bet.agentId)) continue;
    const winnerEntryId = winnerByMarket.get(bet.marketId);
    if (!winnerEntryId) continue; // voided / no-winner market — nothing to score
    const meta = marketMeta.get(bet.marketId);
    if (!meta?.resolvedAt) continue;

    scannedBets++;

    const refDate = new Date(meta.resolvedAt as Date);
    const start = getPeriodStart(refDate);
    const end = getPeriodEnd(refDate);
    const category = meta.category ?? "general";

    const isCorrect = bet.entryId === winnerEntryId;
    const outcome = isCorrect ? 1 : 0;
    // Predicted prob = AMM price_per_share (LMSR implied prob), falling back to
    // confidence (legacy/parimutuel), then the 0.5 prior. Mirrors the live writer.
    const rawProb =
      bet.pricePerShare != null
        ? parseFloat(String(bet.pricePerShare))
        : bet.confidence != null
          ? parseFloat(String(bet.confidence))
          : 0.5;
    const conf = Number.isFinite(rawProb) ? Math.min(1, Math.max(0, rawProb)) : 0.5;
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

  const rows = Array.from(aggByKey.values());
  console.log(
    `[backfill] Aggregated ${scannedBets} scored buys into ${rows.length} (agent x week) rows ` +
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
