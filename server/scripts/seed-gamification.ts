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

async function seedXpActions() {
  console.log("[Gamification] Seeding XP actions...");
  
  const actions = [
    // Voting Actions
    { actionKey: 'vote_sentiment', displayName: 'Sentiment Vote', xpValue: 25, dailyCap: 20, description: 'Vote on celebrity sentiment (1-10 scale)' },
    { actionKey: 'vote_face_off', displayName: 'Matchup Vote', xpValue: 15, dailyCap: 25, description: 'Vote in a Matchup' },
    { actionKey: 'vote_induction', displayName: 'Induction Vote', xpValue: 30, dailyCap: 10, description: 'Vote on candidate for main leaderboard' },
    { actionKey: 'vote_curation', displayName: 'Image Curation Vote', xpValue: 20, dailyCap: 30, description: 'Vote on profile images (hot-or-not)' },
    { actionKey: 'vote_opinion', displayName: 'Opinion Poll Vote', xpValue: 15, dailyCap: 20, description: 'Vote on an opinion poll' },
    
    // Content Creation Actions
    { actionKey: 'post_insight', displayName: 'Post Insight', xpValue: 50, dailyCap: 5, description: 'Post a community insight' },
    { actionKey: 'post_comment', displayName: 'Post Comment', xpValue: 15, dailyCap: 10, description: 'Comment on an insight (min 20 chars, not on own insight, cap 10/day)' },
    { actionKey: 'submit_suggestion', displayName: 'Submit Suggestion', xpValue: 5, dailyCap: 3, description: 'Earn XP for submitting content suggestions for admin review' },
    { actionKey: 'suggestion_approved', displayName: 'Suggestion Approved', xpValue: 50, dailyCap: null, description: 'Bonus XP when your suggested content is approved and goes live' },
    
    // Engagement Actions
    { actionKey: 'upvote_insight', displayName: 'Upvote Insight', xpValue: 5, dailyCap: 50, description: 'Upvote a community insight' },
    { actionKey: 'downvote_insight', displayName: 'Downvote Insight', xpValue: 5, dailyCap: 50, description: 'Downvote a community insight' },
    
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
      .values(action)
      .onConflictDoUpdate({
        target: xpActions.actionKey,
        set: {
          displayName: action.displayName,
          xpValue: action.xpValue,
          dailyCap: action.dailyCap,
          description: action.description,
        }
      });
  }

  console.log(`[Gamification] Seeded ${actions.length} XP actions`);
}

async function seedRanks() {
  console.log("[Gamification] Seeding ranks...");
  
  const rankData = [
    { name: 'Citizen', tier: 1, minXp: 0, maxXp: 499, voteMultiplier: 1.0, color: '#6B7280', icon: 'user', description: 'Welcome to VoxDex. Every VoxMaxxer starts here.' },
    { name: 'Aspirant', tier: 2, minXp: 500, maxXp: 1999, voteMultiplier: 1.0, color: '#10B981', icon: 'trending-up', description: "You're finding your voice. Keep VoxMaxxing." },
    { name: 'Insider', tier: 3, minXp: 2000, maxXp: 4999, voteMultiplier: 1.25, color: '#3B82F6', icon: 'eye', description: 'You know how VoxDex works. Your perspective matters.' },
    { name: 'Analyst', tier: 4, minXp: 5000, maxXp: 9999, voteMultiplier: 1.5, color: '#8B5CF6', icon: 'bar-chart', description: 'A sharp read on the room. Your votes carry weight.' },
    { name: 'Expert', tier: 5, minXp: 10000, maxXp: 24999, voteMultiplier: 1.75, color: '#F59E0B', icon: 'award', description: 'Deep knowledge, consistent takes. Others follow your lead.' },
    { name: 'Maven', tier: 6, minXp: 25000, maxXp: 49999, voteMultiplier: 2.0, color: '#EF4444', icon: 'star', description: 'Elite tier. Your predictions and calls set the pace.' },
    { name: 'Hall of Famer', tier: 7, minXp: 50000, maxXp: 149999, voteMultiplier: 2.5, color: '#FFD700', icon: 'crown', description: 'Legendary status. A veteran of the VoxDex arena.' },
    { name: 'VoxMax Legend', tier: 8, minXp: 150000, maxXp: null, voteMultiplier: 3.0, color: '#E5E4E2', icon: 'sparkles', description: 'The rarest status on VoxDex — reserved for those who reach the summit.' },
  ];

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
