/**
 * Repair orphan-"Other" source-anchor desync on specific Emmy World Markets.
 *
 * Root cause: admin edit toggled "Other" on without syncing
 * metadata.source.outcomeMapping / price vectors. Agents then abstain
 * under WORLD_MARKETS_LLM_ASSESSMENTS_ENABLED=false.
 *
 * For each allowlisted market:
 *   1. Abort if any market_bets reference the Other entry (cascade would
 *      silently delete history).
 *   2. Drop Other from market_amm_state.share_quantities + outcome_order.
 *   3. Delete the Other market_entries row.
 *
 * Usage:
 *   npx tsx --env-file=.env server/scripts/repair-world-market-anchor.ts
 *   npx tsx --env-file=.env server/scripts/repair-world-market-anchor.ts --apply
 *
 * Default is DRY-RUN (no DB writes). Pass --apply to persist.
 */

import { and, asc, eq, sql } from "drizzle-orm";
import { db, pool } from "../db";
import {
  marketAmmState,
  marketBets,
  marketEntries,
  predictionMarkets,
} from "@shared/schema";
import { isOtherStyleOutcomeLabel } from "@shared/lib/other-outcome";
import { readSourceFairByEntryId } from "../agents/sourceFair";

const args = process.argv.slice(2);
const applyMode = args.includes("--apply");

/** Explicit allowlist — never touch open-field markets like Billboard. */
const MARKET_IDS = [
  "786edebc-310b-4f20-92af-1d777dc497f0", // Emmy Outstanding Variety Series
  "f278c683-a290-4433-b774-09dc421a4cc9", // Emmy Outstanding Limited/Anthology
  "5ba0456c-422b-4bf6-a804-8cea8136739d", // Emmy Outstanding Comedy Series
  "27316915-5403-4cbb-b205-4d1d5bf9a31f", // Emmy Supporting Actress Limited
] as const;

async function shutdown(code: number) {
  try {
    await pool.end();
  } catch {
    /* ignore — Windows can assert on late handle close */
  }
  process.exit(code);
}

function mappingLength(metadata: unknown): number {
  if (!metadata || typeof metadata !== "object") return 0;
  const source = (metadata as Record<string, unknown>).source;
  if (!source || typeof source !== "object") return 0;
  const mapping = (source as Record<string, unknown>).outcomeMapping;
  return Array.isArray(mapping) ? mapping.length : 0;
}

function importPricesLength(metadata: unknown): number {
  if (!metadata || typeof metadata !== "object") return 0;
  const source = (metadata as Record<string, unknown>).source;
  if (!source || typeof source !== "object") return 0;
  const prices = (source as Record<string, unknown>).pricesAtImport;
  return Array.isArray(prices) ? prices.length : 0;
}

