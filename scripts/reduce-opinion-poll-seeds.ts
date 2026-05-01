#!/usr/bin/env npx tsx
/**
 * Reduce opinion poll option seed counts by 90% (keep 10%).
 * Preserves relative weighting between options within each poll.
 *
 * Usage:
 *   npx tsx --env-file=.env scripts/reduce-opinion-poll-seeds.ts --dry-run
 *   npx tsx --env-file=.env scripts/reduce-opinion-poll-seeds.ts --apply
 */

import { db } from "../server/db";
import { opinionPollOptions, opinionPolls } from "../shared/schema";
import { eq } from "drizzle-orm";

const APPLY = process.argv.includes("--apply");
const DRY_RUN = !APPLY;

async function main() {
  console.log(`[ReduceOpinionSeeds] mode: ${DRY_RUN ? "DRY-RUN" : "APPLY"}`);

  const options = await db
    .select({
      id: opinionPollOptions.id,
      pollId: opinionPollOptions.pollId,
      name: opinionPollOptions.name,
      seedCount: opinionPollOptions.seedCount,
    })
    .from(opinionPollOptions);

  const polls = await db
    .select({ id: opinionPolls.id, title: opinionPolls.title })
    .from(opinionPolls);

  const pollNameMap = new Map(polls.map((p) => [p.id, p.title]));

  console.log(
    `[ReduceOpinionSeeds] Found ${options.length} options across ${polls.length} polls\n`,
  );

  let updated = 0;
  let skipped = 0;

  // Group by poll for readable output
  const byPoll = new Map<string, typeof options>();
  for (const opt of options) {
    const arr = byPoll.get(opt.pollId) || [];
    arr.push(opt);
    byPoll.set(opt.pollId, arr);
  }

  for (const [pollId, pollOptions] of byPoll) {
    const pollName = pollNameMap.get(pollId) ?? pollId.substring(0, 8);
    console.log(`  [${pollName}]`);

    for (const opt of pollOptions) {
      if (opt.seedCount === 0) {
        skipped++;
        continue;
      }

      let newSeed = Math.round(opt.seedCount * 0.1);
      if (newSeed === 0 && opt.seedCount > 0) newSeed = 1;

      console.log(
        `    "${opt.name}" : ${opt.seedCount} → ${newSeed}`,
      );

      if (!DRY_RUN) {
        await db
          .update(opinionPollOptions)
          .set({ seedCount: newSeed })
          .where(eq(opinionPollOptions.id, opt.id));
      }

      updated++;
    }
  }

  console.log(
    `\n[ReduceOpinionSeeds] Done. Updated: ${updated}, Skipped (0 seeds): ${skipped}`,
  );
  if (DRY_RUN) {
    console.log("[ReduceOpinionSeeds] DRY-RUN complete. Pass --apply to write.");
  } else {
    console.log("[ReduceOpinionSeeds] All option seeds reduced by 90%.");
  }

  process.exit(0);
}

main().catch((err) => {
  console.error("[ReduceOpinionSeeds] fatal:", err);
  process.exit(1);
});
