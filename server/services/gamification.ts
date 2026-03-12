import { db } from "../db";
import { 
  profiles,
  xpLedger, 
  creditLedger, 
  xpActions, 
  ranks,
  type Profile,
  type XpAction,
  type Rank
} from "@shared/schema";
import { eq, and, sql, gte, desc } from "drizzle-orm";
import { canAccessCapability, computeCreditBalance, type Capability } from "./gamification-utils";
import { resolveRankForXp } from "./gamification-ranks";

interface AwardXpResult {
  success: boolean;
  xpAwarded: number;
  newTotalXp: number;
  newRank: string | null;
  dailyCount: number;
  dailyCap: number | null;
  message: string;
}

interface AdjustCreditsResult {
  success: boolean;
  amount: number;
  newBalance: number;
  message: string;
}

interface UserStats {
  userId: string;
  username: string;
  xpPoints: number;
  predictCredits: number;
  rank: Rank | null;
  currentStreak: number;
  capabilities: Record<Capability, boolean>;
}

class GamificationService {
  private xpActionsCache: Map<string, XpAction> = new Map();
  private ranksCache: Rank[] = [];
  private cacheExpiry: number = 0;
  private readonly CACHE_TTL = 5 * 60 * 1000; // 5 minutes

  private async getProfile(userId: string): Promise<Profile | null> {
    const [profile] = await db.select().from(profiles).where(eq(profiles.id, userId)).limit(1);
    return profile ?? null;
  }

  private async ensureCache(): Promise<void> {
    if (Date.now() < this.cacheExpiry) return;

    const [actions, ranksList] = await Promise.all([
      db.select().from(xpActions).where(eq(xpActions.isActive, true)),
      db.select().from(ranks).orderBy(ranks.tier)
    ]);

    this.xpActionsCache.clear();
    actions.forEach(action => this.xpActionsCache.set(action.actionKey, action));
    this.ranksCache = ranksList;
    this.cacheExpiry = Date.now() + this.CACHE_TTL;
  }

  async awardXp(
    userId: string,
    actionType: string,
    idempotencyKey: string,
    metadata?: Record<string, unknown>
  ): Promise<AwardXpResult> {
    await this.ensureCache();

    const action = this.xpActionsCache.get(actionType);
    if (!action) {
      return {
        success: false,
        xpAwarded: 0,
        newTotalXp: 0,
        newRank: null,
        dailyCount: 0,
        dailyCap: null,
        message: `Unknown action type: ${actionType}`
      };
    }

    if (action.expiryDate && new Date() > action.expiryDate) {
      return {
        success: false,
        xpAwarded: 0,
        newTotalXp: 0,
        newRank: null,
        dailyCount: 0,
        dailyCap: action.dailyCap,
        message: `Action ${actionType} has expired`
      };
    }

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    return db.transaction(async (tx) => {
      const [existingEntry] = await tx.select({
        id: xpLedger.id,
      })
      .from(xpLedger)
      .where(and(
        eq(xpLedger.userId, userId),
        eq(xpLedger.idempotencyKey, idempotencyKey)
      ))
      .limit(1);

      if (existingEntry) {
        const [profile] = await tx.select({
          xpPoints: profiles.xpPoints,
          rank: profiles.rank,
        })
        .from(profiles)
        .where(eq(profiles.id, userId))
        .limit(1);

        return {
          success: false,
          xpAwarded: 0,
          newTotalXp: profile?.xpPoints || 0,
          newRank: profile?.rank || null,
          dailyCount: 0,
          dailyCap: action.dailyCap,
          message: 'Duplicate action - XP already awarded'
        };
      }

      const dailyCountResult = await tx.select({
        count: sql<number>`count(*)`
      })
      .from(xpLedger)
      .where(and(
        eq(xpLedger.userId, userId),
        eq(xpLedger.actionType, actionType),
        gte(xpLedger.createdAt, today)
      ));

      const dailyCount = Number(dailyCountResult[0]?.count || 0);
      const [profile] = await tx.select().from(profiles).where(eq(profiles.id, userId)).limit(1);

      if (!profile) {
        return {
          success: false,
          xpAwarded: 0,
          newTotalXp: 0,
          newRank: null,
          dailyCount,
          dailyCap: action.dailyCap,
          message: "User profile not found",
        };
      }

      if (action.dailyCap !== null && dailyCount >= action.dailyCap) {
        return {
          success: false,
          xpAwarded: 0,
          newTotalXp: profile.xpPoints,
          newRank: profile.rank || null,
          dailyCount,
          dailyCap: action.dailyCap,
          message: `Daily cap reached for ${actionType} (${dailyCount}/${action.dailyCap})`
        };
      }

      const insertedLedger = await tx.insert(xpLedger).values({
        userId,
        actionType,
        xpDelta: action.xpValue,
        idempotencyKey,
        source: 'user_action',
        metadata: metadata || null
      }).onConflictDoNothing().returning({
        id: xpLedger.id,
      });

      if (insertedLedger.length === 0) {
        return {
          success: false,
          xpAwarded: 0,
          newTotalXp: profile.xpPoints,
          newRank: profile.rank || null,
          dailyCount,
          dailyCap: action.dailyCap,
          message: 'Duplicate action - XP already awarded'
        };
      }

      const newTotalXp = profile.xpPoints + action.xpValue;
      const nextRank = resolveRankForXp(this.ranksCache, newTotalXp);

      await tx.update(profiles)
        .set({
          xpPoints: newTotalXp,
          rank: nextRank?.name ?? profile.rank,
        })
        .where(eq(profiles.id, userId));

      return {
        success: true,
        xpAwarded: action.xpValue,
        newTotalXp,
        newRank: nextRank?.name ?? profile.rank ?? null,
        dailyCount: dailyCount + 1,
        dailyCap: action.dailyCap,
        message: `Awarded ${action.xpValue} XP for ${action.displayName}`
      };
    });
  }

