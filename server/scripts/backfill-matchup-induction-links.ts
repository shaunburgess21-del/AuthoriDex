/**
 * Backfill face_offs so induction-queue option sides are linked via person_a_id /
 * person_b_id and stored matchup-bucket image URLs are cleared.
 *
 * Usage:
 *   npx tsx --env-file=.env server/scripts/backfill-matchup-induction-links.ts --dry-run
 *   npx tsx --env-file=.env server/scripts/backfill-matchup-induction-links.ts
 */

import { db, pool } from "../db";
import { matchups } from "@shared/schema";
import { eq } from "drizzle-orm";
import {
  applyInductionMatchupSideLinks,
  buildInductionPersonIdByName,
  resolveInductionMatchupSideLink,
} from "../services/matchup-person-link";

const dryRun = process.argv.includes("--dry-run");

type SideChange = {
  side: "A" | "B";
  optionText: string;
  oldPersonId: string | null;
  newPersonId: string | null;
  clearedImage: boolean;
  linked: boolean;
};

async function main() {
  console.log(`[backfill-matchup-induction-links] dryRun=${dryRun}`);

  const inductionMap = await buildInductionPersonIdByName();
  console.log(`[backfill-matchup-induction-links] Induction name map: ${inductionMap.size} entries`);

  const allMatchups = await db.select().from(matchups);

  let rowsTouched = 0;
  let sidesLinked = 0;
  let imagesCleared = 0;
  let skippedNoChange = 0;

  for (const m of allMatchups) {
    const normalized = applyInductionMatchupSideLinks(
      {
        optionAText: m.optionAText,
        optionBText: m.optionBText,
        personAId: m.personAId,
        personBId: m.personBId,
        optionAImage: m.optionAImage,
        optionBImage: m.optionBImage,
      },
      inductionMap,
    );

    const changes: SideChange[] = [];

    const linkA = resolveInductionMatchupSideLink(m.optionAText, m.personAId, inductionMap);
    const linkB = resolveInductionMatchupSideLink(m.optionBText, m.personBId, inductionMap);

    if (normalized.personAId !== m.personAId || normalized.optionAImage !== m.optionAImage) {
      changes.push({
        side: "A",
        optionText: m.optionAText,
        oldPersonId: m.personAId,
        newPersonId: normalized.personAId,
        clearedImage: (m.optionAImage ?? null) !== null && normalized.optionAImage === null,
        linked: linkA.linked,
      });
    }
    if (normalized.personBId !== m.personBId || normalized.optionBImage !== m.optionBImage) {
      changes.push({
        side: "B",
        optionText: m.optionBText,
        oldPersonId: m.personBId,
        newPersonId: normalized.personBId,
        clearedImage: (m.optionBImage ?? null) !== null && normalized.optionBImage === null,
        linked: linkB.linked,
      });
    }

    if (changes.length === 0) {
      skippedNoChange++;
      continue;
    }

    rowsTouched++;
    for (const c of changes) {
      if (c.linked && c.newPersonId && c.oldPersonId !== c.newPersonId) sidesLinked++;
      if (c.clearedImage) imagesCleared++;
      console.log(
        `  ${m.slug ?? m.id} [${c.side}] "${c.optionText}": ` +
          `person ${c.oldPersonId?.slice(0, 8) ?? "null"} → ${c.newPersonId?.slice(0, 8) ?? "null"}` +
          (c.clearedImage ? " | image cleared" : ""),
      );
    }

    if (!dryRun) {
      await db
        .update(matchups)
        .set({
          personAId: normalized.personAId,
          personBId: normalized.personBId,
          optionAImage: normalized.optionAImage,
          optionBImage: normalized.optionBImage,
        })
        .where(eq(matchups.id, m.id));
    }
  }

  console.log("\n[backfill-matchup-induction-links] Summary:");
  console.log(`  Matchups scanned: ${allMatchups.length}`);
  console.log(`  Rows updated: ${rowsTouched}`);
  console.log(`  Sides newly linked: ${sidesLinked}`);
  console.log(`  Stored images cleared: ${imagesCleared}`);
  console.log(`  Unchanged: ${skippedNoChange}`);
  if (dryRun) {
    console.log("\n  Dry run — no writes. Re-run without --dry-run to apply.");
  }

  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
