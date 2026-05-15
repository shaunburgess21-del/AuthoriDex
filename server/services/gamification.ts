import { db } from "../db";
import { 
  profiles,
  xpLedger, 
  creditLedger, 
  xpActions, 
  creditActions,
  ranks,
  type Profile,
  type XpAction,
  type CreditAction,
  type Rank
} from "@shared/schema";
import { eq, and, sql, gte, desc } from "drizzle-orm";
import { canAccessCapability, computeCreditBalance, type Capability } from "./gamification-utils";
import { resolveRankForXp } from "./gamification-ranks";
import { createNotification } from "./notifications";
import { ALL_CAPABILITIES } from "@shared/rank-config";
import { CREDIT_ACTIONS, type CreditActionConfig } from "@shared/credit-config";

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
  /** True when a ledger row was inserted and the balance moved. */
  awarded: boolean;
  /** Signed amount applied (0 if not awarded). */
  amount: number;
  /** Balance after the operation (or the unchanged balance if not awarded). */
  newBalance: number;
  /**
   * Reason code for non-awarded results. Stable enough that callers
   * can branch on it ('duplicate' | 'daily_cap' | 'inactive' |
   * 'unknown_action' | 'insufficient_credits' | 'user_not_found').
   */
  reason?: string;
  message: string;
}

interface AdjustCreditsOptions {
  /**
   * Signed override for the reward amount. When omitted, the helper
   * reads `proposed_credits` from the credit_actions cache (DB row,
   * so admin edits take effect without redeploy) and falls back to
   * the shared seed config if the DB row is missing.
   *
   * Stake / payout / refund call sites that compute their own amount
   * (e.g. parimutuel payouts) pass the signed value here. Engagement
   * earn-loop call sites omit this and let the table win.
   */
  amount?: number;
  metadata?: Record<string, unknown>;
}

interface UserStats {
  userId: string;
  username: string;
  xpPoints: number;
  predictCredits: number;
  rank: Rank | null;
  /** Peak rank ever reached (full row from the ranks cache). */
  highestRank: Rank | null;
  currentStreak: number;
  longestStreak: number;
  lastLoginDate: string | null;
  capabilities: Record<Capability, boolean>;
}

class GamificationService {
  private xpActionsCache: Map<string, XpAction> = new Map();
  // Mirrors xpActionsCache. Populated from the credit_actions table
  // so admin edits to proposed_credits / daily_cap / is_active are
  // picked up after the next ensureCache() refresh (5-minute TTL).
  private creditActionsCache: Map<string, CreditAction> = new Map();
  private ranksCache: Rank[] = [];
  private cacheExpiry: number = 0;
  private readonly CACHE_TTL = 5 * 60 * 1000; // 5 minutes

  private async getProfile(userId: string): Promise<Profile | null> {
    const [profile] = await db.select().from(profiles).where(eq(profiles.id, userId)).limit(1);
    return profile ?? null;
  }

  private async ensureCache(): Promise<void> {
    if (Date.now() < this.cacheExpiry) return;

    const [actions, creditActionRows, ranksList] = await Promise.all([
      db.select().from(xpActions).where(eq(xpActions.isActive, true)),
      // Cache ALL credit action rows (active + inactive) so the admin
      // CRUD endpoints can return the inactive ones without a second
      // DB read; the runtime award path checks isActive separately.
      db.select().from(creditActions),
      db.select().from(ranks).orderBy(ranks.tier)
    ]);

    this.xpActionsCache.clear();
    actions.forEach(action => this.xpActionsCache.set(action.actionKey, action));
    this.creditActionsCache.clear();
    creditActionRows.forEach(action => this.creditActionsCache.set(action.key, action));
    this.ranksCache = ranksList;
    this.cacheExpiry = Date.now() + this.CACHE_TTL;
  }

  /**
   * Force a cache refresh on the next access. Called by the admin
   * credit-actions CRUD endpoints so a rate edit propagates to the
   * runtime award path immediately, not after the 5-minute TTL.
   */
  invalidateCache(): void {
    this.cacheExpiry = 0;
  }

