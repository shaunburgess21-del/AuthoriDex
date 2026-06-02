/**
 * Backfill tracked_people induction shadows from induction_candidates metadata,
 * then remove stale induction shadows (no active matching candidate row).
 *
 * Usage:
 *   npx tsx --env-file=.env server/scripts/backfill-induction-shadow-sync.ts
 *   npx tsx --env-file=.env server/scripts/backfill-induction-shadow-sync.ts --dry-run
 */

import { db, pool } from "../db";
import {
  backfillAllInductionShadowsFromCandidates,
  removeOrphanInductionShadows,
} from "../services/induction-sync";
import { trackedPeople, inductionCandidates } from "@shared/schema";
import { eq, sql } from "drizzle-orm";

const dryRun = process.argv.includes("--dry-run");

async function counts() {
  const [tp] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(trackedPeople)
    .where(eq(trackedPeople.status, "induction"));
  const [ic] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(inductionCandidates)
    .where(eq(inductionCandidates.isActive, true));
  return { trackedInduction: tp?.n ?? 0, activeCandidates: ic?.n ?? 0 };
}

async function main() {
  const before = await counts();
  console.log("[backfill-induction-shadow] Before:", before);

  if (dryRun) {
    console.log("[backfill-induction-shadow] Dry run — no writes.");
    await pool.end();
    return;
  }

  const backfill = await backfillAllInductionShadowsFromCandidates();
  console.log("[backfill-induction-shadow] Backfill:", backfill);

  const orphans = await removeOrphanInductionShadows();
  console.log("[backfill-induction-shadow] Orphans removed:", orphans);

  const after = await counts();
  console.log("[backfill-induction-shadow] After:", after);

  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
