/**
 * One-shot backfill: refresh estimated net worth for main-leaderboard
 * profiles currently stored as unavailable ("Not available", etc.).
 *
 * Strategy (balanced cost vs coverage):
 *  1. Try Serper-only extraction with the broadened query/tiered rules.
 *  2. If Serper still cannot write a figure, force a full profile
 *     regeneration so OpenAI web-search augmentation can fill gaps.
 *
 * Idempotent: rows that already have a dollar estimate are skipped.
 * Safe to re-run — only unavailable sentinels are selected.
 *
 * Usage:
 *   npm run backfill:missing-net-worth
 *   npx tsx --env-file=.env server/scripts/backfill-missing-net-worth.ts
 */

import { and, eq, sql } from "drizzle-orm";
import { celebrityProfiles, trackedPeople, type TrackedPerson, type TrendingPerson } from "@shared/schema";
import { db } from "../db";
import { refreshNetWorth } from "../services/net-worth-refresher";
import { getOrGenerateCelebrityProfile } from "../services/profile-generator";

const BATCH_SIZE = 3;
const BATCH_DELAY_MS = 2500;

const UNAVAILABLE_SQL = sql`lower(${celebrityProfiles.estimatedNetWorth}) ~ '(not available|unavailable|unknown|^n/a$|no reliable estimate)'`;

function toTrendingPerson(person: TrackedPerson): TrendingPerson {
  return {
    id: person.id,
    name: person.name,
    avatar: person.avatar ?? null,
    bio: person.bio ?? null,
    rank: person.displayOrder || 9999,
    trendScore: 0,
    fameIndex: 0,
    fameIndexLive: null,
    liveRank: null,
    liveUpdatedAt: null,
    liveDampen: null,
    change24h: null,
    change7d: null,
    category: person.category,
    secondaryCategories: person.secondaryCategories ?? [],
    profileViews10m: null,
  };
}

function isUnavailable(value: string | null | undefined): boolean {
  if (!value) return true;
  return /\b(not available|unavailable|unknown|n\/a|no reliable estimate)\b/i.test(value);
}

async function main() {
  const rows = await db
    .select({
      person: trackedPeople,
      estimatedNetWorth: celebrityProfiles.estimatedNetWorth,
    })
    .from(celebrityProfiles)
    .innerJoin(trackedPeople, eq(trackedPeople.id, celebrityProfiles.personId))
    .where(and(eq(trackedPeople.status, "main_leaderboard"), UNAVAILABLE_SQL));

  console.log(`[backfill-missing-net-worth] candidates: ${rows.length}`);

  let serperWrote = 0;
  let regenWrote = 0;
  let stillUnavailable = 0;
  let errors = 0;
  const errorNames: string[] = [];
  const stillNames: string[] = [];

  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const batch = rows.slice(i, i + BATCH_SIZE);
    await Promise.all(
      batch.map(async ({ person }) => {
        try {
          console.log(`\n[backfill-missing-net-worth] ${person.name}`);

          const serper = await refreshNetWorth(person.id, person.name);
          if (serper.outcome === "wrote" && serper.estimatedNetWorth && !isUnavailable(serper.estimatedNetWorth)) {
            serperWrote++;
            console.log(`  ✓ Serper wrote: ${serper.estimatedNetWorth}`);
            return;
          }

          console.log(`  … Serper ${serper.outcome}; forcing profile regen for OpenAI web search`);
          const result = await getOrGenerateCelebrityProfile(toTrendingPerson(person), { forceRefresh: true });
          const value = result.profile.estimatedNetWorth;
          if (isUnavailable(value)) {
            stillUnavailable++;
            stillNames.push(person.name);
            console.log(`  ○ Still unavailable after regen`);
          } else {
            regenWrote++;
            console.log(`  ✓ Regen wrote: ${value}`);
          }
        } catch (err: any) {
          errors++;
          const msg = err?.message ?? String(err);
          errorNames.push(`${person.name}: ${msg}`);
          console.error(`  ✗ ${person.name}: ${msg}`);
        }
      }),
    );

    if (i + BATCH_SIZE < rows.length) {
      console.log(`\n[backfill-missing-net-worth] waiting ${BATCH_DELAY_MS}ms before next batch…`);
      await new Promise((r) => setTimeout(r, BATCH_DELAY_MS));
    }
  }

  console.log(`\n========================================`);
  console.log(`[backfill-missing-net-worth] done`);
  console.log(`  candidates:        ${rows.length}`);
  console.log(`  serper wrote:      ${serperWrote}`);
  console.log(`  regen wrote:       ${regenWrote}`);
  console.log(`  still unavailable: ${stillUnavailable}`);
  console.log(`  errors:            ${errors}`);
  if (stillNames.length) {
    console.log(`  still names: ${stillNames.slice(0, 30).join(", ")}${stillNames.length > 30 ? "…" : ""}`);
  }
  if (errorNames.length) {
    console.log(`  error sample: ${errorNames.slice(0, 10).join(" | ")}`);
  }
  console.log(`========================================`);

  if (errors > 0) process.exitCode = 1;
}

main()
  .then(() => process.exit(process.exitCode ?? 0))
  .catch((err) => {
    console.error("[backfill-missing-net-worth] fatal", err);
    process.exit(1);
  });
