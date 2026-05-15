// Migration notes (most recent first):
// - 2026-04-18: post_comment dailyCap tightened from 20 to 10 to keep lower-effort
//   actions from out-earning higher-effort ones (post_insight remains 50 × 5 = 250/day).
// - 2026-04-18: Added rank tier 8 "VoxMax Legend" (150000+ XP); Hall of Famer now
//   capped at maxXp=149999; all ranks gained a description column.

import { db } from "../db";
import { xpActions, xpLedger, profiles, ranks } from "@shared/schema";
import { eq, sql } from "drizzle-orm";
import {
  STREAK_MILESTONES,
  STREAK_MILESTONE_XP,
  streakMilestoneActionKey,
} from "@shared/streak-config";
import { RANKS } from "@shared/rank-config";

/**
 * Action keys that have been retired from the live catalogue. They're
 * not deleted (we keep them so historical xp_ledger rows stay
 * referentially intact and admin XP audit views can still resolve the
 * displayName) — instead the seed flips `isActive=false` on every run
 * so any orphaned awardXp() callers fail closed with "Action not
 * found or inactive".
 */
const DEPRECATED_ACTION_KEYS = ['downvote_insight'] as const;

async function seedXpActions() {
  console.log("[Gamification] Seeding XP actions...");

  const actions = [
    // Voting Actions — equalised to 20 XP / cap 20/day across all
    // five surfaces. Pre-overhaul values varied 15–30 XP and 10–30
    // cap, which made vote choice feel like an XP optimisation
    // problem ("induction is worth more, skip sentiment"). Flat
    // values let users vote where the content interests them.
    { actionKey: 'vote_sentiment', displayName: 'Sentiment Vote', xpValue: 20, dailyCap: 20, description: 'Vote on celebrity sentiment (1-10 scale)' },
    { actionKey: 'vote_face_off', displayName: 'Matchup Vote', xpValue: 20, dailyCap: 20, description: 'Vote in a Matchup' },
    { actionKey: 'vote_induction', displayName: 'Induction Vote', xpValue: 20, dailyCap: 10, description: 'Vote on candidate for main leaderboard' },
    { actionKey: 'vote_curation', displayName: 'Image Curation Vote', xpValue: 20, dailyCap: 20, description: 'Vote on whether a profile image should be featured' },
    { actionKey: 'vote_opinion', displayName: 'Opinion Poll Vote', xpValue: 20, dailyCap: 20, description: 'Vote on an opinion poll' },

    // Content Creation Actions
    { actionKey: 'post_insight', displayName: 'Post Insight', xpValue: 50, dailyCap: 5, description: 'Post a community insight' },
    { actionKey: 'post_comment', displayName: 'Post Comment', xpValue: 15, dailyCap: 10, description: 'Comment on an insight (min 20 chars, not on own insight, cap 10/day)' },
    { actionKey: 'submit_suggestion', displayName: 'Submit Suggestion', xpValue: 5, dailyCap: 3, description: 'Earn XP for submitting content suggestions for admin review' },
    { actionKey: 'suggestion_approved', displayName: 'Suggestion Approved', xpValue: 50, dailyCap: null, description: 'Bonus XP when your suggested content is approved and goes live' },

    // Engagement Actions. downvote_insight was retired in this
    // pass — see DEPRECATED_ACTION_KEYS below for the deactivation
    // path. insight_upvoted is the new author-side reward: when
    // your insight or comment receives an upvote, you (the
    // author) earn a small bounty, capped per author per day.
    { actionKey: 'upvote_insight', displayName: 'Upvote Insight', xpValue: 5, dailyCap: 10, description: 'Upvote a community insight or comment' },
    { actionKey: 'insight_upvoted', displayName: 'Insight Upvoted', xpValue: 20, dailyCap: 10, description: 'Earned when your insight or comment receives an upvote from another VoxMaxer' },

    // Prediction Actions
    { actionKey: 'place_prediction', displayName: 'Place Prediction', xpValue: 20, dailyCap: 10, description: 'Place a prediction on a market' },
    { actionKey: 'prediction_win', displayName: 'Prediction Win', xpValue: 100, dailyCap: null, description: 'Win a prediction (bonus XP)' },
    
    // Streak & Bonus Actions. The per-milestone rows below are
    // generated from shared/streak-config.ts so the seed, the
    // daily-checkin handler, and the HowItWorks page can never disagree
    // on amounts. dailyCap is null on milestones (the lifetime
    // idempotency key `streak_milestone_<n>_<userId>` is what enforces
    // "once per user per milestone" — no calendar cap needed).
    { actionKey: 'daily_login', displayName: 'Daily Login', xpValue: 10, dailyCap: 1, description: 'Log in daily to earn streak bonus' },
    { actionKey: 'streak_bonus', displayName: 'Streak Bonus', xpValue: 25, dailyCap: 1, description: 'Bonus XP for maintaining a multi-day streak' },
    ...STREAK_MILESTONES.map((day) => ({
      actionKey: streakMilestoneActionKey(day),
      displayName: `Streak Milestone — Day ${day}`,
      xpValue: STREAK_MILESTONE_XP[day],
      dailyCap: null as number | null,
      description: `One-time bonus for reaching a ${day}-day login streak`,
    })),

    // Special Actions (no cap for admin use)
    { actionKey: 'legacy_migration', displayName: 'Legacy Migration', xpValue: 0, dailyCap: null, description: 'XP from legacy system migration' },
    { actionKey: 'admin_adjustment', displayName: 'Admin Adjustment', xpValue: 0, dailyCap: null, description: 'Manual XP adjustment by admin' },
  ];

  for (const action of actions) {
    await db.insert(xpActions)
      .values({ ...action, isActive: true })
      .onConflictDoUpdate({
        target: xpActions.actionKey,
        set: {
          displayName: action.displayName,
          xpValue: action.xpValue,
          dailyCap: action.dailyCap,
          description: action.description,
          isActive: true,
        }
      });
  }

  // Flip retired keys to isActive=false. Idempotent — runs every seed
  // and converges any environment that pre-dated the deprecation.
  for (const key of DEPRECATED_ACTION_KEYS) {
    await db.update(xpActions)
      .set({ isActive: false })
      .where(eq(xpActions.actionKey, key));
  }

  console.log(
    `[Gamification] Seeded ${actions.length} XP actions ` +
    `(${DEPRECATED_ACTION_KEYS.length} deprecated → isActive=false)`,
  );
}

