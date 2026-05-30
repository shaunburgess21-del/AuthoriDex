/**
 * Badge award engine.
 *
 * Mirrors the structural contract of `gamification.ts:awardXp` /
 * `gamification.ts:adjustCredits`:
 *
 *   - Single deterministic idempotency key per (user, badge).
 *   - Composite UNIQUE on `user_badges (user_id, badge_key)` is the
 *     guard rail when a caller forgets to pass the key — we still
 *     can't double-award.
 *   - Best-effort post-commit notification fanout.
 *   - Never throws; every failure path returns a structured result.
 *
 * The runtime award functions live here. The shared canonical badge
 * list lives in `shared/badge-config.ts` and is seeded into the
 * `badges` table by `seedBadges()` in
 * `server/scripts/seed-gamification.ts`.
 *
 * Per-surface check helpers (`checkAndAwardVoteBadges`, etc.) live
 * in this file too. They each load the relevant aggregate counts
 * once and call `awardBadge()` for every threshold the user has
 * crossed. Idempotency makes "award all that match" safe even when
 * the helper runs every time the surface fires (vote, prediction,
 * etc.).
 */

import { and, count, eq, inArray, sql } from "drizzle-orm";
import { db } from "../db";
import {
  badges,
  comments,
  commentVotes,
  communityInsights,
  insightVotes,
  marketBets,
  predictionMarkets,
  profiles,
  shareClicks,
  suggestions,
  userBadges,
  votes,
  type Badge,
} from "@shared/schema";
import { notificationDayBucket } from "../jobs/notification-buckets";
import { createNotification } from "./notifications";
import {
  BADGES,
  RANK_TIER_BADGE_KEYS,
  REFERRAL_COUNT_BADGE_KEYS,
  STREAK_MILESTONE_BADGE_KEYS,
  type BadgeConfig,
} from "@shared/badge-config";
import {
  isAvatarCustomizationEligible,
  type AvatarCustomizationCheckOpts,
} from "@shared/avatar-customization";

export type { AvatarCustomizationSource } from "@shared/avatar-customization";
export type TryAwardAvatarCustomizationOpts = AvatarCustomizationCheckOpts;

interface AwardBadgeResult {
  awarded: boolean;
  badge: BadgeConfig | Badge | null;
  /** "duplicate" | "inactive" | "unknown_badge" | "user_not_found" | "error" */
  reason?: string;
}

class BadgeService {
  private badgesCache: Map<string, Badge> = new Map();
  private cacheExpiry = 0;
  private readonly CACHE_TTL = 5 * 60 * 1000;

  private async ensureCache(): Promise<void> {
    if (Date.now() < this.cacheExpiry) return;
    const rows = await db.select().from(badges);
    this.badgesCache.clear();
    rows.forEach((b) => this.badgesCache.set(b.key, b));
    this.cacheExpiry = Date.now() + this.CACHE_TTL;
  }

  /** Force a refresh on next access. Called by admin CRUD endpoints. */
  invalidateCache(): void {
    this.cacheExpiry = 0;
  }

