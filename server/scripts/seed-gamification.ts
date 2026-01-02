import { db } from "../db";
import { xpActions, xpLedger, users, ranks } from "@shared/schema";
import { eq, sql } from "drizzle-orm";

async function seedXpActions() {
  console.log("[Gamification] Seeding XP actions...");
  
  const actions = [
    // Voting Actions
    { actionKey: 'vote_sentiment', displayName: 'Sentiment Vote', xpValue: 25, dailyCap: 20, description: 'Vote on celebrity sentiment (1-10 scale)' },
    { actionKey: 'vote_face_off', displayName: 'Face-Off Vote', xpValue: 15, dailyCap: 25, description: 'Vote in a Face-Off matchup' },
    { actionKey: 'vote_induction', displayName: 'Induction Vote', xpValue: 30, dailyCap: 10, description: 'Vote on candidate for main leaderboard' },
    { actionKey: 'vote_curation', displayName: 'Image Curation Vote', xpValue: 20, dailyCap: 30, description: 'Vote on profile images (hot-or-not)' },
    
    // Content Creation Actions
    { actionKey: 'post_insight', displayName: 'Post Insight', xpValue: 50, dailyCap: 5, description: 'Post a community insight' },
    { actionKey: 'post_comment', displayName: 'Post Comment', xpValue: 15, dailyCap: 20, description: 'Comment on an insight' },
    
    // Engagement Actions
    { actionKey: 'upvote_insight', displayName: 'Upvote Insight', xpValue: 5, dailyCap: 50, description: 'Upvote a community insight' },
    { actionKey: 'downvote_insight', displayName: 'Downvote Insight', xpValue: 5, dailyCap: 50, description: 'Downvote a community insight' },
    
    // Prediction Actions
    { actionKey: 'place_prediction', displayName: 'Place Prediction', xpValue: 20, dailyCap: 10, description: 'Place a prediction on a market' },
    { actionKey: 'prediction_win', displayName: 'Prediction Win', xpValue: 100, dailyCap: null, description: 'Win a prediction (bonus XP)' },
    
    // Streak & Bonus Actions
    { actionKey: 'daily_login', displayName: 'Daily Login', xpValue: 10, dailyCap: 1, description: 'Log in daily to earn streak bonus' },
    { actionKey: 'streak_bonus', displayName: 'Streak Bonus', xpValue: 25, dailyCap: 1, description: 'Bonus XP for maintaining streak' },
    
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
    { name: 'Citizen', tier: 1, minXp: 0, maxXp: 499, voteMultiplier: 1.0, color: '#6B7280', icon: 'user' },
    { name: 'Aspirant', tier: 2, minXp: 500, maxXp: 1999, voteMultiplier: 1.0, color: '#10B981', icon: 'trending-up' },
    { name: 'Insider', tier: 3, minXp: 2000, maxXp: 4999, voteMultiplier: 1.25, color: '#3B82F6', icon: 'eye' },
    { name: 'Analyst', tier: 4, minXp: 5000, maxXp: 9999, voteMultiplier: 1.5, color: '#8B5CF6', icon: 'bar-chart' },
    { name: 'Expert', tier: 5, minXp: 10000, maxXp: 24999, voteMultiplier: 1.75, color: '#F59E0B', icon: 'award' },
    { name: 'Maven', tier: 6, minXp: 25000, maxXp: 49999, voteMultiplier: 2.0, color: '#EF4444', icon: 'star' },
    { name: 'Hall of Famer', tier: 7, minXp: 50000, maxXp: null, voteMultiplier: 2.5, color: '#FFD700', icon: 'crown' },
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
  
  const existingUsers = await db.select().from(users);
  let migrated = 0;

  for (const user of existingUsers) {
    if (user.xpPoints > 0) {
      const idempotencyKey = `legacy_migration_${user.id}`;
      
      const existing = await db.select()
        .from(xpLedger)
        .where(eq(xpLedger.idempotencyKey, idempotencyKey))
        .limit(1);

      if (existing.length === 0) {
        await db.insert(xpLedger).values({
          userId: user.id,
          actionType: 'legacy_migration',
          xpDelta: user.xpPoints,
          idempotencyKey,
          source: 'legacy_migration',
          metadata: { migratedAt: new Date().toISOString(), originalXp: user.xpPoints }
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
