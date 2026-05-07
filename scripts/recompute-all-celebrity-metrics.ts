#!/usr/bin/env npx tsx
/**
 * One-shot remediation: recompute celebrity_metrics for every tracked
 * person using the corrected (non-double-counting) recompute logic.
 *
 * Background: prior to the fix in
 * server/services/celebrity-metrics-recompute.ts, recompute summed
 * `seed_approval_count` ON TOP of `COUNT(user_votes)`, but seed votes are
 * already physically stored in user_votes. Any celebrity whose recompute
 * was the most recent writer of `celebrity_metrics` therefore has an
 * inflated `approval_votes_count` (off by exactly seed_approval_count) and
 * a slightly distorted `approval_avg_rating`.
 *
 * Run once after deploying the fix:
 *   npx tsx scripts/recompute-all-celebrity-metrics.ts          # dry-run
 *   npx tsx scripts/recompute-all-celebrity-metrics.ts --apply  # write
 *
 * Requires the same DATABASE_URL / Supabase env as the server. Idempotent
 * (safe to re-run).
 */

import { db } from "../server/db";
import { celebrityMetrics, trackedPeople } from "@shared/schema";
import { eq } from "drizzle-orm";
import { recomputeCelebrityMetrics } from "../server/services/celebrity-metrics-recompute";

function hasFlag(name: string): boolean {
  return process.argv.includes(`--${name}`);
}

type BeforeRow = {
  approvalVotesCount: number | null;
  approvalAvgRating: number | null;
  seedApprovalCount: number | null;
};

async function readMetrics(celebrityId: string): Promise<BeforeRow | null> {
  const [row] = await db
    .select({
      approvalVotesCount: celebrityMetrics.approvalVotesCount,
      approvalAvgRating: celebrityMetrics.approvalAvgRating,
      seedApprovalCount: celebrityMetrics.seedApprovalCount,
    })
    .from(celebrityMetrics)
    .where(eq(celebrityMetrics.celebrityId, celebrityId))
    .limit(1);
  return row ?? null;
}

function fmtAvg(v: number | null | undefined): string {
  if (v == null) return "—";
  return v.toFixed(3);
}

async function main() {
  const apply = hasFlag("apply");
  const mode = apply ? "APPLY" : "DRY-RUN";
  console.log(`[recompute-all] mode=${mode} starting…`);

  const people = await db
    .select({ id: trackedPeople.id, name: trackedPeople.name })
    .from(trackedPeople);

  console.log(`[recompute-all] tracked_people count=${people.length}`);

  let processed = 0;
  let changed = 0;
  let failed = 0;

  for (const person of people) {
    processed++;
    try {
      const before = await readMetrics(person.id);

      if (!apply) {
        // Dry-run: just report what is currently cached. We do not call
        // recompute in dry-run because it would write the corrected value
        // immediately. To estimate the would-be delta without writing,
        // recompute reads user_votes anyway — but writing is the side
        // effect we want to gate on --apply, so dry-run only inventories.
        if (before && (before.seedApprovalCount ?? 0) > 0) {
          console.log(
            `  [dry] ${person.id} ${person.name} | cached count=${before.approvalVotesCount} avg=${fmtAvg(before.approvalAvgRating)} seed=${before.seedApprovalCount}`,
          );
        }
        continue;
      }

      await recomputeCelebrityMetrics(person.id);
      const after = await readMetrics(person.id);

      const beforeCnt = before?.approvalVotesCount ?? 0;
      const afterCnt = after?.approvalVotesCount ?? 0;
      const beforeAvg = before?.approvalAvgRating ?? null;
      const afterAvg = after?.approvalAvgRating ?? null;

      const cntDelta = afterCnt - beforeCnt;
      const avgChanged =
        (beforeAvg == null) !== (afterAvg == null) ||
        (beforeAvg != null &&
          afterAvg != null &&
          Math.abs(beforeAvg - afterAvg) > 1e-6);

      if (cntDelta !== 0 || avgChanged) {
        changed++;
        console.log(
          `  [fix] ${person.id} ${person.name} | count ${beforeCnt} -> ${afterCnt} (Δ${cntDelta >= 0 ? "+" : ""}${cntDelta}) | avg ${fmtAvg(beforeAvg)} -> ${fmtAvg(afterAvg)} | seed=${after?.seedApprovalCount ?? 0}`,
        );
      }
    } catch (err) {
      failed++;
      console.error(
        `  [error] ${person.id} ${person.name} recompute failed:`,
        err instanceof Error ? err.message : err,
      );
    }
  }

  console.log(
    `[recompute-all] done. mode=${mode} processed=${processed} changed=${changed} failed=${failed}`,
  );

  if (!apply) {
    console.log(
      "[recompute-all] dry-run only — re-run with --apply to write corrected metrics.",
    );
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("[recompute-all] fatal:", err);
    process.exit(1);
  });