  /**
   * Award a badge to a user. Idempotent, never throws.
   *
   * Pass an explicit `idempotencyKey` for manual / admin-driven
   * awards (`badge_manual_${userId}_${badgeKey}` is the convention).
   * Automatic call sites can omit it; the helper falls back to the
   * canonical `badge_${userId}_${badgeKey}` shape.
   */
  async awardBadge(
    userId: string,
    badgeKey: string,
    idempotencyKey?: string,
    metadata?: Record<string, unknown>,
  ): Promise<AwardBadgeResult> {
    try {
      await this.ensureCache();

      const cached = this.badgesCache.get(badgeKey);
      // Fall back to the static config if the seed hasn't run yet —
      // matches the credit-action "db preferred, seed fallback" pattern
      // so a hotfix that ships a new badge key in code lands the row
      // even if the operator forgot to reseed.
      const seed = BADGES.find((b) => b.key === badgeKey);
      const definition: BadgeConfig | Badge | undefined = cached ?? seed;

      if (!definition) {
        return { awarded: false, badge: null, reason: "unknown_badge" };
      }

      const isActive =
        cached?.isActive ?? (seed ? seed.isActive : true);
      if (!isActive) {
        return { awarded: false, badge: definition, reason: "inactive" };
      }

      const [profile] = await db
        .select({ id: profiles.id })
        .from(profiles)
        .where(eq(profiles.id, userId))
        .limit(1);
      if (!profile) {
        return { awarded: false, badge: definition, reason: "user_not_found" };
      }

      const key = idempotencyKey ?? `badge_${userId}_${badgeKey}`;

      const inserted = await db
        .insert(userBadges)
        .values({
          userId,
          badgeKey,
          idempotencyKey: key,
          metadata: metadata ?? null,
        })
        .onConflictDoNothing()
        .returning({ id: userBadges.id });

      if (inserted.length === 0) {
        // Unique violation race or replay — already awarded.
        return { awarded: false, badge: definition, reason: "duplicate" };
      }

      // Best-effort notification fanout. badge_awarded is high-priority
      // so the client's realtime layer auto-toasts; for streak-keyed
      // badges the toast handler delays 4s so it doesn't fight the
      // existing streak milestone toast.
      try {
        const rarity =
          (cached?.rarity ?? seed?.rarity ?? "COMMON") as string;
        const name = cached?.name ?? seed?.name ?? badgeKey;
        const description =
          cached?.description ?? seed?.description ?? "You earned a badge.";
        const icon = cached?.icon ?? seed?.icon ?? "award";
        const dayBucket = notificationDayBucket();
        await createNotification({
          userId,
          kind: "badge_awarded",
          title: `New badge: ${name}`,
          body: description,
          href: "/me/badges",
          entityType: "badge",
          entityId: badgeKey,
          metadata: {
            badgeKey,
            badgeName: name,
            rarity,
            icon,
            description,
          },
          groupKey: `badge_awarded:${userId}:${dayBucket}`,
          idempotencyKey: `badge_awarded:${userId}:${badgeKey}`,
        });
      } catch (notifyErr) {
        console.warn("[badges] notification fanout failed", {
          userId,
          badgeKey,
          err: notifyErr,
        });
      }

      return { awarded: true, badge: definition };
    } catch (err) {
      console.error("[badges] awardBadge failed", { userId, badgeKey, err });
      return { awarded: false, badge: null, reason: "error" };
    }
  }

  /** Has this user already earned this badge? */
  async hasBadge(userId: string, badgeKey: string): Promise<boolean> {
    const [row] = await db
      .select({ id: userBadges.id })
      .from(userBadges)
      .where(and(eq(userBadges.userId, userId), eq(userBadges.badgeKey, badgeKey)))
      .limit(1);
    return !!row;
  }
}

export const badgeService = new BadgeService();

/* -----------------------------------------------------------------
 * Per-surface check helpers.
 * ---------------------------------------------------------------- */

const VOTE_COUNT_BADGES: Array<{ threshold: number; key: string }> = [
  { threshold: 1, key: "first_vote" },
  { threshold: 25, key: "quarter_century" },
  { threshold: 100, key: "century_citizen" },
  { threshold: 500, key: "dedicated_voter" },
  { threshold: 1000, key: "voxmax_voter" },
  { threshold: 10000, key: "legend_of_ballot" },
];

const PREDICTION_COUNT_BADGES: Array<{ threshold: number; key: string }> = [
  { threshold: 50, key: "forecaster_1" },
  { threshold: 500, key: "forecaster_2" },
  { threshold: 5000, key: "forecaster_3" },
];

const INSIGHT_COUNT_BADGES: Array<{ threshold: number; key: string }> = [
  { threshold: 1, key: "first_insight" },
  { threshold: 50, key: "thought_leader" },
];

const UPVOTE_RECEIVED_BADGES: Array<{ threshold: number; key: string }> = [
  { threshold: 10, key: "rising_voice" },
  { threshold: 100, key: "community_favourite" },
  { threshold: 500, key: "viral_voice" },
  { threshold: 1000, key: "legends_echo" },
];