async function seedRanks() {
  console.log("[Gamification] Seeding ranks...");

  // Source of truth lives in shared/rank-config.ts so the seed,
  // the client RankLadderStrip, the Ranks tab, and the RankUpModal
  // all read the same table. Threshold rebalances are a single-file
  // edit with no client/server drift surface.
  const rankData = RANKS;

  for (const rank of rankData) {
    const existing = await db.select().from(ranks).where(eq(ranks.tier, rank.tier)).limit(1);

    if (existing.length > 0) {
      await db.update(ranks)
        .set({
          name: rank.name,
          minXp: rank.minXp,
          maxXp: rank.maxXp,
          voteMultiplier: rank.voteMultiplier,
          color: rank.color,
          icon: rank.icon,
          description: rank.description,
        })
        .where(eq(ranks.tier, rank.tier));
    } else {
      await db.insert(ranks).values(rank);
    }
  }

  console.log(`[Gamification] Seeded ${rankData.length} ranks`);
}

async function migrateLegacyXp() {
  console.log("[Gamification] Migrating legacy XP balances to ledger...");
  
  const existingProfiles = await db.select().from(profiles);
  let migrated = 0;

  for (const profile of existingProfiles) {
    if (profile.xpPoints > 0) {
      const idempotencyKey = `legacy_migration_${profile.id}`;
      
      const existing = await db.select()
        .from(xpLedger)
        .where(eq(xpLedger.idempotencyKey, idempotencyKey))
        .limit(1);

      if (existing.length === 0) {
        await db.insert(xpLedger).values({
          userId: profile.id,
          actionType: 'legacy_migration',
          xpDelta: profile.xpPoints,
          idempotencyKey,
          source: 'legacy_migration',
          metadata: { migratedAt: new Date().toISOString(), originalXp: profile.xpPoints }
        });
        migrated++;
      }
    }
  }

  console.log(`[Gamification] Migrated ${migrated} legacy XP entries`);
}

export async function seedGamification() {
  try {
    await seedXpActions();
    await seedRanks();
    await migrateLegacyXp();
    console.log("[Gamification] Seeding complete!");
    return { success: true };
  } catch (error) {
    console.error("[Gamification] Seeding failed:", error);
    throw error;
  }
}

if (process.argv[1]?.endsWith('seed-gamification.ts')) {
  seedGamification().then(() => {
    console.log('[Gamification] Done');
    process.exit(0);
  }).catch(err => {
    console.error('[Gamification] Error:', err);
    process.exit(1);
  });
}