  async adjustCredits(
    userId: string,
    amount: number,
    txnType: string,
    idempotencyKey: string,
    metadata?: Record<string, unknown>
  ): Promise<AdjustCreditsResult> {
    return db.transaction(async (tx) => {
      const [existingEntry] = await tx.select({
        balanceAfter: creditLedger.balanceAfter,
      })
      .from(creditLedger)
      .where(and(
        eq(creditLedger.userId, userId),
        eq(creditLedger.idempotencyKey, idempotencyKey)
      ))
      .limit(1);

      if (existingEntry) {
        return {
          success: false,
          amount: 0,
          newBalance: existingEntry.balanceAfter,
          message: 'Duplicate transaction'
        };
      }

      const [profile] = await tx.select({
        predictCredits: profiles.predictCredits,
      })
      .from(profiles)
      .where(eq(profiles.id, userId))
      .limit(1);

      if (!profile) {
        return {
          success: false,
          amount: 0,
          newBalance: 0,
          message: 'User not found'
        };
      }

      const newBalance = computeCreditBalance(profile.predictCredits, amount);

      if (newBalance === null) {
        return {
          success: false,
          amount: 0,
          newBalance: profile.predictCredits,
          message: 'Insufficient credits'
        };
      }

      const insertedLedger = await tx.insert(creditLedger).values({
        userId,
        txnType,
        amount,
        walletType: 'VIRTUAL',
        balanceAfter: newBalance,
        source: 'user_action',
        idempotencyKey,
        metadata: metadata || null
      }).onConflictDoNothing().returning({
        id: creditLedger.id,
      });

      if (insertedLedger.length === 0) {
        return {
          success: false,
          amount: 0,
          newBalance: profile.predictCredits,
          message: 'Duplicate transaction'
        };
      }

      await tx.update(profiles)
        .set({ predictCredits: newBalance })
        .where(eq(profiles.id, userId));

      return {
        success: true,
        amount,
        newBalance,
        message: amount > 0
          ? `Added ${amount} credits`
          : `Deducted ${Math.abs(amount)} credits`
      };
    });
  }