const SUGGESTION_APPROVED_BADGES: Array<{ threshold: number; key: string }> = [
  { threshold: 1, key: "first_approved_suggestion" },
  { threshold: 10, key: "content_creator" },
];

/** Vote-cast surface: vote_count, sections, per-person, induction, curation. */
export async function checkAndAwardVoteBadges(userId: string): Promise<void> {
  if (!userId) return;
  try {
    // Single pass to compute total + per-type bucket — vote sections
    // and the induction/curation counts fall out of the same scan.
    const typeRows = await db
      .select({
        voteType: votes.voteType,
        count: sql<number>`count(*)::int`,
      })
      .from(votes)
      .where(eq(votes.userId, userId))
      .groupBy(votes.voteType);

    let total = 0;
    let inductionCount = 0;
    let curationCount = 0;
    const distinctTypes = new Set<string>();
    for (const row of typeRows) {
      const c = Number(row.count) || 0;
      total += c;
      distinctTypes.add(row.voteType);
      if (row.voteType === "induction") inductionCount += c;
      if (row.voteType === "image_curate") curationCount += c;
    }

    // Threshold sweeps — awardBadge() is idempotent so awarding on
    // every check is fine; the duplicate guard short-circuits.
    for (const t of VOTE_COUNT_BADGES) {
      if (total >= t.threshold) {
        await badgeService.awardBadge(userId, t.key, undefined, {
          totalVotes: total,
        });
      }
    }
    if (distinctTypes.size >= 4) {
      await badgeService.awardBadge(userId, "well_rounded", undefined, {
        sections: Array.from(distinctTypes),
      });
    }
    if (inductionCount >= 50) {
      await badgeService.awardBadge(userId, "induction_champion", undefined, {
        inductionVotes: inductionCount,
      });
    }
    if (curationCount >= 100) {
      await badgeService.awardBadge(userId, "image_curator", undefined, {
        curationVotes: curationCount,
      });
    }

    // Subject Shaper — any single person target with >= 5 votes from
    // this user. Cap target rows scanned; we only need to know if
    // ANY group has >= 5, so a HAVING clause is the cheapest check.
    const [shaperRow] = await db
      .select({
        targetId: votes.targetId,
        count: sql<number>`count(*)::int`,
      })
      .from(votes)
      .where(and(eq(votes.userId, userId), eq(votes.targetType, "person")))
      .groupBy(votes.targetId)
      .having(sql`count(*) >= 5`)
      .limit(1);

    if (shaperRow) {
      await badgeService.awardBadge(userId, "subject_shaper", undefined, {
        personId: shaperRow.targetId,
        votes: Number(shaperRow.count) || 5,
      });
    }
  } catch (err) {
    console.error("[badges] checkAndAwardVoteBadges failed", { userId, err });
  }
}

/** Prediction-placed surface: forecaster_1/2/3 by total bets count. */
export async function checkAndAwardPredictionBadges(
  userId: string,
): Promise<void> {
  if (!userId) return;
  try {
    const [{ count: total }] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(marketBets)
      .where(eq(marketBets.userId, userId));

    const totalNum = Number(total) || 0;
    for (const t of PREDICTION_COUNT_BADGES) {
      if (totalNum >= t.threshold) {
        await badgeService.awardBadge(userId, t.key, undefined, {
          totalPredictions: totalNum,
        });
      }
    }
  } catch (err) {
    console.error("[badges] checkAndAwardPredictionBadges failed", {
      userId,
      err,
    });
  }
}

/**
 * Prediction-resolved surface: first_win, sharp_mind, oracle,
 * jackpot_hunter. Called from the market resolver after a bet flips
 * to status='won'.
 */