async function main() {
  console.log(
    `[Repair World Market Anchor] Mode: ${applyMode ? "APPLY" : "DRY-RUN"}`,
  );
  console.log(`[Repair] Allowlist: ${MARKET_IDS.length} markets`);

  let repaired = 0;
  let skipped = 0;
  let failed = 0;

  for (const marketId of MARKET_IDS) {
    const [market] = await db
      .select({
        id: predictionMarkets.id,
        title: predictionMarkets.title,
        status: predictionMarkets.status,
        visibility: predictionMarkets.visibility,
        metadata: predictionMarkets.metadata,
      })
      .from(predictionMarkets)
      .where(eq(predictionMarkets.id, marketId))
      .limit(1);

    if (!market) {
      console.error(`\n[${marketId.slice(0, 8)}] NOT FOUND — skip`);
      failed += 1;
      continue;
    }

    console.log(`\n[${marketId.slice(0, 8)}] ${market.title}`);
    console.log(`  status=${market.status} visibility=${market.visibility}`);

    const entries = await db
      .select({
        id: marketEntries.id,
        label: marketEntries.label,
        displayOrder: marketEntries.displayOrder,
      })
      .from(marketEntries)
      .where(eq(marketEntries.marketId, marketId))
      .orderBy(asc(marketEntries.displayOrder));

    const otherEntries = entries.filter((e) => isOtherStyleOutcomeLabel(e.label));
    const mapN = mappingLength(market.metadata);
    const importN = importPricesLength(market.metadata);

    console.log(
      `  entries=${entries.length} mapping=${mapN} pricesAtImport=${importN} otherEntries=${otherEntries.length}`,
    );

    if (otherEntries.length !== 1) {
      console.log(`  → SKIP: expected exactly 1 Other entry, found ${otherEntries.length}`);
      skipped += 1;
      continue;
    }
    if (entries.length !== mapN + 1) {
      console.log(
        `  → SKIP: expected entries = mapping + 1 (${mapN + 1}), got ${entries.length}`,
      );
      skipped += 1;
      continue;
    }

    const other = otherEntries[0];
    console.log(`  Other entry: ${other.id} (order=${other.displayOrder})`);

    const [{ betCount }] = await db
      .select({ betCount: sql<number>`count(*)::int` })
      .from(marketBets)
      .where(eq(marketBets.entryId, other.id));

    if (betCount > 0) {
      console.error(
        `  → ABORT: ${betCount} market_bets reference Other — refusing delete (cascade risk)`,
      );
      failed += 1;
      continue;
    }
    console.log(`  bets on Other: 0 (ok)`);

    const [amm] = await db
      .select({
        outcomeOrder: marketAmmState.outcomeOrder,
        shareQuantities: marketAmmState.shareQuantities,
      })
      .from(marketAmmState)
      .where(eq(marketAmmState.marketId, marketId))
      .limit(1);

    if (!amm) {
      console.error(`  → ABORT: missing market_amm_state row`);
      failed += 1;
      continue;
    }

    const order = (amm.outcomeOrder as string[] | null) ?? [];
    const shares = (amm.shareQuantities as Record<string, number> | null) ?? {};
    const otherShares = Number(shares[other.id] ?? 0);
    console.log(
      `  AMM: outcome_order_n=${order.length} other_in_order=${order.includes(other.id)} other_shares=${otherShares}`,
    );

    if (otherShares !== 0) {
      console.error(`  → ABORT: Other has non-zero share quantity (${otherShares})`);
      failed += 1;
      continue;
    }

    const nextOrder = order.filter((id) => id !== other.id);
    const nextShares = { ...shares };
    delete nextShares[other.id];

    const remainingEntries = entries.filter((e) => e.id !== other.id);
    const postFair = readSourceFairByEntryId(
      market.metadata,
      remainingEntries.map((e) => ({ id: e.id, label: e.label })),
    );
    console.log(
      `  post-repair preview: entries=${remainingEntries.length} mapping=${mapN} anchor=${postFair ? postFair.anchor : "NULL"}`,
    );
    if (!postFair) {
      // Tolerant reader should heal orphan Other, but after delete lengths
      // match so happy-path must work. Abort apply if preview fails.
      console.error(`  → ABORT: readSourceFairByEntryId would still return null after repair`);
      failed += 1;
      continue;
    }
    if (remainingEntries.length !== mapN || remainingEntries.length !== importN) {
      console.error(
        `  → ABORT: post lengths would not align (entries=${remainingEntries.length} mapping=${mapN} import=${importN})`,
      );
      failed += 1;
      continue;
    }

    if (!applyMode) {
      console.log(`  → DRY-RUN would: drop Other from AMM state + delete entry ${other.id}`);
      repaired += 1;
      continue;
    }

    try {
      await db.transaction(async (tx) => {
        // Re-check bets inside the transaction.
        const [{ liveBets }] = await tx
          .select({ liveBets: sql<number>`count(*)::int` })
          .from(marketBets)
          .where(eq(marketBets.entryId, other.id));
        if (liveBets > 0) {
          throw new Error(`Other entry gained ${liveBets} bets mid-repair`);
        }

        await tx
          .update(marketAmmState)
          .set({
            outcomeOrder: nextOrder,
            shareQuantities: nextShares,
            updatedAt: new Date(),
          })
          .where(eq(marketAmmState.marketId, marketId));

        await tx
          .delete(marketEntries)
          .where(
            and(eq(marketEntries.id, other.id), eq(marketEntries.marketId, marketId)),
          );
      });

      // Verify post-state.
      const verifyEntries = await db
        .select({
          id: marketEntries.id,
          label: marketEntries.label,
        })
        .from(marketEntries)
        .where(eq(marketEntries.marketId, marketId));
      const [verifyMarket] = await db
        .select({ metadata: predictionMarkets.metadata })
        .from(predictionMarkets)
        .where(eq(predictionMarkets.id, marketId))
        .limit(1);
      const fair = readSourceFairByEntryId(
        verifyMarket?.metadata,
        verifyEntries.map((e) => ({ id: e.id, label: e.label })),
      );
      const vMap = mappingLength(verifyMarket?.metadata);
      console.log(
        `  → WROTE: entries=${verifyEntries.length} mapping=${vMap} anchor=${fair ? fair.anchor : "NULL"}`,
      );
      if (!fair || verifyEntries.length !== vMap) {
        throw new Error("post-repair verification failed");
      }
      repaired += 1;
    } catch (err) {
      failed += 1;
      console.error(
        `  → FAILED: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  console.log("\n[Repair] Done.");
  console.log(
    `  repaired=${repaired} skipped=${skipped} failed=${failed} mode=${applyMode ? "APPLY" : "DRY-RUN"}`,
  );
  if (failed > 0) await shutdown(1);
}

main()
  .then(() => shutdown(0))
  .catch(async (err) => {
    console.error("[Repair] Fatal:", err);
    await shutdown(1);
  });
