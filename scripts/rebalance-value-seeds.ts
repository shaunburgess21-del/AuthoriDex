#!/usr/bin/env npx tsx
/**
 * Rebalance Overrated/Underrated seed votes.
 *
 * Group A (existing seeds > 0):
 *   - Reduce total by 95%, minimum 3.
 *   - Redistribute with ~15-25% going to fairly-rated,
 *     remainder split to keep a similar underrated/overrated ratio.
 *
 * Group B (existing seeds = 0):
 *   - Assign random total between 8 and 35.
 *   - Split across underrated (50-65%), overrated (15-30%), fairly-rated (15-25%).
 *
 * Usage:
 *   npx tsx scripts/rebalance-value-seeds.ts --dry-run
 *   npx tsx scripts/rebalance-value-seeds.ts --apply
 */

import { db } from "../server/db";
import { celebrityMetrics } from "../shared/schema";
import { eq } from "drizzle-orm";
import { recomputeCelebrityMetrics } from "../server/services/celebrity-metrics-recompute";

const APPLY = process.argv.includes("--apply");
const DRY_RUN = !APPLY;

function hashCode(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = (Math.imul(31, h) + s.charCodeAt(i)) | 0;
  }
  return Math.abs(h);
}

function seededRandom(seed: number): number {
  const x = Math.sin(seed + 1) * 10000;
  return x - Math.floor(x);
}

function clamp(v: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, v));
}

function splitThreeWay(
  total: number,
  pctA: number,
  pctB: number,
): [number, number, number] {
  const a = Math.max(1, Math.round(total * pctA));
  const b = Math.max(1, Math.round(total * pctB));
  const c = Math.max(1, total - a - b);
  const sum = a + b + c;
  if (sum !== total) {
    return [a, b, total - a - b > 0 ? total - a - b : 1];
  }
  return [a, b, c];
}

async function main() {
  console.log(`[RebalanceSeeds] mode: ${DRY_RUN ? "DRY-RUN" : "APPLY"}`);

  const rows = await db
    .select({
      celebrityId: celebrityMetrics.celebrityId,
      seedUnderrated: celebrityMetrics.seedUnderratedCount,
      seedOverrated: celebrityMetrics.seedOverratedCount,
      seedFairly: celebrityMetrics.seedFairlyRatedCount,
    })
    .from(celebrityMetrics);

  console.log(`[RebalanceSeeds] Found ${rows.length} celebrity_metrics rows\n`);

  let groupA = 0;
  let groupB = 0;

  for (const row of rows) {
    const oldTotal =
      row.seedUnderrated + row.seedOverrated + row.seedFairly;
    const h = hashCode(row.celebrityId);

    let newUnder: number;
    let newOver: number;
    let newFairly: number;

    if (oldTotal > 0) {
      // Group A: reduce by 95%, redistribute with fairly-rated injection
      groupA++;
      const reducedTotal = Math.max(3, Math.round(oldTotal * 0.05));

      const fairlyPct = 0.15 + seededRandom(h) * 0.10; // 15-25%
      const remaining = 1 - fairlyPct;

      // Preserve original underrated/overrated ratio for the non-fairly portion
      const origUnderRatio =
        row.seedUnderrated + row.seedOverrated > 0
          ? row.seedUnderrated / (row.seedUnderrated + row.seedOverrated)
          : 0.6;
      const underPct = remaining * origUnderRatio;
      const overPct = remaining * (1 - origUnderRatio);

      [newUnder, newOver, newFairly] = splitThreeWay(
        reducedTotal,
        underPct,
        overPct,
      );
    } else {
      // Group B: assign 8-35 random seeds
      groupB++;
      const total = 8 + Math.floor(seededRandom(h * 7) * 28); // 8..35

      const underPct = 0.50 + seededRandom(h * 3) * 0.15; // 50-65%
      const overPct = 0.15 + seededRandom(h * 5) * 0.15; // 15-30%

      [newUnder, newOver, newFairly] = splitThreeWay(
        total,
        clamp(underPct, 0.1, 0.85),
        clamp(overPct, 0.1, 0.85),
      );
    }

    const newTotal = newUnder + newOver + newFairly;
    const tag = oldTotal > 0 ? "A" : "B";
    console.log(
      `  [${tag}] ${row.celebrityId.substring(0, 8)}… ` +
        `old=${oldTotal} (U${row.seedUnderrated}/O${row.seedOverrated}/F${row.seedFairly}) → ` +
        `new=${newTotal} (U${newUnder}/O${newOver}/F${newFairly})`,
    );

    if (!DRY_RUN) {
      await db
        .update(celebrityMetrics)
        .set({
          seedUnderratedCount: newUnder,
          seedOverratedCount: newOver,
          seedFairlyRatedCount: newFairly,
        })
        .where(eq(celebrityMetrics.celebrityId, row.celebrityId));

      await recomputeCelebrityMetrics(row.celebrityId);
    }
  }

  console.log(
    `\n[RebalanceSeeds] Done. Group A (reduced): ${groupA}, Group B (new seeds): ${groupB}`,
  );
  if (DRY_RUN) {
    console.log("[RebalanceSeeds] DRY-RUN complete. Pass --apply to write.");
  } else {
    console.log("[RebalanceSeeds] All rows updated and recomputed.");
  }

  process.exit(0);
}

main().catch((err) => {
  console.error("[RebalanceSeeds] fatal:", err);
  process.exit(1);
});