export async function checkAndAwardPredictionWinBadges(
  userId: string,
): Promise<void> {
  if (!userId) return;
  try {
    // Tally settled outcomes in one pass — we need both win count
    // and total settled to compute win rate.
    const rows = await db
      .select({
        status: marketBets.status,
        count: sql<number>`count(*)::int`,
      })
      .from(marketBets)
      .where(
        and(
          eq(marketBets.userId, userId),
          inArray(marketBets.status, ["won", "lost"]),
        ),
      )
      .groupBy(marketBets.status);

    let won = 0;
    let lost = 0;
    for (const r of rows) {
      const c = Number(r.count) || 0;
      if (r.status === "won") won = c;
      else if (r.status === "lost") lost = c;
    }
    const settled = won + lost;

    if (won >= 1) {
      await badgeService.awardBadge(userId, "first_win", undefined, { wins: won });
    }
    if (settled >= 20 && won / settled >= 0.6) {
      await badgeService.awardBadge(userId, "sharp_mind", undefined, {
        winRate: won / settled,
        settled,
      });
    }
    if (settled >= 50 && won / settled >= 0.7) {
      await badgeService.awardBadge(userId, "oracle", undefined, {
        winRate: won / settled,
        settled,
      });
    }

    // Jackpot Hunter: at least one won bet on a jackpot market.
    const [jackpot] = await db
      .select({ id: marketBets.id })
      .from(marketBets)
      .innerJoin(
        predictionMarkets,
        eq(predictionMarkets.id, marketBets.marketId),
      )
      .where(
        and(
          eq(marketBets.userId, userId),
          eq(marketBets.status, "won"),
          eq(predictionMarkets.marketType, "jackpot"),
        ),
      )
      .limit(1);
    if (jackpot) {
      await badgeService.awardBadge(userId, "jackpot_hunter");
    }
  } catch (err) {
    console.error("[badges] checkAndAwardPredictionWinBadges failed", {
      userId,
      err,
    });
  }
}

/** Insight-posted surface: first_insight, thought_leader. */
export async function checkAndAwardInsightBadges(
  userId: string,
): Promise<void> {
  if (!userId) return;
  try {
    const [{ count: total }] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(communityInsights)
      .where(eq(communityInsights.userId, userId));

    const totalNum = Number(total) || 0;
    for (const t of INSIGHT_COUNT_BADGES) {
      if (totalNum >= t.threshold) {
        await badgeService.awardBadge(userId, t.key, undefined, {
          insights: totalNum,
        });
      }
    }
  } catch (err) {
    console.error("[badges] checkAndAwardInsightBadges failed", {
      userId,
      err,
    });
  }
}

/**
 * Upvote-received surface — the AUTHOR of the upvoted insight or
 * comment is checked. Aggregates insight upvotes (from
 * `insight_votes` where vote_type='up') + comment upvotes (from the
 * `comments.upvotes` materialized counter).
 */
export async function checkAndAwardUpvoteReceivedBadges(
  authorUserId: string,
): Promise<void> {
  if (!authorUserId) return;
  try {
    // Insight upvotes: count rows where vote_type='up' on insights
    // that this user authored.
    const [{ count: insightUpRaw }] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(insightVotes)
      .innerJoin(
        communityInsights,
        eq(communityInsights.id, insightVotes.insightId),
      )
      .where(
        and(
          eq(communityInsights.userId, authorUserId),
          eq(insightVotes.voteType, "up"),
        ),
      );

    // Comment upvotes: sum the materialized `upvotes` column on every
    // comment authored by this user. Safer than scanning comment_votes
    // because the column is the source of truth for the UI.
    const [{ total: commentUpRaw }] = await db
      .select({ total: sql<number>`coalesce(sum(${comments.upvotes}), 0)::int` })
      .from(comments)
      .where(eq(comments.userId, authorUserId));

    const total = (Number(insightUpRaw) || 0) + (Number(commentUpRaw) || 0);
    for (const t of UPVOTE_RECEIVED_BADGES) {
      if (total >= t.threshold) {
        await badgeService.awardBadge(authorUserId, t.key, undefined, {
          upvotesReceived: total,
        });
      }
    }
  } catch (err) {
    console.error("[badges] checkAndAwardUpvoteReceivedBadges failed", {
      authorUserId,
      err,
    });
  }
}

