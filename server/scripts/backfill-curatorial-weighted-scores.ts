/**
 * One-time backfill for the Phase 3 curatorial-weight redesign.
 *
 * `db:push` adds `weighted_score` to `induction_candidates` and
 * `celebrity_images` with a default of 0. For existing rows that already
 * carry vote history, weighted_score must be seeded from the raw counts
 * (every historical vote is treated as weight 1.0) so the new weighted
 * winner selection doesn't ignore pre-redesign votes.
 *
 * Per-vote `weight` columns (`induction_votes.weight`, `image_votes.weight`)
 * default to 1.0, which is already correct for historical rows — no
 * backfill needed there.
 *
 * Idempotent: only touches rows whose weighted_score is still 0 while a
 * positive raw count exists, so re-running after live weighted votes have
 * accumulated will not clobber them.
 *
 * Run once after `npm run db:push`:
 *   npx tsx server/scripts/backfill-curatorial-weighted-scores.ts
 */
import { sql } from "drizzle-orm";
import { db } from "../db";
import { inductionCandidates, celebrityImages } from "@shared/schema";

async function main() {
  const candidates = await db
    .update(inductionCandidates)
    .set({ weightedScore: sql`${inductionCandidates.seedVotes}` })
    .where(
      sql`${inductionCandidates.weightedScore} = 0 AND ${inductionCandidates.seedVotes} > 0`,
    )
    .returning({ id: inductionCandidates.id });

  const images = await db
    .update(celebrityImages)
    .set({ weightedScore: sql`${celebrityImages.votesUp}` })
    .where(
      sql`${celebrityImages.weightedScore} = 0 AND ${celebrityImages.votesUp} > 0`,
    )
    .returning({ id: celebrityImages.id });

  console.log(
    `[backfill] curatorial weighted_score seeded: ` +
      `${candidates.length} induction candidate(s), ${images.length} celebrity image(s).`,
  );
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("[backfill] failed:", err);
    process.exit(1);
  });
