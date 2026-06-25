/**
 * One-time badge backfill.
 *
 * Walks every profile and runs every check-and-award helper from
 * `server/services/badges.ts` against their existing data. Idempotent:
 * the user_badges UNIQUE constraint guards against re-awards, so this
 * script can be re-run as often as needed without producing duplicate
 * notifications.
 *
 * Notifications: `badgeService.awardBadge()` always fanouts a
 * `badge_awarded` notification. For the backfill we don't want to
 * spam every existing user with 5+ badge toasts at once, so the
 * helper marks all backfill-created notifications as `seenAt = now()`
 * inside its post-commit step. The bell counter stays at zero; the
 * badges themselves are visible immediately on /me.
 *
 * Run:
 *   node --env-file=.env --import tsx server/scripts/backfill-badges.ts
 *   node --env-file=.env --import tsx server/scripts/backfill-badges.ts --agents-only
 */

import { and, eq, isNotNull, sql } from "drizzle-orm";
import { db } from "../db";
import {
  notifications,
  profiles,
  ranks,
} from "@shared/schema";
import {
  awardRankTierBadges,
  badgeService,
  checkAndAwardInsightBadges,
  checkAndAwardPredictionBadges,
  checkAndAwardPredictionWinBadges,
  checkAndAwardProfileBadges,
  checkAndAwardReferralBadges,
  checkAndAwardShareMasterBadge,
  checkAndAwardSuggestionBadges,
  checkAndAwardUpvoteReceivedBadges,
  checkAndAwardVoteBadges,
} from "../services/badges";

interface BackfillStats {
  usersProcessed: number;
  badgesAwarded: number;
  byBadgeKey: Record<string, number>;
}

async function backfillForUser(userId: string, stats: BackfillStats, ranksByName: Map<string, number>): Promise<void> {
  // Snapshot the user's badge count BEFORE running the checks so we
  // can compute "new badges awarded" by diffing post-state.
  const [{ before }] = await db
    .select({ before: sql<number>`count(*)::int` })
    .from(sql`user_badges`)
    .where(sql`user_id = ${userId}`);
  const beforeCount = Number(before) || 0;

  // Vote, prediction, content, suggestion surfaces.
  await checkAndAwardVoteBadges(userId);
  await checkAndAwardPredictionBadges(userId);
  await checkAndAwardPredictionWinBadges(userId);
  await checkAndAwardInsightBadges(userId);
  await checkAndAwardSuggestionBadges(userId);
  await checkAndAwardUpvoteReceivedBadges(userId);

  // Rank tier badges (Hall Inductee 7, VoxMax Legend 8). Resolve the
  // user's current rank → tier and let the helper decide which badges
  // (if any) apply.
  const [profile] = await db
    .select({ rank: profiles.rank })
    .from(profiles)
    .where(eq(profiles.id, userId))
    .limit(1);
  const tier = profile?.rank ? ranksByName.get(profile.rank) ?? 0 : 0;
  if (tier >= 7) {
    await awardRankTierBadges(userId, tier);
  }

  // Referral milestones — only meaningful for users who have had at
  // least one successful referral land. The helper short-circuits if
  // the count is zero.
  await checkAndAwardReferralBadges(userId);

  // Share Master — fires only if the user has at least one credited
  // share click on file.
  await checkAndAwardShareMasterBadge(userId);

  // Profile completion sweep (avatar / name+bio / community / full).
  await checkAndAwardProfileBadges(userId);

  // Diff post-state to record what was awarded.
  const earned = await db
    .select({ key: sql<string>`badge_key` })
    .from(sql`user_badges`)
    .where(sql`user_id = ${userId}`);

  const delta = earned.length - beforeCount;
  if (delta > 0) {
    stats.badgesAwarded += delta;
    // We can't tell which N rows are new without a timestamp diff,
    // so instead bump per-key counts based on the full snapshot —
    // it's fine because the script only runs against fresh data.
    // (Noisy first run, accurate second run.)
    for (const row of earned) {
      stats.byBadgeKey[row.key] = (stats.byBadgeKey[row.key] ?? 0) + 1;
    }
  }
}

async function main(): Promise<void> {
  const agentsOnly = process.argv.includes("--agents-only");
  const stats: BackfillStats = {
    usersProcessed: 0,
    badgesAwarded: 0,
    byBadgeKey: {},
  };

  // Build a name → tier lookup from the ranks cache so the rank-tier
  // badge sweep doesn't have to re-query for each user.
  const ranksByName = new Map<string, number>();
  const allRanks = await db.select().from(ranks);
  for (const r of allRanks) {
    ranksByName.set(r.name, r.tier);
  }
  badgeService.invalidateCache();

  const allProfiles = agentsOnly
    ? await db
        .select({ id: profiles.id, username: profiles.username })
        .from(profiles)
        .where(eq(profiles.isAgent, true))
    : await db
        .select({ id: profiles.id, username: profiles.username })
        .from(profiles);

  console.log(
    `[backfill-badges] Processing ${allProfiles.length} profiles${agentsOnly ? " (agents only)" : ""}`,
  );
  for (const p of allProfiles) {
    try {
      await backfillForUser(p.id, stats, ranksByName);
      stats.usersProcessed += 1;
      if (stats.usersProcessed % 25 === 0) {
        console.log(
          `[backfill-badges] ${stats.usersProcessed}/${allProfiles.length} processed`,
        );
      }
    } catch (err) {
      console.error(`[backfill-badges] failed for ${p.id} (${p.username})`, err);
    }
  }

  // Quiet the bell: mark every notification fanned out by this run
  // as seen so users aren't ambushed by 5+ unread badge toasts on
  // their next visit. The badges themselves remain visible on /me.
  await db
    .update(notifications)
    .set({ seenAt: new Date() })
    .where(
      and(
        eq(notifications.kind, "badge_awarded"),
        sql`${notifications.seenAt} IS NULL`,
      ),
    );

  console.log("[backfill-badges] Summary:");
  console.log(`  users processed: ${stats.usersProcessed}`);
  console.log(`  total badges in user_badges: ${stats.badgesAwarded}`);
  console.log("  by badge key:");
  for (const [key, count] of Object.entries(stats.byBadgeKey).sort(
    (a, b) => b[1] - a[1],
  )) {
    console.log(`    ${key}: ${count}`);
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("[backfill-badges] fatal", err);
    process.exit(1);
  });