/** Suggestion-approved surface. */
export async function checkAndAwardSuggestionBadges(
  userId: string,
): Promise<void> {
  if (!userId) return;
  try {
    const [{ count: total }] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(suggestions)
      .where(
        and(
          eq(suggestions.submittedBy, userId),
          eq(suggestions.status, "approved"),
        ),
      );

    const totalNum = Number(total) || 0;
    for (const t of SUGGESTION_APPROVED_BADGES) {
      if (totalNum >= t.threshold) {
        await badgeService.awardBadge(userId, t.key, undefined, {
          approvedSuggestions: totalNum,
        });
      }
    }
  } catch (err) {
    console.error("[badges] checkAndAwardSuggestionBadges failed", {
      userId,
      err,
    });
  }
}

/**
 * Streak-milestone surface. Wired into POST
 * /api/gamification/daily-checkin so the badge fires alongside the
 * milestone XP + credit grants.
 */
export async function awardStreakMilestoneBadge(
  userId: string,
  milestoneDay: number,
): Promise<void> {
  const key = STREAK_MILESTONE_BADGE_KEYS[milestoneDay];
  if (!key) return;
  await badgeService.awardBadge(userId, key, undefined, { milestoneDay });
}

/**
 * Rank-promotion surface. Called from awardXp() post-commit branch
 * when the user's rank tier crosses 7 (Hall Inductee) or 8 (VoxMax
 * Legend). Lower tiers do not award badges in this category.
 */
export async function awardRankTierBadges(
  userId: string,
  newTier: number,
): Promise<void> {
  if (!userId || !newTier) return;
  for (const tierStr of Object.keys(RANK_TIER_BADGE_KEYS)) {
    const tier = Number(tierStr);
    if (newTier >= tier) {
      const key = RANK_TIER_BADGE_KEYS[tier];
      await badgeService.awardBadge(userId, key, undefined, { tier });
    }
  }
}

/**
 * Referral-milestone surface. Called from
 * `credits-earn.ts:maybeFireReferralCredit` immediately after the
 * referrer's `referral_completed` credit lands.
 */
export async function checkAndAwardReferralBadges(
  referrerUserId: string,
): Promise<void> {
  if (!referrerUserId) return;
  try {
    // Successful referrals = profiles where referred_by = me AND
    // first_action_at IS NOT NULL — same definition the /me
    // referral-stats card uses.
    const [{ count: total }] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(profiles)
      .where(
        and(
          eq(profiles.referredBy, referrerUserId),
          sql`${profiles.firstActionAt} IS NOT NULL`,
        ),
      );

    const totalNum = Number(total) || 0;
    for (const t of REFERRAL_COUNT_BADGE_KEYS) {
      if (totalNum >= t.threshold) {
        await badgeService.awardBadge(referrerUserId, t.key, undefined, {
          successfulReferrals: totalNum,
        });
      }
    }
  } catch (err) {
    console.error("[badges] checkAndAwardReferralBadges failed", {
      referrerUserId,
      err,
    });
  }
}

/**
 * Share-click surface. The Share Master badge fires on the FIRST
 * credited click only — subsequent clicks are no-ops via the
 * idempotency key.
 */
export async function checkAndAwardShareMasterBadge(
  sharerUserId: string,
): Promise<void> {
  if (!sharerUserId) return;
  try {
    const [row] = await db
      .select({ id: shareClicks.id })
      .from(shareClicks)
      .where(
        and(
          eq(shareClicks.sharerUserId, sharerUserId),
          eq(shareClicks.credited, true),
        ),
      )
      .limit(1);
    if (row) {
      await badgeService.awardBadge(sharerUserId, "share_master");
    }
  } catch (err) {
    console.error("[badges] checkAndAwardShareMasterBadge failed", {
      sharerUserId,
      err,
    });
  }
}

/**
 * Awards Fresh Look + profile_avatar XP when the user deliberately changes
 * their avatar from Settings (custom upload or generative re-pick). Never
 * fires during onboarding shuffle/auto-save.
 */
export async function tryAwardAvatarCustomizationBadge(
  userId: string,
  opts: TryAwardAvatarCustomizationOpts,
): Promise<void> {
  if (!userId || !isAvatarCustomizationEligible(opts)) return;

  try {
    await badgeService.awardBadge(userId, "avatar_uploaded");
  } catch (err) {
    console.warn("[badges] avatar_uploaded award failed", { userId, err });
  }

  try {
    const { gamificationService } = await import("./gamification");
    await gamificationService.awardXp(
      userId,
      "profile_avatar",
      `xp_profile_profile_avatar_${userId}`,
      { source: "profile_completion" },
    );
  } catch (err) {
    console.warn("[badges] xp profile_avatar failed", { userId, err });
  }
}