  async recalculateUserRank(userId: string, currentXp?: number): Promise<string | null> {
    await this.ensureCache();

    let xp = currentXp;
    if (xp === undefined) {
      const profile = await this.getProfile(userId);
      xp = profile?.xpPoints || 0;
    }

    const newRank = resolveRankForXp(this.ranksCache, xp);

    if (newRank) {
      await db.update(profiles)
        .set({ rank: newRank.name })
        .where(eq(profiles.id, userId))
        .returning();
      return newRank.name;
    }

    return null;
  }

  async checkPermission(userId: string, capability: Capability): Promise<boolean> {
    await this.ensureCache();

    const profile = await this.getProfile(userId);

    if (!profile) return false;

    const userRank = this.ranksCache.find(r => r.name === profile.rank);
    const tier = userRank?.tier || 1;

    return canAccessCapability(tier, capability);
  }

  async getUserStats(userId: string): Promise<UserStats | null> {
    await this.ensureCache();

    const profile = await this.getProfile(userId);

    if (!profile) return null;

    const userRank = this.ranksCache.find(r => r.name === profile.rank);

    const capabilities: Record<Capability, boolean> = {
      can_vote_sentiment: await this.checkPermission(userId, 'can_vote_sentiment'),
      can_vote_matchup: await this.checkPermission(userId, 'can_vote_matchup'),
      can_vote_induction: await this.checkPermission(userId, 'can_vote_induction'),
      can_vote_curation: await this.checkPermission(userId, 'can_vote_curation'),
      can_post_insight: await this.checkPermission(userId, 'can_post_insight'),
      can_comment: await this.checkPermission(userId, 'can_comment'),
      can_predict: await this.checkPermission(userId, 'can_predict')
    };

    return {
      userId: profile.id,
      username: profile.username || "Unknown",
      xpPoints: profile.xpPoints,
      predictCredits: profile.predictCredits,
      rank: userRank || null,
      currentStreak: profile.currentStreak,
      capabilities
    };
  }

  async getVoteMultiplier(userId: string, voteType: string): Promise<number> {
    if (voteType === 'face_off' || voteType === 'poll') {
      return 1.0;
    }

    await this.ensureCache();

    const profile = await this.getProfile(userId);

    if (!profile) return 1.0;

    const userRank = this.ranksCache.find(r => r.name === profile.rank);
    return userRank?.voteMultiplier || 1.0;
  }

  async getXpHistory(userId: string, limit: number = 20): Promise<typeof xpLedger.$inferSelect[]> {
    const entries = await db.select()
      .from(xpLedger)
      .where(eq(xpLedger.userId, userId))
      .orderBy(desc(xpLedger.createdAt))
      .limit(limit);

    return entries;
  }

  async getCreditHistory(userId: string, limit: number = 20): Promise<typeof creditLedger.$inferSelect[]> {
    const entries = await db.select()
      .from(creditLedger)
      .where(eq(creditLedger.userId, userId))
      .orderBy(desc(creditLedger.createdAt))
      .limit(limit);

    return entries;
  }

  async getDailyXpSummary(userId: string): Promise<Record<string, { count: number; total: number; cap: number | null }>> {
    await this.ensureCache();

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const entries = await db.select({
      actionType: xpLedger.actionType,
      count: sql<number>`count(*)`,
      total: sql<number>`sum(${xpLedger.xpDelta})`
    })
    .from(xpLedger)
    .where(and(
      eq(xpLedger.userId, userId),
      gte(xpLedger.createdAt, today)
    ))
    .groupBy(xpLedger.actionType);

    const summary: Record<string, { count: number; total: number; cap: number | null }> = {};
    
    for (const entry of entries) {
      const action = this.xpActionsCache.get(entry.actionType);
      summary[entry.actionType] = {
        count: Number(entry.count),
        total: Number(entry.total),
        cap: action?.dailyCap || null
      };
    }

    return summary;
  }
}

export const gamificationService = new GamificationService();