  /**
   * Resolve a credit action by key, preferring the live DB row and
   * falling back to the shared seed config. The fallback matters in
   * two cases: (a) cold start before the seed has run, and (b) a
   * production hotfix that ships a new action key in code before the
   * accompanying seed is applied. In both cases we'd rather award
   * the seed default than silently no-op.
   */
  private resolveCreditAction(actionKey: string):
    | { source: "db"; row: CreditAction }
    | { source: "seed"; row: CreditActionConfig }
    | null {
    const dbRow = this.creditActionsCache.get(actionKey);
    if (dbRow) return { source: "db", row: dbRow };
    const seed = CREDIT_ACTIONS.find((a) => a.key === actionKey);
    if (seed) return { source: "seed", row: seed };
    return null;
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

    // Track rank promotion across the transaction so we can fire a
    // `rank_up` notification after the DB commit. We only emit if the
    // rank name actually changed AND the new tier is higher than the
    // old one — this avoids spurious pings if a future code path ever
    // recomputes rank with the same XP.
    type RankUpFanout = {
      previousRank: string | null;
      newRank: string;
      newTotalXp: number;
      /** True when the new rank also raised highest_rank (new peak). */
      newPersonalBest: boolean;
    };
    // The closure-narrowing dance: TypeScript can't see assignments
    // inside the transaction callback, so we hold the value in a
    // single-element ref array instead of a `let`. This keeps the
    // type wide enough that the post-commit branch type-checks.
    const rankUpRef: { value: RankUpFanout | null } = { value: null };

    const txResult = await db.transaction(async (tx) => {
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

      // Promotion + highest_rank lazy promotion both decided in one
      // pass so the SET clause stays atomic. We only raise highest
      // when the new tier strictly exceeds the existing peak — never
      // lower it (that would defeat the "your peak was N" promise).
      const newRankFull = nextRank
        ? this.ranksCache.find((r) => r.name === nextRank.name)
        : undefined;
      const newTier = newRankFull?.tier ?? -Infinity;
      const oldTier = this.ranksCache.find((r) => r.name === profile.rank)?.tier ?? -Infinity;
      const peakTier =
        this.ranksCache.find((r) => r.name === profile.highestRank)?.tier ?? -Infinity;
      const raisingPeak = newRankFull !== undefined && newTier > peakTier;

      await tx.update(profiles)
        .set({
          xpPoints: newTotalXp,
          rank: nextRank?.name ?? profile.rank,
          highestRank: raisingPeak ? nextRank!.name : profile.highestRank,
        })
        .where(eq(profiles.id, userId));

      if (nextRank && nextRank.name !== profile.rank) {
        // resolveRankForXp() returns the public RankThreshold shape so
        // we use the full Rank row resolved above to inspect tier
        // ordering. A change is only a "promotion" (and worth a ping)
        // if the new tier is strictly higher than the old one — guards
        // against any future code path that recomputes rank with the
        // same XP and accidentally regresses.
        if (newRankFull && newTier > oldTier) {
          rankUpRef.value = {
            previousRank: profile.rank ?? null,
            newRank: nextRank.name,
            newTotalXp,
            newPersonalBest: raisingPeak,
          };
        }
      }

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

    // Post-commit fanout. Best-effort; never throws back to the caller.
    const rankUpFanout = rankUpRef.value;
    if (rankUpFanout) {
      try {
        await createNotification({
          userId,
          kind: "rank_up",
          title: `You're now ${rankUpFanout.newRank}`,
          body: rankUpFanout.previousRank
            ? `Promoted from ${rankUpFanout.previousRank}. Keep going.`
            : `New rank unlocked. Keep going.`,
          href: "/me",
          entityType: "rank",
          entityId: rankUpFanout.newRank,
          metadata: {
            previousRank: rankUpFanout.previousRank,
            newRank: rankUpFanout.newRank,
            xp: rankUpFanout.newTotalXp,
            newPersonalBest: rankUpFanout.newPersonalBest,
          },
          // Idempotent on (user, rank) — even if rank flips back and
          // forth (which shouldn't happen for monotonic XP) we never
          // fire two pings for the same promotion.
          idempotencyKey: `rank_up:${userId}:${rankUpFanout.newRank}`,
        });
      } catch (err) {
        console.error("[notifications] rank_up fanout failed:", err);
      }
    }

    return txResult;
  }

  /**
   * Award (or deduct) credits against a configured action key.
   *
   * The earn loop (votes, comments, insights, suggestion approvals,
   * streak milestones) calls this with no `amount` override — the
   * helper looks up `proposed_credits` from the credit_actions DB
   * cache so admin edits take effect without a redeploy.
   *
   * Existing production paths (prediction stake/payout/refund,
   * jackpot payouts, AMM trades, signup grant, admin adjustments)
   * still inline their own ledger writes. The intent is to keep
   * those untouched; new earn-loop call sites consolidate here.
   *
   * Daily cap enforcement: when the resolved action has a non-null
   * dailyCap, we count credit_ledger rows with the matching txnType
   * for this user since the start of the UTC day. At-or-above the
   * cap returns `awarded: false` with reason 'daily_cap' — silent,
   * not an error, mirroring the awardXp() pattern.
   *
   * Idempotency: `(userId, idempotencyKey)` uniqueness on the
   * credit_ledger row prevents double-payment when a caller retries.
   * Engagement actions should encode (action, target, user) into the
   * key; lifetime-once actions (streak milestones) encode just
   * (action, user) so reset+reclimb cannot double-pay.
   */
  async adjustCredits(
    userId: string,
    actionKey: string,
    idempotencyKey: string,
    options?: AdjustCreditsOptions
  ): Promise<AdjustCreditsResult> {
    await this.ensureCache();

    const resolved = this.resolveCreditAction(actionKey);

    if (!resolved) {
      return {
        awarded: false,
        amount: 0,
        newBalance: 0,
        reason: "unknown_action",
        message: `Unknown credit action: ${actionKey}`,
      };
    }

    // Inactive guard. Admin-initiated kills (e.g. abuse mitigation)
    // should immediately stop awarding even if a deploy is mid-flight.
    if (resolved.source === "db" && resolved.row.isActive === false) {
      return {
        awarded: false,
        amount: 0,
        newBalance: 0,
        reason: "inactive",
        message: `Credit action ${actionKey} is inactive`,
      };
    }
    if (resolved.source === "seed" && resolved.row.isActive === false) {
      return {
        awarded: false,
        amount: 0,
        newBalance: 0,
        reason: "inactive",
        message: `Credit action ${actionKey} is inactive`,
      };
    }

    const proposedCredits =
      resolved.source === "db"
        ? resolved.row.proposedCredits
        : resolved.row.proposedCredits;
    const dailyCap =
      resolved.source === "db" ? resolved.row.dailyCap : resolved.row.dailyCap;
    const amount = options?.amount ?? proposedCredits;

    // Zero-amount actions (e.g. admin_adjustment with no override)
    // are a no-op — silently skip rather than write an empty row.
    if (amount === 0) {
      return {
        awarded: false,
        amount: 0,
        newBalance: 0,
        reason: "zero_amount",
        message: `No credit amount configured for ${actionKey}`,
      };
    }

    return db.transaction(async (tx) => {
      const [existingEntry] = await tx
        .select({ balanceAfter: creditLedger.balanceAfter })
        .from(creditLedger)
        .where(
          and(
            eq(creditLedger.userId, userId),
            eq(creditLedger.idempotencyKey, idempotencyKey),
          ),
        )
        .limit(1);

      if (existingEntry) {
        return {
          awarded: false,
          amount: 0,
          newBalance: existingEntry.balanceAfter,
          reason: "duplicate",
          message: "Duplicate transaction",
        };
      }

      const [profile] = await tx
        .select({ predictCredits: profiles.predictCredits })
        .from(profiles)
        .where(eq(profiles.id, userId))
        .limit(1);

      if (!profile) {
        return {
          awarded: false,
          amount: 0,
          newBalance: 0,
          reason: "user_not_found",
          message: "User not found",
        };
      }

      // Daily cap check. Count UTC-today's ledger rows with the
      // matching txnType. At or above the cap, return awarded:false
      // silently — caller swallows the result and continues.
      if (dailyCap !== null && dailyCap !== undefined && amount > 0) {
        const utcToday = new Date();
        utcToday.setUTCHours(0, 0, 0, 0);

        const [{ count }] = await tx
          .select({ count: sql<number>`count(*)::int` })
          .from(creditLedger)
          .where(
            and(
              eq(creditLedger.userId, userId),
              eq(creditLedger.txnType, actionKey),
              gte(creditLedger.createdAt, utcToday),
            ),
          );

        if (Number(count) >= dailyCap) {
          return {
            awarded: false,
            amount: 0,
            newBalance: profile.predictCredits,
            reason: "daily_cap",
            message: `Daily cap reached for ${actionKey} (${count}/${dailyCap})`,
          };
        }
      }

      const newBalance = computeCreditBalance(profile.predictCredits, amount);

      if (newBalance === null) {
        return {
          awarded: false,
          amount: 0,
          newBalance: profile.predictCredits,
          reason: "insufficient_credits",
          message: "Insufficient credits",
        };
      }

      const insertedLedger = await tx
        .insert(creditLedger)
        .values({
          userId,
          // txnType mirrors the action key so the credit history UI
          // and labelForTxnType() in shared/credit-config can resolve
          // the friendly label from a single source.
          txnType: actionKey,
          amount,
          walletType: "VIRTUAL",
          balanceAfter: newBalance,
          source: "user_action",
          idempotencyKey,
          metadata: options?.metadata ?? null,
        })
        .onConflictDoNothing()
        .returning({ id: creditLedger.id });

      if (insertedLedger.length === 0) {
        // Unique violation race — another concurrent caller landed
        // first. Treat as duplicate, same as the explicit precheck.
        return {
          awarded: false,
          amount: 0,
          newBalance: profile.predictCredits,
          reason: "duplicate",
          message: "Duplicate transaction",
        };
      }

      await tx
        .update(profiles)
        .set({ predictCredits: newBalance })
        .where(eq(profiles.id, userId));

      return {
        awarded: true,
        amount,
        newBalance,
        message:
          amount > 0
            ? `Awarded ${amount} credits for ${actionKey}`
            : `Deducted ${Math.abs(amount)} credits for ${actionKey}`,
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
    const peakRank = profile.highestRank
      ? this.ranksCache.find(r => r.name === profile.highestRank) ?? null
      : null;
    const tier = userRank?.tier || 1;
    // Derive the full capability map from ALL_CAPABILITIES so the
    // API response stays in sync with shared/rank-config.ts. Adding a
    // new capability there is a one-file change.
    const capabilities = ALL_CAPABILITIES.reduce(
      (acc, capability) => {
        acc[capability] = canAccessCapability(tier, capability);
        return acc;
      },
      {} as Record<Capability, boolean>,
    );

    return {
      userId: profile.id,
      username: profile.username || "Unknown",
      xpPoints: profile.xpPoints,
      predictCredits: profile.predictCredits,
      rank: userRank || null,
      highestRank: peakRank,
      currentStreak: profile.currentStreak,
      longestStreak: profile.longestStreak,
      lastLoginDate: profile.lastLoginDate,
      capabilities
    };
  }

  /**
   * @deprecated Not currently wired into vote handlers. The voteMultiplier
   * column exists in the ranks table but all votes use weight 1.0. Keeping
   * this method for potential future use; remove if vote weighting by rank
   * is explicitly ruled out.
   */
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

  async getRanks(): Promise<Rank[]> {
    await this.ensureCache();
    return this.ranksCache;
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