/**
 * Profile-completion surface. Called after every profile mutation
 * (PATCH /api/profile/me + avatar / username endpoints). Idempotent
 * on three levels:
 *
 *   1. user_badges UNIQUE drops repeat badge awards.
 *   2. xp_ledger.idempotency_key (`xp_profile_<key>_<userId>`,
 *      lifetime-keyed, no date) drops repeat XP awards.
 *   3. credit_ledger.idempotency_key (`credit_profile_<key>_<userId>`,
 *      same shape) drops repeat credit awards.
 *
 * Awards XP + credits + badges in a single sweep so the
 * "completing your profile pays N XP + M credits + a badge" UX
 * lands all three side-effects in one PATCH. Best-effort: each award
 * is independently try/catch'd so a single failure can't block the
 * others.
 */
export async function checkAndAwardProfileBadges(
  userId: string,
): Promise<void> {
  if (!userId) return;
  try {
    const [profile] = await db
      .select({
        username: profiles.username,
        fullName: profiles.fullName,
        bio: profiles.bio,
        dateOfBirth: profiles.dateOfBirth,
        gender: profiles.gender,
        countryOfOrigin: profiles.countryOfOrigin,
        countryOfResidence: profiles.countryOfResidence,
        ethnicity: profiles.ethnicity,
      })
      .from(profiles)
      .where(eq(profiles.id, userId))
      .limit(1);
    if (!profile) return;

    const hasText = (v: string | null | undefined) =>
      typeof v === "string" && v.trim().length > 0;

    // Lazy import to avoid the circular dep gamification → badges →
    // gamification (the rank-tier badge path already imports the
    // other direction at module init).
    const { gamificationService } = await import("./gamification");

    const awardProfileTier = async (key: string): Promise<void> => {
      try {
        await gamificationService.awardXp(
          userId,
          key,
          `xp_profile_${key}_${userId}`,
          { source: "profile_completion" },
        );
      } catch (err) {
        console.warn(`[badges] xp ${key} failed`, err);
      }
      // profile_avatar / community_member: XP only (no credit grant).
      const xpOnlyKeys = new Set(["profile_avatar", "community_member"]);
      if (!xpOnlyKeys.has(key)) {
        try {
          await gamificationService.adjustCredits(
            userId,
            key,
            `credit_profile_${key}_${userId}`,
            { metadata: { source: "profile_completion" } },
          );
        } catch (err) {
          console.warn(`[badges] credit ${key} failed`, err);
        }
      }
    };

    // Fresh Look (avatar_uploaded) is awarded only from Settings via
    // tryAwardAvatarCustomizationBadge — not here.
    // Display name = username (canonical) OR fullName (deprecated but
    // still readable for legacy rows).
    const hasName = hasText(profile.username) || hasText(profile.fullName);
    if (hasName && hasText(profile.bio)) {
      await badgeService.awardBadge(userId, "getting_personal");
      await awardProfileTier("profile_bio");
    }
    if (
      hasText(profile.dateOfBirth) &&
      hasText(profile.gender) &&
      hasText(profile.countryOfResidence)
    ) {
      const communityResult = await badgeService.awardBadge(
        userId,
        "community_member",
      );
      if (communityResult.awarded) {
        await awardProfileTier("community_member");
      }
    }
    if (
      hasText(profile.dateOfBirth) &&
      hasText(profile.gender) &&
      hasText(profile.countryOfOrigin) &&
      hasText(profile.countryOfResidence) &&
      hasText(profile.ethnicity)
    ) {
      await badgeService.awardBadge(userId, "full_voxmaxer");
      await awardProfileTier("profile_demographics");
    }
  } catch (err) {
    console.error("[badges] checkAndAwardProfileBadges failed", { userId, err });
  }
}
