/**
 * One-shot: regenerate profiles missing source_hash or on stale prompt_version.
 *
 * Two entry points:
 *   - CLI: `npx tsx server/backfill-profile-metadata.ts`
 *   - HTTP: `POST /api/cron/backfill-profile-metadata` (CRON_SECRET bearer)
 *
 * Unlike the regular celebrity-profile cron (top_leaderboard only), this one
 * covers EVERY profile row needing metadata catch-up, so it should only be
 * run after a schema bump or prompt-version increment.
 */
import { db } from "./db";
import { celebrityProfiles, trackedPeople } from "@shared/schema";
import { eq, or, isNull, lt } from "drizzle-orm";
import {
  getOrGenerateCelebrityProfile,
  PROFILE_PROMPT_VERSION,
} from "./services/profile-generator";
import { toTrendingPerson } from "./jobs/celebrity-profile-cron";

const BATCH_SIZE = 5;
const BATCH_DELAY_MS = 2000;

export interface ProfileBackfillResult {
  candidates: number;
  ok: number;
  failed: number;
  failedNames: string[];
  durationMs: number;
}

export async function runProfileMetadataBackfill(): Promise<ProfileBackfillResult> {
  const startTime = Date.now();
  const rows = await db
    .select({ person: trackedPeople, profile: celebrityProfiles })
    .from(celebrityProfiles)
    .innerJoin(trackedPeople, eq(trackedPeople.id, celebrityProfiles.personId))
    .where(
      or(
        isNull(celebrityProfiles.sourceHash),
        lt(celebrityProfiles.promptVersion, PROFILE_PROMPT_VERSION),
      ),
    );

  console.log(`[Backfill] ${rows.length} profiles need metadata refresh`);

  let ok = 0;
  let failed = 0;
  const failedNames: string[] = [];

  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const batch = rows.slice(i, i + BATCH_SIZE);
    await Promise.all(
      batch.map(async ({ person }) => {
        try {
          const result = await getOrGenerateCelebrityProfile(toTrendingPerson(person), {
            forceRefresh: true,
          });
          ok++;
          console.log(`  ✓ ${person.name} (${result.cacheStatus})`);
        } catch (err: any) {
          failed++;
          failedNames.push(`${person.name}: ${err.message}`);
          console.error(`  ✗ ${person.name}: ${err.message}`);
        }
      }),
    );
    if (i + BATCH_SIZE < rows.length) {
      await new Promise((r) => setTimeout(r, BATCH_DELAY_MS));
    }
  }

  const durationMs = Date.now() - startTime;
  console.log(`[Backfill] Done. success=${ok} failed=${failed} duration=${durationMs}ms`);
  return {
    candidates: rows.length,
    ok,
    failed,
    failedNames: failedNames.slice(0, 20),
    durationMs,
  };
}

// CLI entry point — only runs when invoked directly (not when imported).
const isMain = (() => {
  try {
    // Works for `tsx` / Node ESM; falls back to false in bundlers.
    const argv1 = process.argv[1] ?? "";
    return argv1.includes("backfill-profile-metadata");
  } catch {
    return false;
  }
})();

if (isMain) {
  runProfileMetadataBackfill()
    .then((r) => process.exit(r.failed > 0 ? 1 : 0))
    .catch((err) => {
      console.error("[Backfill] Fatal:", err);
      process.exit(1);
    });
}
