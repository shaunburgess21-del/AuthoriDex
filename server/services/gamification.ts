import { db } from "../db";
import { 
  users, 
  xpLedger, 
  creditLedger, 
  xpActions, 
  ranks,
  type XpAction,
  type Rank
} from "@shared/schema";
import { eq, and, sql, gte, desc } from "drizzle-orm";

export type Capability = 
  | 'can_vote_sentiment'
  | 'can_vote_matchup'
  | 'can_vote_induction'
  | 'can_vote_curation'
  | 'can_post_insight'
  | 'can_comment'
  | 'can_predict';

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

    const existingEntry = await db.query.xpLedger.findFirst({
      where: and(
        eq(xpLedger.userId, userId),
        eq(xpLedger.idempotencyKey, idempotencyKey)
      )
    });

    if (existingEntry) {
      const user = await db.query.users.findFirst({
        where: eq(users.id, userId)
      });
      return {
        success: false,
        xpAwarded: 0,
        newTotalXp: user?.xpPoints || 0,
        newRank: user?.reputationRank || null,
        dailyCount: 0,
        dailyCap: action.dailyCap,
        message: 'Duplicate action - XP already awarded'
      };
    }

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const dailyCountResult = await db.select({
      count: sql<number>`count(*)`
    })
    .from(xpLedger)
    .where(and(
      eq(xpLedger.userId, userId),
      eq(xpLedger.actionType, actionType),
      gte(xpLedger.createdAt, today)
    ));

    const dailyCount = Number(dailyCountResult[0]?.count || 0);

    if (action.dailyCap !== null && dailyCount >= action.dailyCap) {
      const user = await db.query.users.findFirst({
        where: eq(users.id, userId)
      });
      return {
        success: false,
        xpAwarded: 0,
        newTotalXp: user?.xpPoints || 0,
        newRank: user?.reputationRank || null,
        dailyCount,
        dailyCap: action.dailyCap,
        message: `Daily cap reached for ${actionType} (${dailyCount}/${action.dailyCap})`
      };
    }

    await db.insert(xpLedger).values({
      userId,
      actionType,
      xpDelta: action.xpValue,
      idempotencyKey,
      source: 'user_action',
      metadata: metadata || null
    });

    const updatedUser = await db.update(users)
      .set({
        xpPoints: sql`${users.xpPoints} + ${action.xpValue}`
      })
      .where(eq(users.id, userId))
      .returning();

    const newTotalXp = updatedUser[0]?.xpPoints || 0;

    const newRank = await this.recalculateUserRank(userId, newTotalXp);

    return {
      success: true,
      xpAwarded: action.xpValue,
      newTotalXp,
      newRank,
      dailyCount: dailyCount + 1,
      dailyCap: action.dailyCap,
      message: `Awarded ${action.xpValue} XP for ${action.displayName}`
    };
  }

  async adjustCredits(
    userId: string,
    amount: number,
    txnType: string,
    idempotencyKey: string,
    metadata?: Record<string, unknown>
  ): Promise<AdjustCreditsResult> {
    const existingEntry = await db.query.creditLedger.findFirst({
      where: and(
        eq(creditLedger.userId, userId),
        eq(creditLedger.idempotencyKey, idempotencyKey)
      )
    });

    if (existingEntry) {
      return {
        success: false,
        amount: 0,
        newBalance: existingEntry.balanceAfter,
        message: 'Duplicate transaction'
      };
    }

    const user = await db.query.users.findFirst({
      where: eq(users.id, userId)
    });

    if (!user) {
      return {
        success: false,
        amount: 0,
        newBalance: 0,
        message: 'User not found'
      };
    }

    const newBalance = user.predictCredits + amount;

    if (newBalance < 0) {
      return {
        success: false,
        amount: 0,
        newBalance: user.predictCredits,
        message: 'Insufficient credits'
      };
    }

    await db.insert(creditLedger).values({
      userId,
      txnType,
      amount,
      walletType: 'VIRTUAL',
      balanceAfter: newBalance,
      source: 'user_action',
      idempotencyKey,
      metadata: metadata || null
    });

    await db.update(users)
      .set({ predictCredits: newBalance })
      .where(eq(users.id, userId));

    return {
      success: true,
      amount,
      newBalance,
      message: amount > 0 
        ? `Added ${amount} credits` 
        : `Deducted ${Math.abs(amount)} credits`
    };
  }

  async recalculateUserRank(userId: string, currentXp?: number): Promise<string | null> {
    await this.ensureCache();

    let xp = currentXp;
    if (xp === undefined) {
      const user = await db.query.users.findFirst({
        where: eq(users.id, userId)
      });
      xp = user?.xpPoints || 0;
    }

    let newRank: Rank | null = null;
    for (const rank of this.ranksCache) {
      if (xp >= rank.minXp && (rank.maxXp === null || xp <= rank.maxXp)) {
        newRank = rank;
        break;
      }
    }

    if (newRank) {
      await db.update(users)
        .set({ reputationRank: newRank.name })
        .where(eq(users.id, userId));
      return newRank.name;
    }

    return null;
  }

  async checkPermission(userId: string, capability: Capability): Promise<boolean> {
    await this.ensureCache();

    const user = await db.query.users.findFirst({
      where: eq(users.id, userId)
    });

    if (!user) return false;

    const userRank = this.ranksCache.find(r => r.name === user.reputationRank);
    const tier = userRank?.tier || 1;

    switch (capability) {
      case 'can_vote_sentiment':
      case 'can_vote_matchup':
      case 'can_predict':
        return true;

      case 'can_vote_induction':
      case 'can_vote_curation':
        return tier >= 2; // Aspirant+

      case 'can_post_insight':
      case 'can_comment':
        return tier >= 2; // Aspirant+ (buffer rank for spam prevention)

      default:
        return false;
    }
  }

  async getUserStats(userId: string): Promise<UserStats | null> {
    await this.ensureCache();

    const user = await db.query.users.findFirst({
      where: eq(users.id, userId)
    });

    if (!user) return null;

    const userRank = this.ranksCache.find(r => r.name === user.reputationRank);

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
      userId: user.id,
      username: user.username,
      xpPoints: user.xpPoints,
      predictCredits: user.predictCredits,
      rank: userRank || null,
      currentStreak: user.currentStreak,
      capabilities
    };
  }

  async getVoteMultiplier(userId: string, voteType: string): Promise<number> {
    if (voteType === 'face_off' || voteType === 'poll') {
      return 1.0;
    }

    await this.ensureCache();

    const user = await db.query.users.findFirst({
      where: eq(users.id, userId)
    });

    if (!user) return 1.0;

    const userRank = this.ranksCache.find(r => r.name === user.reputationRank);
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
