/**
 * One-shot: regenerate profiles missing source_hash or on stale prompt_version.
 * Run: npx tsx server/backfill-profile-metadata.ts
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

async function main() {
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
  let fail = 0;

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
          fail++;
          console.error(`  ✗ ${person.name}: ${err.message}`);
        }
      }),
    );
    if (i + BATCH_SIZE < rows.length) {
      await new Promise((r) => setTimeout(r, BATCH_DELAY_MS));
    }
  }

  console.log(`[Backfill] Done. success=${ok} failed=${fail}`);
  process.exit(fail > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error("[Backfill] Fatal:", err);
  process.exit(1);
});
