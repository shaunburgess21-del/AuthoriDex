/**
 * One-off backfill: canonicalize category strings on tracked_people and trending_people
 * to Title Case display labels (via getMarketCategoryLabel).
 *
 * Usage:
 *   npx tsx --env-file=.env server/scripts/normalize-people-categories.ts
 *   npx tsx --env-file=.env server/scripts/normalize-people-categories.ts --dry-run
 */

import { db, pool } from "../db";
import { inductionCandidates, trackedPeople, trendingPeople } from "@shared/schema";
import { canonicalizePersonCategory } from "@shared/constants";
import { eq, sql } from "drizzle-orm";

const dryRun = process.argv.includes("--dry-run");

async function distinctCategories(table: "tracked" | "trending") {
  if (table === "tracked") {
    return db
      .select({
        category: trackedPeople.category,
        n: sql<number>`count(*)::int`,
      })
      .from(trackedPeople)
      .groupBy(trackedPeople.category)
      .orderBy(trackedPeople.category);
  }
  return db
    .select({
      category: trendingPeople.category,
      n: sql<number>`count(*)::int`,
    })
    .from(trendingPeople)
    .where(sql`${trendingPeople.category} is not null`)
    .groupBy(trendingPeople.category)
    .orderBy(trendingPeople.category);
}

async function backfillInductionCandidates() {
  const rows = await db
    .select({ id: inductionCandidates.id, category: inductionCandidates.category })
    .from(inductionCandidates);

  let updated = 0;
  for (const row of rows) {
    const next = canonicalizePersonCategory(row.category);
    if (!next || next === row.category) continue;
    if (!dryRun) {
      await db
        .update(inductionCandidates)
        .set({ category: next })
        .where(eq(inductionCandidates.id, row.id));
    }
    updated++;
  }
  return { scanned: rows.length, updated };
}

async function backfillTable(table: "tracked" | "trending") {
  const rows =
    table === "tracked"
      ? await db
          .select({ id: trackedPeople.id, category: trackedPeople.category })
          .from(trackedPeople)
      : await db
          .select({ id: trendingPeople.id, category: trendingPeople.category })
          .from(trendingPeople)
          .where(sql`${trendingPeople.category} is not null`);

  let updated = 0;
  for (const row of rows) {
    const next = canonicalizePersonCategory(row.category);
    if (!next || next === row.category) continue;
    if (!dryRun) {
      if (table === "tracked") {
        await db
          .update(trackedPeople)
          .set({ category: next })
          .where(eq(trackedPeople.id, row.id));
      } else {
        await db
          .update(trendingPeople)
          .set({ category: next })
          .where(eq(trendingPeople.id, row.id));
      }
    }
    updated++;
  }
  return { scanned: rows.length, updated };
}

async function main() {
  console.log("[normalize-people-categories] dryRun:", dryRun);

  console.log("\n--- tracked_people categories (before) ---");
  console.table(await distinctCategories("tracked"));

  console.log("\n--- trending_people categories (before) ---");
  console.table(await distinctCategories("trending"));

  const tracked = await backfillTable("tracked");
  const trending = await backfillTable("trending");
  const induction = await backfillInductionCandidates();

  console.log("\n[normalize-people-categories] tracked_people:", tracked);
  console.log("[normalize-people-categories] trending_people:", trending);
  console.log("[normalize-people-categories] induction_candidates:", induction);

  if (!dryRun) {
    console.log("\n--- tracked_people categories (after) ---");
    console.table(await distinctCategories("tracked"));

    console.log("\n--- trending_people categories (after) ---");
    console.table(await distinctCategories("trending"));
  }

  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
