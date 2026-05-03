import type { Express, Request, Response, NextFunction } from "express";
import express from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { getBaselineDiagnostics } from "./utils/baseline";
import { db } from "./db";
import { syncWinningAvatarForPerson } from "./lib/curateAvatar";
import { trendSnapshots, trackedPeople, communityInsights, insightVotes, comments as unifiedComments, commentVotes, matchups, votes, xpActions, xpLedger, celebrityImages, profiles, userFavourites, trendingPeople, creditLedger, adminAuditLog, predictionMarkets, marketEntries, marketBets, pageViews, apiCache, sentimentVotes, celebrityMetrics, celebrityValueVotes, userVotes, trendingPolls, trendingPollVotes, ingestionRuns, inductionCandidates, opinionPolls, opinionPollOptions, opinionPollVotes, imageVotes, imageFlags, inductionVotes, cardRelatedPeople, approvalSnapshots, commentReports, suggestions, profileItemPrivacy, contentCategories, userCategoryEngagement, insertCommunityInsightSchema, insertInsightVoteSchema, insertCommentVoteSchema, insertVoteSchema, type CelebrityProfile, type InsertCelebrityProfile, type Matchup, type Vote, type Profile, type TrendingPoll } from "@shared/schema";
import { validateSuggestionPayload, SUGGESTION_TYPES } from "@shared/suggestionSchemas";
import { normaliseSocialHandles } from "@shared/handleNormalise";
import { eq, desc, and, gt, sql, count, gte, lte, ilike, SQL, or, inArray, asc, lt, ne, isNotNull, isNull } from "drizzle-orm";
import { seedSupabasePersons } from "./supabase-seed";
import { supabaseServer } from "./supabase";
import { requireAuth, requireAdmin, optionalAuth, type AuthRequest } from "./auth-middleware";
import OpenAI from "openai";
import { createHash, randomUUID } from "crypto";
import multer, { MulterError } from "multer";
import path from "path";
import { gamificationService } from "./services/gamification";
import { createNotification, createNotificationsBulk } from "./services/notifications";
import { dispatchApproval, markSuggestionApproved, markSuggestionRejected } from "./services/suggestionApproval";
import { JACKPOT_TICKET_COST, JACKPOT_MAX_PREDICTED_SCORE } from "./config/constants";
import { isAdminRole } from "./utils/authz";
import { applyAdminCreditAdjustment } from "./utils/admin-credits";
import { IMAGE_FLAG_WINDOW_MS, isImageFlagRateLimited, isValidImageFlagReason } from "./utils/image-flags";
import { classifyImageVoteAction } from "./utils/image-vote-transition";
import { optimizeImage } from "./utils/image-optimize";
import geoip from "geoip-lite";
import { getTrendContext, getTrendContextBatch, formatRelativeTime, type TrendContext } from "./services/trend-context";
import { fetchTrendingNewsContext, probeSerperSearchLive, refreshSerperCacheForPerson, getSerperDegradedState, getSerperRunStats } from "./providers/serper";
import { generateProfilePreview, getOrGenerateCelebrityProfile } from "./services/profile-generator";
import { getSourceStats, refreshSourceStats } from "./scoring/sourceStats";
import {
  normalizeSourceValue,
  PLATFORM_WEIGHTS,
  MASS_ALLOCATION,
  VELOCITY_ALLOCATION,
  SCORE_VERSION,
  getNewsAggregationMode,
  getNewsAggregationFlippedAt,
  getRollingWindowDaysBaseline,
  getRollingWindowDaysNews,
} from "./scoring/normalize";
import {
  getCurrentHealthSnapshot,
  hasAnyDegradedSource,
  getHealthSummary,
  getStalenessDecayFactor,
} from "./scoring/sourceHealth";
import { getLastFullRefreshAt } from "./jobs/live-tick";
import { getLastRunMeta } from "./jobs/ingest";
import { getMediastackBudgetSummary, getMediastackRefreshIntervalMinutes, probeMediastackLive } from "./providers/mediastack";
import pLimit from "p-limit";
import { buildOpeningScores } from "./native-markets/openingScores";
import { generateWeeklyUpDown, generateWeeklyJackpot, generateWeeklyH2H, generateWeeklyGainer, getWeekContext, ensureWeeklyMarketsForCurrentWeek } from "./jobs/market-generator";
import { voidMarketBets } from "./jobs/market-resolver";
import { deriveNativeMarketLifecycle, getWeeklyBettingCutoff } from "./native-markets/lifecycle";
import { recomputeCelebrityMetrics } from "./services/celebrity-metrics-recompute";
import { z, ZodError } from "zod";
import { sendError, sendBadRequest, sendZodError } from "./utils/api-response";
import { approveInductionCandidate } from "./services/induction-service";
import { CANONICAL_MARKET_CATEGORIES, getMarketCategoryLabel, normalizeMarketCategory, CANONICAL_CATEGORIES } from "@shared/constants";
import {
  shouldUseColdStart,
  orderRecencyForUser,
  orderFeaturedRecencyForUser,
  orderSeedVotesForUser,
  orderFeaturedCategoryForUser,
} from "./lib/coldStartOrder";
import { upsertEngagement } from "./lib/engagementWriter";
import { captureBackgroundError } from "./sentry";
import { computeBlendStateForUser } from "./lib/blendedRank";
import {
  BEHAVIOUR_HALF_LIFE_DAYS,
  BEHAVIOUR_RAMP_MIN_CATEGORIES,
  BEHAVIOUR_RAMP_FULL_CATEGORIES,
  BLEND_STATED_WEEK_1,
  BLEND_STATED_WEEK_4,
  PREDICTION_STAKE_WEIGHT_CAP,
} from "./lib/rankingConfig";
import { resolvePublicMatchupBySlugOrId } from "./utils/matchup-resolve";
import { registerCronRoutes, registerPublicRoutes, registerGamificationRoutes, registerFavoritesRoutes, registerNotificationsRoutes, registerOgRoutes } from "./route-modules";
import { handleAuthHook } from "./emails/routes/auth-hook";
import { sendEmail } from "./emails/send";
import { WelcomeEmail, welcomeSubject } from "./emails/templates/lifecycle/Welcome";
// React is needed (not TSX) to construct the welcome email element via
// React.createElement, since routes.ts is a .ts file and can't use JSX.
// Mirrors how server/emails/routes/auth-hook.ts builds VerifyEmail.
import * as React from "react";
import { h2hModelProbability } from "@shared/h2hModel";
import { getAiModel, getChatCompletionTokenLimit } from "./config/ai-models";

const VIEW_DEDUPE_WINDOW_MS = 10 * 60 * 1000;
const VIEW_IP_RATE_LIMIT = 30;
const COMMENT_MAX_LENGTH = 5000;
type CommentVoteState = "up" | "down" | null;
type ParentVoteLabel =
  | { type: "trending_poll"; choice: string }
  | { type: "matchup"; choice: string; optionName: string }
  | { type: "opinion_poll"; optionName: string }
  | { type: "approval_rating"; rating: number }
  | null;
type CommentAuthorJoin = {
  authorId: string | null;
  authorUsername: string | null;
  authorAvatarUrl: string | null;
};
const DELETED_COMMENT_AUTHOR_USERNAME = "[deleted user]";
const commentAuthorSelect = {
  authorId: profiles.id,
  authorUsername: profiles.username,
  authorAvatarUrl: profiles.avatarUrl,
};
function formatCommentAuthor(author: CommentAuthorJoin) {
  if (!author.authorId) {
    return { username: DELETED_COMMENT_AUTHOR_USERNAME, avatarUrl: null };
  }

  return {
    username: author.authorUsername,
    avatarUrl: author.authorAvatarUrl,
  };
}

const COMMENT_PARENT_TYPES = ["community_insight", "matchup", "trending_poll", "opinion_poll", "open_market"] as const;
type CommentParentType = typeof COMMENT_PARENT_TYPES[number];

const commentParentTypeSchema = z.enum(COMMENT_PARENT_TYPES);
const commentVoteTypeSchema = z.enum(["up", "down"]);

function isCommentVoteState(value: unknown): value is Exclude<CommentVoteState, null> {
  return value === "up" || value === "down";
}

function uniqueStrings(values: Array<string | null | undefined>): string[] {
  return Array.from(new Set(values.filter((value): value is string => Boolean(value))));
}

/** Compare stored DB category text to a canonical registry id (handles legacy title-case vs kebab-case). */
function storedMatchesCanonicalCategory(stored: string | null | undefined, canonicalId: string): boolean {
  if (stored == null || stored === "") return false;
  return normalizeMarketCategory(stored) === canonicalId;
}

type CategoryUsageBreakdown = {
  celebrities: number;
  trendingPolls: number;
  opinionPolls: number;
  faceOffs: number;
  inductionCandidates: number;
  predictionMarkets: number;
  leaderboardRows: number;
};

function sumCategoryUsage(u: CategoryUsageBreakdown): number {
  return (
    u.celebrities +
    u.trendingPolls +
    u.opinionPolls +
    u.faceOffs +
    u.inductionCandidates +
    u.predictionMarkets +
    u.leaderboardRows
  );
}

function usageBreakdownForId(
  canonicalId: string,
  buckets: {
    trackedPeopleCats: { id: string; category: string | null }[];
    trendingPollCats: { category: string | null }[];
    opinionPollCats: { category: string | null }[];
    faceOffCats: { category: string | null }[];
    inductionCats: { category: string | null }[];
    marketCats: { category: string | null }[];
    trendingPeopleCats: { id: string; category: string | null }[];
  },
): CategoryUsageBreakdown {
  const cnt = (rows: { category: string | null }[]) =>
    rows.filter((r) => storedMatchesCanonicalCategory(r.category, canonicalId)).length;

  const celebRows = buckets.trackedPeopleCats.filter((r) =>
    storedMatchesCanonicalCategory(r.category, canonicalId),
  );
  const celebrities = celebRows.length;
  const celebIds = new Set(celebRows.map((r) => r.id));

  const trendingMatching = buckets.trendingPeopleCats.filter((r) =>
    storedMatchesCanonicalCategory(r.category, canonicalId),
  );
  // Avoid double-counting the same person: leaderboard cache mirrors tracked_people for synced rows.
  const leaderboardRows = trendingMatching.filter((r) => !celebIds.has(r.id)).length;

  return {
    celebrities,
    trendingPolls: cnt(buckets.trendingPollCats),
    opinionPolls: cnt(buckets.opinionPollCats),
    faceOffs: cnt(buckets.faceOffCats),
    inductionCandidates: cnt(buckets.inductionCats),
    predictionMarkets: cnt(buckets.marketCats),
    leaderboardRows,
  };
}

function reportEntityTypeForCommentParent(parentType: CommentParentType): string {
  if (parentType === "trending_poll") return "poll";
  if (parentType === "opinion_poll") return "opinion-poll";
  if (parentType === "open_market") return "open-market";
  return parentType;
}

async function resolveUnifiedCommentParent(input: {
  parentType: CommentParentType;
  parentId?: string | null;
  parentSlug?: string | null;
}): Promise<string | null> {
  const parentId = input.parentId?.trim();
  const parentSlug = input.parentSlug?.trim();

  if (input.parentType === "community_insight") {
    if (!parentId) return null;
    const [insight] = await db
      .select({ id: communityInsights.id, deletedAt: communityInsights.deletedAt })
      .from(communityInsights)
      .where(eq(communityInsights.id, parentId))
      .limit(1);
    return insight?.id ?? null;
  }

  if (!parentSlug) return null;

  if (input.parentType === "matchup") {
    const matchup = await resolvePublicMatchupBySlugOrId(parentSlug);
    return matchup?.id ?? null;
  }

  if (input.parentType === "trending_poll") {
    const [poll] = await db
      .select({ id: trendingPolls.id })
      .from(trendingPolls)
      .where(eq(trendingPolls.slug, parentSlug))
      .limit(1);
    return poll?.id ?? null;
  }

  if (input.parentType === "opinion_poll") {
    const [poll] = await db
      .select({ id: opinionPolls.id })
      .from(opinionPolls)
      .where(eq(opinionPolls.slug, parentSlug))
      .limit(1);
    return poll?.id ?? null;
  }

  const [market] = await db
    .select({ id: predictionMarkets.id })
    .from(predictionMarkets)
    .where(and(
      eq(predictionMarkets.slug, parentSlug),
      eq(predictionMarkets.marketType, "community"),
    ))
    .limit(1);
  return market?.id ?? null;
}

/**
 * Build the canonical client-side URL for a unified comment so we can
 * deep-link from notifications. Falls back to `/me` if the parent has
 * been deleted or its slug can't be resolved — better a soft landing
 * than a 404.
 */
async function resolveUnifiedCommentHref(parentType: CommentParentType, parentId: string): Promise<string> {
  try {
    if (parentType === "community_insight") {
      // Insights live on the person detail page; we need the personId.
      const [row] = await db
        .select({ personId: communityInsights.personId })
        .from(communityInsights)
        .where(eq(communityInsights.id, parentId))
        .limit(1);
      return row?.personId ? `/person/${row.personId}` : "/me";
    }
    if (parentType === "matchup") {
      const [row] = await db
        .select({ slug: matchups.slug })
        .from(matchups)
        .where(eq(matchups.id, parentId))
        .limit(1);
      return row?.slug ? `/vote/matchups/${row.slug}` : "/vote";
    }
    if (parentType === "trending_poll") {
      const [row] = await db
        .select({ slug: trendingPolls.slug })
        .from(trendingPolls)
        .where(eq(trendingPolls.id, parentId))
        .limit(1);
      return row?.slug ? `/polls/${row.slug}` : "/vote";
    }
    if (parentType === "opinion_poll") {
      const [row] = await db
        .select({ slug: opinionPolls.slug })
        .from(opinionPolls)
        .where(eq(opinionPolls.id, parentId))
        .limit(1);
      return row?.slug ? `/vote/opinion-polls/${row.slug}` : "/vote";
    }
    if (parentType === "open_market") {
      const [row] = await db
        .select({ slug: predictionMarkets.slug })
        .from(predictionMarkets)
        .where(eq(predictionMarkets.id, parentId))
        .limit(1);
      return row?.slug ? `/markets/${row.slug}` : "/predict";
    }
  } catch {
    // Swallow — notifications fanout must never break the originating flow.
  }
  return "/me";
}

async function getCommentParentVoteLabelMap(input: {
  parentType: CommentParentType;
  parentId: string;
  comments: Array<{ id: string; userId: string; deletedAt: Date | null }>;
}): Promise<Map<string, ParentVoteLabel>> {
  const liveComments = input.comments.filter(comment => !comment.deletedAt);
  const userIds = uniqueStrings(liveComments.map(comment => comment.userId));
  const labelByCommentId = new Map<string, ParentVoteLabel>();
  if (liveComments.length === 0 || userIds.length === 0) return labelByCommentId;

  const applyLabelsByUserId = (labelByUserId: Map<string, ParentVoteLabel>) => {
    for (const comment of liveComments) {
      labelByCommentId.set(comment.id, labelByUserId.get(comment.userId) ?? null);
    }
  };

  if (input.parentType === "trending_poll") {
    const parentVotes = await db
      .select({
        userId: trendingPollVotes.userId,
        choice: trendingPollVotes.choice,
      })
      .from(trendingPollVotes)
      .where(and(
        eq(trendingPollVotes.pollId, input.parentId),
        inArray(trendingPollVotes.userId, userIds),
      ));
    applyLabelsByUserId(new Map(parentVotes.map(vote => [
      vote.userId,
      { type: "trending_poll", choice: vote.choice },
    ])));
    return labelByCommentId;
  }

  if (input.parentType === "matchup") {
    const parentVotes = await db
      .select({
        userId: votes.userId,
        choice: votes.value,
        optionAName: matchups.optionAText,
        optionBName: matchups.optionBText,
      })
      .from(votes)
      .leftJoin(matchups, eq(matchups.id, votes.targetId))
      .where(and(
        eq(votes.voteType, "face_off"),
        eq(votes.targetType, "face_off"),
        eq(votes.targetId, input.parentId),
        inArray(votes.userId, userIds),
      ));
    applyLabelsByUserId(new Map(parentVotes.map(vote => {
      const optionName =
        vote.choice === "option_a"
          ? vote.optionAName
          : vote.choice === "option_b"
            ? vote.optionBName
            : "neutral";
      return [
        vote.userId,
        { type: "matchup", choice: vote.choice, optionName: optionName ?? "neutral" },
      ];
    })));
    return labelByCommentId;
  }

  if (input.parentType === "opinion_poll") {
    const parentVotes = await db
      .select({
        userId: opinionPollVotes.userId,
        optionName: opinionPollOptions.name,
      })
      .from(opinionPollVotes)
      .leftJoin(opinionPollOptions, eq(opinionPollOptions.id, opinionPollVotes.optionId))
      .where(and(
        eq(opinionPollVotes.pollId, input.parentId),
        inArray(opinionPollVotes.userId, userIds),
      ));
    applyLabelsByUserId(new Map(parentVotes.map(vote => [
      vote.userId,
      vote.optionName ? { type: "opinion_poll", optionName: vote.optionName } : null,
    ])));
    return labelByCommentId;
  }

  if (input.parentType === "community_insight") {
    const [insight] = await db
      .select({ personId: communityInsights.personId })
      .from(communityInsights)
      .where(eq(communityInsights.id, input.parentId))
      .limit(1);
    if (!insight) return labelByCommentId;

    const parentVotes = await db
      .select({
        userId: userVotes.userId,
        rating: userVotes.rating,
      })
      .from(userVotes)
      .where(and(
        eq(userVotes.personId, insight.personId),
        inArray(userVotes.userId, userIds),
      ));
    applyLabelsByUserId(new Map(parentVotes.map(vote => [
      vote.userId,
      { type: "approval_rating", rating: vote.rating },
    ])));
  }

  return labelByCommentId;
}

async function getInsightParentVoteLabelMap(input: {
  personId: string;
  insights: Array<{ id: string; userId: string; deletedAt: Date | null }>;
}): Promise<Map<string, ParentVoteLabel>> {
  const liveInsights = input.insights.filter(insight => !insight.deletedAt);
  const userIds = uniqueStrings(liveInsights.map(insight => insight.userId));
  const labelByInsightId = new Map<string, ParentVoteLabel>();
  if (liveInsights.length === 0 || userIds.length === 0) return labelByInsightId;

  const parentVotes = await db
    .select({
      userId: userVotes.userId,
      rating: userVotes.rating,
    })
    .from(userVotes)
    .where(and(
      eq(userVotes.personId, input.personId),
      inArray(userVotes.userId, userIds),
    ));
  const labelByUserId = new Map(parentVotes.map(vote => [
    vote.userId,
    { type: "approval_rating", rating: vote.rating } satisfies ParentVoteLabel,
  ]));

  for (const insight of liveInsights) {
    labelByInsightId.set(insight.id, labelByUserId.get(insight.userId) ?? null);
  }

  return labelByInsightId;
}

function toUnifiedCommentItem(row: {
  id: string;
  userId: string;
  body: string;
  parentCommentId: string | null;
  upvotes: number;
  downvotes: number;
  deletedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
} & CommentAuthorJoin, userVote: CommentVoteState = null, parentVoteLabel: ParentVoteLabel = null) {
  const { authorId, authorUsername, authorAvatarUrl, ...comment } = row;
  const isDeleted = Boolean(comment.deletedAt);
  return {
    ...comment,
    body: isDeleted ? "" : comment.body,
    ...(isDeleted
      ? { username: DELETED_COMMENT_AUTHOR_USERNAME, avatarUrl: null }
      : formatCommentAuthor({ authorId, authorUsername, authorAvatarUrl })),
    userVote,
    parentVoteLabel: isDeleted ? null : parentVoteLabel,
  };
}
const BOT_UA_PATTERNS = /bot|crawl|spider|slurp|wget|curl|fetch|headless|phantom|puppet|selenium|lighthouse|preview|embed|scrape/i;
const PREFETCH_HEADERS = ['purpose', 'sec-purpose', 'x-purpose'];
const SESSION_COOKIE_NAME = 'fdx_sid';
const LEADERBOARD_DEFAULT_LIMIT = 100;
const LEADERBOARD_MAX_LIMIT = Math.max(
  LEADERBOARD_DEFAULT_LIMIT,
  parseInt(process.env.LEADERBOARD_MAX_LIMIT || "500", 10) || 500,
);
const LEADERBOARD_MAX_OFFSET = Math.max(
  0,
  parseInt(process.env.LEADERBOARD_MAX_OFFSET || "20000", 10) || 20000,
);
const NATIVE_MARKETS_SELF_HEAL_COOLDOWN_MS = 2 * 60 * 1000;

const _viewDedupe = new Map<string, number>();
const _viewIpCounts = new Map<string, { count: number; resetAt: number }>();
const _nativeMarketsSelfHealByType = new Map<string, number>();

function cleanViewDedupe() {
  const now = Date.now();
  Array.from(_viewDedupe.entries()).forEach(([key, ts]) => {
    if (now - ts > VIEW_DEDUPE_WINDOW_MS) _viewDedupe.delete(key);
  });
  Array.from(_viewIpCounts.entries()).forEach(([ip, bucket]) => {
    if (now > bucket.resetAt) _viewIpCounts.delete(ip);
  });
}
setInterval(cleanViewDedupe, 5 * 60 * 1000);

function getSessionId(req: Request): string {
  const cookieHeader = req.headers.cookie || '';
  const match = cookieHeader.match(new RegExp(`(?:^|;\\s*)${SESSION_COOKIE_NAME}=([^;]+)`));
  if (match && match[1] && match[1].length > 8) return match[1];
  return '';
}

function isPrefetch(req: Request): boolean {
  for (const h of PREFETCH_HEADERS) {
    const val = req.headers[h];
    if (val && /prefetch/i.test(String(val))) return true;
  }
  return false;
}

function shouldCountView(req: Request, personId: string): boolean {
  if (req.method !== 'GET') return false;
  if (isPrefetch(req)) return false;

  const ua = req.headers['user-agent'] || '';
  if (BOT_UA_PATTERNS.test(ua)) return false;

  const now = Date.now();
  const sessionId = getSessionId(req);
  const clientIp = req.ip || 'unknown';
  const identity = sessionId || clientIp;
  const dedupeKey = `${identity}:${personId}`;
  const lastSeen = _viewDedupe.get(dedupeKey);
  if (lastSeen && now - lastSeen < VIEW_DEDUPE_WINDOW_MS) return false;

  const bucket = _viewIpCounts.get(clientIp);
  if (bucket && now < bucket.resetAt) {
    if (bucket.count >= VIEW_IP_RATE_LIMIT) return false;
    bucket.count++;
  } else {
    _viewIpCounts.set(clientIp, { count: 1, resetAt: now + VIEW_DEDUPE_WINDOW_MS });
  }

  _viewDedupe.set(dedupeKey, now);
  return true;
}

// Cached snapshot rank lookup (shared between /api/trending and /api/leaderboard)
// Pinned baseline: only re-selects when a new completed ingestion run is detected.
// This matches the "APIs refresh hourly" mental model — Hot Movers only changes
// when genuinely new data arrives, never due to time passing.
let _cachedPrevRanks: Map<string, number> | null = null;
let _lastCompletedRunId: string | null = null;

type HotMoversResponse = {
  data: Array<Record<string, unknown>>;
  meta: {
    currentRunId: string | null;
    currentRunFinishedAt: string | null;
    baseline24hRunId: string | null;
    baseline24hAgeHours: number | null;
    baselineStatus: string;
    coveragePct: number | null;
    scoreVersion: string | null;
    smoothingMode: string;
    newsAggregationMode: string;
  };
};
let _cachedHotMovers: HotMoversResponse | null = null;
let _hotMoversCachedAt: number = 0;
let _hotMoversCachedRunId: string | null = null;
const HOT_MOVERS_TTL_MS = 10 * 60 * 1000; // 10 minutes

function parseBoundedInt(value: unknown, fallback: number, min: number, max: number): number {
  const parsed = typeof value === "string" ? parseInt(value, 10) : Number.NaN;
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

async function getSupabaseAuthEmail(userId: string): Promise<string | null> {
  try {
    const result = await supabaseServer.auth.admin.getUserById(userId);
    if (result.error) {
      console.warn(`[Admin Users] Failed to load auth email for ${userId}: ${result.error.message}`);
      return null;
    }
    return result.data.user?.email || null;
  } catch (error: any) {
    console.warn(`[Admin Users] Error loading auth email for ${userId}: ${error?.message || "unknown error"}`);
    return null;
  }
}

async function getLatestCompletedRunId(): Promise<string | null> {
  try {
    const [row] = await db
      .select({ id: ingestionRuns.id })
      .from(ingestionRuns)
      .where(eq(ingestionRuns.status, "completed"))
      .orderBy(desc(ingestionRuns.finishedAt))
      .limit(1);
    return row?.id ?? null;
  } catch {
    return null;
  }
}

async function getSnapshotRankMap(): Promise<Map<string, number>> {
  const now = Date.now();

  const newestRunId = await getLatestCompletedRunId();
  const newRunCompleted = newestRunId && newestRunId !== _lastCompletedRunId;

  if (_cachedPrevRanks && _cachedPrevRanks.size > 0 && !newRunCompleted) {
    return _cachedPrevRanks;
  }

  if (newestRunId) {
    _lastCompletedRunId = newestRunId;
  }

  const map = new Map<string, number>();
  try {
    const t24hAgo = new Date(now - 24 * 60 * 60 * 1000);

    // Strategy 1: Find the closest completed ingestion run to 24h ago (preferred)
    const [baselineRun] = await db
      .select({ id: ingestionRuns.id })
      .from(ingestionRuns)
      .where(and(
        eq(ingestionRuns.status, "completed"),
        eq(ingestionRuns.scoreVersion, SCORE_VERSION),
        gt(ingestionRuns.finishedAt, new Date(now - 28 * 60 * 60 * 1000)),
        sql`${ingestionRuns.finishedAt} < ${new Date(now - 20 * 60 * 60 * 1000)}`
      ))
      .orderBy(sql`ABS(EXTRACT(EPOCH FROM ${ingestionRuns.finishedAt} - ${t24hAgo}::timestamp))`)
      .limit(1);

    if (baselineRun) {
      const prevSnapshot = await db
        .select({
          personId: trendSnapshots.personId,
          fameIndex: sql<number>`MAX(${trendSnapshots.fameIndex})`,
        })
        .from(trendSnapshots)
        .where(eq(trendSnapshots.runId, baselineRun.id))
        .groupBy(trendSnapshots.personId)
        .orderBy(sql`MAX(${trendSnapshots.fameIndex}) DESC NULLS LAST`);

      prevSnapshot.forEach((s, i) => {
        map.set(s.personId, i + 1);
      });
    } else {
      // Strategy 2: Fallback to hour-bucketed timestamps, but ONLY trusted snapshots (run_id IS NOT NULL)
      const targetHour = new Date(t24hAgo);
      targetHour.setMinutes(0, 0, 0);
      const tLow = new Date(targetHour.getTime() - 8 * 60 * 60 * 1000);
      const tHigh = new Date(targetHour.getTime() + 8 * 60 * 60 * 1000);

      const nearestHourRow = await db
        .select({ hour: sql<string>`date_trunc('hour', ${trendSnapshots.timestamp})` })
        .from(trendSnapshots)
        .where(and(
          sql`${trendSnapshots.timestamp} BETWEEN ${tLow} AND ${tHigh}`,
          isNotNull(trendSnapshots.runId)
        ))
        .groupBy(sql`date_trunc('hour', ${trendSnapshots.timestamp})`)
        .orderBy(sql`ABS(EXTRACT(EPOCH FROM date_trunc('hour', ${trendSnapshots.timestamp}) - ${targetHour}::timestamp))`)
        .limit(1);

      if (nearestHourRow.length > 0) {
        const snapshotHour = new Date(nearestHourRow[0].hour);
        const snapshotHourEnd = new Date(snapshotHour.getTime() + 60 * 60 * 1000);

        const prevSnapshot = await db
          .select({
            personId: trendSnapshots.personId,
            fameIndex: sql<number>`MAX(${trendSnapshots.fameIndex})`,
          })
          .from(trendSnapshots)
          .where(and(
            sql`${trendSnapshots.timestamp} >= ${snapshotHour} AND ${trendSnapshots.timestamp} < ${snapshotHourEnd}`,
            isNotNull(trendSnapshots.runId)
          ))
          .groupBy(trendSnapshots.personId)
          .orderBy(sql`MAX(${trendSnapshots.fameIndex}) DESC NULLS LAST`);

        prevSnapshot.forEach((s, i) => {
          map.set(s.personId, i + 1);
        });
      }
    }
  } catch (e) {
    console.warn("[rankChange] Snapshot rank computation failed:", e);
  }

  if (map.size > 0) {
    _cachedPrevRanks = map;
  }
  return map;
}

const BET_RATE_WINDOW_MS = 60_000;
const BET_RATE_MAX = 10;
const betRateMap = new Map<string, number[]>();

function checkBetRateLimit(userId: string): boolean {
  const now = Date.now();
  const timestamps = betRateMap.get(userId) || [];
  const recent = timestamps.filter(t => now - t < BET_RATE_WINDOW_MS);
  if (recent.length >= BET_RATE_MAX) {
    betRateMap.set(userId, recent);
    return false;
  }
  recent.push(now);
  betRateMap.set(userId, recent);
  return true;
}

setInterval(() => {
  const cutoff = Date.now() - BET_RATE_WINDOW_MS * 2;
  for (const [uid, ts] of Array.from(betRateMap.entries())) {
    const filtered = (ts as number[]).filter((t: number) => t > cutoff);
    if (filtered.length === 0) betRateMap.delete(uid);
    else betRateMap.set(uid, filtered);
  }
}, 300_000);

const VOTE_RATE_WINDOW_MS = 60_000;
const VOTE_RATE_MAX = 30;
const voteRateMap = new Map<string, number[]>();

function checkVoteRateLimit(userId: string): boolean {
  const now = Date.now();
  const timestamps = voteRateMap.get(userId) || [];
  const recent = timestamps.filter(t => now - t < VOTE_RATE_WINDOW_MS);
  if (recent.length >= VOTE_RATE_MAX) {
    voteRateMap.set(userId, recent);
    return false;
  }
  recent.push(now);
  voteRateMap.set(userId, recent);
  return true;
}

setInterval(() => {
  const cutoff = Date.now() - VOTE_RATE_WINDOW_MS * 2;
  for (const [uid, ts] of Array.from(voteRateMap.entries())) {
    const filtered = (ts as number[]).filter((t: number) => t > cutoff);
    if (filtered.length === 0) voteRateMap.delete(uid);
    else voteRateMap.set(uid, filtered);
  }
}, 300_000);

async function getRelatedPeopleForCards(cardType: string, cardIds: string[]): Promise<Record<string, { id: string; name: string }[]>> {
  if (cardIds.length === 0) return {};
  const rows = await db
    .select({
      cardId: cardRelatedPeople.cardId,
      personId: cardRelatedPeople.personId,
      personName: trackedPeople.name,
    })
    .from(cardRelatedPeople)
    .innerJoin(trackedPeople, eq(cardRelatedPeople.personId, trackedPeople.id))
    .where(and(eq(cardRelatedPeople.cardType, cardType), inArray(cardRelatedPeople.cardId, cardIds)));
  const map: Record<string, { id: string; name: string }[]> = {};
  for (const r of rows) {
    (map[r.cardId] ||= []).push({ id: r.personId, name: r.personName });
  }
  return map;
}

async function syncRelatedPeople(cardType: string, cardId: string, personIds: string[]): Promise<void> {
  await db.delete(cardRelatedPeople).where(
    and(eq(cardRelatedPeople.cardType, cardType), eq(cardRelatedPeople.cardId, cardId))
  );
  if (personIds.length > 0) {
    await db.insert(cardRelatedPeople).values(
      personIds.map(pid => ({ cardType, cardId, personId: pid }))
    );
  }
}

function generateImageSlug(name: string): string {
  return name
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

function extractImageFilenameFromUrl(imageUrl: string | null | undefined): string | null {
  if (!imageUrl) return null;
  try {
    const url = new URL(imageUrl);
    const raw = url.pathname.split("/").filter(Boolean).pop();
    return raw ? decodeURIComponent(raw) : null;
  } catch {
    const raw = imageUrl.split("/").filter(Boolean).pop();
    return raw ? decodeURIComponent(raw.split("?")[0]) : null;
  }
}

function buildCelebrityLargePublicUrl(supabaseUrl: string, slug: string, filename: string): string {
  return `${supabaseUrl}/storage/v1/object/public/celebrity-large/${encodeURIComponent(slug)}/${filename}`;
}

function imageUrlMatchesCurrentSlugPath(imageUrl: string | null | undefined, slug: string, filename?: string | null): boolean {
  if (!imageUrl || !slug) return false;
  try {
    const path = decodeURIComponent(new URL(imageUrl).pathname);
    const expectedPrefix = `/storage/v1/object/public/celebrity-large/${slug}/`;
    if (!path.includes(expectedPrefix)) return false;
    if (!filename) return true;
    return extractImageFilenameFromUrl(imageUrl) === filename;
  } catch {
    const decoded = decodeURIComponent(imageUrl);
    const expectedPrefix = `/storage/v1/object/public/celebrity-large/${slug}/`;
    if (!decoded.includes(expectedPrefix)) return false;
    if (!filename) return true;
    return extractImageFilenameFromUrl(imageUrl) === filename;
  }
}

function buildMarketResolutionSummary(resolutionNotes: string | null | undefined) {
  if (!resolutionNotes || !resolutionNotes.trim()) return null;

  try {
    const parsed = JSON.parse(resolutionNotes) as Record<string, unknown>;
    if (!parsed || typeof parsed !== "object") return null;

    return {
      outcomeLabel: typeof parsed.outcome === "string" ? parsed.outcome : null,
      openScore: typeof parsed.openScore === "number" ? parsed.openScore : null,
      closeScore: typeof parsed.closeScore === "number" ? parsed.closeScore : null,
      actualScore: typeof parsed.actualScore === "number" ? parsed.actualScore : null,
      winningPrediction: typeof parsed.winningPrediction === "number" ? parsed.winningPrediction : null,
      margin: typeof parsed.margin === "number" ? parsed.margin : null,
      closeSnapshotAt: typeof parsed.closeSnapshotAt === "string" ? parsed.closeSnapshotAt : null,
      notesText: null,
    };
  } catch {
    return {
      outcomeLabel: null,
      openScore: null,
      closeScore: null,
      actualScore: null,
      winningPrediction: null,
      margin: null,
      closeSnapshotAt: null,
      notesText: resolutionNotes,
    };
  }
}

export async function registerRoutes(app: Express): Promise<Server> {
  // Note: Using local PostgreSQL database instead of Supabase
  // Supabase seeding disabled while Supabase is paused
  // seedSupabasePersons().catch(err => {
  //   console.error('Failed to seed Supabase:', err);
  // });

  // ============ PAGE VIEW TRACKING MIDDLEWARE ============
  // Log page views for analytics (only public frontend routes)
  app.use((req, res, next) => {
    // Skip API calls, static assets, admin routes, and health checks
    if (req.path.startsWith('/api/') || 
        req.path.startsWith('/assets/') ||
        req.path.startsWith('/admin') ||
        req.path.includes('.') ||
        req.path === '/favicon.ico') {
      return next();
    }
    
    // Resolve country from IP before the request object is recycled
    const forwarded = req.headers['x-forwarded-for'];
    const ip = (typeof forwarded === 'string' ? forwarded.split(',')[0].trim() : req.socket.remoteAddress) || null;
    let country: string | null = null;
    if (ip) {
      const geo = geoip.lookup(ip);
      if (geo?.country) country = geo.country;
    }

    const pageData = {
      path: req.path,
      userAgent: req.headers['user-agent'] || null,
      referrer: req.headers['referer'] || null,
      sessionId: (req as any).sessionID || null,
      country,
    };
    
    // Log the page view asynchronously (don't block the response)
    setImmediate(async () => {
      try {
        await db.insert(pageViews).values(pageData);
      } catch (err) {
        // Silently fail - don't break the app if analytics fails
        console.error('[PageView] Failed to log:', err);
      }
    });
    
    next();
  });

  registerPublicRoutes(app);
  registerGamificationRoutes(app);
  registerFavoritesRoutes(app);
  registerNotificationsRoutes(app);
  registerOgRoutes(app);

  // ---- Supabase Send Email Auth Hook -------------------------------------
  // Receives webhooks from Supabase whenever an auth email needs sending.
  // Uses express.raw() (not json()) because signature verification requires
  // the exact bytes of the request body. Do not add requireAuth — the caller
  // is Supabase, authenticated via webhook signature not a user session.
  app.post(
    "/api/auth/email-hook",
    express.raw({ type: "application/json", limit: "1mb" }),
    handleAuthHook,
  );

  // Manual seeding endpoint for testing
  app.post("/api/admin/seed-supabase", requireAuth, requireAdmin, async (req, res) => {
    try {
      const result = await seedSupabasePersons();
      
      // Test query to verify
      const { data, error } = await supabaseServer
        .from('persons')
        .select('id, name')
        .limit(3);
      
      res.json({ 
        success: true, 
        message: "Supabase seeded successfully",
        samplePersons: data,
        error: error
      });
    } catch (error: any) {
      res.status(500).json({ success: false, error: error.message });
    }
  });
  
  // Run data ingestion - fetches real data from Wikipedia and GDELT
  app.post("/api/admin/ingest", requireAuth, requireAdmin, async (req, res) => {
    try {
      const { runDataIngestion } = await import("./jobs/ingest");
      const result = await runDataIngestion();
      res.json({ 
        success: true, 
        message: "Data ingestion complete",
        ...result
      });
    } catch (error: any) {
      console.error("Ingestion error:", error);
      res.status(500).json({ success: false, error: error.message });
    }
  });
  
  // Seed historical trend data for graphs
  app.post("/api/admin/seed-history", requireAuth, requireAdmin, async (req, res) => {
    try {
      const { seedHistoricalSnapshots } = await import("./jobs/seed-history");
      const { days = 7 } = req.body;
      const result = await seedHistoricalSnapshots(days);
      res.json({ 
        success: true, 
        message: `Created ${result.created} historical snapshots`,
        ...result
      });
    } catch (error: any) {
      console.error("Seed history error:", error);
      res.status(500).json({ success: false, error: error.message });
    }
  });

  // Get all trending people with pagination support
  app.get("/api/trending", async (req, res) => {
    try {
      const { search, category, sort, limit, offset } = req.query;
      
      let people = await storage.getTrendingPeople();
      
      // If storage is empty, return empty array (ingestion job populates the database)
      // DO NOT fetch mock data here - it corrupts real scores
      if (people.length === 0) {
        console.log('[API] trending_people is empty - waiting for ingestion job to populate');
        res.json([]);
        return;
      }

      // Fetch approval metrics for all celebrities
      const metrics = await db
        .select({
          celebrityId: celebrityMetrics.celebrityId,
          approvalPct: celebrityMetrics.approvalPct,
          approvalAvgRating: celebrityMetrics.approvalAvgRating,
          approvalVotesCount: celebrityMetrics.approvalVotesCount,
          underratedPct: celebrityMetrics.underratedPct,
          overratedPct: celebrityMetrics.overratedPct,
          fairlyRatedPct: celebrityMetrics.fairlyRatedPct,
          valueScore: celebrityMetrics.valueScore,
        })
        .from(celebrityMetrics);
      
      // Create a lookup map for metrics
      const metricsMap = new Map<string, typeof metrics[0]>();
      for (const m of metrics) {
        metricsMap.set(m.celebrityId, m);
      }

      // Compute rank changes from actual trend_snapshots ~24h ago (cached)
      let prevRankMap = await getSnapshotRankMap();

      // Fallback: estimate from change24h if snapshot lookup returned empty
      if (prevRankMap.size === 0) {
        prevRankMap = new Map<string, number>();
        const previousScores = people.map(p => {
          const fi = p.fameIndex ?? Math.round(p.trendScore / 100);
          const delta = p.change24h ?? 0;
          const prevFi = delta !== 0 ? fi / (1 + delta / 100) : fi;
          return { id: p.id, prevFi };
        }).sort((a, b) => b.prevFi - a.prevFi);
        previousScores.forEach((s, i) => prevRankMap.set(s.id, i + 1));
      }

      // Merge metrics + rankChange into people
      let enrichedPeople = people.map(p => {
        const m = metricsMap.get(p.id);
        const prevRank = prevRankMap.get(p.id) ?? p.rank;
        const rankChange = prevRank - p.rank;
        return {
          ...p,
          approvalPct: m?.approvalPct ?? null,
          approvalAvgRating: m?.approvalAvgRating ?? null,
          approvalVotesCount: m?.approvalVotesCount ?? null,
          underratedPct: m?.underratedPct ?? null,
          overratedPct: m?.overratedPct ?? null,
          fairlyRatedPct: m?.fairlyRatedPct ?? null,
          valueScore: m?.valueScore ?? null,
          rankChange,
        };
      });

      // Apply search filter
      if (search && typeof search === 'string') {
        const searchLower = search.toLowerCase();
        enrichedPeople = enrichedPeople.filter(p => 
          p.name.toLowerCase().includes(searchLower) ||
          (p.category && p.category.toLowerCase().includes(searchLower))
        );
      }

      // Apply category filter
      if (category && typeof category === 'string') {
        enrichedPeople = enrichedPeople.filter(p => p.category === category);
      }

      // Apply sorting
      if (sort === 'rank') {
        enrichedPeople.sort((a, b) => a.rank - b.rank);
      } else if (sort === 'score') {
        enrichedPeople.sort((a, b) => b.trendScore - a.trendScore);
      } else if (sort === '24h') {
        enrichedPeople.sort((a, b) => (b.change24h ?? 0) - (a.change24h ?? 0));
      } else if (sort === '7d') {
        enrichedPeople.sort((a, b) => (b.change7d ?? 0) - (a.change7d ?? 0));
      } else if (sort === 'approval') {
        // Sort by avg rating (highest first), tiebreak by vote count (more votes first), nulls last
        enrichedPeople.sort((a, b) => {
          const aRating = (a as any).approvalAvgRating ?? null;
          const bRating = (b as any).approvalAvgRating ?? null;
          if (aRating === null && bRating === null) return 0;
          if (aRating === null) return 1;
          if (bRating === null) return -1;
          if (bRating !== aRating) return bRating - aRating;
          // Tiebreak: more votes ranks higher
          return ((b as any).approvalVotesCount ?? 0) - ((a as any).approvalVotesCount ?? 0);
        });
      }

      // Store total count before pagination
      const totalCount = enrichedPeople.length;

      // Apply pagination — default limit prevents unbounded JSON responses
      const DEFAULT_TRENDING_LIMIT = 200;
      const requestedLimit = limit && typeof limit === 'string' ? limit : String(DEFAULT_TRENDING_LIMIT);
      if (requestedLimit !== 'all') {
        const limitNum = parseInt(requestedLimit, 10);
        const offsetNum = offset && typeof offset === 'string' ? parseInt(offset, 10) : 0;
        
        if (!isNaN(limitNum) && limitNum > 0) {
          enrichedPeople = enrichedPeople.slice(offsetNum, offsetNum + limitNum);
        }
      }

      const baselineMeta = await getBaselineDiagnostics(totalCount);
      const baselineDegraded = baselineMeta.baseline24hStatus !== "normal";

      const safeData = baselineDegraded
        ? enrichedPeople.map(p => ({ ...p, change24h: null, change7d: null }))
        : enrichedPeople;

      res.json({
        data: safeData,
        totalCount,
        hasMore: limit ? (parseInt(offset as string || '0', 10) + safeData.length) < totalCount : false,
        meta: {
          scoreVersion: baselineMeta.scoreVersion,
          baselineStatus: baselineMeta.baseline24hStatus,
          sourceHealth: (() => {
            const health = getCurrentHealthSnapshot();
            const runMeta = getLastRunMeta();
            return {
              news: health.news.state,
              search: health.search.state,
              wiki: health.wiki.state,
              newsProviderUsed: runMeta?.newsProviderUsed ?? null,
              newsFreshCoveragePct: runMeta?.newsFreshCoveragePct ?? null,
              newsFreshnessGovernor: runMeta?.newsGovernorFactor ?? null,
              newsDegradedReason: health.news.state !== "HEALTHY" ? health.news.reason : null,
            };
          })(),
        },
      });
    } catch (error) {
      console.error("Error fetching trending people:", error);
      res.status(500).json({ error: "Failed to fetch trending data" });
    }
  });

  app.get("/api/trending/hot-movers", async (req, res) => {
    try {
      const debug = req.query.debug === '1';
      const now = Date.now();

      if (!debug && _cachedHotMovers && (now - _hotMoversCachedAt < HOT_MOVERS_TTL_MS)) {
        const currentRunId = await getLatestCompletedRunId();
        if (currentRunId === _hotMoversCachedRunId) {
          res.json(_cachedHotMovers);
          return;
        }
      }

      let people = await storage.getTrendingPeople();
      if (people.length === 0) {
        const fallback = await getSnapshotFallbackPeople();
        if (fallback && fallback.length > 0) {
          console.log(`[API] hot-movers using snapshot fallback (${fallback.length} people)`);
          people = fallback as any;
        }
      }

      // Build meta once, up front, so the degraded short-circuit and the
      // happy-path response share an identical shape. currentRunFinishedAt
      // is used by the TrendingNowFeed clock instead of the client refetch
      // time, so the "X min ago" label reflects real ingest age.
      const baselineMeta = await getBaselineDiagnostics(people.length);
      const meta = {
        currentRunId: baselineMeta.currentRunId,
        currentRunFinishedAt: baselineMeta.currentRunFinishedAt,
        baseline24hRunId: baselineMeta.baseline24hRunId,
        baseline24hAgeHours: baselineMeta.baseline24hAgeHours,
        baselineStatus: baselineMeta.baseline24hStatus,
        coveragePct: baselineMeta.baseline24hCoveragePct,
        scoreVersion: baselineMeta.scoreVersion,
        smoothingMode: "off",
        newsAggregationMode: getNewsAggregationMode(),
      };

      // Hide the card when we don't have data or a clean 24h baseline.
      // Previously the handler kept classifying badges using raw change24h
      // and then nulled the percentages on the response, leaving the UI
      // showing "Surging" / "Breakout" labels with no numbers next to them.
      // The empty-state copy in TrendingNowFeed renders correctly here.
      if (people.length === 0 || baselineMeta.baseline24hStatus !== "normal") {
        const empty: HotMoversResponse = { data: [], meta };
        if (!debug) {
          _cachedHotMovers = empty;
          _hotMoversCachedAt = Date.now();
          _hotMoversCachedRunId = baselineMeta.currentRunId;
        }
        res.json(empty);
        return;
      }

      const prevRanks = await getSnapshotRankMap();

      // Pick the top positive 24h movers. We deliberately stopped
      // classifying these into Breakout / Surging / Cooling bands in
      // April 2026 — the rank-change and change_24h signals are ~0.94
      // correlated in production, so the bands collapsed to a single
      // "Breakout" group anyway. The list is now simply the biggest
      // upward movers, ranked by raw 24h percentage change.
      const HOT_MOVERS_CAP = 5;
      const candidates = people
        .filter(p => p.change24h != null && p.change24h > 0)
        .sort((a, b) => (b.change24h ?? 0) - (a.change24h ?? 0))
        .slice(0, HOT_MOVERS_CAP);

      const result = candidates.map(p => ({
        id: p.id,
        name: p.name,
        avatar: p.avatar,
        category: p.category,
        rank: p.rank,
        fameIndex: p.fameIndex,
        change24h: p.change24h,
        rankChange: prevRanks.has(p.id) ? (prevRanks.get(p.id)! - p.rank) : null,
      }));

      if (debug) {
        res.json({
          baselineStatus: meta.baselineStatus,
          smoothingMode: "off",
          newsAggregationMode: getNewsAggregationMode(),
          cap: HOT_MOVERS_CAP,
          totalQualified: result.length,
          candidates: result,
        });
        return;
      }

      const responseWithMeta: HotMoversResponse = {
        data: result,
        meta,
      };
      _cachedHotMovers = responseWithMeta;
      _hotMoversCachedAt = Date.now();
      _hotMoversCachedRunId = baselineMeta.currentRunId;
      res.json(responseWithMeta);
    } catch (error) {
      console.error("Error fetching hot movers:", error);
      res.status(500).json({ error: "Failed to fetch hot movers" });
    }
  });

  // Get single person details
  app.get("/api/trending/:id", async (req, res) => {
    try {
      const { id } = req.params;
      const person = await storage.getTrendingPerson(id);
      
      // Only return real data from database - no mock data fallback
      if (!person) {
        return res.status(404).json({ error: "Person not found" });
      }

      if (!getSessionId(req)) {
        const newSid = randomUUID();
        res.cookie(SESSION_COOKIE_NAME, newSid, {
          httpOnly: true,
          sameSite: 'lax',
          // Force Secure in production so the session cookie only rides HTTPS.
          // Local dev still works because NODE_ENV !== 'production' drops it.
          secure: process.env.NODE_ENV === 'production',
          maxAge: 365 * 24 * 60 * 60 * 1000,
          path: '/',
        });
      }
      if (shouldCountView(req, id)) {
        db.update(trendingPeople)
          .set({ profileViews10m: sql`COALESCE(${trendingPeople.profileViews10m}, 0) + 1` })
          .where(eq(trendingPeople.id, id))
          .execute()
          .catch((err) => console.error("[ProfileView] Failed to increment view count:", err?.message ?? err));
      }

      const metrics = await db
        .select({
          approvalPct: celebrityMetrics.approvalPct,
          approvalAvgRating: celebrityMetrics.approvalAvgRating,
          approvalVotesCount: celebrityMetrics.approvalVotesCount,
        })
        .from(celebrityMetrics)
        .where(eq(celebrityMetrics.celebrityId, id))
        .limit(1);

      const m = metrics[0];

      const tracked = await db
        .select({ wikiSlug: trackedPeople.wikiSlug, imageSlug: trackedPeople.imageSlug })
        .from(trackedPeople)
        .where(eq(trackedPeople.id, id))
        .limit(1);

      let categoryRank: number | undefined;
      if (person.category?.trim()) {
        const rankRows = await db.execute(sql`
          WITH ranked AS (
            SELECT ${trendingPeople.id} AS id,
              ROW_NUMBER() OVER (
                PARTITION BY ${trendingPeople.category}
                ORDER BY COALESCE(${trendingPeople.fameIndexLive}, ${trendingPeople.fameIndex}) DESC NULLS LAST, ${trendingPeople.name} ASC
              ) AS category_rank
            FROM ${trendingPeople}
            WHERE ${trendingPeople.category} = ${person.category}
          )
          SELECT category_rank FROM ranked WHERE id = ${id}
        `);
        const row = (rankRows as { rows: Record<string, unknown>[] }).rows?.[0];
        const raw = row?.category_rank ?? row?.categoryRank;
        const n = raw != null ? Number(raw) : NaN;
        if (Number.isFinite(n) && n > 0) categoryRank = n;
      }

      res.json({
        ...person,
        approvalPct: m?.approvalPct ?? null,
        approvalAvgRating: m?.approvalAvgRating ?? null,
        approvalVotesCount: m?.approvalVotesCount ?? 0,
        wikiSlug: tracked[0]?.wikiSlug ?? null,
        imageSlug: tracked[0]?.imageSlug ?? null,
        ...(categoryRank != null ? { categoryRank } : {}),
      });
    } catch (error) {
      console.error("Error fetching person:", error);
      res.status(500).json({ error: "Failed to fetch person data" });
    }
  });

  // ===================== VoxDex Pulse Endpoints =====================

  app.get("/api/pulse/trend-history", async (req, res) => {
    try {
      const days = Math.min(Math.max(parseInt(req.query.days as string) || 7, 1), 3650);
      const limit = Math.min(Math.max(parseInt(req.query.limit as string) || 10, 1), 100);
      const category = (req.query.category as string || "").toLowerCase();

      const trendWhere = category && category !== "all"
        ? sql`lower(${trendingPeople.category}) = ${category}`
        : undefined;

      const topPeople = await db
        .select({
          id: trendingPeople.id,
          name: trendingPeople.name,
          category: trendingPeople.category,
          trendScore: trendingPeople.trendScore,
          change24h: trendingPeople.change24h,
          avatar: trendingPeople.avatar,
        })
        .from(trendingPeople)
        .where(trendWhere)
        .orderBy(desc(trendingPeople.trendScore))
        .limit(limit);
      if (topPeople.length === 0) return res.json({ people: [], series: {} });

      const personIds = topPeople.map((p) => p.id);
      const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

      const imageSlugs = await db
        .select({ id: trackedPeople.id, imageSlug: trackedPeople.imageSlug })
        .from(trackedPeople)
        .where(inArray(trackedPeople.id, personIds));
      const slugMap = Object.fromEntries(imageSlugs.map((r) => [r.id, r.imageSlug]));

      const seriesConditions = [
        inArray(trendSnapshots.personId, personIds),
        sql`${trendSnapshots.timestamp} >= ${cutoff}`,
        sql`${trendSnapshots.timestamp} = date_trunc('hour', ${trendSnapshots.timestamp})`,
        eq(trendSnapshots.snapshotOrigin, "ingest"),
      ];
      if (days > 7 && days <= 30) {
        seriesConditions.push(sql`extract(hour from ${trendSnapshots.timestamp})::int % 6 = 0`);
      } else if (days > 30) {
        seriesConditions.push(sql`extract(hour from ${trendSnapshots.timestamp})::int = 0`);
      }

      const snapshots = await db
        .select({
          personId: trendSnapshots.personId,
          timestamp: trendSnapshots.timestamp,
          trendScore: trendSnapshots.trendScore,
        })
        .from(trendSnapshots)
        .where(and(...seriesConditions))
        .orderBy(trendSnapshots.timestamp);

      const series: Record<string, { timestamp: string; trendScore: number }[]> = {};
      const sparkMap: Record<string, number[]> = {};
      const sparkCutoff = Date.now() - 7 * 24 * 60 * 60 * 1000;
      for (const s of snapshots) {
        (series[s.personId] ||= []).push({
          timestamp: s.timestamp.toISOString(),
          trendScore: s.trendScore,
        });
        if (s.timestamp.getTime() >= sparkCutoff) {
          (sparkMap[s.personId] ||= []).push(s.trendScore);
        }
      }
      for (const id of personIds) {
        const full = sparkMap[id] ?? [];
        if (full.length > 12) {
          const step = (full.length - 1) / 11;
          sparkMap[id] = Array.from({ length: 12 }, (_, i) => full[Math.round(i * step)]);
        }
      }

      const allCats = await db
        .selectDistinct({ category: trendingPeople.category })
        .from(trendingPeople)
        .where(isNotNull(trendingPeople.category));

      res.json({
        people: topPeople.map((p) => ({
          id: p.id,
          name: p.name,
          category: p.category,
          trendScore: p.trendScore,
          change24h: p.change24h,
          avatar: p.avatar,
          imageSlug: slugMap[p.id] || null,
          sparkline: sparkMap[p.id] ?? [],
        })),
        series,
        availableCategories: allCats.map((r) => r.category).filter(Boolean),
      });
    } catch (error: any) {
      res.status(500).json({ error: "Failed to fetch pulse trend history" });
    }
  });

  app.get("/api/pulse/approval-history", async (req, res) => {
    try {
      const days = Math.min(Math.max(parseInt(req.query.days as string) || 7, 1), 3650);
      const limit = Math.min(Math.max(parseInt(req.query.limit as string) || 10, 1), 20);
      const category = (req.query.category as string || "").toLowerCase();

      const approvalWhere = category && category !== "all"
        ? sql`lower(${trendingPeople.category}) = ${category}`
        : undefined;

      const topPeople = await db
        .select({
          id: trendingPeople.id,
          name: trendingPeople.name,
          category: trendingPeople.category,
          avatar: trendingPeople.avatar,
        })
        .from(trendingPeople)
        .innerJoin(celebrityMetrics, eq(trendingPeople.id, celebrityMetrics.celebrityId))
        .where(approvalWhere)
        .orderBy(desc(celebrityMetrics.approvalAvgRating))
        .limit(limit);
      if (topPeople.length === 0) return res.json({ people: [], series: {} });

      const personIds = topPeople.map((p) => p.id);
      const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

      const imageSlugs = await db
        .select({ id: trackedPeople.id, imageSlug: trackedPeople.imageSlug })
        .from(trackedPeople)
        .where(inArray(trackedPeople.id, personIds));
      const slugMap = Object.fromEntries(imageSlugs.map((r) => [r.id, r.imageSlug]));

      const snapshots = await db
        .select({
          personId: approvalSnapshots.personId,
          timestamp: approvalSnapshots.timestamp,
          approvalAvgRating: approvalSnapshots.approvalAvgRating,
        })
        .from(approvalSnapshots)
        .where(
          and(
            inArray(approvalSnapshots.personId, personIds),
            sql`${approvalSnapshots.timestamp} >= ${cutoff}`
          )
        )
        .orderBy(approvalSnapshots.timestamp);

      const series: Record<string, { timestamp: string; approvalAvgRating: number | null }[]> = {};
      for (const s of snapshots) {
        (series[s.personId] ||= []).push({
          timestamp: s.timestamp.toISOString(),
          approvalAvgRating: s.approvalAvgRating,
        });
      }

      res.json({
        people: topPeople.map((p) => ({
          id: p.id,
          name: p.name,
          category: p.category,
          avatar: p.avatar,
          imageSlug: slugMap[p.id] || null,
        })),
        series,
      });
    } catch (error: any) {
      res.status(500).json({ error: "Failed to fetch pulse approval history" });
    }
  });

  app.get("/api/pulse/approval-current", async (req, res) => {
    try {
      const limit = Math.min(Math.max(parseInt(req.query.limit as string) || 10, 1), 100);
      const category = (req.query.category as string || "").toLowerCase();

      const conditions: SQL[] = [gt(celebrityMetrics.approvalAvgRating, 0)];
      if (category && category !== "all") {
        conditions.push(sql`lower(${trendingPeople.category}) = ${category}`);
      }

      const rows = await db
        .select({
          id: trendingPeople.id,
          name: trendingPeople.name,
          category: trendingPeople.category,
          avatar: trendingPeople.avatar,
          approvalAvgRating: celebrityMetrics.approvalAvgRating,
          approvalVotesCount: celebrityMetrics.approvalVotesCount,
        })
        .from(trendingPeople)
        .innerJoin(celebrityMetrics, eq(trendingPeople.id, celebrityMetrics.celebrityId))
        .where(and(...conditions))
        .orderBy(desc(celebrityMetrics.approvalAvgRating))
        .limit(limit);

      const personIds = rows.map((r) => r.id);
      const imageSlugs = personIds.length > 0
        ? await db.select({ id: trackedPeople.id, imageSlug: trackedPeople.imageSlug })
            .from(trackedPeople).where(inArray(trackedPeople.id, personIds))
        : [];
      const slugMap = Object.fromEntries(imageSlugs.map((r) => [r.id, r.imageSlug]));

      // Aggregate vote counts per person via Drizzle to avoid Supabase's 1000-row default limit.
      const realVoteCountMap: Record<string, number> = {};
      if (personIds.length > 0) {
        const voteCounts = await db
          .select({
            personId: userVotes.personId,
            voteCount: sql<number>`cast(count(*) as int)`,
          })
          .from(userVotes)
          .where(inArray(userVotes.personId, personIds))
          .groupBy(userVotes.personId);

        for (const r of voteCounts) {
          realVoteCountMap[r.personId] = r.voteCount;
        }
      }

      const allCats = await db
        .selectDistinct({ category: trendingPeople.category })
        .from(trendingPeople)
        .innerJoin(celebrityMetrics, eq(trendingPeople.id, celebrityMetrics.celebrityId))
        .where(gt(celebrityMetrics.approvalAvgRating, 0));

      res.json({
        people: rows.map((r) => ({
          id: r.id,
          name: r.name,
          category: r.category,
          avatar: r.avatar,
          imageSlug: slugMap[r.id] || null,
          approvalAvgRating: r.approvalAvgRating,
          approvalVotesCount: realVoteCountMap[r.id] ?? r.approvalVotesCount ?? 0,
        })),
        availableCategories: allCats.map((r) => r.category).filter(Boolean),
      });
    } catch (error: any) {
      res.status(500).json({ error: "Failed to fetch pulse approval current" });
    }
  });

  app.get("/api/pulse/approval-breakdown/:personId", async (req, res) => {
    try {
      const personId = String(req.params.personId || "").trim();
      if (!personId) {
        return res.status(400).json({ error: "personId is required" });
      }

      const ratingRows = await db
        .select({
          rating: userVotes.rating,
          cnt: sql<number>`cast(count(*) as int)`,
        })
        .from(userVotes)
        .where(
          and(
            eq(userVotes.personId, personId),
            gte(userVotes.rating, 1),
            lte(userVotes.rating, 5),
          ),
        )
        .groupBy(userVotes.rating);

      const counts: Record<"1" | "2" | "3" | "4" | "5", number> = {
        "1": 0,
        "2": 0,
        "3": 0,
        "4": 0,
        "5": 0,
      };

      for (const row of ratingRows) {
        const r = Number(row.rating);
        if (r >= 1 && r <= 5) {
          counts[String(r) as keyof typeof counts] = Number(row.cnt);
        }
      }

      const totalVotes = counts["1"] + counts["2"] + counts["3"] + counts["4"] + counts["5"];
      const percentages: Record<"1" | "2" | "3" | "4" | "5", number> = {
        "1": totalVotes > 0 ? Number(((counts["1"] / totalVotes) * 100).toFixed(1)) : 0,
        "2": totalVotes > 0 ? Number(((counts["2"] / totalVotes) * 100).toFixed(1)) : 0,
        "3": totalVotes > 0 ? Number(((counts["3"] / totalVotes) * 100).toFixed(1)) : 0,
        "4": totalVotes > 0 ? Number(((counts["4"] / totalVotes) * 100).toFixed(1)) : 0,
        "5": totalVotes > 0 ? Number(((counts["5"] / totalVotes) * 100).toFixed(1)) : 0,
      };

      res.json({
        personId,
        totalVotes,
        counts,
        percentages,
      });
    } catch (error: any) {
      console.error("Error in approval-breakdown route:", error);
      res.status(500).json({ error: "Failed to fetch approval breakdown" });
    }
  });

  // Get historical trend data for graphs
  app.get("/api/trending/:id/history", async (req, res) => {
    try {
      const { id } = req.params;
      const { days = '7' } = req.query; // Default to 7 days
      
      const daysNum = parseInt(days as string);
      
      // Validate days parameter
      if (isNaN(daysNum) || daysNum < 1 || daysNum > 3650) {
        return res.status(400).json({ error: "Invalid days parameter. Must be between 1 and 3650." });
      }
      
      const cutoffDate = new Date(Date.now() - daysNum * 24 * 60 * 60 * 1000);
      
      // Fetch snapshots for this person within the time range
      // Safety net: only include on-the-hour snapshots (written by ingest.ts)
      // Off-hour snapshots with unique millisecond timestamps are pollution
      const snapshots = await db
        .select({
          timestamp: trendSnapshots.timestamp,
          trendScore: trendSnapshots.trendScore,
          fameIndex: trendSnapshots.fameIndex,
          newsCount: trendSnapshots.newsCount,
          youtubeViews: trendSnapshots.youtubeViews,
          spotifyFollowers: trendSnapshots.spotifyFollowers,
          searchVolume: trendSnapshots.searchVolume,
          wikiPageviews: trendSnapshots.wikiPageviews,
        })
        .from(trendSnapshots)
        .where(and(
          eq(trendSnapshots.personId, id),
          sql`${trendSnapshots.timestamp} >= ${cutoffDate}`,
          sql`${trendSnapshots.timestamp} = date_trunc('hour', ${trendSnapshots.timestamp})`,
          eq(trendSnapshots.snapshotOrigin, 'ingest')
        ))
        .orderBy(desc(trendSnapshots.timestamp), desc(trendSnapshots.id))
        .limit(daysNum * 24); // Max one per hour for requested days
      
      // Transform for graph display
      const historyData = snapshots.reverse().map(snapshot => ({
        timestamp: snapshot.timestamp.toISOString(),
        date: snapshot.timestamp.toLocaleDateString(),
        time: snapshot.timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        trendScore: snapshot.trendScore,
        fameIndex: snapshot.fameIndex,
        newsCount: snapshot.newsCount,
        youtubeViews: snapshot.youtubeViews,
        spotifyFollowers: snapshot.spotifyFollowers,
        searchVolume: snapshot.searchVolume,
      }));

      res.json(historyData);
    } catch (error) {
      console.error("Error fetching history:", error);
      res.status(500).json({ error: "Failed to fetch historical data" });
    }
  });

  // Refresh trending data - DEPRECATED
  // NOTE: This endpoint should NOT write mock data to the database
  // Real data comes from the scheduled ingestion job (ingest.ts)
  app.post("/api/trending/refresh", async (req, res) => {
    try {
      // Just return current database data - don't write mock data
      const currentData = await storage.getTrendingPeople();
      res.json({ 
        success: true, 
        count: currentData.length,
        message: "Data is managed by scheduled ingestion job"
      });
    } catch (error) {
      console.error("Error in trending/refresh:", error);
      res.status(500).json({ error: "Failed to get data" });
    }
  });

  // ============ TREND CONTEXT API (Why Trending) ============
  
  // Get trend context for a single person
  app.get("/api/trending/:id/context", async (req, res) => {
    try {
      const { id } = req.params;
      const context = await getTrendContext(id);
      
      res.json({
        ...context,
        lastScoredAtFormatted: formatRelativeTime(context.lastScoredAt),
        sourceTimestampsFormatted: {
          wiki: formatRelativeTime(context.sourceTimestamps.wiki),
          news: formatRelativeTime(context.sourceTimestamps.news),
          search: formatRelativeTime(context.sourceTimestamps.search),
        },
      });
    } catch (error) {
      console.error("Error fetching trend context:", error);
      res.status(500).json({ error: "Failed to fetch trend context" });
    }
  });

  // Adjacent leaderboard neighbours for the celebrity profile
  // page's "Continue exploring" navigator. Returns the person one
  // rank above (prev) and one rank below (next) so the UI can let
  // users walk the leaderboard without bouncing back to /. Payload
  // is intentionally narrow — avatar + rank + category is enough
  // for the card UI; deeper details belong on the profile itself.
  app.get("/api/trending/:id/neighbours", async (req, res) => {
    try {
      const { id } = req.params;
      const people = await storage.getTrendingPeople();
      if (people.length === 0) {
        return res.json({ prev: null, next: null });
      }
      const idx = people.findIndex((p) => p.id === id);
      if (idx < 0) {
        // Person isn't on the current leaderboard (e.g. dropped
        // out, archived). Returning nulls lets the client render
        // the "edge" placeholder without a 404 — the rest of the
        // profile page is still useful.
        return res.json({ prev: null, next: null });
      }
      const slim = (p: (typeof people)[number] | undefined) =>
        p
          ? {
              id: p.id,
              name: p.name,
              avatar: p.avatar,
              rank: p.rank,
              category: p.category,
              trendScore: p.trendScore,
              change24h: p.change24h,
            }
          : null;
      res.json({
        prev: slim(idx > 0 ? people[idx - 1] : undefined),
        next: slim(idx < people.length - 1 ? people[idx + 1] : undefined),
      });
    } catch (error) {
      console.error("Error fetching trending neighbours:", error);
      res.status(500).json({ error: "Failed to fetch neighbours" });
    }
  });

  app.post("/api/trending/context/batch", async (req, res) => {
    try {
      const { personIds } = req.body;
      
      if (!Array.isArray(personIds) || personIds.length === 0) {
        return res.status(400).json({ error: "personIds array required" });
      }
      
      if (personIds.length > 100) {
        return res.status(400).json({ error: "Max 100 person IDs per request" });
      }
      
      const contexts = await getTrendContextBatch(personIds);
      
      const result: Record<string, TrendContext & { lastScoredAtFormatted: string; sourceTimestampsFormatted: Record<string, string> }> = {};
      
      contexts.forEach((context, id) => {
        result[id] = {
          ...context,
          lastScoredAtFormatted: formatRelativeTime(context.lastScoredAt),
          sourceTimestampsFormatted: {
            wiki: formatRelativeTime(context.sourceTimestamps.wiki),
            news: formatRelativeTime(context.sourceTimestamps.news),
            search: formatRelativeTime(context.sourceTimestamps.search),
          },
        };
      });
      
      res.json(result);
    } catch (error) {
      console.error("Error fetching batch trend context:", error);
      res.status(500).json({ error: "Failed to fetch trend contexts" });
    }
  });
  
  // Lightweight health check for monitors (no auth). Prefer /api/system/freshness for data status.
  app.get("/api/system/health", async (req, res) => {
    const serverTime = new Date().toISOString();
    let dbOk = false;
    try {
      await db.execute(sql`SELECT 1 as ok`);
      dbOk = true;
    } catch (_e) {
      // DB down — still return 200 so load balancer sees app up; body indicates DB failure
    }
    res.status(200).json({
      status: dbOk ? "ok" : "degraded",
      serverTime,
      database: dbOk ? "connected" : "error",
    });
  });

  // Get system data freshness status
  app.get("/api/system/freshness", async (req, res) => {
    try {
      const cacheStats = await db
        .select({
          provider: apiCache.provider,
          latestFetch: sql<Date>`MAX(${apiCache.fetchedAt})`,
          count: sql<number>`COUNT(*)`,
        })
        .from(apiCache)
        .groupBy(apiCache.provider);
      
      const freshness: Record<string, { lastUpdated: string; count: number; status: "live" | "stale" | "cached" }> = {};
      const now = new Date();
      
      const excludedProviders = new Set(["x", "twitter"]);
      for (const stat of cacheStats) {
        if (excludedProviders.has(stat.provider)) continue;
        const latestDate = stat.latestFetch ? new Date(stat.latestFetch) : null;
        const hoursSince = latestDate ? (now.getTime() - latestDate.getTime()) / (1000 * 60 * 60) : Infinity;
        
        let status: "live" | "stale" | "cached" = "live";
        if (hoursSince > 24) status = "stale";
        else if (hoursSince > 2) status = "cached";
        
        freshness[stat.provider] = {
          lastUpdated: formatRelativeTime(latestDate),
          count: Number(stat.count),
          status,
        };
      }
      
      // systemStatus uses only scheduled pipeline sources. Demand-driven (ai_trending) excluded.
      // News: prefer Mediastack (primary); only consider GDELT when Mediastack absent — so GDELT staleness doesn't mark degraded when Mediastack is live.
      const newsStatus = freshness["mediastack"] != null
        ? freshness["mediastack"].status
        : (freshness["gdelt"]?.status ?? null);
      const statusesForHealth: ("live" | "stale" | "cached")[] = [
        freshness["wiki"]?.status,
        freshness["serper"]?.status,
        newsStatus,
      ].filter((s): s is "live" | "stale" | "cached" => s != null);
      const systemStatus = statusesForHealth.length > 0 && statusesForHealth.every(s => s !== "stale")
        ? "healthy"
        : "degraded";
      
      let fullRefresh = getLastFullRefreshAt();

      let liveUpdatedAt: Date | null = null;
      try {
        const [liveTs] = await db
          .select({ ts: sql<Date>`MAX(${trendingPeople.liveUpdatedAt})` })
          .from(trendingPeople);
        if (liveTs?.ts) liveUpdatedAt = new Date(liveTs.ts);
      } catch (e) {
        console.error("[diagnostics] Error fetching liveUpdatedAt:", e);
      }

      if (!fullRefresh || !liveUpdatedAt) {
        try {
          const [latestCompleted] = await db
            .select({ finishedAt: ingestionRuns.finishedAt })
            .from(ingestionRuns)
            .where(and(
              eq(ingestionRuns.status, "completed"),
              eq(ingestionRuns.scoreVersion, SCORE_VERSION),
            ))
            .orderBy(desc(ingestionRuns.startedAt))
            .limit(1);
          if (latestCompleted?.finishedAt) {
            const completedDate = new Date(latestCompleted.finishedAt);
            if (!fullRefresh) fullRefresh = completedDate;
            if (!liveUpdatedAt) liveUpdatedAt = completedDate;
          }
        } catch (e) {
          console.error("[diagnostics] Error fetching latest ingestion run:", e);
        }
      }

      const lastScoredAt = fullRefresh || liveUpdatedAt;

      let runInProgress: { runId: string; startedAt: string; startedAtFormatted: string } | null = null;
      try {
        const [activeRun] = await db.select({
          id: ingestionRuns.id,
          startedAt: ingestionRuns.startedAt,
        })
          .from(ingestionRuns)
          .where(eq(ingestionRuns.status, "running"))
          .orderBy(desc(ingestionRuns.startedAt))
          .limit(1);
        if (activeRun) {
          runInProgress = {
            runId: activeRun.id,
            startedAt: activeRun.startedAt.toISOString(),
            startedAtFormatted: formatRelativeTime(activeRun.startedAt),
          };
        }
      } catch (e) {
        console.error("[diagnostics] Error fetching run in progress:", e);
      }

      res.json({
        freshness,
        systemStatus,
        lastScoredAt: lastScoredAt?.toISOString() || null,
        lastScoredAtFormatted: formatRelativeTime(lastScoredAt),
        liveUpdatedAt: liveUpdatedAt?.toISOString() || null,
        liveUpdatedAtFormatted: formatRelativeTime(liveUpdatedAt),
        fullRefreshAt: fullRefresh?.toISOString() || null,
        fullRefreshAtFormatted: formatRelativeTime(fullRefresh),
        runInProgress,
      });
    } catch (error) {
      console.error("Error fetching system freshness:", error);
      res.status(500).json({ error: "Failed to fetch system status" });
    }
  });

  app.get("/api/trending/movers/:type", async (req, res) => {
    try {
      const { type } = req.params;
      let people = await storage.getTrendingPeople();
      
      if (people.length === 0) {
        const fallback = await getSnapshotFallbackPeople();
        if (fallback && fallback.length > 0) {
          console.log(`[API] movers/${type} using snapshot fallback (${fallback.length} people)`);
          people = fallback as any;
        } else {
          console.log('[API] trending_people is empty for movers - waiting for ingestion job');
          res.json([]);
          return;
        }
      }

      // Per-field baseline gating: only null change24h when the 24h baseline
      // run is missing/degraded, and only null change7d when the 7d baseline
      // is missing. Previously both were nulled together off the 24h flag,
      // which blanked Weekly Gainers/Droppers whenever the 24h run dropped
      // out, even if the 7d run was perfectly fine.
      const baselineMeta = await getBaselineDiagnostics(people.length);
      const degraded24h = baselineMeta.baseline24hStatus !== "normal";
      const degraded7d = baselineMeta.baseline7dStatus !== "normal";

      const prevRanks = await getSnapshotRankMap();
      const enriched = people.map(p => ({
        ...p,
        change24h: degraded24h ? null : p.change24h,
        change7d: degraded7d ? null : p.change7d,
        rankChange: prevRanks.has(p.id) ? (prevRanks.get(p.id)! - p.rank) : null,
      }));

      const TOP_N = 5;

      if (type === 'gainers') {
        // Strict sign filter: a "Weekly Gainer" must actually be up over 7d.
        // If fewer than TOP_N qualify (e.g. uniformly-down week), the card
        // simply renders fewer rows.
        const gainers = enriched
          .filter(p => typeof p.change7d === "number" && p.change7d > 0)
          .sort((a, b) => (b.change7d as number) - (a.change7d as number))
          .slice(0, TOP_N);
        res.json(gainers);
        return;
      }

      if (type === 'droppers') {
        const droppers = enriched
          .filter(p => typeof p.change7d === "number" && p.change7d < 0)
          .sort((a, b) => (a.change7d as number) - (b.change7d as number))
          .slice(0, TOP_N);
        res.json(droppers);
        return;
      }

      if (type === 'daily') {
        // Pure |change24h| sort. The previous rank-change merge built a
        // candidate pool from top-N |change24h| ∪ top-N |rankChange| and then
        // re-sorted only by |change24h|, which made the rank branch a no-op
        // for ordering. rankChange is still included on each row for any
        // future "↑ N ranks" badge.
        const daily = enriched
          .filter(p => typeof p.change24h === "number")
          .sort((a, b) =>
            Math.abs(b.change24h as number) - Math.abs(a.change24h as number)
          )
          .slice(0, TOP_N);
        res.json(daily);
        return;
      }

      res.json(enriched.slice(0, TOP_N));
    } catch (error) {
      console.error("Error fetching movers:", error);
      res.status(500).json({ error: "Failed to fetch movers data" });
    }
  });

  // ============ PEOPLE SEARCH (trigram-backed) ============
  // Backed by pg_trgm GIN index on tracked_people.name (migration 0008).
  // Consumers: VotePage suggest modals (OpinionOptionRow, ContenderSelector,
  // Curate HybridSubjectCombobox). Returns all tracked_people regardless of
  // status — status is a UI hint for consumers, not a filter gate.
  app.get("/api/people/search", async (req, res) => {
    try {
      const rawQ = typeof req.query.q === "string" ? req.query.q.trim() : "";
      const rawLimit = parseInt(req.query.limit as string, 10);
      const limit = Math.min(Math.max(Number.isFinite(rawLimit) ? rawLimit : 10, 1), 25);

      if (rawQ.length < 2) {
        res.json({ data: [], totalCount: 0 });
        return;
      }

      const likePattern = `%${rawQ}%`;
      const rows = await db
        .select({
          id: trackedPeople.id,
          name: trackedPeople.name,
          avatar: trackedPeople.avatar,
          status: trackedPeople.status,
          category: trackedPeople.category,
        })
        .from(trackedPeople)
        .where(sql`${trackedPeople.name} % ${rawQ} OR ${trackedPeople.name} ILIKE ${likePattern}`)
        .orderBy(sql`similarity(${trackedPeople.name}, ${rawQ}) DESC, ${trackedPeople.displayOrder} ASC NULLS LAST`)
        .limit(limit);

      res.json({ data: rows, totalCount: rows.length });
    } catch (error) {
      console.error("Error searching people:", error);
      res.status(500).json({ error: "Failed to search people" });
    }
  });

  // ============ MOMENTUM SIGNALS ENDPOINT ============
  // Traffic-light level helper. Uses percentile cutoffs from the rolling
  // 14-day source stats, with safe fixed-threshold fallbacks when the stats
  // look uninitialized (e.g. fresh DB or persisted defaults).
  type MomentumLevel = "none" | "low" | "medium" | "high";
  // Safety fallbacks used only when rolling stats are unhealthy (< 100 snapshots
  // or degenerate distribution). News bumped for NEWS_AGGREGATION_MODE=union
  // which roughly 2-3x's raw counts vs the legacy tiered pipeline.
  const FIXED_LEVEL_FALLBACKS: Record<"search" | "news" | "wiki", { low: number; high: number }> = {
    search: { low: 20, high: 60 },
    news: { low: 15, high: 40 },
    wiki: { low: 500, high: 5000 },
  };
  const computeLevel = (
    source: "search" | "news" | "wiki",
    value: number,
    stats: { p25: number; p75: number; count: number } | null | undefined,
  ): MomentumLevel => {
    if (!Number.isFinite(value) || value <= 0) return "none";
    const hasGoodStats = stats && stats.count >= 100 && stats.p25 >= 0 && stats.p75 > stats.p25;
    if (hasGoodStats) {
      if (value < stats.p25) return "low";
      if (value < stats.p75) return "medium";
      return "high";
    }
    const fb = FIXED_LEVEL_FALLBACKS[source];
    if (value < fb.low) return "low";
    if (value < fb.high) return "medium";
    return "high";
  };

  // News-momentum level helper. Keys off the literal 24h-vs-7d-average
  // ratio (rather than the log-curved 0..100 score) so each pill maps
  // onto a sentence the user can finish in their head:
  //   none   = no comparable signal (no 24h news or no 7d baseline)
  //   low    = ratio < 1.0           → today is below this person's typical day
  //   medium = 1.0 ≤ ratio < 2.0     → at or modestly above typical
  //   high   = ratio ≥ 2.0           → at least double their typical day
  //
  // Apr 2026 retune (was: low ≤ 30, med ≤ 60, high > 60 on the score):
  //   1) The old "low" band swept up ratios ~1.0–1.04 — i.e. people having
  //      a perfectly typical day showed as Low, contradicting the mental
  //      model that Low means "below normal".
  //   2) The "high" boundary at score 60 corresponded to ratio ≈ 3.3×,
  //      which made the band feel unreachable: a person at 2.7× their
  //      typical day (clearly elevated to any human reader) sat on Medium.
  // Score is still computed and stored for ranking; only the user-facing
  // pill changes here.
  const computeMomentumLevel = (ratio: number): MomentumLevel => {
    if (!Number.isFinite(ratio) || ratio <= 0) return "none";
    if (ratio < 1.0) return "low";
    if (ratio < 2.0) return "medium";
    return "high";
  };

  app.get("/api/people/:id/momentum", async (req, res) => {
    try {
      const { id } = req.params;

      const [person] = await db
        .select()
        .from(trackedPeople)
        .where(eq(trackedPeople.id, id))
        .limit(1);

      if (!person) {
        return res.status(404).json({ error: "Person not found" });
      }

      const [trending] = await db
        .select()
        .from(trendingPeople)
        .where(eq(trendingPeople.id, id))
        .limit(1);

      const latestSnapshots = await db
        .select({
          timestamp: trendSnapshots.timestamp,
          newsCount: trendSnapshots.newsCount,
          searchVolume: trendSnapshots.searchVolume,
          wikiPageviews: trendSnapshots.wikiPageviews,
          wikiDelta: trendSnapshots.wikiDelta,
          newsDelta: trendSnapshots.newsDelta,
          searchDelta: trendSnapshots.searchDelta,
          massScore: trendSnapshots.massScore,
          velocityScore: trendSnapshots.velocityScore,
          drivers: trendSnapshots.drivers,
          diagnostics: trendSnapshots.diagnostics,
          trendScore: trendSnapshots.trendScore,
          fameIndex: trendSnapshots.fameIndex,
        })
        .from(trendSnapshots)
        .where(and(
          eq(trendSnapshots.personId, id),
          eq(trendSnapshots.snapshotOrigin, 'ingest'),
          sql`${trendSnapshots.timestamp} = date_trunc('hour', ${trendSnapshots.timestamp})`
        ))
        .orderBy(desc(trendSnapshots.timestamp), desc(trendSnapshots.id))
        .limit(1);

      if (latestSnapshots.length === 0) {
        return res.json({
          asOf: null,
          activeSources: [],
          staleFlags: { dataDelayed: true },
          signals: null,
          categoryRank: null,
          officialProfiles: {},
        });
      }

      const latest = latestSnapshots[0];
      const diag = latest.diagnostics as Record<string, any> | null;
      const evidence = diag?.evidence ?? {};
      const fresh = diag?.fresh ?? {};

      // Single snapshot from ~24h ago for pill deltas and drivers (20–28h window)
      const [snap24hAgo] = await db
        .select({
          diagnostics: trendSnapshots.diagnostics,
          searchVolume: trendSnapshots.searchVolume,
          newsCount: trendSnapshots.newsCount,
          wikiPageviews: trendSnapshots.wikiPageviews,
        })
        .from(trendSnapshots)
        .where(and(
          eq(trendSnapshots.personId, id),
          eq(trendSnapshots.snapshotOrigin, 'ingest'),
          sql`${trendSnapshots.timestamp} = date_trunc('hour', ${trendSnapshots.timestamp})`,
          sql`${trendSnapshots.timestamp} BETWEEN NOW() - INTERVAL '28 hours' AND NOW() - INTERVAL '20 hours'`,
        ))
        .orderBy(desc(trendSnapshots.timestamp), desc(trendSnapshots.id))
        .limit(1);

      const ageMs = Date.now() - latest.timestamp.getTime();
      const ageMinutes = Math.round(ageMs / 60000);
      const dataDelayed = ageMs > 3 * 60 * 60 * 1000;

      // activeSources drives the "Sources: …" header in the Momentum Signals
      // card, so it should reflect which sources actually have data rendered
      // on-screen — not which sources passed through the primary pipeline
      // fresh (the `diag.fresh.*` flag flips to false for fallback-sourced
      // data even when a valid value lands in the snapshot column). Using
      // the snapshot columns keeps the header in sync with the cards.
      // "search" deliberately omitted (Apr 2026 — PR3): the SERP-shape
      // composite no longer feeds scoring and its UI card is replaced by
      // News Momentum, so listing it as a source would mislead users.
      const activeSources: string[] = [];
      if ((latest.wikiPageviews ?? 0) > 0) activeSources.push("wiki");
      if ((latest.newsCount ?? 0) > 0) activeSources.push("news");

      const staleFlags: Record<string, boolean> = {};
      if (dataDelayed) staleFlags.dataDelayed = true;
      // `*Held` covers both the single-tick EMA-hold and the trailing-24h
      // decay-floor — semantically both mean "the displayed value is not the
      // raw fetch, it's been anchored to recent history".
      if (fresh.newsEmaHeld || fresh.newsFloorApplied) staleFlags.newsHeld = true;
      if (fresh.searchEmaHeld || fresh.searchFloorApplied) staleFlags.searchHeld = true;

      // 24h change for pills; small dead zone to avoid noisy ±1% flicker
      const DELTA_DEAD_ZONE_PCT = 2;
      const rawSearchDeltaPct = snap24hAgo && snap24hAgo.searchVolume > 0
        ? Math.round(((latest.searchVolume - snap24hAgo.searchVolume) / snap24hAgo.searchVolume) * 100)
        : 0;
      const searchDeltaPct = Math.abs(rawSearchDeltaPct) <= DELTA_DEAD_ZONE_PCT ? 0 : rawSearchDeltaPct;

      const rawNewsDeltaPct = snap24hAgo && snap24hAgo.newsCount > 0
        ? Math.round(((latest.newsCount - snap24hAgo.newsCount) / snap24hAgo.newsCount) * 100)
        : 0;
      const newsDeltaPct = Math.abs(rawNewsDeltaPct) <= DELTA_DEAD_ZONE_PCT ? 0 : rawNewsDeltaPct;

      const rawWikiDeltaPct = snap24hAgo && snap24hAgo.wikiPageviews != null && snap24hAgo.wikiPageviews > 0
        ? Math.round(((latest.wikiPageviews! - snap24hAgo.wikiPageviews!) / snap24hAgo.wikiPageviews!) * 100)
        : 0;
      const wikiDeltaPct = Math.abs(rawWikiDeltaPct) <= DELTA_DEAD_ZONE_PCT ? 0 : rawWikiDeltaPct;

      // Wiki 3-day Falling/Rising: need 4 daily values for 3 day-over-day % changes
      let wikiFalling: boolean | undefined;
      let wikiRising: boolean | undefined;
      try {
        const wikiDailyResult = await db.execute(sql`
          SELECT wiki_pageviews as views
          FROM (
            SELECT DISTINCT ON (date_trunc('day', timestamp)::date)
              date_trunc('day', timestamp)::date as day,
              wiki_pageviews
            FROM trend_snapshots
            WHERE person_id = ${id}
              AND snapshot_origin = 'ingest'
              AND timestamp >= NOW() - INTERVAL '4 days'
            ORDER BY date_trunc('day', timestamp)::date DESC, timestamp DESC
            LIMIT 4
          ) sub
          ORDER BY day DESC
        `);
        const wikiDailyRows = Array.isArray(wikiDailyResult) ? wikiDailyResult : (wikiDailyResult as any).rows ?? [];
        if (wikiDailyRows.length === 4) {
          const v0 = Number((wikiDailyRows[0] as any)?.views ?? null);
          const v1 = Number((wikiDailyRows[1] as any)?.views ?? null);
          const v2 = Number((wikiDailyRows[2] as any)?.views ?? null);
          const v3 = Number((wikiDailyRows[3] as any)?.views ?? null);
          if (v1 > 0 && v2 > 0 && v3 > 0 &&
              Number.isFinite(v0) && Number.isFinite(v1) && Number.isFinite(v2) && Number.isFinite(v3)) {
            const pct1 = ((v0 - v1) / v1) * 100;
            const pct2 = ((v1 - v2) / v2) * 100;
            const pct3 = ((v2 - v3) / v3) * 100;
            if (pct1 !== 0 && pct2 !== 0 && pct3 !== 0) {
              if (pct1 < 0 && pct2 < 0 && pct3 < 0) wikiFalling = true;
              else if (pct1 > 0 && pct2 > 0 && pct3 > 0) wikiRising = true;
            }
          }
        }
      } catch {
        // skip flags on any error
      }

      const change24hAbs = Math.abs(trending?.change24h ?? 0);
      const hasSignificantMovement = change24hAbs >= 2.0;

      // Driver breakdown shape now carries an optional `momentum` slice
      // (Apr 2026 — PR2 Fix X). Older snapshots without `velocityComponents.momentum`
      // gracefully coalesce to 0 in the math below; the field is optional in
      // the response so existing API consumers don't break.
      let driverBreakdown: { search: number; news: number; wiki: number; momentum?: number } | null = null;
      let breakdownPct: { search: number; news: number; wiki: number; momentum?: number } | null = null;
      let driverSourceCount = 4;
      let quietSources: string[] = [];
      let driversStatus: "active" | "stable" = "stable";
      let driversIsExact = false;
      let driversMethod: string = "none";

      {
        const currentVC = diag?.velocityComponents;

        if (snap24hAgo) {
          const prevDiag = snap24hAgo.diagnostics as Record<string, any> | null;
          const prevVC = prevDiag?.velocityComponents;

          if (currentVC && prevVC && currentVC.weights && prevVC.weights) {
            driversMethod = "exact_velocity_components";
            driversIsExact = true;

            // PR3 fix: detect "prev tick pre-dates Fix X" (no momentum
            // weight). When prev is on the legacy {search,news,wiki}
            // shape, treating prev.momentum as 0 inflates the momentum
            // delta to the full current weight, causing the dominant
            // driver classifier to label every entity as "News momentum
            // surging" for the entire 24h transition window after deploy.
            // Skip the momentum slice entirely in that case.
            const prevHasMomentum = typeof prevVC.weights?.momentum === "number";

            const searchWeighted = currentVC.search * currentVC.weights.search;
            const newsWeighted = currentVC.news * currentVC.weights.news;
            const wikiWeighted = currentVC.wiki * currentVC.weights.wiki;
            const momentumWeighted = (currentVC.momentum ?? 0) * (currentVC.weights.momentum ?? 0);
            const totalWeighted = searchWeighted + newsWeighted + wikiWeighted + momentumWeighted;

            if (totalWeighted > 0) {
              const rawSearch = (searchWeighted / totalWeighted) * 100;
              const rawNews = (newsWeighted / totalWeighted) * 100;
              const rawWiki = (wikiWeighted / totalWeighted) * 100;
              const rawMomentum = (momentumWeighted / totalWeighted) * 100;
              let pSearch = Math.floor(rawSearch);
              let pNews = Math.floor(rawNews);
              let pWiki = Math.floor(rawWiki);
              let pMomentum = Math.floor(rawMomentum);
              let remainder = 100 - (pSearch + pNews + pWiki + pMomentum);
              const remainders = [
                { key: 'search', frac: rawSearch - pSearch },
                { key: 'news', frac: rawNews - pNews },
                { key: 'wiki', frac: rawWiki - pWiki },
                { key: 'momentum', frac: rawMomentum - pMomentum },
              ].sort((a, b) => b.frac - a.frac);
              for (const r of remainders) {
                if (remainder <= 0) break;
                if (r.key === 'search') pSearch++;
                else if (r.key === 'news') pNews++;
                else if (r.key === 'wiki') pWiki++;
                else pMomentum++;
                remainder--;
              }
              breakdownPct = { search: pSearch, news: pNews, wiki: pWiki, momentum: pMomentum };
            }

            const searchDelta = Math.abs(searchWeighted - (prevVC.search * prevVC.weights.search));
            const newsDelta = Math.abs(newsWeighted - (prevVC.news * prevVC.weights.news));
            const wikiDelta = Math.abs(wikiWeighted - (prevVC.wiki * prevVC.weights.wiki));
            const momentumDelta = prevHasMomentum
              ? Math.abs(
                  momentumWeighted - ((prevVC.momentum ?? 0) * (prevVC.weights.momentum ?? 0))
                )
              : 0;
            const totalDelta = searchDelta + newsDelta + wikiDelta + momentumDelta;

            if (searchDelta / Math.max(searchWeighted, 1) < 0.05) quietSources.push("Search");
            if (newsDelta / Math.max(newsWeighted, 1) < 0.05) quietSources.push("News");
            if (wikiDelta / Math.max(wikiWeighted, 1) < 0.03) quietSources.push("Wikipedia");
            if (prevHasMomentum && momentumDelta / Math.max(momentumWeighted, 1) < 0.05) quietSources.push("Momentum");
            // 4 known sources when prev has momentum, 3 otherwise (during
            // the transition window momentum can't be classified as
            // active OR quiet because we lack a baseline).
            driverSourceCount = (prevHasMomentum ? 4 : 3) - quietSources.length;

            const MIN_DRIVER_DELTA = 0.5;
            if (totalDelta > MIN_DRIVER_DELTA && hasSignificantMovement && driverSourceCount > 0) {
              driverBreakdown = {
                search: Math.round((searchDelta / totalDelta) * 100),
                news: Math.round((newsDelta / totalDelta) * 100),
                wiki: Math.round((wikiDelta / totalDelta) * 100),
                ...(prevHasMomentum
                  ? { momentum: Math.round((momentumDelta / totalDelta) * 100) }
                  : {}),
              };
              driversStatus = "active";
            }
          } else {
            driversMethod = "estimate_signal_change";

            const newsChange = Math.abs(latest.newsCount - snap24hAgo.newsCount);
            const wikiChange = Math.abs((latest.wikiPageviews ?? 0) - (snap24hAgo.wikiPageviews ?? 0));

            // `search` excluded from the fallback (weight is 0, contribution
            // always 0). Aligns with the Hot Movers fallback at line ~1245.
            const newsContrib = newsChange * PLATFORM_WEIGHTS.velocity.news;
            const wikiContrib = wikiChange * PLATFORM_WEIGHTS.velocity.wiki;
            const totalContrib = newsContrib + wikiContrib;

            const newsBase = Math.max(snap24hAgo.newsCount, 1);
            const wikiBase = Math.max(snap24hAgo.wikiPageviews ?? 1, 1);
            if (newsChange / newsBase < 0.05) quietSources.push("News");
            if (wikiChange / wikiBase < 0.03) quietSources.push("Wikipedia");
            driverSourceCount = 2 - quietSources.length;

            const MIN_DRIVER_CONTRIB = 0.5;
            if (totalContrib > MIN_DRIVER_CONTRIB && hasSignificantMovement && driverSourceCount > 0) {
              driverBreakdown = {
                search: 0,
                news: Math.round((newsContrib / totalContrib) * 100),
                wiki: Math.round((wikiContrib / totalContrib) * 100),
              };
              driversStatus = "active";
            }
          }
        }
      }

      let categoryRankNum: number | null = null;
      if (trending?.category) {
        const [catRankRow] = await db
          .select({ cnt: sql<number>`count(*)::int` })
          .from(trendingPeople)
          .where(and(
            eq(trendingPeople.category, trending.category),
            sql`${trendingPeople.rank} < ${trending.rank}`
          ));
        categoryRankNum = (catRankRow?.cnt ?? 0) + 1;
      }

      const officialProfiles: Record<string, string> = {};
      if (person.xHandle) officialProfiles.x = person.xHandle;
      if (person.instagramHandle) officialProfiles.instagram = person.instagramHandle;
      if (person.tiktokHandle) officialProfiles.tiktok = person.tiktokHandle;
      if (person.youtubeId) officialProfiles.youtube = person.youtubeId;
      if (person.spotifyId) officialProfiles.spotify = person.spotifyId;

      const momentumStats = await getSourceStats().catch(() => null);

      const searchLevel = computeLevel("search", latest.searchVolume ?? 0, momentumStats?.search);
      const wikiLevel = computeLevel("wiki", latest.wikiPageviews ?? 0, momentumStats?.wiki);

      // ── News-Momentum slice (Apr 2026 — PR3 + PR4) ───────────────────────
      // The momentum velocity sub-score (0..100) is the canonical reading,
      // persisted on every post-Fix-X snapshot under
      // `diagnostics.velocityComponents.momentum`. The raw 24h-vs-7d ratio
      // is reconstructed from the persisted raw counts so the UI can show
      // a humans-readable "today is N× this person's typical week".
      // For pre-Fix-X snapshots (transition window), the velocityComponents
      // shape is the legacy {search,news,wiki} triple — `momentum` is
      // missing and we fall through to a 0 score so the card renders as
      // "Quiet" rather than spurious-high.
      //
      // PR4 (Apr 2026): The persisted `diag.raw.news7d` was structurally
      // broken pre-deploy (Mediastack=0, Serper/GDELT capped at 35.71/day).
      // Engine now uses SQL aggregate from snapshot history. As a safety
      // net during the transition window — and to keep the displayed ratio
      // in sync with audit / dry-run tooling — the API independently
      // computes the same SQL aggregate and prefers it when available.
      const persistedMomentumScore = Number(diag?.velocityComponents?.momentum ?? 0);
      const persistedNews7dAvg = Number(diag?.raw?.news7d ?? 0);
      const news24h = Number(latest.newsCount ?? 0);

      // Per-person 7-day news average from our own snapshot history. Same
      // query the audit script uses (server/scripts/audit-trend-engine.ts).
      // We require a minimum sample count before trusting the aggregate so
      // brand-new tracked people (< 1 day of history) fall through to the
      // persisted/provider value rather than being penalized by a noisy
      // partial-week average.
      let historyNews7dAvg = 0;
      let historyNews7dSamples = 0;
      try {
        const sevenDaysAgoForNews = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
        const news7dRow = await db.execute(sql`
          SELECT AVG(news_count)::float AS avg7d, COUNT(*)::int AS samples
          FROM trend_snapshots
          WHERE person_id = ${person.id}
            AND timestamp >= ${sevenDaysAgoForNews}
            AND snapshot_origin = 'ingest'
            AND news_count IS NOT NULL
        `);
        const row = news7dRow.rows?.[0] as { avg7d?: number; samples?: number } | undefined;
        historyNews7dAvg = Number(row?.avg7d ?? 0) || 0;
        historyNews7dSamples = Number(row?.samples ?? 0) || 0;
      } catch (e) {
        // Non-fatal — fall through to the persisted value below.
        console.warn(`[momentum API] news7d history query failed for ${person.id}: ${(e as Error).message}`);
      }

      const HISTORY_MIN_SAMPLES = 24; // ~1 day of hourly snapshots
      const news7dAvgForDisplay = historyNews7dSamples >= HISTORY_MIN_SAMPLES
        ? historyNews7dAvg
        : persistedNews7dAvg;
      const news7dAvgSource: "history" | "persisted" =
        historyNews7dSamples >= HISTORY_MIN_SAMPLES ? "history" : "persisted";

      // Mirror the production formula exactly so the displayed ratio always
      // matches the score the engine *would* use given the same denominator.
      // Floor at 1 to dodge the tiny-baseline divide-by-near-zero (matches
      // MOMENTUM_AVG_FLOOR in normalize.ts).
      const momentumDenom = Math.max(news7dAvgForDisplay, 1);
      const momentumRatio = news7dAvgForDisplay > 0 && news24h > 0
        ? Math.min(news24h / momentumDenom, 10) // cap matches MOMENTUM_RATIO_CAP
        : 0;

      // 24h delta vs the prior tick's persisted momentum score. The
      // 24h-prior diagnostics may pre-date Fix X and lack
      // `velocityComponents.momentum`; in that case we report deltaPct=0
      // (no measurable change) rather than fabricating a baseline of 0
      // — see the Hot Movers / Why Trending fix in PR3.
      const prevDiag = snap24hAgo?.diagnostics as Record<string, any> | null;
      const prevMomentumScoreRaw = prevDiag?.velocityComponents?.momentum;
      const prevMomentumScore = typeof prevMomentumScoreRaw === "number" ? prevMomentumScoreRaw : null;
      const rawMomentumDeltaPct = prevMomentumScore !== null && prevMomentumScore > 0
        ? Math.round(((persistedMomentumScore - prevMomentumScore) / prevMomentumScore) * 100)
        : 0;
      const momentumDeltaPct = Math.abs(rawMomentumDeltaPct) <= DELTA_DEAD_ZONE_PCT ? 0 : rawMomentumDeltaPct;

      // The displayed score still mirrors the engine score for ranking
      // diagnostics. When the displayed 7d-avg comes from snapshot
      // history (rather than the persisted/provider value), recompute
      // the score from the same baseline so the score the API hands
      // back matches the ratio it hands back. Once the next ingest
      // tick lands, persisted = recomputed and we converge.
      const recomputedMomentumScore = momentumRatio > 0
        ? Math.round((Math.log(1 + momentumRatio) / Math.log(11)) * 100)
        : 0;
      const momentumScoreForDisplay = news7dAvgSource === "history"
        ? recomputedMomentumScore
        : persistedMomentumScore;
      // Level keys off the *ratio*, not the score — see
      // computeMomentumLevel above for the rationale and band table.
      const momentumLevel = computeMomentumLevel(momentumRatio);

      res.json({
        asOf: latest.timestamp.toISOString(),
        ageMinutes,
        activeSources,
        staleFlags,
        signals: {
          search: {
            volume: latest.searchVolume,
            deltaPct: searchDeltaPct,
            level: searchLevel,
            relatedSearches: (evidence.relatedSearches ?? []).slice(0, 5),
            peopleAlsoAsk: (evidence.peopleAlsoAsk ?? []).slice(0, 5),
          },
          news: await (async () => {
            let displayCount = latest.newsCount;
            let recentPeak: number | null = null;
            let recentPeakAge: string | null = null;

            if (latest.newsCount === 0) {
              const recentNonZero = await db
                .select({
                  newsCount: trendSnapshots.newsCount,
                  timestamp: trendSnapshots.timestamp,
                })
                .from(trendSnapshots)
                .where(and(
                  eq(trendSnapshots.personId, id),
                  eq(trendSnapshots.snapshotOrigin, 'ingest'),
                  sql`${trendSnapshots.newsCount} > 0`,
                  sql`${trendSnapshots.timestamp} >= NOW() - INTERVAL '24 hours'`,
                ))
                .orderBy(desc(trendSnapshots.newsCount))
                .limit(1);

              if (recentNonZero.length > 0) {
                recentPeak = recentNonZero[0].newsCount;
                const hoursAgo = Math.round((Date.now() - recentNonZero[0].timestamp.getTime()) / (1000 * 60 * 60));
                recentPeakAge = hoursAgo < 1 ? "just now" : hoursAgo === 1 ? "~1h ago" : `~${hoursAgo}h ago`;
              }
            }

            return {
              count: displayCount,
              recentPeak,
              recentPeakAge,
              deltaPct: newsDeltaPct,
              level: computeLevel("news", displayCount ?? 0, momentumStats?.news),
              headlines: (evidence.newsHeadlines ?? []).slice(0, 3),
              topStories: (evidence.topStories ?? []).slice(0, 3),
              provider: evidence.newsProvider ?? fresh.newsSource ?? "unknown",
            };
          })(),
          wiki: {
            views: latest.wikiPageviews ?? 0,
            deltaPct: wikiDeltaPct,
            level: wikiLevel,
            ...(wikiFalling === true && { wiki_falling: true }),
            ...(wikiRising === true && { wiki_rising: true }),
          },
          momentum: {
            // 0..100 sub-score. PR4: when the displayed 7d-avg comes
            // from snapshot history (rather than the persisted/provider
            // value), the score is recomputed from the same baseline
            // so level/ratio/score stay internally consistent. Once the
            // next ingest tick lands, persisted = recomputed and we
            // converge on the persisted value.
            score: Math.round(momentumScoreForDisplay * 10) / 10,
            // Raw 24h/7d ratio (clamped at 10×). 0 means no signal —
            // either no news in the 24h window or no 7d baseline.
            ratio: Math.round(momentumRatio * 100) / 100,
            // Trailing 7-day daily-average news count (the baseline).
            // Sourced from snapshot history when available (PR4),
            // falling back to the persisted/provider value for
            // brand-new tracked people.
            averageDaily7d: Math.round(news7dAvgForDisplay * 10) / 10,
            // Today's 24h count (same value the News Activity card shows).
            articleCount24h: news24h,
            // 24h change in the *score* (not the ratio) vs the prior tick.
            deltaPct: momentumDeltaPct,
            level: momentumLevel,
          },
          drivers: {
            status: driversStatus,
            breakdown: driverBreakdown,
            breakdownPct,
            activeSources: driversStatus === "active" ? driverSourceCount : activeSources.length,
            quietSources: quietSources,
            isExact: driversIsExact,
            method: driversMethod,
          },
        },
        categoryRank: trending ? {
          overall: trending.rank,
          category: trending.category,
          categoryRank: categoryRankNum,
        } : null,
        officialProfiles,
      });
    } catch (error) {
      console.error("Error fetching momentum signals:", error);
      res.status(500).json({ error: "Failed to fetch momentum signals" });
    }
  });

  // Get all images for a celebrity (for "Curate Profile" voting)
  app.get("/api/people/:id/images", optionalAuth, async (req: AuthRequest, res) => {
    try {
      const { id } = req.params;

      const images = await db
        .select()
        .from(celebrityImages)
        .where(eq(celebrityImages.personId, id))
        .orderBy(desc(celebrityImages.votesUp), asc(celebrityImages.addedAt));

      const userId = req.userId || null;
      if (!userId || images.length === 0) {
        return res.json(images);
      }

      const votes = await db
        .select({
          imageId: imageVotes.imageId,
          direction: imageVotes.direction,
        })
        .from(imageVotes)
        .where(and(
          eq(imageVotes.userId, userId),
          inArray(imageVotes.imageId, images.map((img) => img.id)),
        ));

      const voteMap = new Map(votes.map((vote) => [vote.imageId, vote.direction]));
      res.json(images.map((image) => ({
        ...image,
        currentUserDirection: voteMap.get(image.id) || null,
      })));
    } catch (error) {
      console.error("Error fetching celebrity images:", error);
      res.status(500).json({ error: "Failed to fetch celebrity images" });
    }
  });

  // Get primary avatar for a celebrity (most voted or marked as primary)
  app.get("/api/people/:id/avatar", async (req, res) => {
    try {
      const { id } = req.params;
      
      const [primaryImage] = await db
        .select()
        .from(celebrityImages)
        .where(eq(celebrityImages.personId, id))
        .orderBy(desc(celebrityImages.votesUp), asc(celebrityImages.addedAt))
        .limit(1);
      
      if (primaryImage) {
        res.json({ imageUrl: primaryImage.imageUrl });
      } else {
        res.json({ imageUrl: null });
      }
    } catch (error) {
      console.error("Error fetching primary avatar:", error);
      res.status(500).json({ error: "Failed to fetch primary avatar" });
    }
  });

  // Vote on a celebrity image (for Curate Profile feature)
  app.post("/api/people/:personId/images/:imageId/vote", requireAuth, async (req: AuthRequest, res) => {
    try {
      const { personId, imageId } = req.params;
      const { direction } = req.body;
      const userId = req.userId!;

      if (!checkVoteRateLimit(userId)) {
        return res.status(429).json({ error: "Too many votes. Please slow down." });
      }

      if (direction !== 'up') {
        return res.status(400).json({ error: "Invalid direction. Only 'up' is accepted." });
      }

      const [image] = await db.select()
        .from(celebrityImages)
        .where(and(
          eq(celebrityImages.id, imageId),
          eq(celebrityImages.personId, personId)
        ));
      
      if (!image) {
        return res.status(404).json({ error: "Image not found" });
      }

      // Scope the existing-vote lookup to this PERSON (not just this image), so that
      // voting for a different image of the same person is treated as a swap rather
      // than a brand-new vote. Join imageVotes -> celebrityImages to filter by personId.
      const [existing] = await db
        .select({ id: imageVotes.id, imageId: imageVotes.imageId })
        .from(imageVotes)
        .innerJoin(celebrityImages, eq(imageVotes.imageId, celebrityImages.id))
        .where(and(
          eq(imageVotes.userId, userId),
          eq(celebrityImages.personId, personId),
        ));

      const action = classifyImageVoteAction(existing, imageId);

      if (action === 'noop') {
        return res.json({ message: "Already voted", alreadyVoted: true });
      }

      let xpResult: Awaited<ReturnType<typeof gamificationService.awardXp>> | undefined;

      if (action === 'swap') {
        const previousImageId = existing!.imageId;
        await db.transaction(async (tx) => {
          await tx.update(imageVotes)
            .set({ imageId, votedAt: new Date() })
            .where(eq(imageVotes.id, existing!.id));
          await tx.update(celebrityImages)
            .set({ votesUp: sql`GREATEST(${celebrityImages.votesUp} - 1, 0)` })
            .where(eq(celebrityImages.id, previousImageId));
          await tx.update(celebrityImages)
            .set({ votesUp: sql`${celebrityImages.votesUp} + 1` })
            .where(eq(celebrityImages.id, imageId));
        });
      } else {
        await db.transaction(async (tx) => {
          await tx.insert(imageVotes).values({ imageId, userId, direction: 'up' });
          await tx.update(celebrityImages)
            .set({ votesUp: sql`${celebrityImages.votesUp} + 1` })
            .where(eq(celebrityImages.id, imageId));
          await tx.update(profiles)
            .set({ totalVotes: sql`${profiles.totalVotes} + 1` })
            .where(eq(profiles.id, userId));
        });

        try {
          xpResult = await gamificationService.awardXp(
            userId, 'vote_curation',
            `curation_${imageId}_${userId}`,
            { imageId, personId, direction: 'up' }
          );
        } catch (e) { console.error("XP award failed:", e); }
      }

      await syncWinningAvatarForPerson(personId);

      const [updatedImage] = await db.select()
        .from(celebrityImages)
        .where(eq(celebrityImages.id, imageId));

      res.json({ ...updatedImage, xp: xpResult ?? null, swapped: action === 'swap' });
    } catch (error) {
      console.error("Error voting on celebrity image:", error);
      res.status(500).json({ error: "Failed to vote on image" });
    }
  });

  // Flag a celebrity image (schema foundation; UI TBD)
  app.post("/api/people/:personId/images/:imageId/flag", requireAuth, async (req: AuthRequest, res) => {
    try {
      const { personId, imageId } = req.params;
      const { reason, notes } = req.body ?? {};
      const userId = req.userId!;

      if (!isValidImageFlagReason(reason)) {
        return res.status(400).json({ error: "Invalid reason" });
      }
      if (notes !== undefined && notes !== null && typeof notes !== 'string') {
        return res.status(400).json({ error: "Invalid notes" });
      }

      const [image] = await db.select()
        .from(celebrityImages)
        .where(and(
          eq(celebrityImages.id, imageId),
          eq(celebrityImages.personId, personId),
        ));
      if (!image) {
        return res.status(404).json({ error: "Image not found" });
      }

      const since = new Date(Date.now() - IMAGE_FLAG_WINDOW_MS);
      const [rateRow] = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(imageFlags)
        .where(and(
          eq(imageFlags.userId, userId),
          gte(imageFlags.createdAt, since),
        ));
      if (isImageFlagRateLimited(rateRow?.count ?? 0)) {
        return res.status(429).json({ error: "Flag rate limit exceeded. Try again later." });
      }

      const [row] = await db.insert(imageFlags)
        .values({ imageId, userId, reason, notes: notes ?? null })
        .onConflictDoUpdate({
          target: [imageFlags.imageId, imageFlags.userId],
          set: { reason, notes: notes ?? null },
        })
        .returning();

      res.status(201).json(row);
    } catch (error) {
      console.error("Error flagging celebrity image:", error);
      res.status(500).json({ error: "Failed to flag image" });
    }
  });

  // Get community insights for a person with vote counts
  app.get("/api/community-insights/:personId", async (req, res) => {
    try {
      const { personId } = req.params;

      // Author info is resolved live via LEFT JOIN profiles. Missing/deleted
      // profiles fall through formatCommentAuthor() to "[deleted user]".
      const insights = await db
        .select({
          id: communityInsights.id,
          personId: communityInsights.personId,
          userId: communityInsights.userId,
          content: communityInsights.content,
          sentimentVote: communityInsights.sentimentVote,
          deletedAt: communityInsights.deletedAt,
          createdAt: communityInsights.createdAt,
          upvotes: sql<number>`CAST(COUNT(CASE WHEN ${insightVotes.voteType} = 'up' THEN 1 END) AS INTEGER)`,
          downvotes: sql<number>`CAST(COUNT(CASE WHEN ${insightVotes.voteType} = 'down' THEN 1 END) AS INTEGER)`,
          ...commentAuthorSelect,
        })
        .from(communityInsights)
        .leftJoin(insightVotes, eq(insightVotes.insightId, communityInsights.id))
        .leftJoin(profiles, eq(profiles.id, communityInsights.userId))
        .where(and(
          eq(communityInsights.personId, personId),
          isNull(communityInsights.deletedAt),
        ))
        .groupBy(
          communityInsights.id,
          communityInsights.personId,
          communityInsights.userId,
          communityInsights.content,
          communityInsights.sentimentVote,
          communityInsights.deletedAt,
          communityInsights.createdAt,
          profiles.id,
          profiles.username,
          profiles.avatarUrl,
        )
        .orderBy(desc(sql`CAST(COUNT(CASE WHEN ${insightVotes.voteType} = 'up' THEN 1 END) AS INTEGER) - CAST(COUNT(CASE WHEN ${insightVotes.voteType} = 'down' THEN 1 END) AS INTEGER)`));

      const parentVoteLabelMap = await getInsightParentVoteLabelMap({
        personId,
        insights,
      });

      res.json(insights.map(({ authorId, authorUsername, authorAvatarUrl, ...insight }) => {
        const isDeleted = Boolean(insight.deletedAt);
        return {
          ...insight,
          content: isDeleted ? "" : insight.content,
          ...(isDeleted
            ? { username: DELETED_COMMENT_AUTHOR_USERNAME, avatarUrl: null }
            : formatCommentAuthor({ authorId, authorUsername, authorAvatarUrl })),
          parentVoteLabel: isDeleted ? null : parentVoteLabelMap.get(insight.id) ?? null,
        };
      }));
    } catch (error) {
      console.error("Error fetching community insights:", error);
      res.status(500).json({ error: "Failed to fetch community insights" });
    }
  });

  // Create a new community insight (protected route)
  app.post("/api/community-insights", requireAuth, async (req: AuthRequest, res) => {
    try {
      // Defense in depth: client must not supply author identity. We resolve it
      // server-side from the authenticated profile and attach it to the response.
      if (Object.prototype.hasOwnProperty.call(req.body ?? {}, "username")) {
        return res.status(400).json({ error: "Username is resolved from the authenticated profile" });
      }

      const { personId, content, sentimentVote } = req.body;

      if (!personId || !content) {
        return res.status(400).json({ error: "Missing required fields: personId, content" });
      }

      // Validate content length (max 2500 characters)
      if (content.length > 2500) {
        return res.status(400).json({ error: "Content exceeds maximum length of 2500 characters" });
      }

      // Validate sentimentVote if provided (must be 1-10)
      if (sentimentVote !== undefined && sentimentVote !== null) {
        if (typeof sentimentVote !== 'number' || sentimentVote < 1 || sentimentVote > 10) {
          return res.status(400).json({ error: "Sentiment vote must be between 1 and 10" });
        }
      }

      const [newInsight] = await db
        .insert(communityInsights)
        .values({
          personId,
          userId: req.userId!,
          content,
          sentimentVote: sentimentVote || null,
        })
        .returning();

      let xpResult;
      try {
        xpResult = await gamificationService.awardXp(
          req.userId!, 'post_insight',
          `insight_${newInsight.id}_${req.userId}`,
          { insightId: newInsight.id, personId }
        );
      } catch (e) { console.error("XP award failed:", e); }

      const [profile] = await db
        .select(commentAuthorSelect)
        .from(profiles)
        .where(eq(profiles.id, req.userId!))
        .limit(1);

      res.json({
        ...newInsight,
        deletedAt: newInsight.deletedAt,
        ...formatCommentAuthor(profile ?? {
          authorId: null,
          authorUsername: null,
          authorAvatarUrl: null,
        }),
        upvotes: 0,
        downvotes: 0,
        xp: xpResult ?? null,
      });
    } catch (error: any) {
      console.error("Error creating community insight:", error);
      res.status(400).json({ error: "Failed to create insight" });
    }
  });

  // Soft-delete a community insight owned by the authenticated user.
  app.delete("/api/community-insights/:id", requireAuth, async (req: AuthRequest, res) => {
    try {
      const { id } = req.params;
      const userId = req.userId!;

      const [insight] = await db
        .select({
          id: communityInsights.id,
          userId: communityInsights.userId,
          deletedAt: communityInsights.deletedAt,
        })
        .from(communityInsights)
        .where(eq(communityInsights.id, id))
        .limit(1);
      if (!insight) return res.status(404).json({ error: "Insight not found" });
      if (insight.userId !== userId) return res.status(403).json({ error: "Forbidden" });
      if (insight.deletedAt) return res.json({ success: true, deletedAt: insight.deletedAt });

      const deletedAt = new Date();
      const [updated] = await db
        .update(communityInsights)
        .set({ deletedAt })
        .where(and(
          eq(communityInsights.id, id),
          eq(communityInsights.userId, userId),
        ))
        .returning({ deletedAt: communityInsights.deletedAt });

      res.json({ success: true, deletedAt: updated?.deletedAt ?? deletedAt });
    } catch (error: any) {
      console.error("Error deleting community insight:", error);
      res.status(500).json({ error: "Failed to delete insight" });
    }
  });

  // Vote on a community insight (protected route)
  app.post("/api/community-insights/:id/vote", requireAuth, async (req: AuthRequest, res) => {
    try {
      if (!checkVoteRateLimit(req.userId!)) {
        return res.status(429).json({ error: "Too many votes. Please slow down." });
      }
      const { id } = req.params;
      const { voteType } = req.body;

      if (!voteType || !['up', 'down'].includes(voteType)) {
        return res.status(400).json({ error: "Invalid vote type. Must be 'up' or 'down'" });
      }

      const userId = req.userId!; // Verified user ID from auth middleware

      const [insight] = await db
        .select({
          id: communityInsights.id,
          deletedAt: communityInsights.deletedAt,
        })
        .from(communityInsights)
        .where(eq(communityInsights.id, id))
        .limit(1);
      if (!insight) return res.status(404).json({ error: "Insight not found" });
      if (insight.deletedAt) return res.status(410).json({ error: "Insight has been deleted" });

      // Check if user already voted on this insight
      const existingVote = await db
        .select()
        .from(insightVotes)
        .where(and(
          eq(insightVotes.insightId, id),
          eq(insightVotes.userId, userId)
        ))
        .limit(1);

      let isNewVote = false;
      if (existingVote.length > 0) {
        await db
          .update(insightVotes)
          .set({ voteType })
          .where(and(
            eq(insightVotes.insightId, id),
            eq(insightVotes.userId, userId)
          ));
      } else {
        isNewVote = true;
        await db
          .insert(insightVotes)
          .values({
            insightId: id,
            userId,
            voteType,
          });
      }

      let xpResult;
      if (isNewVote) {
        const actionKey = voteType === 'up' ? 'upvote_insight' : 'downvote_insight';
        try {
          xpResult = await gamificationService.awardXp(
            userId, actionKey,
            `insight_vote_${id}_${userId}`,
            { insightId: id, voteType }
          );
        } catch (e) { console.error("XP award failed:", e); }
      }

      res.json({ success: true, xp: xpResult ?? null });
    } catch (error: any) {
      console.error("Error voting on insight:", error);
      res.status(500).json({ error: "Failed to vote" });
    }
  });

  // Get user's vote status for insights (protected route)
  app.get("/api/community-insights/:personId/votes", requireAuth, async (req: AuthRequest, res) => {
    try {
      const { personId } = req.params;
      const userId = req.userId!; // Verified user ID from auth middleware
      
      // Get all insights for this person
      const personInsights = await db
        .select({ id: communityInsights.id, deletedAt: communityInsights.deletedAt })
        .from(communityInsights)
        .where(and(
          eq(communityInsights.personId, personId),
          isNull(communityInsights.deletedAt),
        ));

      const insightIds = personInsights.map(i => i.id);

      if (insightIds.length === 0) {
        return res.json({});
      }

      // Get user's votes for these insights
      const votes = await db
        .select()
        .from(insightVotes)
        .where(and(
          eq(insightVotes.userId, userId),
          inArray(insightVotes.insightId, insightIds)
        ));

      // Convert to map: insightId -> voteType
      const voteMap = votes.reduce((acc, vote) => {
        acc[vote.insightId] = vote.voteType;
        return acc;
      }, {} as Record<string, string>);

      res.json(voteMap);
    } catch (error) {
      console.error("Error fetching user votes:", error);
      res.status(500).json({ error: "Failed to fetch user votes" });
    }
  });

  // ===== OVERRATED/UNDERRATED SENTIMENT VOTES API =====
  
  // Submit an overrated/underrated vote (rate limited to 1/user/person/day)
  app.post("/api/sentiment-votes", requireAuth, async (req: AuthRequest, res) => {
    try {
      const { personId, personName, voteType } = req.body;
      const userId = req.userId!;

      if (!checkVoteRateLimit(userId)) {
        return res.status(429).json({ error: "Too many votes. Please slow down." });
      }
      
      if (!personId || !voteType) {
        return res.status(400).json({ error: "personId and voteType are required" });
      }
      
      if (!['overrated', 'underrated'].includes(voteType)) {
        return res.status(400).json({ error: "voteType must be 'overrated' or 'underrated'" });
      }
      
      const today = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
      
      // Check if user already voted on this person today
      const existingVote = await db
        .select()
        .from(sentimentVotes)
        .where(and(
          eq(sentimentVotes.userId, userId),
          eq(sentimentVotes.personId, personId),
          eq(sentimentVotes.votedDate, today)
        ))
        .limit(1);
      
      if (existingVote.length > 0) {
        // Update existing vote
        await db
          .update(sentimentVotes)
          .set({ voteType })
          .where(and(
            eq(sentimentVotes.userId, userId),
            eq(sentimentVotes.personId, personId),
            eq(sentimentVotes.votedDate, today)
          ));
        
        return res.json({ success: true, updated: true });
      }
      
      // Create new vote
      await db.transaction(async (tx) => {
        await tx.insert(sentimentVotes).values({
          userId,
          personId,
          personName: personName || "Unknown",
          voteType,
          votedDate: today,
        });

        await tx.update(profiles)
          .set({ totalVotes: sql`${profiles.totalVotes} + 1` })
          .where(eq(profiles.id, userId));
      });

      // Phase 3: category-attributed engagement signal. Resolved via
      // the tracked-person's category; null if the person has no
      // category yet (shouldn't happen for live data, guard anyway).
      try {
        const [personRow] = await db
          .select({ category: trackedPeople.category })
          .from(trackedPeople)
          .where(eq(trackedPeople.id, personId))
          .limit(1);
        await upsertEngagement({
          userId,
          categoryId: personRow?.category,
          voteDelta: 1,
          source: "sentiment-vote",
        });
      } catch (e) {
        console.warn("[sentiment-vote] engagement lookup failed:", e);
        captureBackgroundError(e, {
          surface: "sentiment-vote.engagement",
          userId,
          personId,
        });
      }

      let xpResult;
      try {
        xpResult = await gamificationService.awardXp(
          userId, 'vote_sentiment',
          `sentiment_${personId}_${today}_${userId}`,
          { personId, voteType }
        );
      } catch (e) { console.error("XP award failed:", e); }
      
      res.json({ success: true, created: true, xp: xpResult ?? null });
    } catch (error: any) {
      console.error("Error submitting sentiment vote:", error);
      res.status(500).json({ error: "Failed to submit vote" });
    }
  });
  
  // Get user's sentiment votes for a specific person
  app.get("/api/sentiment-votes/:personId", requireAuth, async (req: AuthRequest, res) => {
    try {
      const { personId } = req.params;
      const userId = req.userId!;
      const today = new Date().toISOString().split('T')[0];
      
      const vote = await db
        .select()
        .from(sentimentVotes)
        .where(and(
          eq(sentimentVotes.userId, userId),
          eq(sentimentVotes.personId, personId),
          eq(sentimentVotes.votedDate, today)
        ))
        .limit(1);
      
      res.json({
        hasVotedToday: vote.length > 0,
        voteType: vote[0]?.voteType || null,
      });
    } catch (error) {
      console.error("Error fetching sentiment vote:", error);
      res.status(500).json({ error: "Failed to fetch vote" });
    }
  });
  
  // Get aggregated sentiment vote counts for a person (using celebrity_metrics: seed + real)
  app.get("/api/sentiment-votes/:personId/counts", async (req, res) => {
    try {
      const { personId } = req.params;
      
      // Get combined seed + real values from celebrity_metrics
      const [metrics] = await db
        .select({
          underratedVotesCount: celebrityMetrics.underratedVotesCount,
          overratedVotesCount: celebrityMetrics.overratedVotesCount,
        })
        .from(celebrityMetrics)
        .where(eq(celebrityMetrics.celebrityId, personId))
        .limit(1);
      
      if (metrics) {
        res.json({
          overrated: metrics.overratedVotesCount || 0,
          underrated: metrics.underratedVotesCount || 0,
        });
      } else {
        // Fallback: count from raw sentimentVotes table if no metrics exist
        const overratedCount = await db
          .select({ count: count() })
          .from(sentimentVotes)
          .where(and(
            eq(sentimentVotes.personId, personId),
            eq(sentimentVotes.voteType, 'overrated')
          ));
        
        const underratedCount = await db
          .select({ count: count() })
          .from(sentimentVotes)
          .where(and(
            eq(sentimentVotes.personId, personId),
            eq(sentimentVotes.voteType, 'underrated')
          ));
        
        res.json({
          overrated: Number(overratedCount[0]?.count || 0),
          underrated: Number(underratedCount[0]?.count || 0),
        });
      }
    } catch (error) {
      console.error("Error fetching sentiment vote counts:", error);
      res.status(500).json({ error: "Failed to fetch counts" });
    }
  });

  // ============ VALUE VOTING (UNDERRATED/OVERRATED) ============
  // New unified value voting system for the Value leaderboard tab

  // POST /api/celebrity/:id/value-vote - Cast underrated/overrated vote
  app.post("/api/celebrity/:id/value-vote", requireAuth, async (req: AuthRequest, res) => {
    try {
      const celebrityId = req.params.id;
      const userId = req.userId!;

      if (!checkVoteRateLimit(userId)) {
        return res.status(429).json({ error: "Too many votes. Please slow down." });
      }
      const { vote } = req.body;

      if (!vote || !['underrated', 'overrated', 'fairly_rated'].includes(vote)) {
        return res.status(400).json({ error: "vote must be 'underrated', 'overrated', or 'fairly_rated'" });
      }

      // Check if celebrity exists
      const [celebrity] = await db
        .select({ id: trendingPeople.id, name: trendingPeople.name })
        .from(trendingPeople)
        .where(eq(trendingPeople.id, celebrityId))
        .limit(1);

      if (!celebrity) {
        return res.status(404).json({ error: "Celebrity not found" });
      }

      // Snapshot before upsert — first vote per user/celebrity drives profiles.totalVotes
      // bump and behavioural engagement hooks; changing Underrated/O/Fairly Rated later
      // is refinement, not new engagement signal.
      const [priorValVote] = await db
        .select({ id: celebrityValueVotes.id })
        .from(celebrityValueVotes)
        .where(and(eq(celebrityValueVotes.userId, userId), eq(celebrityValueVotes.celebrityId, celebrityId)))
        .limit(1);
      const firstValueVote = !priorValVote;

      await db.transaction(async (tx) => {
        // Upsert the vote (1 vote per user per celebrity, no daily limit)
        await tx
          .insert(celebrityValueVotes)
          .values({
            celebrityId,
            userId,
            vote,
          })
          .onConflictDoUpdate({
            target: [celebrityValueVotes.userId, celebrityValueVotes.celebrityId],
            set: {
              vote,
              updatedAt: new Date(),
            },
          });

        if (firstValueVote) {
          await tx.update(profiles)
            .set({ totalVotes: sql`${profiles.totalVotes} + 1` })
            .where(eq(profiles.id, userId));
        }
      });

      // Phase 3: behavioural engagement — first value vote only, outside the primary tx.
      if (firstValueVote) {
        try {
          const [personRow] = await db
            .select({ category: trackedPeople.category })
            .from(trackedPeople)
            .where(eq(trackedPeople.id, celebrityId))
            .limit(1);
          await upsertEngagement({
            userId,
            categoryId: personRow?.category,
            voteDelta: 1,
            source: "value-vote",
          });
        } catch (e) {
          console.warn("[value-vote] engagement lookup failed:", e);
          captureBackgroundError(e, {
            surface: "value-vote.engagement",
            userId,
            celebrityId,
          });
        }
      }

      let xpResult;
      try {
        xpResult = await gamificationService.awardXp(
          userId, 'vote_sentiment',
          `value_vote_${celebrityId}_${userId}`,
          { celebrityId, vote }
        );
      } catch (e) { console.error("XP award failed:", e); }

      // Recompute metrics for this celebrity
      const metrics = await recomputeCelebrityMetrics(celebrityId);

      res.json({
        success: true,
        userVote: vote,
        underratedPct: metrics.underratedPct,
        overratedPct: metrics.overratedPct,
        fairlyRatedPct: metrics.fairlyRatedPct,
        valueScore: metrics.valueScore,
        xp: xpResult ?? null,
      });
    } catch (error: any) {
      console.error("[value-vote] Error:", error);
      res.status(500).json({ error: "Failed to submit vote" });
    }
  });

  // GET /api/celebrity/:id/value-vote - Get user's current value vote
  app.get("/api/celebrity/:id/value-vote", optionalAuth, async (req: AuthRequest, res) => {
    try {
      const celebrityId = req.params.id;
      const userId = req.userId;

      let userVote: string | null = null;

      if (userId) {
        const [vote] = await db
          .select({ vote: celebrityValueVotes.vote })
          .from(celebrityValueVotes)
          .where(and(
            eq(celebrityValueVotes.celebrityId, celebrityId),
            eq(celebrityValueVotes.userId, userId)
          ))
          .limit(1);

        userVote = vote?.vote || null;
      }

      // Get current metrics
      const [metrics] = await db
        .select()
        .from(celebrityMetrics)
        .where(eq(celebrityMetrics.celebrityId, celebrityId))
        .limit(1);

      res.json({
        userVote,
        underratedPct: metrics?.underratedPct ?? null,
        overratedPct: metrics?.overratedPct ?? null,
        fairlyRatedPct: metrics?.fairlyRatedPct ?? null,
        valueScore: metrics?.valueScore ?? null,
        underratedVotesCount: metrics?.underratedVotesCount ?? 0,
        overratedVotesCount: metrics?.overratedVotesCount ?? 0,
        fairlyRatedVotesCount: metrics?.fairlyRatedVotesCount ?? 0,
      });
    } catch (error: any) {
      console.error("[value-vote GET] Error:", error);
      res.status(500).json({ error: "Failed to get vote" });
    }
  });

  // GET /api/celebrity/:id/approval-rating - Logged-in user's 1–5 approval rating for this person (cross-device sync)
  app.get("/api/celebrity/:id/approval-rating", optionalAuth, async (req: AuthRequest, res) => {
    try {
      const celebrityId = req.params.id;
      const userId = req.userId;

      if (!userId) {
        return res.json({ rating: null });
      }

      const [row] = await db
        .select({ rating: userVotes.rating })
        .from(userVotes)
        .where(and(eq(userVotes.userId, userId), eq(userVotes.personId, celebrityId)))
        .limit(1);

      const r = row?.rating;
      const rating =
        r != null && Number(r) >= 1 && Number(r) <= 5 ? Number(r) : null;
      res.json({ rating });
    } catch (error: any) {
      console.error("[approval-rating GET] Error:", error);
      res.status(500).json({ error: "Failed to get approval rating" });
    }
  });

  // POST /api/celebrity/:id/approval-rating - Submit or update 1–5 approval (persists via API + recomputes metrics)
  app.post("/api/celebrity/:id/approval-rating", requireAuth, async (req: AuthRequest, res) => {
    try {
      const celebrityId = req.params.id;
      const userId = req.userId!;

      if (!checkVoteRateLimit(userId)) {
        return res.status(429).json({ error: "Too many votes. Please slow down." });
      }

      // Hardened input shape: we accept either a numeric body or a numeric
      // string (some older clients still POST rating as "3"). Coerce and then
      // validate via Zod so clients can rely on a consistent error envelope.
      const approvalRatingSchema = z.object({
        rating: z.coerce.number().int().min(1).max(5),
      });
      let parsed: { rating: number };
      try {
        parsed = approvalRatingSchema.parse(req.body ?? {});
      } catch (err) {
        if (err instanceof ZodError) return sendZodError(res, err);
        return sendBadRequest(res, "Invalid request body");
      }
      const rating = parsed.rating;

      const [celebrity] = await db
        .select({ id: trendingPeople.id, name: trendingPeople.name })
        .from(trendingPeople)
        .where(eq(trendingPeople.id, celebrityId))
        .limit(1);

      if (!celebrity) {
        return res.status(404).json({ error: "Celebrity not found" });
      }

      // Snapshot before upsert — behavioural engagement counts the first 1–5
      // rating per (user, person) only; edits are refinement, same as value-vote.
      const [priorApprovalRow] = await db
        .select({ id: userVotes.id })
        .from(userVotes)
        .where(and(eq(userVotes.userId, userId), eq(userVotes.personId, celebrityId)))
        .limit(1);
      const firstApprovalRating = !priorApprovalRow;

      await db
        .insert(userVotes)
        .values({
          userId,
          personId: celebrityId,
          personName: celebrity.name,
          rating,
        })
        .onConflictDoUpdate({
          target: [userVotes.userId, userVotes.personId],
          set: {
            personName: celebrity.name,
            rating,
            votedAt: new Date(),
          },
        });

      if (firstApprovalRating) {
        try {
          const [personRow] = await db
            .select({ category: trackedPeople.category })
            .from(trackedPeople)
            .where(eq(trackedPeople.id, celebrityId))
            .limit(1);
          await upsertEngagement({
            userId,
            categoryId: personRow?.category,
            voteDelta: 1,
            source: "approval-rating",
          });
        } catch (e) {
          console.warn("[approval-rating] engagement lookup failed:", e);
          captureBackgroundError(e, {
            surface: "approval-rating.engagement",
            userId,
            celebrityId,
          });
        }
      }

      await recomputeCelebrityMetrics(celebrityId);

      res.json({ success: true, rating });
    } catch (error: any) {
      console.error("[approval-rating POST] Error:", error);
      res.status(500).json({ error: "Failed to submit approval rating" });
    }
  });

  // GET /api/celebrity/:id/sentiment-stats - Get real sentiment stats from celebrity_metrics
  app.get("/api/celebrity/:id/sentiment-stats", async (req, res) => {
    try {
      const celebrityId = req.params.id;

      // Get metrics from database
      const [metrics] = await db
        .select()
        .from(celebrityMetrics)
        .where(eq(celebrityMetrics.celebrityId, celebrityId))
        .limit(1);

      if (!metrics) {
        // Return default stats if no metrics found
        return res.json({
          totalVotes: 0,
          averageRating: 3.0,
          distribution: {
            Hate: 10,
            Dislike: 15,
            Neutral: 30,
            Like: 25,
            Love: 20,
          }
        });
      }

      const avgRating = metrics.approvalAvgRating || 3.0;

      const ratingRows = await db
        .select({
          rating: userVotes.rating,
          cnt: sql<number>`cast(count(*) as int)`,
        })
        .from(userVotes)
        .where(
          and(
            eq(userVotes.personId, celebrityId),
            gte(userVotes.rating, 1),
            lte(userVotes.rating, 5),
          ),
        )
        .groupBy(userVotes.rating);

      const counts = [0, 0, 0, 0, 0];
      for (const row of ratingRows) {
        const rating = Number(row.rating);
        if (rating >= 1 && rating <= 5) {
          counts[rating - 1] = Number(row.cnt);
        }
      }

      const totalVotes = counts.reduce((a, b) => a + b, 0);
      const pct = totalVotes > 0
        ? counts.map((c) => Math.round((c / totalVotes) * 100))
        : [10, 15, 30, 25, 20];
      const pctSum = pct.reduce((a, b) => a + b, 0);
      if (pctSum !== 100) {
        const maxIdx = pct.indexOf(Math.max(...pct));
        pct[maxIdx] += (100 - pctSum);
      }

      res.json({
        totalVotes,
        averageRating: parseFloat(avgRating.toFixed(1)),
        distribution: {
          Hate: pct[0],
          Dislike: pct[1],
          Neutral: pct[2],
          Like: pct[3],
          Love: pct[4],
        }
      });
    } catch (error: any) {
      console.error("[sentiment-stats GET] Error:", error);
      res.status(500).json({ error: "Failed to get sentiment stats" });
    }
  });

  // GET /api/source-health - Get current data source health status for UI banner
  app.get("/api/source-health", async (req, res) => {
    try {
      const health = getCurrentHealthSnapshot();
      const hasDegradedSources = hasAnyDegradedSource();
      
      // Calculate staleness for each source
      const now = new Date();
      const getStaleMinutes = (lastHealthy: Date | null): number | null => {
        if (!lastHealthy) return null;
        return Math.round((now.getTime() - lastHealthy.getTime()) / (1000 * 60));
      };
      
      res.json({
        hasDegradedSources,
        summary: getHealthSummary(),
        sources: {
          news: {
            state: health.news.state,
            reason: health.news.reason,
            staleMinutes: getStaleMinutes(health.news.lastHealthyTimestamp),
            isHealthy: health.news.state === "HEALTHY",
          },
          search: {
            state: health.search.state,
            reason: health.search.reason,
            staleMinutes: getStaleMinutes(health.search.lastHealthyTimestamp),
            isHealthy: health.search.state === "HEALTHY",
          },
          wiki: {
            state: health.wiki.state,
            reason: health.wiki.reason,
            staleMinutes: getStaleMinutes(health.wiki.lastHealthyTimestamp),
            isHealthy: health.wiki.state === "HEALTHY",
          },
        },
      });
    } catch (error: any) {
      console.error("[source-health GET] Error:", error);
      res.status(500).json({ error: error.message || "Failed to get source health" });
    }
  });

  // --- Shared: get fallback people from latest completed run snapshots ---
  async function getSnapshotFallbackPeople(): Promise<Array<{
    id: string;
    name: string;
    avatar: string | null;
    bio: string | null;
    category: string | null;
    rank: number;
    trendScore: number | null;
    fameIndex: number | null;
    change24h: number | null;
    change7d: number | null;
  }> | null> {
    try {
      const latestRun = await db
        .select({ id: ingestionRuns.id, startedAt: ingestionRuns.startedAt })
        .from(ingestionRuns)
        .where(and(
          eq(ingestionRuns.status, "completed"),
          eq(ingestionRuns.scoreVersion, SCORE_VERSION),
        ))
        .orderBy(desc(ingestionRuns.startedAt))
        .limit(1);

      if (latestRun.length === 0) return null;

      const fallbackRunId = latestRun[0].id;

      const snapshotRows = await db.execute(sql`
        SELECT 
          ts.person_id,
          ts.fame_index,
          ts.trend_score,
          tp.name,
          tp.avatar,
          tp.category,
          tp.bio
        FROM trend_snapshots ts
        JOIN tracked_people tp ON tp.id = ts.person_id
        WHERE ts.run_id = ${fallbackRunId}
          AND ts.score_version = ${SCORE_VERSION}
        ORDER BY ts.fame_index DESC NULLS LAST
      `);

      const rows = Array.isArray(snapshotRows) ? snapshotRows : (snapshotRows as any).rows ?? [];
      if (rows.length === 0) return null;

      return (rows as any[]).map((row: any, idx: number) => ({
        id: row.person_id,
        name: row.name,
        avatar: row.avatar,
        bio: row.bio,
        category: row.category,
        rank: idx + 1,
        trendScore: row.trend_score,
        fameIndex: row.fame_index,
        change24h: null,
        change7d: null,
      }));
    } catch (err) {
      console.error("[fallback] Snapshot fallback people error:", err);
      return null;
    }
  }

  // --- Snapshot-based fallback for empty trending_people ---
  async function buildSnapshotFallbackLeaderboard(
    tab: string,
    search: string | undefined,
    category: string | undefined,
    limit: number,
    offset: number,
    sortDir: string
  ) {
    try {
      const latestRun = await db
        .select({ id: ingestionRuns.id, startedAt: ingestionRuns.startedAt, scoreVersion: ingestionRuns.scoreVersion })
        .from(ingestionRuns)
        .where(and(
          eq(ingestionRuns.status, "completed"),
          eq(ingestionRuns.scoreVersion, SCORE_VERSION),
        ))
        .orderBy(desc(ingestionRuns.startedAt))
        .limit(1);

      if (latestRun.length === 0) return null;

      const fallbackRunId = latestRun[0].id;
      const fallbackRunAt = latestRun[0].startedAt;

      const snapshotRows = await db.execute(sql`
        SELECT 
          ts.person_id,
          ts.fame_index,
          ts.trend_score,
          ts.mass_score,
          ts.velocity_score,
          ts.momentum,
          tp.name,
          tp.avatar,
          tp.category,
          tp.bio
        FROM trend_snapshots ts
        JOIN tracked_people tp ON tp.id = ts.person_id
        WHERE ts.run_id = ${fallbackRunId}
          AND ts.score_version = ${SCORE_VERSION}
        ORDER BY ts.fame_index DESC NULLS LAST
      `);

      const rows = Array.isArray(snapshotRows) ? snapshotRows : (snapshotRows as any).rows ?? [];
      if (rows.length === 0) return null;

      let filtered = rows as any[];
      if (category && category !== "all") {
        const categoryCanonical = normalizeMarketCategory(category);
        filtered = filtered.filter((r: any) => normalizeMarketCategory(r.category) === categoryCanonical);
      }
      if (search && search.trim()) {
        const term = search.trim().toLowerCase();
        filtered = filtered.filter((r: any) => r.name?.toLowerCase().includes(term));
      }

      if (sortDir === "asc") {
        filtered.sort((a: any, b: any) => (a.fame_index ?? 0) - (b.fame_index ?? 0));
      }

      const totalCount = filtered.length;
      const paged = filtered.slice(offset, offset + limit);

      const data = paged.map((row: any, idx: number) => ({
        id: row.person_id,
        name: row.name,
        avatar: row.avatar,
        category: row.category,
        rank: offset + idx + 1,
        trendScore: row.trend_score,
        fameIndex: row.fame_index,
        change24h: null,
        change7d: null,
        liveRank: null,
        fameIndexLive: null,
        liveUpdatedAt: null,
        approvalPct: null,
        approvalVotesCount: null,
        underratedPct: null,
        overratedPct: null,
        fairlyRatedPct: null,
        valueScore: null,
        leaderboardRank: sortDir === 'asc' ? totalCount - offset - idx : offset + idx + 1,
        userValueVote: null,
        rankChange: 0,
      }));

      return {
        tab,
        sortDir,
        total: data.length,
        totalCount,
        data,
        thresholds: { rankChangeP90: 999, deltaP90: 999, negRankChangeP10: -999, negDeltaP10: -999 },
        baselineStatus: "fallback",
        meta: {
          currentRunId: null,
          baseline24hRunId: null,
          baseline24hAgeHours: null,
          baselineStatus: "fallback",
          coveragePct: 0,
          scoreVersion: SCORE_VERSION,
          fallbackUsed: true,
          fallbackRunId,
          fallbackRunAt: fallbackRunAt?.toISOString() ?? null,
        },
      };
    } catch (err) {
      console.error("[leaderboard] Snapshot fallback error:", err);
      return null;
    }
  }

  // GET /api/leaderboard - Enhanced leaderboard with tab support
  app.get("/api/leaderboard/categories", async (_req, res) => {
    try {
      const rows = await db
        .selectDistinct({ category: trendingPeople.category })
        .from(trendingPeople)
        .where(isNotNull(trendingPeople.category));
      const normalized = Array.from(
        new Set(
          rows
            .map((r) => normalizeMarketCategory(r.category))
            .filter(Boolean),
        ),
      );
      res.json(normalized);
    } catch (error) {
      console.error("Error fetching leaderboard categories:", error);
      res.status(500).json({ error: "Failed to fetch categories" });
    }
  });

  app.get("/api/leaderboard", optionalAuth, async (req: AuthRequest, res) => {
    try {
      const tab = (req.query.tab as string) || 'fame'; // 'fame' | 'approval' | 'value'
      const sortDir = (req.query.sortDir as string) || (req.query.sort as string) || 'desc'; // 'asc' | 'desc'
      const category = req.query.category as string;
      const search = req.query.search as string;
      const limit = parseBoundedInt(req.query.limit, LEADERBOARD_DEFAULT_LIMIT, 1, LEADERBOARD_MAX_LIMIT);
      const offset = parseBoundedInt(req.query.offset, 0, 0, LEADERBOARD_MAX_OFFSET);
      const userId = req.userId;

      // Build conditions arrays:
      // - conditions: all filters (including search) for paged results
      // - nonSearchConditions: filters except search for global rank maps
      const conditions: SQL<unknown>[] = [];
      const nonSearchConditions: SQL<unknown>[] = [];
      
      if (category && category !== 'all') {
        const canonicalCategory = normalizeMarketCategory(category);
        const categoryRows = await db
          .select({ id: trendingPeople.id, category: trendingPeople.category })
          .from(trendingPeople)
          .where(isNotNull(trendingPeople.category));
        const matchingIds = categoryRows
          .filter((row) => normalizeMarketCategory(row.category) === canonicalCategory)
          .map((row) => row.id);

        if (matchingIds.length === 0) {
          const noRowsCondition = sql`1 = 0`;
          conditions.push(noRowsCondition);
          nonSearchConditions.push(noRowsCondition);
        } else {
          const categoryCondition = inArray(trendingPeople.id, matchingIds);
          conditions.push(categoryCondition);
          nonSearchConditions.push(categoryCondition);
        }
      }
      
      if (search && search.trim()) {
        const searchTerm = `%${search.trim().toLowerCase()}%`;
        conditions.push(sql`LOWER(${trendingPeople.name}) LIKE ${searchTerm}`);
      }

      let countQuery = db
        .select({ count: sql<number>`COUNT(*)` })
        .from(trendingPeople);
      
      if (conditions.length > 0) {
        countQuery = countQuery.where(and(...conditions)) as typeof countQuery;
      }
      
      const [countResult] = await countQuery;
      const totalCount = Number(countResult?.count) || 0;

      // --- SNAPSHOT FALLBACK: If trending_people is empty, reconstruct from latest completed run ---
      if (totalCount === 0) {
        console.log("[leaderboard] trending_people is empty, attempting snapshot fallback...");
        const fallbackResult = await buildSnapshotFallbackLeaderboard(tab, search, category, limit, offset, sortDir);
        if (fallbackResult) {
          console.log(`[leaderboard] Snapshot fallback serving ${fallbackResult.data.length} people from run ${fallbackResult.meta.fallbackRunId}`);
          return res.json(fallbackResult);
        }
        console.log("[leaderboard] No snapshot fallback available either");
      }

      let query = db
        .select({
          id: trendingPeople.id,
          name: trendingPeople.name,
          avatar: trendingPeople.avatar,
          category: trendingPeople.category,
          rank: trendingPeople.rank,
          trendScore: trendingPeople.trendScore,
          fameIndex: trendingPeople.fameIndex,
          change24h: trendingPeople.change24h,
          change7d: trendingPeople.change7d,
          liveRank: trendingPeople.liveRank,
          fameIndexLive: trendingPeople.fameIndexLive,
          liveUpdatedAt: trendingPeople.liveUpdatedAt,
          imageSlug: trackedPeople.imageSlug,
          approvalPct: celebrityMetrics.approvalPct,
          approvalAvgRating: celebrityMetrics.approvalAvgRating,
          approvalVotesCount: celebrityMetrics.approvalVotesCount,
          underratedPct: celebrityMetrics.underratedPct,
          overratedPct: celebrityMetrics.overratedPct,
          fairlyRatedPct: celebrityMetrics.fairlyRatedPct,
          underratedCount: celebrityMetrics.underratedVotesCount,
          overratedCount: celebrityMetrics.overratedVotesCount,
          fairlyRatedCount: celebrityMetrics.fairlyRatedVotesCount,
          valueScore: celebrityMetrics.valueScore,
        })
        .from(trendingPeople)
        .leftJoin(trackedPeople, eq(trendingPeople.id, trackedPeople.id))
        .leftJoin(celebrityMetrics, eq(trendingPeople.id, celebrityMetrics.celebrityId));

      if (conditions.length > 0) {
        query = query.where(and(...conditions)) as typeof query;
      }

      if (tab === 'approval') {
        if (sortDir === 'asc') {
          query = query.orderBy(sql`${celebrityMetrics.approvalAvgRating} ASC NULLS LAST, ${celebrityMetrics.approvalVotesCount} ASC NULLS LAST, ${trendingPeople.name} ASC`) as typeof query;
        } else {
          query = query.orderBy(sql`${celebrityMetrics.approvalAvgRating} DESC NULLS LAST, ${celebrityMetrics.approvalVotesCount} DESC NULLS LAST, ${trendingPeople.name} ASC`) as typeof query;
        }
      } else {
        let orderByColumn: any;
        switch (tab) {
          case 'value':
            orderByColumn = celebrityMetrics.valueScore;
            break;
          case 'fame':
          default:
            orderByColumn = sql`COALESCE(${trendingPeople.fameIndexLive}, ${trendingPeople.fameIndex})`;
            break;
        }

        // Cold-start: only the Value tab is rendered as a card feed on the
        // Vote page (the Fame tab is the canonical leaderboard ranking, where
        // reordering would mislead users about who is #1). For Value we
        // prepend a soft politics-deprioritisation so the "All" card stack
        // mirrors the other vote sections.
        const coldStart = tab === 'value' && (await shouldUseColdStart(req));
        const direction = sortDir === 'asc' ? 'ASC' : 'DESC';
        if (coldStart) {
          query = query.orderBy(
            sql`CASE WHEN ${trendingPeople.category} = 'politics' THEN 1 ELSE 0 END ASC, ${orderByColumn} ${sql.raw(direction)} NULLS LAST, ${trendingPeople.name} ASC`,
          ) as typeof query;
        } else {
          query = query.orderBy(
            sql`${orderByColumn} ${sql.raw(direction)} NULLS LAST, ${trendingPeople.name} ASC`,
          ) as typeof query;
        }
      }

      query = query.limit(limit).offset(offset) as typeof query;

      const results = await query;

      let userValueVotes: Record<string, string> = {};
      if (userId && tab === 'value') {
        const votes = await db
          .select({ celebrityId: celebrityValueVotes.celebrityId, vote: celebrityValueVotes.vote })
          .from(celebrityValueVotes)
          .where(eq(celebrityValueVotes.userId, userId));

        for (const v of votes) {
          userValueVotes[v.celebrityId] = v.vote;
        }
      }

      const prevRankLookup = await getSnapshotRankMap();
      const baselineStatus = prevRankLookup.size > 0 ? "normal" : "degraded";

      let approvalRankById = new Map<string, number>();
      if (tab === 'approval') {
        let approvalRankQuery = db
          .select({ id: trendingPeople.id })
          .from(trendingPeople)
          .leftJoin(celebrityMetrics, eq(trendingPeople.id, celebrityMetrics.celebrityId));

        if (nonSearchConditions.length > 0) {
          approvalRankQuery = approvalRankQuery.where(and(...nonSearchConditions)) as typeof approvalRankQuery;
        }

        if (sortDir === 'asc') {
          approvalRankQuery = approvalRankQuery.orderBy(
            sql`${celebrityMetrics.approvalAvgRating} ASC NULLS LAST, ${celebrityMetrics.approvalVotesCount} ASC NULLS LAST, ${trendingPeople.name} ASC`
          ) as typeof approvalRankQuery;
        } else {
          approvalRankQuery = approvalRankQuery.orderBy(
            sql`${celebrityMetrics.approvalAvgRating} DESC NULLS LAST, ${celebrityMetrics.approvalVotesCount} DESC NULLS LAST, ${trendingPeople.name} ASC`
          ) as typeof approvalRankQuery;
        }

        const approvalRankRows = await approvalRankQuery;
        approvalRankById = new Map(
          approvalRankRows.map((row, idx) => [row.id, idx + 1])
        );
      }

      const leaderboard = results.map((person, index) => {
        const prevRank = prevRankLookup.get(person.id) ?? person.rank;
        let leaderboardRank: number | null = null;

        if (tab === 'fame') {
          leaderboardRank = (person.fameIndex === 0 || person.fameIndex === null)
            ? null
            : (person.liveRank ?? person.rank);
        } else if (tab === 'approval') {
          leaderboardRank = approvalRankById.get(person.id) ?? null;
        } else {
          leaderboardRank = sortDir === 'asc' ? totalCount - offset - index : offset + index + 1;
        }

        return {
          ...person,
          leaderboardRank,
          userValueVote: userValueVotes[person.id] || null,
          rankChange: prevRank - person.rank,
        };
      });

      const baselineMeta = await getBaselineDiagnostics(totalCount);
      const baselineDegraded = baselineMeta.baseline24hStatus !== "normal";
      const safeLeaderboard = baselineDegraded
        ? leaderboard.map(p => ({ ...p, change24h: null, change7d: null }))
        : leaderboard;

      res.json({
        tab,
        sortDir,
        total: safeLeaderboard.length,
        totalCount,
        data: safeLeaderboard,
        baselineStatus: baselineMeta.baseline24hStatus,
        meta: {
          currentRunId: baselineMeta.currentRunId,
          baseline24hRunId: baselineMeta.baseline24hRunId,
          baseline24hAgeHours: baselineMeta.baseline24hAgeHours,
          baselineStatus: baselineMeta.baseline24hStatus,
          coveragePct: baselineMeta.baseline24hCoveragePct,
          scoreVersion: baselineMeta.scoreVersion,
          fallbackUsed: false,
          fallbackRunId: null,
        },
      });
    } catch (error: any) {
      console.error("[leaderboard] Error:", error);
      res.status(500).json({ error: error.message || "Failed to fetch leaderboard" });
    }
  });

  // GET /api/leaderboard/users - User prediction leaderboard ranked by P&L
  app.get("/api/leaderboard/users", optionalAuth, async (req: AuthRequest, res) => {
    try {
      const period = (req.query.period as string) || 'all';
      const search = (req.query.search as string) || '';
      const page = Math.max(parseInt(req.query.page as string) || 0, 0);
      const limit = Math.min(Math.max(parseInt(req.query.limit as string) || 50, 1), 100);
      const userId = req.userId;

      // Build period filter on settledAt
      let periodFilter = sql`TRUE`;
      if (period === 'today') {
        periodFilter = sql`${marketBets.settledAt} >= NOW() - INTERVAL '1 day'`;
      } else if (period === 'week') {
        periodFilter = sql`${marketBets.settledAt} >= NOW() - INTERVAL '7 days'`;
      } else if (period === 'month') {
        periodFilter = sql`${marketBets.settledAt} >= NOW() - INTERVAL '30 days'`;
      }

      // Aggregate P&L per user from resolved bets
      const statsRows = await db
        .select({
          userId: marketBets.userId,
          profitLoss: sql<number>`
            SUM(CASE WHEN ${marketBets.status} = 'won' THEN COALESCE(${marketBets.payoutAmount}, ${marketBets.potentialPayout}, 0) - ${marketBets.stakeAmount}
                     WHEN ${marketBets.status} = 'lost' THEN -${marketBets.stakeAmount}
                     ELSE 0 END)`.as('profit_loss'),
          volume: sql<number>`SUM(${marketBets.stakeAmount})`.as('volume'),
          winCount: sql<number>`COUNT(*) FILTER (WHERE ${marketBets.status} = 'won')`.as('win_count'),
          totalResolved: sql<number>`COUNT(*) FILTER (WHERE ${marketBets.status} IN ('won', 'lost'))`.as('total_resolved'),
        })
        .from(marketBets)
        .where(and(
          inArray(marketBets.status, ['won', 'lost']),
          periodFilter
        ))
        .groupBy(marketBets.userId)
        .having(sql`COUNT(*) FILTER (WHERE ${marketBets.status} IN ('won', 'lost')) > 0`);

      if (statsRows.length === 0) {
        return res.json({ data: [], total: 0, userEntry: null });
      }

      // Fetch profile info for all user IDs, including public AI agents
      const userIds = statsRows.map(r => r.userId);
      const profileRows = await db
        .select({
          id: profiles.id,
          username: profiles.username,
          avatarUrl: profiles.avatarUrl,
          isPublic: profiles.isPublic,
          rank: profiles.rank,
          createdAt: profiles.createdAt,
          isAgent: profiles.isAgent,
          currentStreak: profiles.currentStreak,
          lastActiveAt: profiles.lastActiveAt,
        })
        .from(profiles)
        .where(inArray(profiles.id, userIds));
      const profileMap = new Map(profileRows.map(p => [p.id, p]));

      // Sort by profitLoss desc, then volume desc, then earliest account creation as tiebreaker
      statsRows.sort((a, b) => {
        const pnlDiff = (Number(b.profitLoss) || 0) - (Number(a.profitLoss) || 0);
        if (pnlDiff !== 0) return pnlDiff;

        const volDiff = (Number(b.volume) || 0) - (Number(a.volume) || 0);
        if (volDiff !== 0) return volDiff;

        const aCreatedAt = profileMap.get(a.userId)?.createdAt?.getTime?.() ?? Number.MAX_SAFE_INTEGER;
        const bCreatedAt = profileMap.get(b.userId)?.createdAt?.getTime?.() ?? Number.MAX_SAFE_INTEGER;
        if (aCreatedAt !== bCreatedAt) return aCreatedAt - bCreatedAt;

        return a.userId.localeCompare(b.userId);
      });

      // Build ranked list, apply search filter
      const searchLower = search.trim().toLowerCase();
      const ranked = statsRows
        .map((r, i) => {
          const profile = profileMap.get(r.userId);
          const isViewer = userId === r.userId;
          const isPublic = profile?.isPublic ?? true;
          const shouldRevealIdentity = isPublic || isViewer;
          return {
            rank: i + 1,
            userId: r.userId,
            username: shouldRevealIdentity ? (profile?.username || null) : null,
            displayName: shouldRevealIdentity ? (profile?.username || 'Anonymous') : 'Private Predictor',
            avatarUrl: shouldRevealIdentity ? (profile?.avatarUrl || null) : null,
            isPublic,
            isAgent: profile?.isAgent ?? false,
            userRank: profile?.rank || 'Citizen',
            currentStreak: profile?.currentStreak || 0,
            lastActiveAt: profile?.lastActiveAt || null,
            profitLoss: Number(r.profitLoss) || 0,
            volume: Number(r.volume) || 0,
            winCount: Number(r.winCount) || 0,
            totalResolved: Number(r.totalResolved) || 0,
            winRate: Number(r.totalResolved) > 0 ? Math.round((Number(r.winCount) / Number(r.totalResolved)) * 100) : 0,
          };
        })
        .filter(r => !searchLower || (r.username || '').toLowerCase().includes(searchLower) || r.displayName.toLowerCase().includes(searchLower));

      const total = ranked.length;

      // Find logged-in user's entry (before pagination)
      let userEntry = null;
      if (userId) {
        const found = ranked.find(r => r.userId === userId);
        if (found) userEntry = found;
      }

      const data = ranked.slice(page * limit, page * limit + limit);

      res.json({ data, total, userEntry });
    } catch (error: any) {
      console.error("[leaderboard/users] Error:", error);
      res.status(500).json({ error: error.message || "Failed to fetch user leaderboard" });
    }
  });

  // POST /api/celebrity-metrics/sync - Sync all celebrity metrics (admin)
  app.post("/api/celebrity-metrics/sync", requireAuth, requireAdmin, async (req, res) => {
    try {
      // Get all celebrities from trending_people
      const celebrities = await db.select({ id: trendingPeople.id }).from(trendingPeople);
      const limit = pLimit(5);
      const results = await Promise.all(
        celebrities.map((c) => limit(() => recomputeCelebrityMetrics(c.id)))
      );
      const synced = results.length;

      res.json({ success: true, synced });
    } catch (error: any) {
      console.error("[celebrity-metrics/sync] Error:", error);
      res.status(500).json({ error: error.message || "Failed to sync metrics" });
    }
  });

  // ===== UNIFIED COMMENTS API =====

  app.get("/api/comments", optionalAuth, async (req: AuthRequest, res) => {
    try {
      const parsedParentType = commentParentTypeSchema.safeParse(req.query.parentType);
      if (!parsedParentType.success) return sendBadRequest(res, "Invalid parentType");

      const parentId = typeof req.query.parentId === "string" ? req.query.parentId : undefined;
      const parentSlug = typeof req.query.parentSlug === "string" ? req.query.parentSlug : undefined;
      const resolvedParentId = await resolveUnifiedCommentParent({
        parentType: parsedParentType.data,
        parentId,
        parentSlug,
      });
      if (!resolvedParentId) return res.status(404).json({ error: "Comment parent not found" });

      const sort = req.query.sort === "newest" ? "newest" : "top";
      const limitRaw = Number(req.query.limit ?? 20);
      const limit = Number.isFinite(limitRaw) ? Math.max(1, Math.min(Math.floor(limitRaw), 100)) : 20;
      const cursor = typeof req.query.cursor === "string" ? req.query.cursor : null;
      const cursorDate = cursor ? new Date(cursor) : null;

      const filters = [
        eq(unifiedComments.parentType, parsedParentType.data),
        eq(unifiedComments.parentId, resolvedParentId),
      ];
      if (sort === "newest" && cursorDate && !Number.isNaN(cursorDate.getTime())) {
        filters.push(lt(unifiedComments.createdAt, cursorDate));
      }

      const rows = await db
        .select({
          id: unifiedComments.id,
          userId: unifiedComments.userId,
          body: unifiedComments.body,
          parentCommentId: unifiedComments.parentCommentId,
          upvotes: unifiedComments.upvotes,
          downvotes: unifiedComments.downvotes,
          deletedAt: unifiedComments.deletedAt,
          createdAt: unifiedComments.createdAt,
          updatedAt: unifiedComments.updatedAt,
          ...commentAuthorSelect,
        })
        .from(unifiedComments)
        .leftJoin(profiles, eq(unifiedComments.userId, profiles.id))
        .where(and(...filters))
        .orderBy(
          sort === "newest"
            ? desc(unifiedComments.createdAt)
            : desc(sql`${unifiedComments.upvotes} - ${unifiedComments.downvotes}`),
          desc(unifiedComments.createdAt),
        )
        .limit(limit);

      const userVoteMap = new Map<string, CommentVoteState>();
      if (req.userId && rows.length > 0) {
        const votesForUser = await db
          .select({ commentId: commentVotes.commentId, voteType: commentVotes.voteType })
          .from(commentVotes)
          .where(and(
            inArray(commentVotes.commentId, rows.map(row => row.id)),
            eq(commentVotes.userId, req.userId),
          ));

        for (const vote of votesForUser) {
          userVoteMap.set(vote.commentId, vote.voteType as CommentVoteState);
        }
      }

      const parentVoteLabelMap = await getCommentParentVoteLabelMap({
        parentType: parsedParentType.data,
        parentId: resolvedParentId,
        comments: rows,
      });

      res.json(rows.map(row => toUnifiedCommentItem(
        row,
        userVoteMap.get(row.id) ?? null,
        parentVoteLabelMap.get(row.id) ?? null,
      )));
    } catch (error: any) {
      console.error("Error fetching comments:", error);
      res.status(500).json({ error: "Failed to fetch comments" });
    }
  });

  app.post("/api/comments", requireAuth, async (req: AuthRequest, res) => {
    try {
      if (Object.prototype.hasOwnProperty.call(req.body ?? {}, "username")) {
        return sendBadRequest(res, "Username is resolved from the authenticated profile");
      }

      const createCommentSchema = z.object({
        parentType: commentParentTypeSchema,
        parentId: z.string().min(1).max(128).optional().nullable(),
        parentSlug: z.string().min(1).max(256).optional().nullable(),
        parentCommentId: z.string().min(1).max(128).optional().nullable(),
        body: z.string().min(1).max(COMMENT_MAX_LENGTH),
      });

      let parsed: z.infer<typeof createCommentSchema>;
      try {
        parsed = createCommentSchema.parse(req.body ?? {});
      } catch (err) {
        if (err instanceof ZodError) return sendZodError(res, err);
        return sendBadRequest(res, "Invalid comment body");
      }

      const resolvedParentId = await resolveUnifiedCommentParent(parsed);
      if (!resolvedParentId) return res.status(404).json({ error: "Comment parent not found" });

      if (parsed.parentCommentId) {
        const [parentComment] = await db
          .select({
            parentType: unifiedComments.parentType,
            parentId: unifiedComments.parentId,
            deletedAt: unifiedComments.deletedAt,
          })
          .from(unifiedComments)
          .where(eq(unifiedComments.id, parsed.parentCommentId))
          .limit(1);
        if (!parentComment || parentComment.parentType !== parsed.parentType || parentComment.parentId !== resolvedParentId) {
          return sendBadRequest(res, "Parent comment does not belong to this thread");
        }
      }

      const userId = req.userId!;
      const [newComment] = await db
        .insert(unifiedComments)
        .values({
          parentType: parsed.parentType,
          parentId: resolvedParentId,
          parentCommentId: parsed.parentCommentId || null,
          userId,
          body: parsed.body,
        })
        .returning();

      // post_comment XP gates ported from the legacy insight comment handler:
      // min 20 trimmed chars, no XP on own insight, action key post_comment,
      // and idempotency key comment_${commentId}_${userId}.
      const trimmedContent = parsed.body.trim();
      let shouldAwardXp = parsed.parentType === "community_insight" && trimmedContent.length >= 20;
      if (shouldAwardXp) {
        const [insight] = await db
          .select({ userId: communityInsights.userId, deletedAt: communityInsights.deletedAt })
          .from(communityInsights)
          .where(eq(communityInsights.id, resolvedParentId))
          .limit(1);
        if (insight && insight.userId === userId) {
          shouldAwardXp = false;
        }
      }

      let xpResult;
      if (shouldAwardXp) {
        try {
          xpResult = await gamificationService.awardXp(
            userId, 'post_comment',
            `comment_${newComment.id}_${userId}`,
            { commentId: newComment.id, insightId: resolvedParentId }
          );
        } catch (e) { console.error("XP award failed:", e); }
      }

      const [profile] = await db
        .select(commentAuthorSelect)
        .from(profiles)
        .where(eq(profiles.id, userId))
        .limit(1);

      // Notification fanout: if this is a reply (has parentCommentId),
      // ping the parent comment's author. Skip self-replies (the most
      // common cause of meaningless "you replied to yourself" pings).
      // Best-effort; runs after we've already responded would be ideal,
      // but the response payload doesn't depend on it and the cost is
      // tiny, so we await for simpler error reporting.
      if (newComment.parentCommentId) {
        try {
          const [parentRow] = await db
            .select({
              userId: unifiedComments.userId,
              parentType: unifiedComments.parentType,
              parentId: unifiedComments.parentId,
              body: unifiedComments.body,
              deletedAt: unifiedComments.deletedAt,
            })
            .from(unifiedComments)
            .where(eq(unifiedComments.id, newComment.parentCommentId))
            .limit(1);

          if (parentRow && !parentRow.deletedAt && parentRow.userId !== userId) {
            const replyAuthorName = profile?.authorUsername ?? "Someone";
            const href = await resolveUnifiedCommentHref(
              parentRow.parentType as CommentParentType,
              parentRow.parentId,
            );
            const snippet = parsed.body.trim().slice(0, 140);
            await createNotification({
              userId: parentRow.userId,
              kind: "comment_reply",
              actorUserId: userId,
              title: `${replyAuthorName} replied to your comment`,
              body: snippet || undefined,
              href: `${href}#comment-${newComment.id}`,
              entityType: "comment",
              entityId: newComment.id,
              metadata: {
                parentCommentId: newComment.parentCommentId,
                parentType: parentRow.parentType,
                parentId: parentRow.parentId,
              },
              idempotencyKey: `comment_reply:${newComment.id}`,
            });
          }
        } catch (err) {
          console.error("[notifications] comment_reply fanout failed:", err);
        }
      }

      res.status(201).json({
        ...toUnifiedCommentItem({
          id: newComment.id,
          userId: newComment.userId,
          body: newComment.body,
          parentCommentId: newComment.parentCommentId,
          upvotes: newComment.upvotes,
          downvotes: newComment.downvotes,
          deletedAt: newComment.deletedAt,
          createdAt: newComment.createdAt,
          updatedAt: newComment.updatedAt,
          ...(profile ?? {
            authorId: null,
            authorUsername: null,
            authorAvatarUrl: null,
          }),
        }),
        xp: xpResult ?? null,
      });
    } catch (error: any) {
      console.error("Error creating comment:", error);
      res.status(500).json({ error: "Failed to create comment" });
    }
  });

  // Soft-delete a comment owned by the authenticated user.
  app.delete("/api/comments/:id", requireAuth, async (req: AuthRequest, res) => {
    try {
      const { id } = req.params;
      const userId = req.userId!;

      const [comment] = await db
        .select({
          id: unifiedComments.id,
          userId: unifiedComments.userId,
          deletedAt: unifiedComments.deletedAt,
        })
        .from(unifiedComments)
        .where(eq(unifiedComments.id, id))
        .limit(1);
      if (!comment) return res.status(404).json({ error: "Comment not found" });
      if (comment.userId !== userId) return res.status(403).json({ error: "Forbidden" });
      if (comment.deletedAt) return res.json({ success: true, deletedAt: comment.deletedAt });

      const deletedAt = new Date();
      const [updated] = await db
        .update(unifiedComments)
        .set({ deletedAt })
        .where(and(
          eq(unifiedComments.id, id),
          eq(unifiedComments.userId, userId),
        ))
        .returning({ deletedAt: unifiedComments.deletedAt });

      res.json({ success: true, deletedAt: updated?.deletedAt ?? deletedAt });
    } catch (error: any) {
      console.error("Error deleting comment:", error);
      res.status(500).json({ error: "Failed to delete comment" });
    }
  });

  app.post("/api/comments/:id/vote", requireAuth, async (req: AuthRequest, res) => {
    try {
      if (!checkVoteRateLimit(req.userId!)) {
        return res.status(429).json({ error: "Too many votes. Please slow down." });
      }

      const { id } = req.params;
      const parsedVoteType = commentVoteTypeSchema.safeParse(req.body?.voteType);
      if (!parsedVoteType.success) {
        return res.status(400).json({ error: "voteType must be 'up' or 'down'" });
      }

      const [comment] = await db
        .select({
          id: unifiedComments.id,
          userId: unifiedComments.userId,
          parentType: unifiedComments.parentType,
          parentId: unifiedComments.parentId,
          body: unifiedComments.body,
          upvotes: unifiedComments.upvotes,
          downvotes: unifiedComments.downvotes,
          deletedAt: unifiedComments.deletedAt,
        })
        .from(unifiedComments)
        .where(eq(unifiedComments.id, id))
        .limit(1);
      if (!comment) return res.status(404).json({ error: "Comment not found" });
      if (comment.deletedAt) return res.status(410).json({ error: "Comment has been deleted" });

      const userId = req.userId!;
      const voteType = parsedVoteType.data;
      const previousUpvotes = comment.upvotes;
      let nextVote: CommentVoteState = voteType;
      let isNewVote = false;

      await db.transaction(async (tx) => {
        const existingVote = await tx
          .select()
          .from(commentVotes)
          .where(and(
            eq(commentVotes.commentId, id),
            eq(commentVotes.userId, userId)
          ))
          .limit(1);

        if (existingVote.length > 0) {
          const previousVoteType = existingVote[0].voteType;
          if (previousVoteType === voteType) {
            nextVote = null;
            await tx
              .delete(commentVotes)
              .where(and(
                eq(commentVotes.commentId, id),
                eq(commentVotes.userId, userId)
              ));
            await tx
              .update(unifiedComments)
              .set({
                upvotes: sql`${unifiedComments.upvotes} + ${voteType === "up" ? -1 : 0}`,
                downvotes: sql`${unifiedComments.downvotes} + ${voteType === "down" ? -1 : 0}`,
              })
              .where(eq(unifiedComments.id, id));
          } else {
            await tx
              .update(commentVotes)
              .set({ voteType })
              .where(and(
                eq(commentVotes.commentId, id),
                eq(commentVotes.userId, userId)
              ));
            await tx
              .update(unifiedComments)
              .set({
                upvotes: sql`${unifiedComments.upvotes} + ${voteType === "up" ? 1 : -1}`,
                downvotes: sql`${unifiedComments.downvotes} + ${voteType === "down" ? 1 : -1}`,
              })
              .where(eq(unifiedComments.id, id));
          }
        } else {
          isNewVote = true;
          await tx
            .insert(commentVotes)
            .values({
              commentId: id,
              userId,
              voteType,
            });
          await tx
            .update(unifiedComments)
            .set({
              upvotes: sql`${unifiedComments.upvotes} + ${voteType === "up" ? 1 : 0}`,
              downvotes: sql`${unifiedComments.downvotes} + ${voteType === "down" ? 1 : 0}`,
            })
            .where(eq(unifiedComments.id, id));
        }
      });

      const [updated] = await db
        .select({
          upvotes: unifiedComments.upvotes,
          downvotes: unifiedComments.downvotes,
          deletedAt: unifiedComments.deletedAt,
        })
        .from(unifiedComments)
        .where(eq(unifiedComments.id, id))
        .limit(1);

      let xpResult;
      if (isNewVote && comment.parentType === "community_insight") {
        const actionKey = voteType === 'up' ? 'upvote_insight' : 'downvote_insight';
        try {
          xpResult = await gamificationService.awardXp(
            userId, actionKey,
            `comment_vote_${id}_${userId}`,
            { commentId: id, voteType }
          );
        } catch (e) { console.error("XP award failed:", e); }
      }

      // comment_upvote_milestone fanout. We deliberately do NOT ping per
      // upvote — that's exactly the kind of engagement spam the plan is
      // trying to avoid. Instead we ping when the comment's upvote
      // counter crosses one of [5, 10, 25, 100]. Idempotency is keyed
      // on (commentId, milestone) so re-running the vote handler can't
      // double-fire. Skips self-upvotes and own-comment milestones.
      const newUpvotes = updated?.upvotes ?? comment.upvotes;
      if (
        comment.userId !== userId &&
        voteType === "up" &&
        isNewVote &&
        newUpvotes > previousUpvotes
      ) {
        const COMMENT_UPVOTE_MILESTONES = [5, 10, 25, 100] as const;
        const crossed = COMMENT_UPVOTE_MILESTONES.find(
          (m) => previousUpvotes < m && newUpvotes >= m,
        );
        if (crossed) {
          try {
            const href = await resolveUnifiedCommentHref(
              comment.parentType as CommentParentType,
              comment.parentId,
            );
            const snippet = comment.body.trim().slice(0, 140);
            await createNotification({
              userId: comment.userId,
              kind: "comment_upvote_milestone",
              title: `Your comment hit ${crossed} upvotes`,
              body: snippet || undefined,
              href: `${href}#comment-${comment.id}`,
              entityType: "comment",
              entityId: comment.id,
              metadata: { milestone: crossed, upvotes: newUpvotes },
              groupKey: `upvote-milestone:${comment.id}:${crossed}`,
              idempotencyKey: `comment_upvote_milestone:${comment.id}:${crossed}`,
            });
          } catch (err) {
            console.error("[notifications] comment_upvote_milestone fanout failed:", err);
          }
        }
      }

      res.json({
        success: true,
        vote: nextVote,
        userVote: nextVote,
        upvotes: updated?.upvotes ?? comment.upvotes,
        downvotes: updated?.downvotes ?? comment.downvotes,
        xp: xpResult ?? null,
      });
    } catch (error: any) {
      console.error("Error voting on comment:", error);
      res.status(500).json({ error: "Failed to vote" });
    }
  });

  app.post("/api/comments/:id/report", requireAuth, async (req: AuthRequest, res) => {
    try {
      const { id } = req.params;
      const [comment] = await db
        .select({ parentType: unifiedComments.parentType, deletedAt: unifiedComments.deletedAt })
        .from(unifiedComments)
        .where(eq(unifiedComments.id, id))
        .limit(1);
      if (!comment) return res.status(404).json({ error: "Comment not found" });

      const reason = typeof req.body?.reason === "string" ? req.body.reason.trim() : "";
      const [existing] = await db.select().from(commentReports)
        .where(and(eq(commentReports.commentId, id), eq(commentReports.reporterId, req.userId!)))
        .limit(1);
      if (existing) {
        return res.json({ message: "Already reported" });
      }

      await db.insert(commentReports).values({
        commentId: id,
        entityType: reportEntityTypeForCommentParent(comment.parentType as CommentParentType),
        reporterId: req.userId!,
        reason: reason || null,
      });

      res.json({ success: true });
    } catch (error: any) {
      console.error("Error reporting comment:", error);
      res.status(500).json({ error: "Failed to report comment" });
    }
  });

  // Get AI-generated celebrity profile with source-grounded caching and validation
  app.get("/api/celebrity-profile/:personId", async (req, res) => {
    try {
      const { personId } = req.params;
      const forceRefresh = req.query.refresh === 'true';
      const model = typeof req.query.model === "string" ? req.query.model : undefined;

      const person = await storage.getTrendingPerson(personId);
      if (!person) {
        return res.status(404).json({ error: "Person not found" });
      }

      const result = await getOrGenerateCelebrityProfile(person, { forceRefresh, model });
      console.log(`[Profile] ${result.cacheStatus} profile for ${person.name}`);
      const profile = result.profile;
      res.json(profile);
    } catch (error: any) {
      console.error("Error generating celebrity profile:", error);
      res.status(500).json({ error: "Failed to generate profile", message: error.message });
    }
  });

  // Admin endpoint to refresh all celebrity profiles with source-grounded generation
  app.post("/api/admin/refresh-all-profiles", requireAuth, requireAdmin, async (req: AuthRequest, res) => {
    try {
      const people = await db.select().from(trackedPeople);
      console.log(`[Admin] Starting profile refresh for ${people.length} celebrities...`);

      const BATCH_SIZE = 5;
      const DELAY_MS = 2000;
      let successCount = 0;
      let errorCount = 0;

      for (let i = 0; i < people.length; i += BATCH_SIZE) {
        const batch = people.slice(i, i + BATCH_SIZE);

        await Promise.all(batch.map(async (person) => {
          try {
            await getOrGenerateCelebrityProfile({
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
              profileViews10m: null,
            }, { forceRefresh: true });

            successCount++;
            console.log(`[Admin] Refreshed profile for ${person.name} (${successCount}/${people.length})`);
          } catch (err: any) {
            errorCount++;
            console.error(`[Admin] Failed to refresh profile for ${person.name}:`, err.message);
          }
        }));

        if (i + BATCH_SIZE < people.length) {
          await new Promise(resolve => setTimeout(resolve, DELAY_MS));
        }
      }

      await db.insert(adminAuditLog).values({
        adminId: req.userId || 'unknown',
        actionType: 'refresh_all_profiles',
        targetTable: 'celebrity_profiles',
        targetId: 'all',
        metadata: { successCount, errorCount, total: people.length },
      });
      
      res.json({ 
        success: true, 
        message: `Refreshed ${successCount} profiles, ${errorCount} errors`,
        successCount,
        errorCount,
        total: people.length
      });
    } catch (error: any) {
      console.error("Error refreshing all profiles:", error);
      res.status(500).json({ error: "Failed to refresh profiles", message: error.message });
    }
  });

  // ============ WHY TRENDING - AI-Generated Summary ============
  // Improvements (Feb 2026):
  //   A) Top-10 hysteresis: sticky eligibility (enter <=10, exit >=12 or 2 consecutive checks outside)
  //   B) Input hash: skip OpenAI call if headlines unchanged, just extend TTL
  //   C) Provenance: store model, promptVersion, headlinesUsed in cached payload
  //   D) Rate limit: max 1 OpenAI generation per person per 30 minutes

  const WHY_TRENDING_PROMPT_VERSION = 5;
  const WHY_TRENDING_CACHE_TTL_HOURS = 4;
  const WHY_TRENDING_RATE_LIMIT_MINUTES = 30;

  function extractDomain(url: string): string {
    try {
      return new URL(url).hostname.replace(/^www\./, "");
    } catch {
      return url.slice(0, 30);
    }
  }

  function normalizeTitle(title: string): string {
    let t = title;
    t = t.replace(/[\u200B-\u200D\uFEFF\u00AD]/g, "");
    t = t.replace(/\s*[-–—|]\s*(CNN|Reuters|AP|BBC|NBC|CBS|ABC|Fox News|CNBC|Bloomberg|Forbes|WSJ|The Guardian|The New York Times|Associated Press|NPR|USA Today|The Washington Post|Sky News|Al Jazeera|MSNBC|The Hill|Politico|TechCrunch|The Verge|Variety|TMZ|E! News|People|Entertainment Weekly|ESPN|Daily Mail|NY Post|New York Post|Axios|Business Insider|The Independent)\.?$/i, "");
    t = t.toLowerCase().replace(/[^a-z0-9 ]/g, "").replace(/\s+/g, " ").trim();
    return t;
  }

  function computeHeadlineHash(sources: Array<{ title: string; link?: string }>): string {
    const stableIds = sources.map(s => {
      const domain = s.link ? extractDomain(s.link) : "unknown";
      return `${domain}|${normalizeTitle(s.title)}`;
    });
    return createHash("sha256").update(stableIds.sort().join("||")).digest("hex").slice(0, 16);
  }

  const WHY_TRENDING_RANK_CUTOFF = 20;
  const WHY_TRENDING_RANK_EXIT = 22;

  async function getTopNEligibility(personId: string): Promise<{ eligible: boolean; lastRankSeen: number; consecutiveOutside: number }> {
    const eligibilityCacheKey = `top10_eligible:${personId}`;
    const [row] = await db.select().from(apiCache).where(eq(apiCache.cacheKey, eligibilityCacheKey)).limit(1);
    if (row) {
      try {
        return JSON.parse(row.responseData);
      } catch {}
    }
    return { eligible: false, lastRankSeen: 999, consecutiveOutside: 0 };
  }

  async function updateTopNEligibility(personId: string, rank: number | null): Promise<boolean> {
    const eligibilityCacheKey = `top10_eligible:${personId}`;
    const state = await getTopNEligibility(personId);
    const currentRank = rank ?? 999;

    if (currentRank <= WHY_TRENDING_RANK_CUTOFF) {
      state.eligible = true;
      state.consecutiveOutside = 0;
    } else if (currentRank >= WHY_TRENDING_RANK_EXIT) {
      state.eligible = false;
      state.consecutiveOutside = 0;
    } else {
      state.consecutiveOutside += 1;
      if (state.consecutiveOutside >= 2) {
        state.eligible = false;
      }
    }
    state.lastRankSeen = currentRank;

    const now = new Date();
    const farFuture = new Date(now.getTime() + 365 * 24 * 60 * 60 * 1000);
    await db.insert(apiCache).values({
      cacheKey: eligibilityCacheKey,
      provider: "system",
      responseData: JSON.stringify(state),
      fetchedAt: now,
      expiresAt: farFuture,
    }).onConflictDoUpdate({
      target: apiCache.cacheKey,
      set: {
        responseData: JSON.stringify(state),
        fetchedAt: now,
      },
    });

    return state.eligible;
  }

  app.get("/api/why-trending/:personId", async (req, res) => {
    try {
      const { personId } = req.params;
      
      const person = await storage.getTrendingPerson(personId);
      if (!person) {
        return res.status(404).json({ error: "Person not found" });
      }
      
      const hotMover = req.query.hotMover === "true";
      
      const eligible = hotMover || await updateTopNEligibility(personId, person.rank ?? null);
      
      if (!eligible) {
        return res.json({
          personId,
          personName: person.name,
          hasContext: false,
          message: `Why Trending is only available for top ${WHY_TRENDING_RANK_CUTOFF} ranked celebrities and Hot Movers`,
          fetchedAt: new Date(),
        });
      }
      
      // Check existing cache (may be expired - we still need it for input hash comparison)
      const cacheKey = `why_trending:${personId}`;
      const [cached] = await db
        .select()
        .from(apiCache)
        .where(eq(apiCache.cacheKey, cacheKey))
        .limit(1);
      
      // If cache exists and is still valid, return it immediately
      if (cached && cached.expiresAt && cached.expiresAt > new Date()) {
        const hitResult = JSON.parse(cached.responseData);
        hitResult.cacheStatus = "HIT";
        if (hitResult.provenance?.generatedAt) {
          hitResult.staleAgeMinutes = Math.round((Date.now() - new Date(hitResult.provenance.generatedAt).getTime()) / 60000);
        }
        return res.json(hitResult);
      }
      
      // E) Single-flight lock: prevent cache stampede when multiple users hit cold cache simultaneously
      const lockKey = `why_trending_lock:${personId}`;
      const WHY_TRENDING_LOCK_TTL_SECONDS = 90;
      const [lockRow] = await db.select().from(apiCache).where(eq(apiCache.cacheKey, lockKey)).limit(1);
      if (lockRow && lockRow.expiresAt && lockRow.expiresAt > new Date()) {
        console.log(`[WhyTrending] Generation locked for ${person.name}, serving stale or empty`);
        if (cached) {
          try {
            const staleResult = JSON.parse(cached.responseData);
            staleResult.cacheStatus = "LOCKED_STALE";
            if (staleResult.provenance?.generatedAt) {
              staleResult.staleAgeMinutes = Math.round((Date.now() - new Date(staleResult.provenance.generatedAt).getTime()) / 60000);
            }
            return res.json(staleResult);
          } catch {}
        }
        return res.json({
          personId,
          personName: person.name,
          hasContext: false,
          cacheStatus: "LOCKED_COLD",
          message: "Summary is being generated, please try again shortly",
          fetchedAt: new Date(),
        });
      }
      
      // Acquire single-flight lock before doing any work
      const lockNow = new Date();
      const lockExpires = new Date(lockNow.getTime() + WHY_TRENDING_LOCK_TTL_SECONDS * 1000);
      await db.insert(apiCache).values({
        cacheKey: lockKey,
        provider: "system",
        responseData: JSON.stringify({ personId, lockedAt: lockNow.toISOString() }),
        fetchedAt: lockNow,
        expiresAt: lockExpires,
      }).onConflictDoUpdate({
        target: apiCache.cacheKey,
        set: { fetchedAt: lockNow, expiresAt: lockExpires, responseData: JSON.stringify({ personId, lockedAt: lockNow.toISOString() }) },
      });
      
      // Fetch fresh news via Serper (Serper has its own 3h cache)
      const newsContext = await fetchTrendingNewsContext(person.name);
      
      // Helper: release single-flight lock (expire immediately)
      const releaseLock = async () => {
        try {
          await db.insert(apiCache).values({
            cacheKey: lockKey,
            provider: "system",
            responseData: JSON.stringify({ personId, releasedAt: new Date().toISOString() }),
            fetchedAt: new Date(),
            expiresAt: new Date(0),
          }).onConflictDoUpdate({
            target: apiCache.cacheKey,
            set: { expiresAt: new Date(0), fetchedAt: new Date() },
          });
        } catch {}
      };
      
      if (!newsContext || newsContext.sources.length === 0) {
        await releaseLock();
        // Distinguish a provider outage (auth/quota/rate-limit) from legitimately-empty
        // results. If Serper flagged itself as degraded, surface that state to the client
        // and do NOT touch the existing rate-limit marker or main cache row, so real
        // cached summaries stay visible once the provider recovers.
        const degraded = getSerperDegradedState();
        if (degraded) {
          return res.json({
            personId,
            personName: person.name,
            hasContext: false,
            cacheStatus: "PROVIDER_UNAVAILABLE",
            providerReason: degraded.reason,
            providerSince: degraded.since,
            staleAgeMinutes: null,
            message: "Trending insights are temporarily unavailable. Please try again shortly.",
            fetchedAt: new Date(),
          });
        }
        return res.json({
          personId,
          personName: person.name,
          hasContext: false,
          cacheStatus: "NO_NEWS",
          staleAgeMinutes: null,
          message: "No recent trending context available",
          fetchedAt: new Date(),
        });
      }
      
      // B) Compute input hash from domain+normalizedTitle (stable even if tracking URLs change)
      const currentInputHash = computeHeadlineHash(newsContext.sources);
      
      // If we have a previous cached result and the input hash is unchanged, extend TTL without calling OpenAI
      if (cached) {
        try {
          const previousResult = JSON.parse(cached.responseData);
          const cachedPromptVersion = previousResult.provenance?.promptVersion ?? 0;
          if (previousResult.inputHash === currentInputHash && previousResult.hasContext && cachedPromptVersion >= WHY_TRENDING_PROMPT_VERSION) {
            console.log(`[WhyTrending] Input hash unchanged for ${person.name}, extending TTL (skipping OpenAI)`);
            const extendNow = new Date();
            const extendExpiresAt = new Date(extendNow.getTime() + WHY_TRENDING_CACHE_TTL_HOURS * 60 * 60 * 1000);
            previousResult.fetchedAt = extendNow;
            previousResult.cacheStatus = "STALE_EXTENDED";
            previousResult.staleAgeMinutes = previousResult.provenance?.generatedAt
              ? Math.round((Date.now() - new Date(previousResult.provenance.generatedAt).getTime()) / 60000)
              : null;
            const updatedResponseData = JSON.stringify(previousResult);
            await db.insert(apiCache).values({
              cacheKey,
              provider: "ai_trending",
              responseData: updatedResponseData,
              fetchedAt: extendNow,
              expiresAt: extendExpiresAt,
            }).onConflictDoUpdate({
              target: apiCache.cacheKey,
              set: { responseData: updatedResponseData, fetchedAt: extendNow, expiresAt: extendExpiresAt },
            });
            await releaseLock();
            return res.json(previousResult);
          }
        } catch {}
      }
      
      // D) Per-person rate limit: no more than 1 OpenAI generation per 30 minutes
      const rateLimitKey = `why_trending_ratelimit:${personId}`;
      const [rateLimitRow] = await db.select().from(apiCache).where(eq(apiCache.cacheKey, rateLimitKey)).limit(1);
      if (rateLimitRow && rateLimitRow.expiresAt && rateLimitRow.expiresAt > new Date()) {
        console.log(`[WhyTrending] Rate limited for ${person.name}, returning stale cache or empty`);
        await releaseLock();
        if (cached) {
          try {
            const rlResult = JSON.parse(cached.responseData);
            rlResult.cacheStatus = "RATE_LIMITED";
            rlResult.staleAgeMinutes = rlResult.provenance?.generatedAt
              ? Math.round((Date.now() - new Date(rlResult.provenance.generatedAt).getTime()) / 60000)
              : null;
            return res.json(rlResult);
          } catch {}
        }
        return res.json({
          personId,
          personName: person.name,
          hasContext: false,
          cacheStatus: "RATE_LIMITED",
          staleAgeMinutes: null,
          message: "Rate limited - please try again later",
          fetchedAt: new Date(),
        });
      }
      
      // Call OpenAI to generate summary
      const openai = new OpenAI({
        apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY || process.env.OPENAI_API_KEY,
      });
      
      const headlinesText = newsContext.sources.map(s => {
        const dateLabel = s.date ? ` (${s.date})` : '';
        return `${s.title}${dateLabel}`;
      }).join('\n');
      const todayStr = new Date().toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });

      const systemPrompt = `You are a neutral wire-service news reporter (like AP or Reuters). Today's date is ${todayStr}. Use the headlines provided to determine what is currently happening. Treat all information in the headlines as current events happening right now.

CRITICAL RULES:
- Do NOT add titles like "former", "ex-", or "President" to anyone's name unless that exact title appears in the headlines.
- If the headlines simply say a person's name without a title, use just their name — do NOT infer or add titles from your training data.
- Never call someone "former President" or "former CEO" unless the headline explicitly uses that phrase.
- When in doubt, just use the person's name without any title prefix.
- You must NEVER express or imply public opinion, approval, or disapproval of any figure.
- Never use phrases like "facing backlash", "widely criticized", "growing dissatisfaction", "public outcry", or "mounting pressure" unless those exact phrases appear in a headline.
- Never characterize how the public feels about a person. Only describe what the person DID or what HAPPENED.
- For politically polarizing figures, describe actions and events only. Do not editorialize.`;

      const userPrompt = `Based on these recent news headlines about ${person.name}, write a brief 1-2 sentence summary explaining why they are currently in the news.

RECENCY RULES:
- Each headline may have a date in parentheses. Prioritize the most recent headlines.
- If older headlines (3+ days before today) appear alongside newer ones, focus your summary on what happened most recently.
- The summary should reflect what is happening NOW, not days ago.

STRICT NEUTRALITY RULES:
- Describe ONLY actions taken and events that occurred — never describe reactions, opinions, or public sentiment
- Do NOT use any of these words or phrases: controversial, criticized, backlash, scandal, slammed, blasted, under fire, embattled, divisive, polarizing, widely, overwhelmingly, growing concern, mounting, outcry, fury, outrage
- Do NOT characterize public opinion (e.g. never say "Americans are frustrated" or "facing widespread criticism")
- Write as a wire-service reporter: facts only, zero commentary
- If headlines are mostly negative about a person, still summarize neutrally by focusing on what happened, not how people reacted
- Treat every public figure with the same neutral tone regardless of political affiliation

Headlines:
${headlinesText}

Return a JSON object with:
{
  "summary": "1-2 sentence strictly factual summary describing what happened or what actions were taken",
  "category": "One of: Politics, Business, Music, Sports, Technology, Legal, Personal Life, Controversy, or General News"
}

Only return the JSON object.`;

      const whyTrendingModel = getAiModel("whyTrending");
      const response = await openai.chat.completions.create({
        model: whyTrendingModel,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
        response_format: { type: "json_object" },
        ...getChatCompletionTokenLimit(whyTrendingModel, 200),
      });
      
      const content = response.choices[0]?.message?.content;
      const parsed = content ? JSON.parse(content) : { summary: newsContext.headline, category: newsContext.category };
      
      // C) Build result with provenance fields + input hash + debug fields
      const generatedAt = new Date().toISOString();
      const result = {
        personId,
        personName: person.name,
        hasContext: true,
        summary: parsed.summary || newsContext.headline,
        category: parsed.category || newsContext.category,
        topHeadline: newsContext.headline,
        sources: newsContext.sources.slice(0, 3),
        fetchedAt: new Date(),
        inputHash: currentInputHash,
        cacheStatus: "REGENERATED" as string,
        staleAgeMinutes: 0,
        provenance: {
          model: whyTrendingModel,
          promptVersion: WHY_TRENDING_PROMPT_VERSION,
          serperQuery: person.name,
          serperTbs: "qdr:w",
          headlinesUsed: newsContext.sources.slice(0, 5).map(s => ({ title: s.title, link: s.link })),
          generatedAt,
        },
      };
      
      const cacheNow = new Date();
      const cacheExpiresAt = new Date(cacheNow.getTime() + WHY_TRENDING_CACHE_TTL_HOURS * 60 * 60 * 1000);
      
      await db.insert(apiCache).values({
        cacheKey,
        provider: "ai_trending",
        responseData: JSON.stringify(result),
        fetchedAt: cacheNow,
        expiresAt: cacheExpiresAt,
      }).onConflictDoUpdate({
        target: apiCache.cacheKey,
        set: {
          responseData: JSON.stringify(result),
          fetchedAt: cacheNow,
          expiresAt: cacheExpiresAt,
        },
      });
      
      // D) Set rate limit marker AFTER successful generation (fail-safe: transient failures won't lock out for 30 min)
      const rlNow = new Date();
      const rlExpires = new Date(rlNow.getTime() + WHY_TRENDING_RATE_LIMIT_MINUTES * 60 * 1000);
      await db.insert(apiCache).values({
        cacheKey: rateLimitKey,
        provider: "system",
        responseData: JSON.stringify({ personId, generatedAt: rlNow.toISOString() }),
        fetchedAt: rlNow,
        expiresAt: rlExpires,
      }).onConflictDoUpdate({
        target: apiCache.cacheKey,
        set: { fetchedAt: rlNow, expiresAt: rlExpires, responseData: JSON.stringify({ personId, generatedAt: rlNow.toISOString() }) },
      });
      
      await releaseLock();
      
      console.log(`[WhyTrending] Generated new summary for ${person.name} (hash: ${currentInputHash})`);
      res.json(result);
    } catch (error: any) {
      console.error("Error fetching why trending:", error);
      // Release lock on error so it doesn't block for 90s
      try {
        const errLockKey = `why_trending_lock:${req.params.personId}`;
        await db.insert(apiCache).values({
          cacheKey: errLockKey,
          provider: "system",
          responseData: JSON.stringify({ error: true }),
          fetchedAt: new Date(),
          expiresAt: new Date(0),
        }).onConflictDoUpdate({
          target: apiCache.cacheKey,
          set: { expiresAt: new Date(0), fetchedAt: new Date() },
        });
      } catch {}
      res.status(500).json({ error: "Failed to fetch trending context", message: error.message });
    }
  });

  // ==================== Matchups API ====================

  const MATCHUP_BUCKET_BASE = process.env.SUPABASE_URL
    ? `${process.env.SUPABASE_URL}/storage/v1/object/public/matchups`
    : null;

  function slugifyMatchupName(s: string): string {
    return s.toLowerCase().replace(/[''`]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  }

  function matchupBucketUrl(optionAText: string, optionBText: string, optionText: string): string | null {
    if (!MATCHUP_BUCKET_BASE) return null;
    const folder = `${slugifyMatchupName(optionAText)}-vs-${slugifyMatchupName(optionBText)}`;
    return `${MATCHUP_BUCKET_BASE}/${folder}/${slugifyMatchupName(optionText)}.webp`;
  }

  /** Primary image: explicit DB URL > linked celebrity avatar > convention bucket URL. Fallback: next distinct candidate for img onError. */
  function resolveMatchupOptionDisplay(
    dbUrl: string | null,
    personId: string | null,
    optionLabelText: string,
    optionAText: string,
    optionBText: string,
    avatarById: Record<string, string | null>,
    avatarByName: Record<string, string | null>,
  ): { resolved: string | null; fallback: string | null } {
    const bucket = matchupBucketUrl(optionAText, optionBText, optionLabelText);
    const linkedAvatar = personId ? avatarById[personId] ?? null : null;
    const nameAvatar = avatarByName[optionLabelText.toLowerCase()] ?? null;

    const resolved =
      dbUrl ||
      linkedAvatar ||
      bucket ||
      null;

    for (const cand of [linkedAvatar, nameAvatar, bucket]) {
      if (cand && cand !== resolved) {
        return { resolved, fallback: cand };
      }
    }
    return { resolved, fallback: null };
  }

  // Get all matchups with vote counts (with dynamic avatar lookup from tracked_people)
  app.get("/api/matchups", optionalAuth, async (req: AuthRequest, res) => {
    try {
      const { category } = req.query;

      // Cold-start / personalised primary, admin manual order as
      // within-bucket tiebreaker, recency last.
      const orderTerms = await orderRecencyForUser(
        req,
        matchups.createdAt,
        matchups.category,
      );

      let matchupList = await db
        .select()
        .from(matchups)
        .orderBy(...orderTerms, asc(matchups.displayOrder));
      
      // Filter by category if provided
      if (category && category !== 'All') {
        matchupList = matchupList.filter(f => f.category === category);
      }
      
      // Public API: Only show live and inactive matchups (not draft/hidden/archived)
      matchupList = matchupList.filter(f => f.visibility === 'live' || f.visibility === 'inactive');
      
      // Build lookup maps for celebrity avatars (by ID and by name).
      // Only fetch the rows actually referenced by this matchup batch
      // instead of scanning the full tracked_people table on every call.
      const personIds = Array.from(
        new Set(
          matchupList
            .flatMap((m) => [m.personAId, m.personBId])
            .filter((x): x is string => Boolean(x)),
        ),
      );
      const celebrities = personIds.length === 0
        ? []
        : await db
            .select({
              id: trackedPeople.id,
              name: trackedPeople.name,
              avatar: trackedPeople.avatar,
            })
            .from(trackedPeople)
            .where(inArray(trackedPeople.id, personIds));

      const avatarByName: Record<string, string | null> = {};
      const avatarById: Record<string, string | null> = {};
      for (const celeb of celebrities) {
        avatarByName[celeb.name.toLowerCase()] = celeb.avatar;
        avatarById[celeb.id] = celeb.avatar;
      }
      
      // Single query for all vote counts (batch instead of N+1)
      const matchupIds = matchupList.map((m) => m.id);
      const voteCountsMap = new Map<string, { option_a: number; option_b: number; neutral: number }>();
      if (matchupIds.length > 0) {
        const voteResults = await db
          .select({
            targetId: votes.targetId,
            value: votes.value,
            cnt: count(),
          })
          .from(votes)
          .where(and(eq(votes.voteType, "face_off"), inArray(votes.targetId, matchupIds)))
          .groupBy(votes.targetId, votes.value);
        for (const row of voteResults) {
          const existing = voteCountsMap.get(row.targetId) || { option_a: 0, option_b: 0, neutral: 0 };
          if (row.value === "option_a") existing.option_a = Number(row.cnt);
          else if (row.value === "option_b") existing.option_b = Number(row.cnt);
          else if (row.value === "neutral") existing.neutral = Number(row.cnt);
          voteCountsMap.set(row.targetId, existing);
        }
      }

      const relatedMap = await getRelatedPeopleForCards("matchup", matchupIds);

      const matchupsWithVotes = matchupList.map((matchup) => {
        const counts = voteCountsMap.get(matchup.id) || { option_a: 0, option_b: 0, neutral: 0 };
        const displayAVotes = counts.option_a + (matchup.seedVotesA || 0);
        const displayBVotes = counts.option_b + (matchup.seedVotesB || 0);
        const displayNeutralVotes = counts.neutral + (matchup.seedVotesNeutral || 0);
        const totalVotes = displayAVotes + displayBVotes + displayNeutralVotes;

        const optA = resolveMatchupOptionDisplay(
          matchup.optionAImage,
          matchup.personAId,
          matchup.optionAText,
          matchup.optionAText,
          matchup.optionBText,
          avatarById,
          avatarByName,
        );
        const optB = resolveMatchupOptionDisplay(
          matchup.optionBImage,
          matchup.personBId,
          matchup.optionBText,
          matchup.optionAText,
          matchup.optionBText,
          avatarById,
          avatarByName,
        );
        const optionAImageResolved = optA.resolved;
        const optionBImageResolved = optB.resolved;
        const optionAFallback = optA.fallback;
        const optionBFallback = optB.fallback;

        const optionAPercent = totalVotes > 0 ? Math.round((displayAVotes / totalVotes) * 100) : 50;
        const optionBPercent = totalVotes > 0 ? Math.round((displayBVotes / totalVotes) * 100) : 50;
        const neutralPercent = totalVotes > 0 ? 100 - optionAPercent - optionBPercent : 0;

        return {
          ...matchup,
          optionAImage: optionAImageResolved,
          optionBImage: optionBImageResolved,
          optionAFallbackImage: optionAFallback !== optionAImageResolved ? optionAFallback : null,
          optionBFallbackImage: optionBFallback !== optionBImageResolved ? optionBFallback : null,
          optionAVotes: displayAVotes,
          optionBVotes: displayBVotes,
          neutralVotes: displayNeutralVotes,
          totalVotes,
          optionAPercent,
          optionBPercent,
          neutralPercent,
          relatedPersonIds: (relatedMap[matchup.id] || []).map(p => p.id),
          relatedPeople: relatedMap[matchup.id] || [],
        };
      });
      
      res.json(matchupsWithVotes);
    } catch (error: any) {
      console.error("Error fetching matchups:", error.message);
      res.status(500).json({ error: "Failed to fetch matchups" });
    }
  });
  
  app.get("/api/matchups/by-slug/:slug", async (req, res) => {
    try {
      const { slug } = req.params;

      const matchup = await resolvePublicMatchupBySlugOrId(slug);
      if (!matchup) {
        return res.status(404).json({ error: "Matchup not found" });
      }

      const celebrities = await db.select({
        id: trackedPeople.id,
        name: trackedPeople.name,
        avatar: trackedPeople.avatar,
      }).from(trackedPeople);
      
      const avatarByName: Record<string, string | null> = {};
      const avatarById: Record<string, string | null> = {};
      for (const celeb of celebrities) {
        avatarByName[celeb.name.toLowerCase()] = celeb.avatar;
        avatarById[celeb.id] = celeb.avatar;
      }
      
      const voteResults = await db.select({
        value: votes.value,
        count: count(),
      })
      .from(votes)
      .where(and(
        eq(votes.voteType, 'face_off'),
        eq(votes.targetId, matchup.id)
      ))
      .groupBy(votes.value);
      
      const realAVotes = Number(voteResults.find(v => v.value === 'option_a')?.count || 0);
      const realBVotes = Number(voteResults.find(v => v.value === 'option_b')?.count || 0);
      const realNeutralVotes = Number(voteResults.find(v => v.value === 'neutral')?.count || 0);
      const displayAVotes = realAVotes + (matchup.seedVotesA || 0);
      const displayBVotes = realBVotes + (matchup.seedVotesB || 0);
      const displayNeutralVotes = realNeutralVotes + (matchup.seedVotesNeutral || 0);
      const totalVotes = displayAVotes + displayBVotes + displayNeutralVotes;

      const optA = resolveMatchupOptionDisplay(
        matchup.optionAImage,
        matchup.personAId,
        matchup.optionAText,
        matchup.optionAText,
        matchup.optionBText,
        avatarById,
        avatarByName,
      );
      const optB = resolveMatchupOptionDisplay(
        matchup.optionBImage,
        matchup.personBId,
        matchup.optionBText,
        matchup.optionAText,
        matchup.optionBText,
        avatarById,
        avatarByName,
      );
      const optionAImageResolved = optA.resolved;
      const optionBImageResolved = optB.resolved;
      const optionAFallback = optA.fallback;
      const optionBFallback = optB.fallback;

      const optionAPercent = totalVotes > 0 ? Math.round((displayAVotes / totalVotes) * 100) : 50;
      const optionBPercent = totalVotes > 0 ? Math.round((displayBVotes / totalVotes) * 100) : 50;
      const neutralPercent = totalVotes > 0 ? 100 - optionAPercent - optionBPercent : 0;

      res.json({
        ...matchup,
        optionAImage: optionAImageResolved,
        optionBImage: optionBImageResolved,
        optionAFallbackImage: optionAFallback !== optionAImageResolved ? optionAFallback : null,
        optionBFallbackImage: optionBFallback !== optionBImageResolved ? optionBFallback : null,
        optionAVotes: displayAVotes,
        optionBVotes: displayBVotes,
        neutralVotes: displayNeutralVotes,
        totalVotes,
        optionAPercent,
        optionBPercent,
        neutralPercent,
      });
    } catch (error: any) {
      console.error("Error fetching matchup by slug:", error.message);
      res.status(500).json({ error: "Failed to fetch matchup" });
    }
  });

  // Get user's votes on matchups (supports anonymous via session ID)
  app.get("/api/matchups/user-votes", optionalAuth, async (req: AuthRequest, res) => {
    try {
      // Use userId if logged in, otherwise use session ID
      const voterId = req.userId || req.sessionId;
      if (!voterId) {
        return res.json({});
      }
      
      const userVotes = await db.select()
        .from(votes)
        .where(and(
          eq(votes.userId, voterId),
          eq(votes.voteType, 'face_off')
        ));
      
      // Convert to a map of matchupId -> votedOption
      const voteMap: Record<string, string> = {};
      userVotes.forEach(vote => {
        voteMap[vote.targetId] = vote.value;
      });
      
      res.json(voteMap);
    } catch (error: any) {
      console.error("Error fetching user matchup votes:", error.message);
      res.status(500).json({ error: "Failed to fetch user votes" });
    }
  });
  
  // Submit a vote on a matchup (supports anonymous via session ID)
  app.post("/api/matchups/:id/vote", optionalAuth, async (req: AuthRequest, res) => {
    try {
      // Use userId if logged in, otherwise use session ID for anonymous voting
      const voterId = req.userId || req.sessionId;
      if (voterId && !checkVoteRateLimit(voterId)) {
        return res.status(429).json({ error: "Too many votes. Please slow down." });
      }
      if (!voterId) {
        return res.status(400).json({ error: "Unable to track vote - no session available" });
      }
      
      const { id } = req.params;
      const { option, remove } = req.body;
      
      // Check if matchup exists
      const [matchup] = await db.select().from(matchups).where(eq(matchups.id, id));
      if (!matchup) {
        return res.status(404).json({ error: "Matchup not found" });
      }
      
      // Check if user/session already voted
      const [existingVote] = await db.select()
        .from(votes)
        .where(and(
          eq(votes.userId, voterId),
          eq(votes.voteType, 'face_off'),
          eq(votes.targetId, id)
        ));
      
      // Handle vote removal
      if (remove === true) {
        if (existingVote) {
          await db.delete(votes).where(eq(votes.id, existingVote.id));
          if (req.userId) {
            await db.update(profiles)
              .set({ totalVotes: sql`GREATEST(${profiles.totalVotes} - 1, 0)` })
              .where(eq(profiles.id, req.userId));
          }
        }
        const voteResults = await db.select({
          value: votes.value,
          count: count(),
        })
        .from(votes)
        .where(and(
          eq(votes.voteType, 'face_off'),
          eq(votes.targetId, id)
        ))
        .groupBy(votes.value);
        
        const realA = Number(voteResults.find(v => v.value === 'option_a')?.count || 0);
        const realB = Number(voteResults.find(v => v.value === 'option_b')?.count || 0);
        const realN = Number(voteResults.find(v => v.value === 'neutral')?.count || 0);
        const dispA = realA + (matchup.seedVotesA || 0);
        const dispB = realB + (matchup.seedVotesB || 0);
        const dispN = realN + (matchup.seedVotesNeutral || 0);
        const totalVotes = dispA + dispB + dispN;
        const dispAPercent = totalVotes > 0 ? Math.round((dispA / totalVotes) * 100) : 50;
        const dispBPercent = totalVotes > 0 ? Math.round((dispB / totalVotes) * 100) : 50;

        return res.json({
          success: true,
          removed: true,
          optionAVotes: dispA,
          optionBVotes: dispB,
          neutralVotes: dispN,
          totalVotes,
          optionAPercent: dispAPercent,
          optionBPercent: dispBPercent,
          neutralPercent: totalVotes > 0 ? 100 - dispAPercent - dispBPercent : 0,
          votedOption: null,
        });
      }

      if (!option || (option !== 'option_a' && option !== 'option_b' && option !== 'neutral')) {
        return res.status(400).json({ error: "Invalid option. Must be 'option_a', 'option_b', or 'neutral'" });
      }
      
      let xpResult = null;
      
      if (existingVote) {
        if (existingVote.value !== option) {
          await db.update(votes)
            .set({ value: option })
            .where(eq(votes.id, existingVote.id));
        }
      } else {
        await db.transaction(async (tx) => {
          await tx.insert(votes).values({
            userId: voterId,
            voteType: 'face_off',
            targetType: 'face_off',
            targetId: id,
            value: option,
            weight: 1.0,
          });

          if (req.userId) {
            await tx.update(profiles)
              .set({ totalVotes: sql`${profiles.totalVotes} + 1` })
              .where(eq(profiles.id, req.userId));
          }
        });

        if (req.userId) {
          // Phase 3: engagement signal. Only tracked for signed-in
          // users (anonymous session votes don't have a profile to
          // blend against). matchup.category was loaded at the top of
          // this handler.
          await upsertEngagement({
            userId: req.userId,
            categoryId: matchup.category,
            voteDelta: 1,
            source: "matchup-vote",
          });

          try {
            xpResult = await gamificationService.awardXp(
              req.userId,
              'vote_face_off',
              `face_off_${id}_${req.userId}`,
              { matchupId: id, votedOption: option }
            );
          } catch (xpError) {
            console.error("XP award failed:", xpError);
          }
        }
      }
      
      // Get updated vote counts
      const voteResults = await db.select({
        value: votes.value,
        count: count(),
      })
      .from(votes)
      .where(and(
        eq(votes.voteType, 'face_off'),
        eq(votes.targetId, id)
      ))
      .groupBy(votes.value);
      
      const realA2 = Number(voteResults.find(v => v.value === 'option_a')?.count || 0);
      const realB2 = Number(voteResults.find(v => v.value === 'option_b')?.count || 0);
      const realN2 = Number(voteResults.find(v => v.value === 'neutral')?.count || 0);
      const dispA2 = realA2 + (matchup.seedVotesA || 0);
      const dispB2 = realB2 + (matchup.seedVotesB || 0);
      const dispN2 = realN2 + (matchup.seedVotesNeutral || 0);
      const totalVotes = dispA2 + dispB2 + dispN2;
      const dispA2Percent = totalVotes > 0 ? Math.round((dispA2 / totalVotes) * 100) : 50;
      const dispB2Percent = totalVotes > 0 ? Math.round((dispB2 / totalVotes) * 100) : 50;

      res.json({
        success: true,
        optionAVotes: dispA2,
        optionBVotes: dispB2,
        neutralVotes: dispN2,
        totalVotes,
        optionAPercent: dispA2Percent,
        optionBPercent: dispB2Percent,
        neutralPercent: totalVotes > 0 ? 100 - dispA2Percent - dispB2Percent : 0,
        votedOption: option,
        xpAwarded: xpResult?.success ? xpResult.xpAwarded : 0,
        xp: xpResult ?? null,
      });
    } catch (error: any) {
      console.error("Error submitting matchup vote:", error.message);
      res.status(500).json({ error: "Failed to submit vote" });
    }
  });

  app.get("/api/admin/moderation/comment-reports", requireAuth, requireAdmin, async (req: AuthRequest, res) => {
    try {
      const reports = await db.select({
        id: commentReports.id,
        commentId: commentReports.commentId,
        entityType: commentReports.entityType,
        reporterId: commentReports.reporterId,
        reason: commentReports.reason,
        createdAt: commentReports.createdAt,
      }).from(commentReports).orderBy(desc(commentReports.createdAt)).limit(200);

      res.json(reports);
    } catch (error: any) {
      console.error("Error fetching comment reports:", error.message);
      res.status(500).json({ error: "Failed to fetch comment reports" });
    }
  });

  // ============================================================================
  // GAMIFICATION ROUTES
  // ============================================================================

  // Get user gamification stats (XP, rank, capabilities, credits)
  app.get("/api/gamification/stats", requireAuth, async (req: AuthRequest, res) => {
    try {
      const userId = req.userId!;

      // Award daily login XP (idempotent per day)
      const today = new Date().toISOString().split('T')[0];
      let loginXp: Awaited<ReturnType<typeof gamificationService.awardXp>> | undefined;
      let streakXp: Awaited<ReturnType<typeof gamificationService.awardXp>> | undefined;
      try {
        loginXp = await gamificationService.awardXp(
          userId, 'daily_login',
          `daily_login_${today}_${userId}`,
          { date: today }
        );

        if (loginXp?.success) {
          // Check yesterday's login to maintain/increment streak
          const yesterday = new Date(Date.now() - 86_400_000).toISOString().split('T')[0];
          const [yesterdayLogin] = await db.select({ id: xpLedger.id })
            .from(xpLedger)
            .where(and(
              eq(xpLedger.userId, userId),
              eq(xpLedger.idempotencyKey, `daily_login_${yesterday}_${userId}`)
            ))
            .limit(1);

          if (yesterdayLogin) {
            await db.update(profiles)
              .set({ currentStreak: sql`${profiles.currentStreak} + 1` })
              .where(eq(profiles.id, userId));

            try {
              streakXp = await gamificationService.awardXp(
                userId, 'streak_bonus',
                `streak_bonus_${today}_${userId}`,
                { date: today }
              );
            } catch (e) { /* streak bonus already awarded or failed */ }
          } else {
            // Reset streak to 1 (today is day 1)
            await db.update(profiles)
              .set({ currentStreak: 1 })
              .where(eq(profiles.id, userId));
          }
        }
      } catch (e) { /* daily login XP already awarded or failed */ }

      const stats = await gamificationService.getUserStats(userId);
      if (!stats) {
        return res.status(404).json({ error: "User not found" });
      }

      // Combine login + streak into a single xp payload for the client burst.
      // Only include when at least one award fired this call — on polls where
      // XP was already granted today both success flags are false, so the
      // client won't re-trigger a burst.
      const loginAwarded = loginXp?.success ? loginXp.xpAwarded : 0;
      const streakAwarded = streakXp?.success ? streakXp.xpAwarded : 0;
      const combinedXpAwarded = loginAwarded + streakAwarded;
      const xp = combinedXpAwarded > 0
        ? {
            xpAwarded: combinedXpAwarded,
            reason: streakAwarded > 0 ? "Daily login + streak bonus" : "Daily login",
          }
        : null;
      res.json({ ...stats, xp });
    } catch (error: any) {
      console.error("Error fetching user stats:", error.message);
      res.status(500).json({ error: "Failed to fetch user stats" });
    }
  });

  // NOTE: The following gamification read endpoints have been extracted into
  // server/route-modules/gamification-routes.ts (registered above):
  //   GET /api/gamification/check-permission/:capability
  //   GET /api/gamification/xp-history
  //   GET /api/gamification/credit-history
  //   GET /api/gamification/daily-summary
  //   GET /api/gamification/xp-actions
  //   GET /api/gamification/ranks
  //
  // /api/gamification/stats stays in this file because it has daily-login
  // and streak-award side effects that touch multiple subsystems.
  //
  // NOTE: XP awarding is handled INTERNALLY by action handlers (votes, comments, etc.)
  // There is NO public endpoint for XP awards - this prevents forging.
  // XP is awarded via gamificationService.awardXp() called directly in handlers.
  //
  // NOTE: Credit adjustments are handled INTERNALLY by prediction handlers.
  // Debits occur when placing predictions (via stake handlers).
  // Credits occur when winning predictions (via settlement handlers).

  // Admin: Re-seed gamification actions and ranks (idempotent upsert)
  app.post("/api/admin/seed-gamification", requireAuth, requireAdmin, async (req: AuthRequest, res) => {
    try {
      const { seedGamification } = await import("./scripts/seed-gamification");
      const result = await seedGamification();
      res.json(result);
    } catch (error: any) {
      console.error("Error seeding gamification:", error.message);
      res.status(500).json({ error: "Failed to seed gamification" });
    }
  });

  // ==================== PROFILE ENDPOINTS ====================

  // Single source of truth for the signup credit grant. Referenced by:
  //   - profiles.predictCredits on insert (the on-screen balance)
  //   - creditLedger initial_grant entry (amount + balanceAfter)
  //   - the welcome email (server passes profile.predictCredits at send
  //     time, so it auto-tracks any change here without template edits)
  // NOTE on backfill: the ledger entry uses idempotencyKey
  // `initial_grant_${userId}` and onConflictDoNothing(), which means
  // bumping this constant only affects NEW accounts. Existing users
  // who already received a previous-amount grant won't be silently
  // topped up — that's intentional and the safe default.
  const SIGNUP_CREDIT_GRANT = 10000;

  // Sync profile after Supabase auth - creates profile if doesn't exist
  app.post("/api/profile/sync", requireAuth, async (req: AuthRequest, res) => {
    try {
      const userId = req.userId!;
      const jwtEmail = req.userEmail || null;
      const initialGrantEntry = {
        userId,
        txnType: 'initial_grant' as const,
        amount: SIGNUP_CREDIT_GRANT,
        walletType: 'VIRTUAL' as const,
        balanceAfter: SIGNUP_CREDIT_GRANT,
        source: 'signup',
        idempotencyKey: `initial_grant_${userId}`,
        metadata: { reason: 'New account signup bonus' },
      };
      
      // Try to get user details from Supabase Admin API, but don't block on failure.
      // We deliberately ignore `user_metadata.full_name` / `name` — the previous
      // behaviour seeded our `fullName` column from Google OAuth's display name,
      // but the column is now deprecated (username is the single source of truth)
      // so there's nothing to seed.
      let email = jwtEmail;
      let avatarUrl: string | null = null;
      
      try {
        const result = await supabaseServer.auth.admin.getUserById(userId);
        if (result.data?.user) {
          email = result.data.user.email || email;
          avatarUrl = result.data.user.user_metadata?.avatar_url || result.data.user.user_metadata?.picture || null;
        } else {
          console.warn(`[Profile] Admin API getUserById failed for ${userId}, falling back to JWT email: ${jwtEmail}`);
        }
      } catch (adminErr: any) {
        console.warn(`[Profile] Admin API error for ${userId}, falling back to JWT email: ${jwtEmail}`, adminErr?.message);
      }
      
      if (!email) {
        console.error(`[Profile] No email available for user ${userId} from JWT or Admin API`);
        return res.status(400).json({ error: "Could not determine user email" });
      }
      
      // Check if profile exists
      const existing = await db.select().from(profiles).where(eq(profiles.id, userId)).limit(1);
      const created = existing.length === 0;

      if (!created) {
        // Update existing profile (update avatar if changed)
        const updateData: Partial<Profile> = {
          lastActiveAt: new Date(),
        };
        if (avatarUrl && !existing[0].avatarUrl) updateData.avatarUrl = avatarUrl;
        
        await db.transaction(async (tx) => {
          await tx.update(profiles).set(updateData).where(eq(profiles.id, userId));
          await tx.insert(creditLedger).values(initialGrantEntry).onConflictDoNothing();
        });
        const updated = await db.select().from(profiles).where(eq(profiles.id, userId)).limit(1);

        return res.json({ profile: updated[0], created: false });
      }
      
      // Create new profile.
      // Username intentionally left null at sync time — the user picks
      // their own handle on /login/welcome. Auto-generating from email
      // local part (the previous behaviour) leaked the address shape
      // and produced unattractive defaults like `andrewdburgess0123`,
      // which most users would just rename anyway. Postgres allows
      // multiple NULLs in a UNIQUE column, so this is safe; the
      // NewUserGate keeps un-onboarded users on /login/welcome until
      // they submit a username, so a transient null is never visible
      // to the rest of the app.
      const newProfile = {
        id: userId,
        username: null,
        avatarUrl,
        avatarSeed: `${userId}:default:v1`,
        isPublic: true,
        role: "user",
        rank: "Citizen",
        xpPoints: 0,
        predictCredits: SIGNUP_CREDIT_GRANT,
        currentStreak: 0,
        totalVotes: 0,
        totalPredictions: 0,
        winRate: 0,
        lastActiveAt: new Date(),
      };
      
      await db.transaction(async (tx) => {
        await tx.insert(profiles).values(newProfile);
        await tx.insert(creditLedger).values(initialGrantEntry).onConflictDoNothing();
      });

      res.json({ profile: newProfile, created: true });
    } catch (error: any) {
      console.error("Error syncing profile:", error.message);
      res.status(500).json({ error: "Failed to sync profile" });
    }
  });
  
  // Get current user's profile
  app.get("/api/profile/me", requireAuth, async (req: AuthRequest, res) => {
    try {
      const userId = req.userId!;
      const profile = await db.select().from(profiles).where(eq(profiles.id, userId)).limit(1);
      
      if (profile.length === 0) {
        return res.status(404).json({ error: "Profile not found. Please sync your profile first." });
      }
      
      const { isAgent, ...publicProfile } = profile[0];
      res.json(publicProfile);
    } catch (error: any) {
      console.error("Error fetching profile:", error.message);
      res.status(500).json({ error: "Failed to fetch profile" });
    }
  });
  
  // Update current user's profile.
  // `fullName` is intentionally NOT accepted here anymore — it was
  // merged into `username` (single source of truth for handle and
  // display). Older clients that still send the field will simply
  // have it ignored rather than rejected, so a stale tab in another
  // browser won't blow up.
  app.patch("/api/profile/me", requireAuth, async (req: AuthRequest, res) => {
    try {
      const userId = req.userId!;
      const { username, avatarUrl, isPublic } = req.body;
      
      // Build update object with only provided fields
      const updateData: Partial<Profile> = {};
      if (username !== undefined) {
        // Validate username uniqueness
        const existingUsername = await db.select().from(profiles)
          .where(and(eq(profiles.username, username), sql`${profiles.id} != ${userId}`))
          .limit(1);
        if (existingUsername.length > 0) {
          return res.status(400).json({ error: "Username already taken" });
        }
        updateData.username = username;
      }
      if (avatarUrl !== undefined) updateData.avatarUrl = avatarUrl;
      if (isPublic !== undefined) updateData.isPublic = isPublic;
      
      if (Object.keys(updateData).length === 0) {
        return res.status(400).json({ error: "No fields to update" });
      }
      
      await db.update(profiles).set(updateData).where(eq(profiles.id, userId));
      const updated = await db.select().from(profiles).where(eq(profiles.id, userId)).limit(1);
      
      res.json(updated[0]);
    } catch (error: any) {
      console.error("Error updating profile:", error.message);
      res.status(500).json({ error: "Failed to update profile" });
    }
  });

  // Welcome flow: set username + record ToS acceptance in a single call.
  // Idempotent — safe to call multiple times; tosAcceptedAt is set on every
  // successful submit, but the route is only ever hit during /login/welcome.
  app.patch("/api/profile/me/username", requireAuth, async (req: AuthRequest, res) => {
    try {
      const userId = req.userId!;
      const { username, tosAccepted } = req.body ?? {};

      if (typeof username !== "string") {
        return res.status(400).json({ error: "username is required" });
      }
      if (!/^[A-Za-z0-9_]{3,20}$/.test(username)) {
        return res.status(400).json({ error: "invalid_format" });
      }
      if (tosAccepted !== true) {
        return res.status(400).json({ error: "tos_required" });
      }

      const taken = await db.select({ id: profiles.id }).from(profiles)
        .where(and(eq(profiles.username, username), sql`${profiles.id} != ${userId}`))
        .limit(1);
      if (taken.length > 0) {
        return res.status(409).json({ error: "username_taken" });
      }

      // Read the existing row first so we can:
      //   1. Detect first-time ToS acceptance (welcome email trigger).
      //   2. Preserve the original tosAcceptedAt timestamp on retries —
      //      important if the user (or a buggy client) ever resubmits
      //      this endpoint, we don't want to silently move the
      //      acceptance date forward.
      //   3. Get the predictCredits + display name needed to render an
      //      accurate welcome email (matches the on-screen balance).
      const existingRows = await db
        .select()
        .from(profiles)
        .where(eq(profiles.id, userId))
        .limit(1);
      if (existingRows.length === 0) {
        return res.status(404).json({ error: "Profile not found" });
      }
      const existing = existingRows[0];
      const isFirstAcceptance = !existing.tosAcceptedAt;

      const updated = await db
        .update(profiles)
        .set({
          username,
          // Only stamp on first acceptance — preserves the original
          // ToS-accepted timestamp on any subsequent calls.
          ...(isFirstAcceptance ? { tosAcceptedAt: new Date() } : {}),
        })
        .where(eq(profiles.id, userId))
        .returning();

      if (updated.length === 0) {
        return res.status(404).json({ error: "Profile not found" });
      }

      // First-time acceptance → fire the welcome email.
      // Fire-and-forget on purpose: a slow Resend response shouldn't
      // hold up the user's onboarding redirect. The idempotencyKey
      // prevents accidental duplicate sends if this handler is ever
      // hit twice for the same user (network retry, double-click).
      // Template no longer takes a firstName — see Welcome.tsx for
      // why we dropped the personal greeting.
      if (isFirstAcceptance && req.userEmail) {
        const creditAmount = updated[0].predictCredits ?? 0;
        const baseUrl =
          process.env.PUBLIC_APP_URL ||
          process.env.APP_URL ||
          `${req.protocol}://${req.get("host")}`;

        void (async () => {
          try {
            await sendEmail({
              to: req.userEmail!,
              subject: welcomeSubject(creditAmount),
              category: "lifecycle",
              template: React.createElement(WelcomeEmail, {
                baseUrl,
                creditAmount,
              }),
              idempotencyKey: `welcome:${userId}`,
              tags: [
                { name: "category", value: "lifecycle" },
                { name: "template", value: "welcome" },
              ],
            });
          } catch (err) {
            console.error(
              `[welcome-email] Send failed for user=${userId}:`,
              err instanceof Error ? err.message : err,
            );
          }
        })();
      }

      res.json(updated[0]);
    } catch (error: any) {
      console.error("Error setting username:", error.message);
      res.status(500).json({ error: "Failed to set username" });
    }
  });

  // Public category registry (used by onboarding/settings pickers).
  app.get("/api/categories", async (_req, res) => {
    try {
      const rows = await db
        .select({ id: contentCategories.id, label: contentCategories.label, sortOrder: contentCategories.sortOrder })
        .from(contentCategories)
        .orderBy(asc(contentCategories.sortOrder), asc(contentCategories.id));

      if (rows.length > 0) {
        return res.json(rows);
      }

      // Fallback for environments that haven't run the category registry migration yet.
      res.json(
        CANONICAL_CATEGORIES.map((c, idx) => ({
          id: c.id,
          label: c.label,
          sortOrder: (idx + 1) * 10,
        })),
      );
    } catch (error: any) {
      console.error("Error fetching category registry:", error.message);
      res.status(500).json({ error: "Failed to fetch categories" });
    }
  });

  // Interest Picker — Phase 1.
  //
  // Stores the user's stated category interests. Two body shapes are accepted:
  //
  //   { interests: string[] }            -> save selection, clear dismissed flag
  //   { interests: [], dismissed: true } -> user skipped/dismissed, stamp
  //                                         interestsPromptDismissedAt = now()
  //
  // The dismissed timestamp drives the soft re-prompt logic in App.tsx
  // (InterestsGate). Saving a non-empty selection always clears the dismissed
  // flag so the re-prompt doesn't fire for users who picked something.
  app.patch("/api/profile/me/interests", requireAuth, async (req: AuthRequest, res) => {
    try {
      const userId = req.userId!;
      const body = (req.body ?? {}) as { interests?: unknown; dismissed?: unknown };

      if (!Array.isArray(body.interests)) {
        return res.status(400).json({ error: "interests_required" });
      }

      const registryRows = await db
        .select({ id: contentCategories.id })
        .from(contentCategories);
      const validIds = new Set<string>(
        (registryRows.length > 0
          ? registryRows.map((r) => r.id)
          : CANONICAL_CATEGORIES.map((c) => c.id)
        ).map((id) => id.toLowerCase()),
      );
      const cleaned: string[] = [];
      const seen = new Set<string>();
      for (const raw of body.interests) {
        if (typeof raw !== "string") {
          return res.status(400).json({ error: "invalid_interest_type" });
        }
        const normalized = raw.trim().toLowerCase();
        if (!validIds.has(normalized)) {
          return res.status(400).json({ error: "invalid_interest", value: raw });
        }
        if (seen.has(normalized)) continue;
        seen.add(normalized);
        cleaned.push(normalized);
      }

      const dismissed = body.dismissed === true;

      // Skip path: empty array + dismissed=true -> stamp dismissed timestamp.
      // Save path: non-empty array -> persist + clear dismissed timestamp so
      // a user who picks at least one interest never gets re-prompted.
      // Empty array without dismissed flag is treated as a "clear all" save
      // (used by the Settings card) and also clears the dismissed timestamp
      // so the cold-start ordering applies again.
      const updateData: Partial<Profile> = {
        statedInterests: cleaned,
        interestsPromptDismissedAt:
          cleaned.length === 0 && dismissed ? new Date() : null,
      };

      const updated = await db
        .update(profiles)
        .set(updateData)
        .where(eq(profiles.id, userId))
        .returning();

      if (updated.length === 0) {
        return res.status(404).json({ error: "Profile not found" });
      }

      res.json({
        statedInterests: updated[0].statedInterests ?? [],
        interestsPromptDismissedAt: updated[0].interestsPromptDismissedAt,
      });
    } catch (error: any) {
      console.error("Error updating interests:", error.message);
      res.status(500).json({ error: "Failed to update interests" });
    }
  });

  // Update current user's avatar (seed + URL)
  app.patch("/api/profile/avatar", requireAuth, async (req: AuthRequest, res) => {
    try {
      const userId = req.userId!;
      const { seed, avatarUrl } = req.body ?? {};

      // `seed` accepts either a non-empty string (generative avatar) or
      // explicit null (user uploaded a custom photo — no seed to track).
      // Generative avatars and uploaded photos are mutually exclusive
      // sources of truth, so we clear the column rather than leave a
      // stale seed pointing at the previous look.
      const seedIsValid =
        seed === null ||
        (typeof seed === "string" && seed.trim().length > 0);
      if (!seedIsValid) {
        return res.status(400).json({
          error: "seed must be a non-empty string or null",
        });
      }
      if (typeof avatarUrl !== "string" || avatarUrl.trim().length === 0) {
        return res.status(400).json({ error: "avatarUrl is required and must be a non-empty string" });
      }

      const updated = await db
        .update(profiles)
        .set({ avatarSeed: seed, avatarUrl })
        .where(eq(profiles.id, userId))
        .returning();

      if (updated.length === 0) {
        return res.status(404).json({ error: "Profile not found" });
      }

      res.json({ profile: updated[0] });
    } catch (error: any) {
      console.error("Error updating profile avatar:", error.message);
      res.status(500).json({ error: "Failed to update profile avatar" });
    }
  });
  
  // Get public profile by username
  app.get("/api/profile/u/:username", async (req, res) => {
    try {
      const { username } = req.params;
      const profile = await db.select().from(profiles).where(eq(profiles.username, username)).limit(1);
      
      if (profile.length === 0) {
        return res.status(404).json({ error: "Profile not found" });
      }

      const baseProfile = profile[0];
      let agentProfile: {
        archetype: string;
        bio: string | null;
        specialties: string[];
        displayName: string;
        totalEntered?: number;
        accuracy?: number | null;
      } | null = null;

      if (baseProfile.isAgent) {
        const { agentConfigs, agentPerformance } = await import("@shared/schema");
        const { isV2SimulationProfile } = await import("./agents/simulationProfile");

        const [agentConfig] = await db
          .select({
            id: agentConfigs.id,
            displayName: agentConfigs.displayName,
            bio: agentConfigs.bio,
            archetype: agentConfigs.archetype,
            specialties: agentConfigs.specialties,
            simulationProfile: agentConfigs.simulationProfile,
          })
          .from(agentConfigs)
          .where(eq(agentConfigs.userId, baseProfile.id))
          .limit(1);

        // V2 (simulation) agents must look like normal users on the public
        // profile. We deliberately do not surface internal labels (archetype,
        // bio, specialties) for them. Legacy agents keep their old payload
        // so admin/QA tools still work during the transition.
        if (agentConfig && !isV2SimulationProfile(agentConfig.simulationProfile)) {
          const [latestPerformance] = await db
            .select({
              totalEntered: agentPerformance.totalEntered,
              accuracy: agentPerformance.accuracy,
            })
            .from(agentPerformance)
            .where(eq(agentPerformance.agentId, agentConfig.id))
            .orderBy(desc(agentPerformance.periodEnd))
            .limit(1);

          agentProfile = {
            displayName: agentConfig.displayName,
            bio: agentConfig.bio ?? null,
            archetype: agentConfig.archetype,
            specialties: agentConfig.specialties ?? [],
            totalEntered: latestPerformance?.totalEntered ?? 0,
            accuracy: latestPerformance?.accuracy ? Number(latestPerformance.accuracy) : null,
          };
        }
      }
      
      // If profile is private, return limited info
      if (!baseProfile.isPublic) {
        return res.json({
          username: baseProfile.username,
          avatarUrl: baseProfile.avatarUrl,
          rank: baseProfile.rank,
          isAgent: baseProfile.isAgent,
          isPublic: false,
          agentProfile,
          message: "This profile is private"
        });
      }

      const [betStats] = await db
        .select({
          profitLoss: sql<number>`COALESCE(SUM(CASE WHEN ${marketBets.status} = 'won' THEN COALESCE(${marketBets.payoutAmount}, ${marketBets.potentialPayout}, 0) - ${marketBets.stakeAmount} WHEN ${marketBets.status} = 'lost' THEN -${marketBets.stakeAmount} ELSE 0 END), 0)`.as("profit_loss"),
          volume: sql<number>`COALESCE(SUM(${marketBets.stakeAmount}), 0)`.as("volume"),
          totalBets: sql<number>`COUNT(*)::int`.as("total_bets"),
          biggestWin: sql<number>`COALESCE(MAX(CASE WHEN ${marketBets.status} = 'won' THEN COALESCE(${marketBets.payoutAmount}, ${marketBets.potentialPayout}, 0) - ${marketBets.stakeAmount} ELSE 0 END), 0)`.as("biggest_win"),
        })
        .from(marketBets)
        .where(and(eq(marketBets.userId, baseProfile.id), inArray(marketBets.status, ["won", "lost"])));

      // Subtract hidden items from the denormalized counters so the public view
      // reflects only what the user has chosen to expose. /api/profile/me stays
      // untouched so the owner still sees their real totals on /me/* pages.
      const [privacyCounts] = await db
        .select({
          hiddenVotes: sql<number>`COUNT(*) FILTER (WHERE ${profileItemPrivacy.itemType} IN (
            'matchup','sentiment','trending_poll','opinion_poll',
            'image_curate','induction','value_vote','overall_rating'
          ))::int`.as("hidden_votes"),
          hiddenPredictions: sql<number>`COUNT(*) FILTER (
            WHERE ${profileItemPrivacy.itemType} = 'market_bet'
          )::int`.as("hidden_predictions"),
        })
        .from(profileItemPrivacy)
        .where(eq(profileItemPrivacy.userId, baseProfile.id));

      const visibleTotalVotes = Math.max(
        0,
        (baseProfile.totalVotes ?? 0) - Number(privacyCounts?.hiddenVotes ?? 0),
      );
      const visibleTotalPredictions = Math.max(
        0,
        (baseProfile.totalPredictions ?? 0) - Number(privacyCounts?.hiddenPredictions ?? 0),
      );

      // Return full public profile
      res.json({
        username: baseProfile.username,
        avatarUrl: baseProfile.avatarUrl,
        rank: baseProfile.rank,
        xpPoints: baseProfile.xpPoints,
        totalVotes: visibleTotalVotes,
        totalPredictions: visibleTotalPredictions,
        winRate: baseProfile.winRate,
        isAgent: baseProfile.isAgent,
        isPublic: true,
        createdAt: baseProfile.createdAt,
        agentProfile,
        profitLoss: Number(betStats?.profitLoss ?? 0),
        volume: Number(betStats?.volume ?? 0),
        totalBets: Number(betStats?.totalBets ?? 0),
        biggestWin: Number(betStats?.biggestWin ?? 0),
      });
    } catch (error: any) {
      console.error("Error fetching public profile:", error.message);
      res.status(500).json({ error: "Failed to fetch profile" });
    }
  });
  
  app.get("/api/profile/u/:username/bets", async (req, res) => {
    try {
      const { username } = req.params;
      const tab = (req.query.tab as string) || "settled";
      const limit = Math.min(Number(req.query.limit) || 50, 100);
      const offset = Number(req.query.offset) || 0;

      const [user] = await db.select({ id: profiles.id, isPublic: profiles.isPublic, isAgent: profiles.isAgent })
        .from(profiles).where(eq(profiles.username, username)).limit(1);
      if (!user) return res.status(404).json({ error: "User not found" });
      if (!user.isPublic) return res.status(403).json({ error: "Profile is private" });

      const { getSimulationProfile, shouldShowPublicConfidence } = await import("./agents/simulationProfile");
      let agentSimulationProfile: import("./agents/simulationProfile").AgentSimulationProfile | null = null;
      if (user.isAgent) {
        const { agentConfigs: agentConfigsTable } = await import("@shared/schema");
        const [agentRow] = await db
          .select({ simulationProfile: agentConfigsTable.simulationProfile })
          .from(agentConfigsTable)
          .where(eq(agentConfigsTable.userId, user.id))
          .limit(1);
        if (agentRow) {
          agentSimulationProfile = getSimulationProfile(agentRow.simulationProfile);
        }
      }

      const statusFilter = tab === "active"
        ? eq(marketBets.status, "active")
        : inArray(marketBets.status, ["won", "lost", "void", "refunded"]);

      const bets = await db
        .select({
          betId: marketBets.id,
          stakeAmount: marketBets.stakeAmount,
          potentialPayout: marketBets.potentialPayout,
          payoutAmount: marketBets.payoutAmount,
          betStatus: marketBets.status,
          direction: marketBets.direction,
          betCreatedAt: marketBets.createdAt,
          settledAt: marketBets.settledAt,
          betMetadata: marketBets.betMetadata,
          confidence: marketBets.confidence,
          marketSlug: predictionMarkets.slug,
          marketTitle: predictionMarkets.title,
          marketType: predictionMarkets.marketType,
          marketCategory: predictionMarkets.category,
          entryLabel: marketEntries.label,
        })
        .from(marketBets)
        .innerJoin(predictionMarkets, eq(marketBets.marketId, predictionMarkets.id))
        .innerJoin(marketEntries, eq(marketBets.entryId, marketEntries.id))
        .where(and(
          eq(marketBets.userId, user.id),
          statusFilter,
          sql`${predictionMarkets.visibility} NOT IN ('draft', 'hidden')`,
          sql`NOT (${predictionMarkets.visibility} = 'archived' AND ${marketBets.status} = 'active')`,
          sql`NOT EXISTS (
            SELECT 1 FROM ${profileItemPrivacy}
            WHERE ${profileItemPrivacy.userId} = ${user.id}
              AND ${profileItemPrivacy.itemType} = 'market_bet'
              AND ${profileItemPrivacy.itemId} = ${marketBets.id}::text
          )`,
        ))
        .orderBy(tab === "active" ? desc(marketBets.createdAt) : desc(marketBets.settledAt))
        .limit(limit)
        .offset(offset);

      const formatted = bets.map(b => {
        const payout = b.betStatus === "won" ? (b.payoutAmount ?? b.potentialPayout ?? 0) : 0;
        const pnl = b.betStatus === "won" ? payout - b.stakeAmount
          : b.betStatus === "lost" ? -b.stakeAmount
          : 0;
        const meta = b.betMetadata as Record<string, any> | null;
        const displayEntryLabel =
          b.marketType === "community" && b.direction === "no"
            ? `No on ${b.entryLabel}`
            : b.entryLabel;
        return {
          betId: b.betId,
          marketSlug: b.marketSlug,
          marketTitle: b.marketTitle,
          marketType: b.marketType,
          marketCategory: b.marketCategory,
          entryLabel: displayEntryLabel,
          stakeAmount: b.stakeAmount,
          payout,
          pnl,
          status: b.betStatus,
          confidence: (() => {
            const rawConfidence = b.confidence ? Number(b.confidence) : meta?.confidence ?? null;
            if (!user.isAgent) return rawConfidence;
            if (rawConfidence == null || agentSimulationProfile == null) return null;
            return shouldShowPublicConfidence(agentSimulationProfile, `bet:${b.betId}`)
              ? rawConfidence
              : null;
          })(),
          thesis: meta?.thesis ?? null,
          predictedScore: meta?.predictedScore ?? null,
          placedAt: b.betCreatedAt,
          settledAt: b.settledAt,
        };
      });

      res.json({ bets: formatted, offset, limit, hasMore: formatted.length === limit });
    } catch (error: any) {
      console.error("Error fetching user bets:", error.message);
      res.status(500).json({ error: "Failed to fetch bets" });
    }
  });

  // GET /api/profile/u/:username/votes — public votes feed for a user's profile.
  // Mirrors the /api/me/votes response shape but:
  //  - 403 when the owner's profile is private
  //  - Excludes any items the owner has explicitly hidden via profileItemPrivacy
  //  - Returns a slimmer payload (no hidden flag)
  app.get("/api/profile/u/:username/votes", async (req, res) => {
    try {
      const { username } = req.params;
      const [user] = await db
        .select({ id: profiles.id, isPublic: profiles.isPublic })
        .from(profiles)
        .where(eq(profiles.username, username))
        .limit(1);
      if (!user) return res.status(404).json({ error: "User not found" });
      if (!user.isPublic) return res.status(403).json({ error: "Profile is private" });

      const userId = user.id;

      type PublicVote = {
        id: string;
        voteType: string;
        value: number;
        targetName: string;
        detail: string | null;
        createdAt: Date;
        subjectId: string | null;
        subjectAvatar: string | null;
        subjectImageSlug: string | null;
      };

      const [faceOffVotes, sentVotes, valVotes, pollVotes, opVotes, imgVotes, indVotes, ovRatings] = await Promise.all([
        db
          .select({
            id: votes.id,
            targetId: votes.targetId,
            value: votes.value,
            votedAt: votes.votedAt,
            matchupTitle: matchups.title,
            optionA: matchups.optionAText,
            optionB: matchups.optionBText,
          })
          .from(votes)
          .leftJoin(matchups, eq(matchups.id, votes.targetId))
          .where(and(eq(votes.userId, userId), eq(votes.voteType, "face_off")))
          .orderBy(desc(votes.votedAt))
          .limit(50),
        db
          .select({
            id: sentimentVotes.id,
            personId: sentimentVotes.personId,
            personName: sentimentVotes.personName,
            voteType: sentimentVotes.voteType,
            votedAt: sentimentVotes.votedAt,
            avatar: trackedPeople.avatar,
            imageSlug: trackedPeople.imageSlug,
          })
          .from(sentimentVotes)
          .leftJoin(trackedPeople, eq(trackedPeople.id, sentimentVotes.personId))
          .where(eq(sentimentVotes.userId, userId))
          .orderBy(desc(sentimentVotes.votedAt))
          .limit(50),
        db
          .select({
            id: celebrityValueVotes.id,
            vote: celebrityValueVotes.vote,
            createdAt: celebrityValueVotes.createdAt,
            personId: trackedPeople.id,
            personName: trackedPeople.name,
            avatar: trackedPeople.avatar,
            imageSlug: trackedPeople.imageSlug,
          })
          .from(celebrityValueVotes)
          .leftJoin(trackedPeople, eq(trackedPeople.id, celebrityValueVotes.celebrityId))
          .where(eq(celebrityValueVotes.userId, userId))
          .orderBy(desc(celebrityValueVotes.createdAt))
          .limit(50),
        db
          .select({
            id: trendingPollVotes.id,
            choice: trendingPollVotes.choice,
            createdAt: trendingPollVotes.createdAt,
            headline: trendingPolls.headline,
          })
          .from(trendingPollVotes)
          .leftJoin(trendingPolls, eq(trendingPolls.id, trendingPollVotes.pollId))
          .where(eq(trendingPollVotes.userId, userId))
          .orderBy(desc(trendingPollVotes.createdAt))
          .limit(50),
        db
          .select({
            id: opinionPollVotes.id,
            createdAt: opinionPollVotes.createdAt,
            pollTitle: opinionPolls.title,
            optionName: opinionPollOptions.name,
          })
          .from(opinionPollVotes)
          .leftJoin(opinionPolls, eq(opinionPolls.id, opinionPollVotes.pollId))
          .leftJoin(opinionPollOptions, eq(opinionPollOptions.id, opinionPollVotes.optionId))
          .where(eq(opinionPollVotes.userId, userId))
          .orderBy(desc(opinionPollVotes.createdAt))
          .limit(50),
        db
          .select({
            id: imageVotes.id,
            votedAt: imageVotes.votedAt,
            personId: trackedPeople.id,
            personName: trackedPeople.name,
            avatar: trackedPeople.avatar,
            imageSlug: trackedPeople.imageSlug,
          })
          .from(imageVotes)
          .leftJoin(celebrityImages, eq(celebrityImages.id, imageVotes.imageId))
          .leftJoin(trackedPeople, eq(trackedPeople.id, celebrityImages.personId))
          .where(eq(imageVotes.userId, userId))
          .orderBy(desc(imageVotes.votedAt))
          .limit(50),
        db
          .select({
            id: inductionVotes.id,
            votedAt: inductionVotes.votedAt,
            candidateName: inductionCandidates.displayName,
          })
          .from(inductionVotes)
          .leftJoin(inductionCandidates, eq(inductionCandidates.id, inductionVotes.candidateId))
          .where(eq(inductionVotes.userId, userId))
          .orderBy(desc(inductionVotes.votedAt))
          .limit(50),
        db
          .select({
            id: userVotes.id,
            rating: userVotes.rating,
            votedAt: userVotes.votedAt,
            personId: userVotes.personId,
            personName: userVotes.personName,
            avatar: trackedPeople.avatar,
            imageSlug: trackedPeople.imageSlug,
          })
          .from(userVotes)
          .leftJoin(trackedPeople, eq(trackedPeople.id, userVotes.personId))
          .where(eq(userVotes.userId, userId))
          .orderBy(desc(userVotes.votedAt))
          .limit(50),
      ]);

      const results: PublicVote[] = [];

      for (const v of faceOffVotes) {
        const name = v.matchupTitle || (v.optionA && v.optionB ? `${v.optionA} vs ${v.optionB}` : "Matchup");
        const side = v.value === "option_a" ? v.optionA : v.value === "option_b" ? v.optionB : null;
        results.push({
          id: v.id,
          voteType: "face_off",
          value: 1,
          targetName: name,
          detail: side ? `Voted: ${side}` : null,
          createdAt: v.votedAt ?? new Date(),
          subjectId: null,
          subjectAvatar: null,
          subjectImageSlug: null,
        });
      }
      for (const v of sentVotes) {
        results.push({
          id: v.id,
          voteType: "sentiment",
          value: v.voteType === "overrated" ? -1 : 1,
          targetName: v.personName || "Unknown",
          detail: v.voteType === "overrated" ? "Overrated" : "Underrated",
          createdAt: v.votedAt ?? new Date(),
          subjectId: v.personId ?? null,
          subjectAvatar: v.avatar ?? null,
          subjectImageSlug: v.imageSlug ?? null,
        });
      }
      for (const v of valVotes) {
        const label = v.vote === "underrated" ? "Underrated" : v.vote === "overrated" ? "Overrated" : "Fairly Rated";
        results.push({
          id: v.id,
          voteType: "value_vote",
          value: v.vote === "underrated" ? 1 : v.vote === "overrated" ? -1 : 0,
          targetName: v.personName || "Unknown",
          detail: label,
          createdAt: v.createdAt ?? new Date(),
          subjectId: v.personId ?? null,
          subjectAvatar: v.avatar ?? null,
          subjectImageSlug: v.imageSlug ?? null,
        });
      }
      for (const v of pollVotes) {
        const choiceLabel = v.choice === "support" ? "Support" : v.choice === "oppose" ? "Oppose" : "Neutral";
        results.push({
          id: v.id,
          voteType: "trending_poll",
          value: v.choice === "support" ? 1 : v.choice === "oppose" ? -1 : 0,
          targetName: v.headline || "Poll",
          detail: choiceLabel,
          createdAt: v.createdAt ?? new Date(),
          subjectId: null,
          subjectAvatar: null,
          subjectImageSlug: null,
        });
      }
      for (const v of opVotes) {
        results.push({
          id: v.id,
          voteType: "opinion_poll",
          value: 1,
          targetName: v.pollTitle || "Opinion Poll",
          detail: v.optionName ? `Chose: ${v.optionName}` : null,
          createdAt: v.createdAt ?? new Date(),
          subjectId: null,
          subjectAvatar: null,
          subjectImageSlug: null,
        });
      }
      for (const v of imgVotes) {
        results.push({
          id: v.id,
          voteType: "image_curate",
          value: 1,
          targetName: v.personName || "Unknown",
          detail: "Image upvote",
          createdAt: v.votedAt ?? new Date(),
          subjectId: v.personId ?? null,
          subjectAvatar: v.avatar ?? null,
          subjectImageSlug: v.imageSlug ?? null,
        });
      }
      for (const v of indVotes) {
        results.push({
          id: v.id,
          voteType: "induction",
          value: 1,
          targetName: v.candidateName || "Candidate",
          detail: "Induction vote",
          createdAt: v.votedAt ?? new Date(),
          subjectId: null,
          subjectAvatar: null,
          subjectImageSlug: null,
        });
      }
      for (const v of ovRatings) {
        const ZONE_LABELS = ["Hate", "Dislike", "Neutral", "Like", "Love"];
        const zoneLabel = ZONE_LABELS[(v.rating ?? 3) - 1] ?? "Neutral";
        results.push({
          id: v.id,
          voteType: "overall_rating",
          value: v.rating ?? 0,
          targetName: v.personName || "Unknown",
          detail: `Rated ${v.rating}/5 - ${zoneLabel}`,
          createdAt: v.votedAt ?? new Date(),
          subjectId: v.personId ?? null,
          subjectAvatar: v.avatar ?? null,
          subjectImageSlug: v.imageSlug ?? null,
        });
      }

      // Filter out explicitly hidden items.
      const hiddenSet = await loadHiddenItemSet(userId);
      const privacyTypeFor = (voteType: string): PrivacyItemType | null => {
        switch (voteType) {
          case "face_off": return "matchup";
          case "sentiment": return "sentiment";
          case "value_vote": return "value_vote";
          case "trending_poll": return "trending_poll";
          case "opinion_poll": return "opinion_poll";
          case "image_curate": return "image_curate";
          case "induction": return "induction";
          case "overall_rating": return "overall_rating";
          default: return null;
        }
      };
      const visible = results.filter(r => {
        const pType = privacyTypeFor(r.voteType);
        return pType ? !hiddenSet.has(`${pType}:${r.id}`) : true;
      });

      visible.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

      res.json(visible.slice(0, 50));
    } catch (error: any) {
      console.error("Error fetching public profile votes:", error.message);
      res.status(500).json({ error: "Failed to fetch votes" });
    }
  });

  // Check if current user is admin
  app.get("/api/profile/is-admin", requireAuth, async (req: AuthRequest, res) => {
    try {
      res.json({ 
        isAdmin: isAdminRole(req.userRole),
        role: req.userRole || null,
      });
    } catch (error: any) {
      console.error("Error checking admin status:", error.message);
      res.status(500).json({ error: "Failed to check admin status" });
    }
  });
  
  // ==================
  // /me User Activity Endpoints
  // ==================

  // Allowlist of item types a user can hide from their public profile.
  const VALID_PRIVACY_ITEM_TYPES = [
    "matchup",
    "sentiment",
    "trending_poll",
    "opinion_poll",
    "image_curate",
    "induction",
    "value_vote",
    "overall_rating",
    "market_bet",
  ] as const;
  type PrivacyItemType = (typeof VALID_PRIVACY_ITEM_TYPES)[number];

  // Load the set of { type, id } pairs the user has explicitly hidden.
  async function loadHiddenItemSet(userId: string): Promise<Set<string>> {
    const rows = await db
      .select({ itemType: profileItemPrivacy.itemType, itemId: profileItemPrivacy.itemId })
      .from(profileItemPrivacy)
      .where(eq(profileItemPrivacy.userId, userId));
    const set = new Set<string>();
    for (const r of rows) set.add(`${r.itemType}:${r.itemId}`);
    return set;
  }

  // PATCH /api/me/item-visibility — toggle per-item visibility on the user's public profile.
  app.patch("/api/me/item-visibility", requireAuth, async (req: AuthRequest, res) => {
    try {
      const userId = req.userId!;
      const { itemType, itemId, hidden } = req.body ?? {};

      if (typeof itemType !== "string" || !VALID_PRIVACY_ITEM_TYPES.includes(itemType as PrivacyItemType)) {
        return res.status(400).json({
          error: `Invalid itemType. Must be one of: ${VALID_PRIVACY_ITEM_TYPES.join(", ")}`,
        });
      }
      // Accept string OR number: some underlying tables (e.g. serial()) return
      // numeric PKs over JSON, and we always persist/compare item_id as text.
      if (typeof itemId !== "string" && typeof itemId !== "number") {
        return res.status(400).json({ error: "Invalid itemId" });
      }
      const itemIdStr = String(itemId);
      if (itemIdStr.length < 1 || itemIdStr.length > 128) {
        return res.status(400).json({ error: "Invalid itemId" });
      }
      if (typeof hidden !== "boolean") {
        return res.status(400).json({ error: "`hidden` must be a boolean" });
      }

      if (hidden) {
        // No target arg: Postgres finds ANY matching unique constraint/index.
        // With an explicit target, Drizzle would require a named unique constraint
        // (not a unique index), which is a frequent source of 500s across envs.
        await db
          .insert(profileItemPrivacy)
          .values({ userId, itemType, itemId: itemIdStr })
          .onConflictDoNothing();
      } else {
        await db
          .delete(profileItemPrivacy)
          .where(and(
            eq(profileItemPrivacy.userId, userId),
            eq(profileItemPrivacy.itemType, itemType),
            eq(profileItemPrivacy.itemId, itemIdStr),
          ));
      }

      return res.json({ hidden, code: "OK" });
    } catch (error: any) {
      // Log the FULL error object so Drizzle/Postgres diagnostics are visible in the
      // server logs (error.message alone hides error.code / .detail / .constraint).
      console.error("Error updating item visibility:", error);
      return res.status(500).json({
        error: "Failed to update item visibility",
        code: "ITEM_VISIBILITY_FAILED",
      });
    }
  });

  // Get user's votes
  app.get("/api/me/votes", requireAuth, async (req: AuthRequest, res) => {
    try {
      const userId = req.userId!;
      const typeFilter = req.query.type as string | undefined;

      const VALID_VOTE_TYPES = [
        "face_off",
        "sentiment",
        "value_vote",
        "trending_poll",
        "opinion_poll",
        "image_curate",
        "induction",
        "overall_rating",
      ] as const;
      if (typeFilter && !VALID_VOTE_TYPES.includes(typeFilter as any)) {
        return res.status(400).json({ error: `Invalid vote type. Must be one of: ${VALID_VOTE_TYPES.join(", ")}` });
      }

      type UnifiedVote = {
        id: string;
        voteType: string;
        value: number;
        targetName: string;
        detail: string | null;
        createdAt: Date;
        hidden: boolean;
        subjectId: string | null;
        subjectAvatar: string | null;
        subjectImageSlug: string | null;
        /**
         * Whether the user's pick matched the crowd's majority. Null when we
         * either don't have enough community data or the vote type isn't
         * directly comparable (e.g. opinion_poll, image_curate, induction).
         */
        alignedWithMajority: boolean | null;
      };

      // voteType -> privacy itemType mapping. "face_off" maps to "matchup".
      const privacyTypeFor = (voteType: string): PrivacyItemType | null => {
        switch (voteType) {
          case "face_off": return "matchup";
          case "sentiment": return "sentiment";
          case "value_vote": return "value_vote";
          case "trending_poll": return "trending_poll";
          case "opinion_poll": return "opinion_poll";
          case "image_curate": return "image_curate";
          case "induction": return "induction";
          case "overall_rating": return "overall_rating";
          default: return null;
        }
      };

      const want = (t: string) => !typeFilter || typeFilter === t;

      const [faceOffVotes, sentVotes, valVotes, pollVotes, opVotes, imgVotes, indVotes, ovRatings] = await Promise.all([
        want("face_off") ? db
          .select({
            id: votes.id,
            targetId: votes.targetId,
            value: votes.value,
            weight: votes.weight,
            votedAt: votes.votedAt,
            matchupTitle: matchups.title,
            optionA: matchups.optionAText,
            optionB: matchups.optionBText,
          })
          .from(votes)
          .leftJoin(matchups, eq(matchups.id, votes.targetId))
          .where(and(eq(votes.userId, userId), eq(votes.voteType, "face_off")))
          .orderBy(desc(votes.votedAt))
          .limit(50) : Promise.resolve([]),

        want("sentiment") ? db
          .select({
            id: sentimentVotes.id,
            userId: sentimentVotes.userId,
            personId: sentimentVotes.personId,
            personName: sentimentVotes.personName,
            voteType: sentimentVotes.voteType,
            votedAt: sentimentVotes.votedAt,
            avatar: trackedPeople.avatar,
            imageSlug: trackedPeople.imageSlug,
            communityUnderratedPct: celebrityMetrics.underratedPct,
            communityOverratedPct: celebrityMetrics.overratedPct,
          })
          .from(sentimentVotes)
          .leftJoin(trackedPeople, eq(trackedPeople.id, sentimentVotes.personId))
          .leftJoin(celebrityMetrics, eq(celebrityMetrics.celebrityId, sentimentVotes.personId))
          .where(eq(sentimentVotes.userId, userId))
          .orderBy(desc(sentimentVotes.votedAt))
          .limit(50) : Promise.resolve([]),

        want("value_vote") ? db
          .select({
            id: celebrityValueVotes.id,
            vote: celebrityValueVotes.vote,
            createdAt: celebrityValueVotes.createdAt,
            personId: trackedPeople.id,
            personName: trackedPeople.name,
            avatar: trackedPeople.avatar,
            imageSlug: trackedPeople.imageSlug,
            communityUnderratedPct: celebrityMetrics.underratedPct,
            communityOverratedPct: celebrityMetrics.overratedPct,
            communityFairlyRatedPct: celebrityMetrics.fairlyRatedPct,
          })
          .from(celebrityValueVotes)
          .leftJoin(trackedPeople, eq(trackedPeople.id, celebrityValueVotes.celebrityId))
          .leftJoin(celebrityMetrics, eq(celebrityMetrics.celebrityId, celebrityValueVotes.celebrityId))
          .where(eq(celebrityValueVotes.userId, userId))
          .orderBy(desc(celebrityValueVotes.createdAt))
          .limit(50) : Promise.resolve([]),

        want("trending_poll") ? db
          .select({
            id: trendingPollVotes.id,
            pollId: trendingPollVotes.pollId,
            choice: trendingPollVotes.choice,
            createdAt: trendingPollVotes.createdAt,
            headline: trendingPolls.headline,
            seedSupport: trendingPolls.seedSupportCount,
            seedOppose: trendingPolls.seedOpposeCount,
            seedNeutral: trendingPolls.seedNeutralCount,
          })
          .from(trendingPollVotes)
          .leftJoin(trendingPolls, eq(trendingPolls.id, trendingPollVotes.pollId))
          .where(eq(trendingPollVotes.userId, userId))
          .orderBy(desc(trendingPollVotes.createdAt))
          .limit(50) : Promise.resolve([]),

        want("opinion_poll") ? db
          .select({
            id: opinionPollVotes.id,
            createdAt: opinionPollVotes.createdAt,
            pollTitle: opinionPolls.title,
            optionName: opinionPollOptions.name,
          })
          .from(opinionPollVotes)
          .leftJoin(opinionPolls, eq(opinionPolls.id, opinionPollVotes.pollId))
          .leftJoin(opinionPollOptions, eq(opinionPollOptions.id, opinionPollVotes.optionId))
          .where(eq(opinionPollVotes.userId, userId))
          .orderBy(desc(opinionPollVotes.createdAt))
          .limit(50) : Promise.resolve([]),

        want("image_curate") ? db
          .select({
            id: imageVotes.id,
            votedAt: imageVotes.votedAt,
            personId: trackedPeople.id,
            personName: trackedPeople.name,
            avatar: trackedPeople.avatar,
            imageSlug: trackedPeople.imageSlug,
          })
          .from(imageVotes)
          .leftJoin(celebrityImages, eq(celebrityImages.id, imageVotes.imageId))
          .leftJoin(trackedPeople, eq(trackedPeople.id, celebrityImages.personId))
          .where(eq(imageVotes.userId, userId))
          .orderBy(desc(imageVotes.votedAt))
          .limit(50) : Promise.resolve([]),

        want("induction") ? db
          .select({
            id: inductionVotes.id,
            votedAt: inductionVotes.votedAt,
            candidateName: inductionCandidates.displayName,
          })
          .from(inductionVotes)
          .leftJoin(inductionCandidates, eq(inductionCandidates.id, inductionVotes.candidateId))
          .where(eq(inductionVotes.userId, userId))
          .orderBy(desc(inductionVotes.votedAt))
          .limit(50) : Promise.resolve([]),

        want("overall_rating") ? db
          .select({
            id: userVotes.id,
            rating: userVotes.rating,
            votedAt: userVotes.votedAt,
            personId: userVotes.personId,
            personName: userVotes.personName,
            avatar: trackedPeople.avatar,
            imageSlug: trackedPeople.imageSlug,
            communityApprovalAvg: celebrityMetrics.approvalAvgRating,
          })
          .from(userVotes)
          .leftJoin(trackedPeople, eq(trackedPeople.id, userVotes.personId))
          .leftJoin(celebrityMetrics, eq(celebrityMetrics.celebrityId, userVotes.personId))
          .where(eq(userVotes.userId, userId))
          .orderBy(desc(userVotes.votedAt))
          .limit(50) : Promise.resolve([]),
      ]);

      // TEMP DIAGNOSTIC: verify overall_rating row counts match between Drizzle
      // ORM and raw SQL for the authenticated user. Remove after root cause is
      // identified.
      if (typeFilter === "overall_rating") {
        try {
          const raw = await db.execute(
            sql`select count(*)::int as c from user_votes where user_id = ${userId}`,
          );
          const rawRows = (raw as any)?.rows?.[0]?.c
            ?? (Array.isArray(raw) ? (raw as any)[0]?.c : undefined)
            ?? raw;
          console.log("[me/votes overall_rating diag]", {
            userId,
            ormRows: ovRatings.length,
            rawRows,
          });
        } catch (diagErr: any) {
          console.log("[me/votes overall_rating diag error]", {
            userId,
            ormRows: ovRatings.length,
            error: diagErr?.message ?? String(diagErr),
          });
        }
      }

      // ---------- Community signal: face_off + trending_poll ----------
      // For the matchups the user voted on, aggregate ALL votes per option so
      // we can flag whether the user's pick matched the crowd's majority.
      const faceOffMatchupIds = Array.from(
        new Set(faceOffVotes.map((v) => v.targetId).filter(Boolean) as string[]),
      );
      const faceOffMajority = new Map<string, string>();
      if (faceOffMatchupIds.length > 0) {
        const tallies = await db
          .select({
            matchupId: votes.targetId,
            option: votes.value,
            c: sql<number>`count(*)::int`,
          })
          .from(votes)
          .where(and(
            eq(votes.voteType, "face_off"),
            inArray(votes.targetId, faceOffMatchupIds),
          ))
          .groupBy(votes.targetId, votes.value);
        const byMatchup = new Map<string, Map<string, number>>();
        for (const row of tallies) {
          if (!row.matchupId || !row.option) continue;
          const m = byMatchup.get(row.matchupId) ?? new Map<string, number>();
          m.set(row.option, (m.get(row.option) ?? 0) + Number(row.c ?? 0));
          byMatchup.set(row.matchupId, m);
        }
        for (const [matchupId, opts] of byMatchup.entries()) {
          let top: string | null = null;
          let topN = -1;
          let tie = false;
          for (const [opt, n] of opts.entries()) {
            if (n > topN) { top = opt; topN = n; tie = false; }
            else if (n === topN) { tie = true; }
          }
          if (top && !tie) faceOffMajority.set(matchupId, top);
        }
      }

      const pollIds = Array.from(
        new Set(pollVotes.map((v) => v.pollId).filter(Boolean) as string[]),
      );
      const pollMajority = new Map<string, string>();
      if (pollIds.length > 0) {
        const tallies = await db
          .select({
            pollId: trendingPollVotes.pollId,
            choice: trendingPollVotes.choice,
            c: sql<number>`count(*)::int`,
          })
          .from(trendingPollVotes)
          .where(inArray(trendingPollVotes.pollId, pollIds))
          .groupBy(trendingPollVotes.pollId, trendingPollVotes.choice);
        // Seed with the curator-provided seed counts so early-stage polls have a majority.
        const byPoll = new Map<string, Map<string, number>>();
        for (const v of pollVotes) {
          if (!v.pollId) continue;
          const m = byPoll.get(v.pollId) ?? new Map<string, number>();
          m.set("support", (m.get("support") ?? 0) + (v.seedSupport ?? 0));
          m.set("oppose", (m.get("oppose") ?? 0) + (v.seedOppose ?? 0));
          m.set("neutral", (m.get("neutral") ?? 0) + (v.seedNeutral ?? 0));
          byPoll.set(v.pollId, m);
        }
        for (const row of tallies) {
          if (!row.pollId || !row.choice) continue;
          const m = byPoll.get(row.pollId) ?? new Map<string, number>();
          m.set(row.choice, (m.get(row.choice) ?? 0) + Number(row.c ?? 0));
          byPoll.set(row.pollId, m);
        }
        for (const [pollId, opts] of byPoll.entries()) {
          let top: string | null = null;
          let topN = -1;
          let tie = false;
          for (const [opt, n] of opts.entries()) {
            if (n > topN) { top = opt; topN = n; tie = false; }
            else if (n === topN && n > 0) { tie = true; }
          }
          if (top && !tie) pollMajority.set(pollId, top);
        }
      }

      const results: UnifiedVote[] = [];

      for (const v of faceOffVotes) {
        const name = v.matchupTitle || (v.optionA && v.optionB ? `${v.optionA} vs ${v.optionB}` : "Matchup");
        const side = v.value === "option_a" ? v.optionA : v.value === "option_b" ? v.optionB : null;
        const majority = v.targetId ? faceOffMajority.get(v.targetId) ?? null : null;
        results.push({
          id: v.id,
          voteType: "face_off",
          value: 1,
          targetName: name,
          detail: side ? `Voted: ${side}` : null,
          createdAt: v.votedAt ?? new Date(),
          hidden: false,
          subjectId: null,
          subjectAvatar: null,
          subjectImageSlug: null,
          alignedWithMajority:
            majority && typeof v.value === "string" ? v.value === majority : null,
        });
      }

      for (const v of sentVotes) {
        const over = Number(v.communityOverratedPct ?? 0);
        const under = Number(v.communityUnderratedPct ?? 0);
        let aligned: boolean | null = null;
        if (over > 0 || under > 0) {
          const majority = over > under ? "overrated" : under > over ? "underrated" : null;
          if (majority) aligned = v.voteType === majority;
        }
        results.push({
          id: v.id,
          voteType: "sentiment",
          value: v.voteType === "overrated" ? -1 : 1,
          targetName: v.personName || "Unknown",
          detail: v.voteType === "overrated" ? "Overrated" : "Underrated",
          createdAt: v.votedAt ?? new Date(),
          hidden: false,
          subjectId: v.personId ?? null,
          subjectAvatar: v.avatar ?? null,
          subjectImageSlug: v.imageSlug ?? null,
          alignedWithMajority: aligned,
        });
      }

      for (const v of valVotes) {
        const label = v.vote === "underrated" ? "Underrated" : v.vote === "overrated" ? "Overrated" : "Fairly Rated";
        const under = Number(v.communityUnderratedPct ?? 0);
        const over = Number(v.communityOverratedPct ?? 0);
        const fair = Number(v.communityFairlyRatedPct ?? 0);
        let aligned: boolean | null = null;
        if (under + over + fair > 0) {
          const pairs: Array<[string, number]> = [
            ["underrated", under],
            ["overrated", over],
            ["fairly_rated", fair],
          ];
          pairs.sort((a, b) => b[1] - a[1]);
          const [top, topN] = pairs[0];
          const [, secondN] = pairs[1];
          if (topN > secondN) aligned = v.vote === top;
        }
        results.push({
          id: v.id,
          voteType: "value_vote",
          value: v.vote === "underrated" ? 1 : v.vote === "overrated" ? -1 : 0,
          targetName: v.personName || "Unknown",
          detail: label,
          createdAt: v.createdAt ?? new Date(),
          hidden: false,
          subjectId: v.personId ?? null,
          subjectAvatar: v.avatar ?? null,
          subjectImageSlug: v.imageSlug ?? null,
          alignedWithMajority: aligned,
        });
      }

      for (const v of pollVotes) {
        const choiceLabel = v.choice === "support" ? "Support" : v.choice === "oppose" ? "Oppose" : "Neutral";
        const majority = v.pollId ? pollMajority.get(v.pollId) ?? null : null;
        results.push({
          id: v.id,
          voteType: "trending_poll",
          value: v.choice === "support" ? 1 : v.choice === "oppose" ? -1 : 0,
          targetName: v.headline || "Poll",
          detail: choiceLabel,
          createdAt: v.createdAt ?? new Date(),
          hidden: false,
          subjectId: null,
          subjectAvatar: null,
          subjectImageSlug: null,
          alignedWithMajority: majority ? v.choice === majority : null,
        });
      }

      for (const v of opVotes) {
        results.push({
          id: v.id,
          voteType: "opinion_poll",
          value: 1,
          targetName: v.pollTitle || "Opinion Poll",
          detail: v.optionName ? `Chose: ${v.optionName}` : null,
          createdAt: v.createdAt ?? new Date(),
          hidden: false,
          subjectId: null,
          subjectAvatar: null,
          subjectImageSlug: null,
          alignedWithMajority: null,
        });
      }

      for (const v of imgVotes) {
        results.push({
          id: v.id,
          voteType: "image_curate",
          value: 1,
          targetName: v.personName || "Unknown",
          detail: "Image upvote",
          createdAt: v.votedAt ?? new Date(),
          hidden: false,
          subjectId: v.personId ?? null,
          subjectAvatar: v.avatar ?? null,
          subjectImageSlug: v.imageSlug ?? null,
          alignedWithMajority: null,
        });
      }

      for (const v of indVotes) {
        results.push({
          id: v.id,
          voteType: "induction",
          value: 1,
          targetName: v.candidateName || "Candidate",
          detail: "Induction vote",
          createdAt: v.votedAt ?? new Date(),
          hidden: false,
          subjectId: null,
          subjectAvatar: null,
          subjectImageSlug: null,
          alignedWithMajority: null,
        });
      }

      for (const v of ovRatings) {
        // 1-5 zone: 1 Hate, 2 Dislike, 3 Neutral, 4 Like, 5 Love.
        const ZONE_LABELS = ["Hate", "Dislike", "Neutral", "Like", "Love"];
        const zoneLabel = ZONE_LABELS[(v.rating ?? 3) - 1] ?? "Neutral";
        const avg = v.communityApprovalAvg != null ? Number(v.communityApprovalAvg) : null;
        // Align if the user's rating rounds to the same zone as the community avg.
        const aligned = avg != null && Number.isFinite(avg)
          ? Math.round(avg) === v.rating
          : null;
        results.push({
          id: v.id,
          voteType: "overall_rating",
          value: v.rating ?? 0,
          targetName: v.personName || "Unknown",
          detail: `Rated ${v.rating}/5 - ${zoneLabel}`,
          createdAt: v.votedAt ?? new Date(),
          hidden: false,
          subjectId: v.personId ?? null,
          subjectAvatar: v.avatar ?? null,
          subjectImageSlug: v.imageSlug ?? null,
          alignedWithMajority: aligned,
        });
      }

      // Annotate with per-item visibility overrides.
      const hiddenSet = await loadHiddenItemSet(userId);
      for (const r of results) {
        const pType = privacyTypeFor(r.voteType);
        if (pType && hiddenSet.has(`${pType}:${r.id}`)) {
          r.hidden = true;
        }
      }

      results.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

      res.json(results.slice(0, 50));
    } catch (error: any) {
      console.error("Error fetching user votes:", error.message);
      res.status(500).json({ error: "Failed to fetch votes" });
    }
  });
  
  // Get user's predictions with stats
  app.get("/api/me/predictions", requireAuth, async (req: AuthRequest, res) => {
    try {
      const userId = req.userId!;

      const [[userProfile], bets] = await Promise.all([
        db.select({ currentStreak: profiles.currentStreak })
          .from(profiles)
          .where(eq(profiles.id, userId))
          .limit(1),
        db.select({
            betId: marketBets.id,
            marketId: marketBets.marketId,
            entryId: marketBets.entryId,
            stakeAmount: marketBets.stakeAmount,
            potentialPayout: marketBets.potentialPayout,
            payoutAmount: marketBets.payoutAmount,
            betStatus: marketBets.status,
            direction: marketBets.direction,
            betCreatedAt: marketBets.createdAt,
            marketSlug: predictionMarkets.slug,
            marketTitle: predictionMarkets.title,
            marketStatus: predictionMarkets.status,
            marketType: predictionMarkets.marketType,
            marketCadence: predictionMarkets.cadence,
            marketCategory: predictionMarkets.category,
            baselineScore: predictionMarkets.baselineScore,
            startAt: predictionMarkets.startAt,
            endAt: predictionMarkets.endAt,
            personId: predictionMarkets.personId,
            resolutionSummary: predictionMarkets.resolutionSummary,
            entryResolutionStatus: marketEntries.resolutionStatus,
            entryLabel: marketEntries.label,
            personName: trendingPeople.name,
            personAvatar: trendingPeople.avatar,
            currentScore: trendingPeople.trendScore,
          })
          .from(marketBets)
          .innerJoin(predictionMarkets, eq(marketBets.marketId, predictionMarkets.id))
          .innerJoin(marketEntries, eq(marketBets.entryId, marketEntries.id))
          .leftJoin(trendingPeople, eq(predictionMarkets.personId, trendingPeople.id))
          .where(and(
            eq(marketBets.userId, userId),
            sql`${predictionMarkets.visibility} NOT IN ('draft', 'hidden')`,
            sql`NOT (${predictionMarkets.visibility} = 'archived' AND ${marketBets.status} = 'active')`,
          ))
          .orderBy(desc(marketBets.createdAt))
          .limit(100),
      ]);

      const hiddenSet = await loadHiddenItemSet(userId);

      const predictions = bets.map(b => {
        let result: 'won' | 'lost' | 'refunded' | 'pending' = 'pending';
        let payout = 0;
        const displayEntryLabel =
          b.marketType === 'community' && b.direction === 'no'
            ? `No on ${b.entryLabel}`
            : b.entryLabel;

        if (b.marketStatus === 'RESOLVED') {
          if (b.betStatus === 'won' || (b.betStatus === 'active' && b.entryResolutionStatus === 'winner')) {
            result = 'won';
            payout = b.payoutAmount ?? b.potentialPayout ?? 0;
          } else if (b.betStatus === 'lost' || b.betStatus === 'active') {
            result = 'lost';
          }
        } else if (b.marketStatus === 'VOID') {
          result = 'refunded';
          payout = b.stakeAmount;
        }

        const isNative = b.marketType !== 'community';

        // Decimal odds at bet time: potentialPayout / stakeAmount.
        // Used client-side to label contrarian (underdog) picks.
        const oddsAtBet =
          b.potentialPayout != null && b.stakeAmount && b.stakeAmount > 0
            ? Number((b.potentialPayout / b.stakeAmount).toFixed(2))
            : null;

        return {
          betId: b.betId,
          marketId: b.marketId,
          marketSlug: b.marketSlug,
          marketTitle: b.marketTitle,
          marketStatus: b.marketStatus,
          marketType: b.marketType,
          marketCadence: isNative ? (b.marketCadence ?? 'weekly') : b.marketCadence,
          marketCategory: b.marketCategory,
          entryLabel: displayEntryLabel,
          stakeAmount: b.stakeAmount,
          potentialPayout: b.potentialPayout,
          oddsAtBet,
          result,
          payout,
          baselineScore: b.baselineScore,
          currentScore: isNative ? b.currentScore : null,
          betCreatedAt: b.betCreatedAt,
          personName: isNative ? b.personName : null,
          personAvatar: isNative ? b.personAvatar : null,
          startAt: b.startAt,
          endAt: b.endAt,
          resolutionSummary: isNative ? b.resolutionSummary ?? null : null,
          hidden: hiddenSet.has(`market_bet:${b.betId}`),
        };
      });

      const won = predictions.filter(p => p.result === 'won').length;
      const lost = predictions.filter(p => p.result === 'lost').length;
      const refunded = predictions.filter(p => p.result === 'refunded').length;
      const pending = predictions.filter(p => p.result === 'pending').length;

      const netCredits = predictions.reduce((sum, p) => {
        if (p.result === 'won') return sum + (p.payout - p.stakeAmount);
        if (p.result === 'lost') return sum - p.stakeAmount;
        return sum;
      }, 0);

      const winRate = (won + lost) > 0
        ? Math.round((won / (won + lost)) * 1000) / 10
        : 0;

      const categoryWins: Record<string, number> = {};
      for (const p of predictions) {
        if (p.result === 'won' && p.marketCategory) {
          categoryWins[p.marketCategory] = (categoryWins[p.marketCategory] || 0) + 1;
        }
      }
      const bestCategory = Object.keys(categoryWins).length > 0
        ? Object.entries(categoryWins).sort((a, b) => b[1] - a[1])[0][0]
        : null;

      res.json({
        predictions,
        stats: {
          total: predictions.length,
          won,
          lost,
          refunded,
          pending,
          netCredits,
          winRate,
          bestCategory,
          currentStreak: userProfile?.currentStreak ?? 0,
        },
      });
    } catch (error: any) {
      console.error("Error fetching user predictions:", error.message);
      res.status(500).json({ error: "Failed to fetch predictions" });
    }
  });
  
  app.get("/api/markets/:id/my-payout", requireAuth, async (req: AuthRequest, res) => {
    try {
      const userId = req.userId!;
      const { id } = req.params;

      const [market] = await db.select({
        id: predictionMarkets.id,
        status: predictionMarkets.status,
      }).from(predictionMarkets).where(eq(predictionMarkets.id, id)).limit(1);

      if (!market) return res.status(404).json({ error: "Market not found" });

      const [winningEntry] = await db.select({ id: marketEntries.id })
        .from(marketEntries)
        .where(and(eq(marketEntries.marketId, id), eq(marketEntries.resolutionStatus, 'winner')))
        .limit(1);

      const allBets = await db.select({
        stakeAmount: marketBets.stakeAmount,
        entryId: marketBets.entryId,
      }).from(marketBets).where(eq(marketBets.marketId, id));

      const myBets = await db.select({
        stakeAmount: marketBets.stakeAmount,
        entryId: marketBets.entryId,
        payoutAmount: marketBets.payoutAmount,
        status: marketBets.status,
      }).from(marketBets).where(and(eq(marketBets.marketId, id), eq(marketBets.userId, userId)));

      if (myBets.length === 0) return res.status(404).json({ error: "No bets found for this market" });

      const totalPool = allBets.reduce((s, b) => s + b.stakeAmount, 0);
      const userStake = myBets.reduce((s, b) => s + b.stakeAmount, 0);
      const userPayout = myBets.reduce((s, b) => s + (b.payoutAmount ?? 0), 0);

      let winnerPoolTotal = 0;
      if (winningEntry) {
        winnerPoolTotal = allBets.filter(b => b.entryId === winningEntry.id).reduce((s, b) => s + b.stakeAmount, 0);
      }

      res.json({
        totalPool,
        userStake,
        winnerPoolTotal,
        userPayout,
        remainderPolicy: 'burned',
      });
    } catch (error: any) {
      console.error("Error fetching user payout:", error.message);
      res.status(500).json({ error: "Failed to fetch payout details" });
    }
  });

  // GET /api/markets/:id/my-position
  //
  // Single source of truth for the "My Position" card on every market
  // detail page (jackpot, updown, h2h, race/gainer, community).
  //
  // Why this exists rather than reusing /api/me/predictions:
  //   - /api/me/predictions returns up to 100 rows across every market
  //     a user has ever touched. The detail page only cares about ONE
  //     market and refreshes after every bet → fetching the entire
  //     history every time is wasteful.
  //   - It doesn't expose betMetadata, so jackpot tickets show up
  //     without their predictedScore — the very piece of data the user
  //     needs to see how close they are.
  //   - Race/gainer detail page calls a non-existent /api/me/bets and
  //     silently 404s; this endpoint replaces that broken contract.
  //
  // Response is shaped to be UI-ready: live currentScore included so
  // we don't need a separate /history round-trip just to render the
  // header. Bets come back newest-first.
  app.get("/api/markets/:id/my-position", requireAuth, async (req: AuthRequest, res) => {
    try {
      const userId = req.userId!;
      const { id } = req.params;

      const [market] = await db
        .select({
          id: predictionMarkets.id,
          marketType: predictionMarkets.marketType,
          status: predictionMarkets.status,
          slug: predictionMarkets.slug,
          title: predictionMarkets.title,
          baselineScore: predictionMarkets.baselineScore,
          startAt: predictionMarkets.startAt,
          endAt: predictionMarkets.endAt,
          closeAt: predictionMarkets.closeAt,
          personId: predictionMarkets.personId,
          tieRule: predictionMarkets.tieRule,
        })
        .from(predictionMarkets)
        .where(eq(predictionMarkets.id, id))
        .limit(1);

      if (!market) return res.status(404).json({ error: "Market not found" });

      // Live trend score for the linked person (when there is one).
      // Many markets are not person-linked (e.g. category races aren't
      // anchored to a single person), so this can legitimately be null.
      let currentScore: number | null = null;
      if (market.personId) {
        const [person] = await db
          .select({ trendScore: trendingPeople.trendScore })
          .from(trendingPeople)
          .where(eq(trendingPeople.id, market.personId))
          .limit(1);
        currentScore = person?.trendScore ?? null;
      }

      // User's ACTIVE bets on this market with entry label and metadata
      // joined in. We deliberately exclude settled rows (won/lost/void)
      // because:
      //   - On an OPEN market every legitimate bet is `active`, so the
      //     filter is a no-op for the common path.
      //   - On a RESOLVED/VOID market the parent page already shows a
      //     dedicated resolution-summary card; surfacing settled rows
      //     here would render a misleading "Your Position" panel
      //     above that summary.
      const myBets = await db
        .select({
          betId: marketBets.id,
          entryId: marketBets.entryId,
          stakeAmount: marketBets.stakeAmount,
          potentialPayout: marketBets.potentialPayout,
          status: marketBets.status,
          direction: marketBets.direction,
          createdAt: marketBets.createdAt,
          settledAt: marketBets.settledAt,
          payoutAmount: marketBets.payoutAmount,
          confidence: marketBets.confidence,
          betMetadata: marketBets.betMetadata,
          entryLabel: marketEntries.label,
          entryPersonId: marketEntries.personId,
          entryDisplayOrder: marketEntries.displayOrder,
          entryResolutionStatus: marketEntries.resolutionStatus,
        })
        .from(marketBets)
        .innerJoin(marketEntries, eq(marketBets.entryId, marketEntries.id))
        .where(
          and(
            eq(marketBets.marketId, id),
            eq(marketBets.userId, userId),
            eq(marketBets.status, "active"),
          ),
        )
        .orderBy(desc(marketBets.createdAt));

      const bets = myBets.map((b) => {
        const meta = (b.betMetadata as Record<string, any> | null) ?? null;
        return {
          betId: b.betId,
          entryId: b.entryId,
          entryLabel: b.entryLabel,
          entryPersonId: b.entryPersonId,
          entryDisplayOrder: b.entryDisplayOrder,
          entryResolutionStatus: b.entryResolutionStatus,
          stakeAmount: b.stakeAmount,
          potentialPayout: b.potentialPayout,
          payoutAmount: b.payoutAmount,
          status: b.status,
          direction: b.direction,
          confidence: b.confidence != null ? Number(b.confidence) : null,
          // Surface predictedScore for jackpot tickets — the prior
          // /api/me/predictions contract dropped this so the UI couldn't
          // show "you predicted 352000, current is 348100, off by 3,900".
          predictedScore: typeof meta?.predictedScore === "number" ? meta.predictedScore : null,
          thesis: typeof meta?.thesis === "string" ? meta.thesis : null,
          placedAt: b.createdAt,
          settledAt: b.settledAt,
        };
      });

      const totalStake = bets.reduce((s, b) => s + (b.stakeAmount ?? 0), 0);

      res.json({
        market: {
          id: market.id,
          marketType: market.marketType,
          status: market.status,
          slug: market.slug,
          title: market.title,
          baselineScore: market.baselineScore,
          startAt: market.startAt,
          endAt: market.endAt,
          closeAt: market.closeAt,
          personId: market.personId,
          tieRule: market.tieRule ?? "refund",
        },
        currentScore,
        totalStake,
        betCount: bets.length,
        bets,
      });
    } catch (error: any) {
      console.error("Error fetching my-position:", error.message);
      res.status(500).json({ error: "Failed to fetch your position" });
    }
  });

  // Get user's favorites
  // NOTE: Favorites CRUD (GET / POST / DELETE /api/me/favorites[/:personId])
  // has been extracted into server/route-modules/favorites-routes.ts
  // (registered above alongside the other route modules).
  
  // ==================
  // Admin Endpoints
  // ==================
  
  // Engine Health Diagnostics - comprehensive snapshot/ingestion health check
  app.get("/api/admin/engine-health", requireAuth, requireAdmin, async (req: AuthRequest, res) => {
    try {
      const now = new Date();
      const h48Ago = new Date(now.getTime() - 48 * 60 * 60 * 1000);
      const h24Ago = new Date(now.getTime() - 24 * 60 * 60 * 1000);

      const hourlyBuckets = await db.execute(sql`
        SELECT 
          date_trunc('hour', timestamp) as hour,
          COUNT(*)::int as count,
          COUNT(DISTINCT person_id)::int as unique_people,
          MAX(snapshot_origin) as origin
        FROM trend_snapshots
        WHERE timestamp > ${h48Ago}
        GROUP BY date_trunc('hour', timestamp)
        ORDER BY hour DESC
      `);

      const latestSnapshotRow = await db.execute(sql`
        SELECT MAX(timestamp) as latest FROM trend_snapshots
      `);
      const latestSnapshot = latestSnapshotRow.rows?.[0]?.latest as string | null;

      const coverageRow = await db.execute(sql`
        SELECT 
          (SELECT COUNT(*)::int FROM tracked_people) as tracked,
          (SELECT COUNT(*)::int FROM trending_people) as trending,
          (SELECT COUNT(*)::int FROM trending_people WHERE fame_index > 0) as with_score
      `);
      const coverage = coverageRow.rows?.[0] || { tracked: 0, trending: 0, with_score: 0 };

      const distRow = await db.execute(sql`
        SELECT 
          MIN(fame_index)::int as min_fame,
          MAX(fame_index)::int as max_fame,
          ROUND(AVG(fame_index))::int as avg_fame,
          ROUND(STDDEV(fame_index))::int as stddev_fame,
          ROUND(PERCENTILE_CONT(0.50) WITHIN GROUP (ORDER BY fame_index))::int as median_fame
        FROM trending_people
        WHERE fame_index > 0
      `);
      const distribution = distRow.rows?.[0] || {};

      const signalRow = await db.execute(sql`
        SELECT 
          SUM(CASE WHEN wiki_pageviews = 0 OR wiki_pageviews IS NULL THEN 1 ELSE 0 END)::int as zero_wiki,
          SUM(CASE WHEN news_count = 0 OR news_count IS NULL THEN 1 ELSE 0 END)::int as zero_news,
          SUM(CASE WHEN search_volume = 0 OR search_volume IS NULL THEN 1 ELSE 0 END)::int as zero_search,
          ROUND(AVG(confidence)::numeric, 2) as avg_confidence,
          COUNT(*)::int as batch_size
        FROM trend_snapshots
        WHERE timestamp = (SELECT MAX(timestamp) FROM trend_snapshots)
      `);
      const signals = signalRow.rows?.[0] || {};

      const zeroNewsRow = await db.execute(sql`
        SELECT tp.name, tp.news_query_widened, tp.search_query_override,
               ts.news_count, tp.id as person_id
        FROM trend_snapshots ts
        JOIN tracked_people tp ON tp.id = ts.person_id
        WHERE ts.timestamp = (SELECT MAX(timestamp) FROM trend_snapshots)
          AND (ts.news_count = 0 OR ts.news_count IS NULL)
        ORDER BY tp.name ASC
      `);
      const zeroNewsPeople = (zeroNewsRow.rows || []).map((r: any) => ({
        personId: r.person_id,
        name: r.name,
        newsQueryWidened: r.news_query_widened || null,
        searchQueryOverride: r.search_query_override || null,
        newsCount: Number(r.news_count ?? 0),
      }));

      const refRow = await db.execute(sql`
        SELECT fetched_at, expires_at
        FROM api_cache 
        WHERE cache_key = 'system:source_stats_reference'
        LIMIT 1
      `);
      const sourceStatsRef = (refRow.rows?.[0] as { fetched_at: string; expires_at: string } | undefined) || null;

      // === BASELINE DIAGNOSTICS ===
      const t24hAgoHealth = new Date(now.getTime() - 24 * 60 * 60 * 1000);
      const t7dAgoHealth = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
      const BASELINE_24H_WINDOW = 6 * 60 * 60 * 1000;
      const BASELINE_7D_WINDOW = 24 * 60 * 60 * 1000;
      
      const [baseline24hRun] = await db
        .select({ id: ingestionRuns.id, finishedAt: ingestionRuns.finishedAt })
        .from(ingestionRuns)
        .where(and(
          eq(ingestionRuns.status, "completed"),
          gt(ingestionRuns.finishedAt, new Date(t24hAgoHealth.getTime() - BASELINE_24H_WINDOW)),
          lt(ingestionRuns.finishedAt, new Date(t24hAgoHealth.getTime() + BASELINE_24H_WINDOW))
        ))
        .orderBy(sql`ABS(EXTRACT(EPOCH FROM ${ingestionRuns.finishedAt} - ${t24hAgoHealth}::timestamp))`)
        .limit(1);
      
      const [baseline7dRun] = await db
        .select({ id: ingestionRuns.id, finishedAt: ingestionRuns.finishedAt })
        .from(ingestionRuns)
        .where(and(
          eq(ingestionRuns.status, "completed"),
          gt(ingestionRuns.finishedAt, new Date(t7dAgoHealth.getTime() - BASELINE_7D_WINDOW)),
          lt(ingestionRuns.finishedAt, new Date(t7dAgoHealth.getTime() + BASELINE_7D_WINDOW))
        ))
        .orderBy(sql`ABS(EXTRACT(EPOCH FROM ${ingestionRuns.finishedAt} - ${t7dAgoHealth}::timestamp))`)
        .limit(1);
      
      const baselineAge24hHours = baseline24hRun?.finishedAt 
        ? Math.round((now.getTime() - new Date(baseline24hRun.finishedAt).getTime()) / (1000 * 60 * 60) * 10) / 10
        : null;
      const baselineAge7dHours = baseline7dRun?.finishedAt
        ? Math.round((now.getTime() - new Date(baseline7dRun.finishedAt).getTime()) / (1000 * 60 * 60) * 10) / 10
        : null;
      
      // Count people missing 24h baseline
      let baselineCoverage24h = 0;
      if (baseline24hRun) {
        const [countRow] = await db
          .select({ cnt: sql<number>`COUNT(DISTINCT ${trendSnapshots.personId})` })
          .from(trendSnapshots)
          .where(eq(trendSnapshots.runId, baseline24hRun.id));
        baselineCoverage24h = Number(countRow?.cnt ?? 0);
      }
      
      // === SYSTEMIC CHANGE ALERT ===
      // Check if >90% of people have 24h changes in the same direction
      const trendingPeopleForAlert = await db
        .select({ change24h: trendingPeople.change24h })
        .from(trendingPeople)
        .where(isNotNull(trendingPeople.change24h));
      
      let positiveCount = 0;
      let negativeCount = 0;
      let totalWithChange = 0;
      for (const p of trendingPeopleForAlert) {
        const c = Number(p.change24h);
        if (c > 0) positiveCount++;
        else if (c < 0) negativeCount++;
        totalWithChange++;
      }
      const positivePct = totalWithChange > 0 ? Math.round(positiveCount / totalWithChange * 100) : 0;
      const negativePct = totalWithChange > 0 ? Math.round(negativeCount / totalWithChange * 100) : 0;
      const systemicChangeAlert = totalWithChange > 10 && (positivePct > 90 || negativePct > 90);

      const pollutedResult = await db.execute(sql`
        SELECT COUNT(*)::int as cnt FROM trend_snapshots WHERE run_id IS NULL
      `);
      const pollutedSnapshotCount = Number((pollutedResult.rows?.[0] as any)?.cnt ?? 0);

      const spotCheckRows = await db.execute(sql`
        SELECT name, fame_index, rank
        FROM trending_people
        ORDER BY RANDOM()
        LIMIT 5
      `);
      const allRanked = await db.execute(sql`
        SELECT name, fame_index, rank
        FROM trending_people
        ORDER BY fame_index DESC NULLS LAST
      `);
      
      let rankOrderCorrect = true;
      let rankIssues: string[] = [];
      const rankedPeople = allRanked.rows || [];
      for (let i = 0; i < rankedPeople.length; i++) {
        const expectedRank = i + 1;
        if (Number(rankedPeople[i].rank) !== expectedRank) {
          rankOrderCorrect = false;
          rankIssues.push(`${rankedPeople[i].name}: has rank ${rankedPeople[i].rank}, expected ${expectedRank}`);
        }
      }

      const buckets = (hourlyBuckets.rows || []).map((r: any) => new Date(r.hour).getTime()).sort((a: number, b: number) => a - b);
      let maxGapMinutes = 0;
      let gapsOver2h = 0;
      const gapDetails: { from: string; to: string; gapMinutes: number }[] = [];
      for (let i = 1; i < buckets.length; i++) {
        const gap = (buckets[i] - buckets[i - 1]) / (1000 * 60);
        if (gap > maxGapMinutes) maxGapMinutes = gap;
        if (gap > 120) {
          gapsOver2h++;
          gapDetails.push({
            from: new Date(buckets[i - 1]).toISOString(),
            to: new Date(buckets[i]).toISOString(),
            gapMinutes: Math.round(gap),
          });
        }
      }

      const backfilledHours = (hourlyBuckets.rows || [])
        .filter((r: any) => Number(r.count) > Number(coverage.tracked || 100))
        .map((r: any) => ({
          hour: new Date(r.hour).toISOString(),
          count: Number(r.count),
          expectedCount: Number(coverage.tracked || 100),
        }));

      const minutesSinceLastSnapshot = latestSnapshot 
        ? Math.round((now.getTime() - new Date(latestSnapshot).getTime()) / (1000 * 60))
        : null;

      // === INGESTION RUNS DATA (from ingestion_runs table) ===
      const recentRunsResult = await db.execute(sql`
        SELECT id, started_at, finished_at, status, hour_bucket,
               snapshots_written, people_processed, error_count, error_summary,
               source_timings, source_statuses, health_summary,
               lock_acquired_at, lock_released_at, heartbeat_at
        FROM ingestion_runs
        ORDER BY started_at DESC
        LIMIT 20
      `);
      const recentRuns = (recentRunsResult.rows || []).map((r: any) => ({
        id: r.id,
        startedAt: r.started_at ? new Date(r.started_at).toISOString() : null,
        finishedAt: r.finished_at ? new Date(r.finished_at).toISOString() : null,
        status: r.status,
        hourBucket: r.hour_bucket ? new Date(r.hour_bucket).toISOString() : null,
        snapshotsWritten: Number(r.snapshots_written || 0),
        peopleProcessed: Number(r.people_processed || 0),
        errorCount: Number(r.error_count || 0),
        errorSummary: r.error_summary,
        sourceTimings: r.source_timings,
        sourceStatuses: r.source_statuses,
        healthSummary: r.health_summary,
        heartbeatAt: r.heartbeat_at ? new Date(r.heartbeat_at).toISOString() : null,
        durationMs: r.started_at && r.finished_at 
          ? new Date(r.finished_at).getTime() - new Date(r.started_at).getTime() 
          : null,
      }));

      // "Last success" surfaces in the FRESHNESS card on the admin dashboard.
      // We require snapshotsWritten > 0 so that short-circuit "completed" rows
      // (e.g. a run that found the hour bucket already populated and exited
      // early) don't get reported as the latest success — which previously
      // caused the timestamp and duration to disagree with the runs list.
      const lastSuccessfulRun = recentRuns.find(
        (r: any) => r.status === "completed" && (r.snapshotsWritten ?? 0) > 0,
      );
      const currentlyRunning = recentRuns.find((r: any) => r.status === "running");

      const runs24hResult = await db.execute(sql`
        SELECT 
          COUNT(*)::int as total_runs,
          COUNT(CASE WHEN status = 'completed' THEN 1 END)::int as completed,
          COUNT(CASE WHEN status = 'failed' THEN 1 END)::int as failed,
          COUNT(CASE WHEN status = 'locked_out' THEN 1 END)::int as locked_out,
          COUNT(CASE WHEN status = 'running' THEN 1 END)::int as currently_running
        FROM ingestion_runs
        WHERE started_at > ${h24Ago}
      `);
      const runs24h = runs24hResult.rows?.[0] || { total_runs: 0, completed: 0, failed: 0, locked_out: 0, currently_running: 0 };

      // Source health from the latest successful run
      const latestSourceTimings = lastSuccessfulRun?.sourceTimings || null;
      const latestSourceStatuses = lastSuccessfulRun?.sourceStatuses || null;

      res.json({
        timestamp: now.toISOString(),
        window: {
          start: h48Ago.toISOString(),
          end: now.toISOString(),
          timezone: "UTC",
        },
        ingestion: {
          lastSnapshotAt: latestSnapshot ? new Date(latestSnapshot).toISOString() : null,
          minutesSinceLastSnapshot,
          status: minutesSinceLastSnapshot !== null 
            ? minutesSinceLastSnapshot < 90 ? "fresh" 
            : minutesSinceLastSnapshot < 180 ? "aging" 
            : "stale"
            : "unknown",
          totalHoursWithData: buckets.length,
          lastSuccessfulFinish: lastSuccessfulRun?.finishedAt || null,
          lastSuccessfulDurationMs: lastSuccessfulRun?.durationMs || null,
          lastSuccessfulSnapshotsWritten: lastSuccessfulRun?.snapshotsWritten ?? null,
          currentlyRunning: !!currentlyRunning,
          currentRunStartedAt: currentlyRunning?.startedAt || null,
          currentRunHeartbeatAt: currentlyRunning?.heartbeatAt || null,
        },
        ingestionRuns: {
          last24h: {
            totalRuns: Number(runs24h.total_runs),
            completed: Number(runs24h.completed),
            failed: Number(runs24h.failed),
            lockedOut: Number(runs24h.locked_out),
            currentlyRunning: Number(runs24h.currently_running),
          },
          recentRuns: recentRuns.slice(0, 10),
        },
        sourceHealth: {
          timings: latestSourceTimings,
          statuses: latestSourceStatuses,
          lastRunHealthSummary: lastSuccessfulRun?.healthSummary || null,
          liveStateMachine: (() => {
            const h = getCurrentHealthSnapshot();
            const fmt = (s: typeof h.news) => ({
              state: s.state,
              consecutiveFailures: s.consecutiveFailures,
              lastHealthyAt: s.lastHealthyTimestamp?.toISOString() ?? null,
              staleHours: s.lastHealthyTimestamp
                ? Math.round((now.getTime() - s.lastHealthyTimestamp.getTime()) / (1000 * 60 * 60) * 10) / 10
                : null,
              decayFactor: Math.round(getStalenessDecayFactor(s.lastHealthyTimestamp) * 100),
              coveragePct: s.prevCoveragePct ?? null,
              coverageDropRuns: s.coverageDropRuns ?? 0,
              consecutiveRecoveryRuns: s.consecutiveRecoveryRuns ?? 0,
              reason: s.reason,
            });
            const runMeta = getLastRunMeta();
            return {
              news: fmt(h.news), search: fmt(h.search), wiki: fmt(h.wiki),
              lastRun: runMeta ? {
                runId: runMeta.runId ?? null,
                newsProviderUsed: runMeta.newsProviderUsed,
                newsFreshCoveragePct: Math.round(runMeta.newsFreshCoveragePct),
                searchFreshCoveragePct: Math.round(runMeta.searchFreshCoveragePct),
                newsFreshnessGovernor: Math.round(runMeta.newsGovernorFactor * 100),
                searchFreshnessGovernor: Math.round(runMeta.searchGovernorFactor * 100),
                newsMedianArticles: runMeta.newsMedianArticles,
                newsMeanArticles: runMeta.newsMeanArticles,
                newsQualityLow: runMeta.newsQualityLow,
                finishedAt: runMeta.finishedAt instanceof Date ? runMeta.finishedAt.toISOString() : String(runMeta.finishedAt),
                mediastackSuccessPct: runMeta.mediastackSuccessPct != null ? Math.round(runMeta.mediastackSuccessPct) : null,
                mediastackNonZeroPct: runMeta.mediastackNonZeroPct != null ? Math.round(runMeta.mediastackNonZeroPct) : null,
                mediastackTop25NonZeroPct: runMeta.mediastackTop25NonZeroPct != null ? Math.round(runMeta.mediastackTop25NonZeroPct) : null,
                mediastackIsRefresh: runMeta.mediastackIsRefresh ?? null,
                mediastackLastFetchAt: runMeta.mediastackLastFetchAt ?? null,
                perPersonFallback: runMeta.perPersonFallback ?? null,
              } : null,
            };
          })(),
        },
        mediastackBudget: await (async () => {
          try {
            return await getMediastackBudgetSummary();
          } catch (err) {
            return { error: "Failed to fetch budget summary" };
          }
        })(),
        coverage: {
          trackedPeople: Number(coverage.tracked),
          trendingPeople: Number(coverage.trending),
          withFameScore: Number(coverage.with_score),
          allHaveScores: Number(coverage.trending) === Number(coverage.with_score),
        },
        staleness: {
          ageMinutes: minutesSinceLastSnapshot,
          isStale: minutesSinceLastSnapshot !== null && minutesSinceLastSnapshot >= 120,
          isCritical: minutesSinceLastSnapshot !== null && minutesSinceLastSnapshot >= 240,
          latestSnapshotAt: latestSnapshot ? new Date(latestSnapshot).toISOString() : null,
        },
        gaps: {
          maxGapMinutes: Math.round(maxGapMinutes),
          gapsOver2hCount: gapsOver2h,
          gapDetails: gapDetails.slice(0, 5),
        },
        backfill: {
          backfilledHoursCount: backfilledHours.length,
          backfilledHours: backfilledHours.slice(0, 5),
        },
        fameDistribution: {
          min: Number(distribution.min_fame || 0),
          max: Number(distribution.max_fame || 0),
          average: Number(distribution.avg_fame || 0),
          median: Number(distribution.median_fame || 0),
          stddev: Number(distribution.stddev_fame || 0),
        },
        signalQuality: {
          batchSize: Number(signals.batch_size || 0),
          zeroWiki: Number(signals.zero_wiki || 0),
          zeroNews: Number(signals.zero_news || 0),
          zeroSearch: Number(signals.zero_search || 0),
          avgConfidence: Number(signals.avg_confidence || 0),
        },
        zeroNewsPeople,
        sourceStatsReference: sourceStatsRef ? {
          lastComputed: new Date(sourceStatsRef.fetched_at).toISOString(),
          expiresAt: new Date(sourceStatsRef.expires_at).toISOString(),
          minutesSinceComputed: Math.round((now.getTime() - new Date(sourceStatsRef.fetched_at).getTime()) / (1000 * 60)),
        } : null,
        rankIntegrity: {
          isCorrect: rankOrderCorrect,
          issueCount: rankIssues.length,
          issues: rankIssues.slice(0, 5),
        },
        baselineDiagnostics: {
          baseline24h: {
            runId: baseline24hRun?.id ?? null,
            finishedAt: baseline24hRun?.finishedAt ? new Date(baseline24hRun.finishedAt).toISOString() : null,
            ageHours: baselineAge24hHours,
            status: baseline24hRun ? "normal" : "degraded",
            snapshotCoverage: baselineCoverage24h,
          },
          baseline7d: {
            runId: baseline7dRun?.id ?? null,
            finishedAt: baseline7dRun?.finishedAt ? new Date(baseline7dRun.finishedAt).toISOString() : null,
            ageHours: baselineAge7dHours,
            status: baseline7dRun ? "normal" : "degraded",
          },
          currentRunId: lastSuccessfulRun?.id ?? null,
          pollutedSnapshots: pollutedSnapshotCount,
        },
        systemicChangeAlert: {
          alert: systemicChangeAlert,
          message: systemicChangeAlert 
            ? `WARNING: ${positivePct > 90 ? positivePct + '% positive' : negativePct + '% negative'} — baseline likely wrong or ingestion gap`
            : "OK — changes are distributed normally",
          breakdown: {
            totalWithChange: totalWithChange,
            positiveCount,
            negativeCount,
            positivePct,
            negativePct,
          },
        },
        persistedInstrumentation: await (async () => {
          try {
            const systemKeys = await db.select({
              cacheKey: apiCache.cacheKey,
              responseData: apiCache.responseData,
              fetchedAt: apiCache.fetchedAt,
            }).from(apiCache).where(
              inArray(apiCache.cacheKey, [
                'system:lastRunMeta',
                'system:healthSummary',
                'system:source_health_state',
              ])
            );
            const result: Record<string, any> = {};
            for (const row of systemKeys) {
              try {
                result[row.cacheKey] = {
                  data: JSON.parse(row.responseData),
                  persistedAt: row.fetchedAt ? new Date(row.fetchedAt).toISOString() : null,
                };
              } catch {
                result[row.cacheKey] = { data: null, error: "parse_failed", persistedAt: row.fetchedAt ? new Date(row.fetchedAt).toISOString() : null };
              }
            }
            const expectedKeys = ['system:lastRunMeta', 'system:healthSummary', 'system:source_health_state'];
            for (const k of expectedKeys) {
              if (!result[k]) result[k] = { data: null, status: "missing" };
            }
            return result;
          } catch (err) {
            return { error: "Failed to query persisted instrumentation" };
          }
        })(),
        spotCheck: (spotCheckRows.rows || []).map((r: any) => ({
          name: r.name,
          fameIndex: Number(r.fame_index),
          rank: Number(r.rank),
        })),
        hourlyBreakdown: (hourlyBuckets.rows || []).slice(0, 24).map((r: any) => ({
          hour: new Date(r.hour).toISOString(),
          snapshotCount: Number(r.count),
          uniquePeople: Number(r.unique_people),
          origin: r.origin,
        })),
        rankChurn: await (async () => {
          try {
            const churnRows = await db.execute(sql`
              WITH hourly_latest AS (
                SELECT 
                  ts.person_id,
                  date_trunc('hour', ts.timestamp) as hour,
                  ts.fame_index,
                  ROW_NUMBER() OVER (
                    PARTITION BY ts.person_id, date_trunc('hour', ts.timestamp)
                    ORDER BY ts.timestamp DESC
                  ) as rn
                FROM trend_snapshots ts
                WHERE ts.timestamp > ${h48Ago}
              ),
              deduped AS (
                SELECT person_id, hour, fame_index FROM hourly_latest WHERE rn = 1
              ),
              hours_list AS (
                SELECT DISTINCT hour FROM deduped ORDER BY hour
              ),
              hour_pairs AS (
                SELECT 
                  h.hour as current_hour,
                  LAG(h.hour) OVER (ORDER BY h.hour) as prev_hour
                FROM hours_list h
              ),
              cohort_ranked AS (
                SELECT 
                  hp.current_hour as hour,
                  cur.person_id,
                  cur.fame_index as current_fame,
                  prev.fame_index as prev_fame,
                  RANK() OVER (PARTITION BY hp.current_hour ORDER BY cur.fame_index DESC) as current_rank,
                  RANK() OVER (PARTITION BY hp.current_hour ORDER BY prev.fame_index DESC) as prev_rank,
                  -- IMPORTANT: cast to numeric to avoid integer division truncating to 0
                  CASE WHEN prev.fame_index > 0 
                    THEN ROUND(((cur.fame_index::numeric - prev.fame_index::numeric) / prev.fame_index::numeric * 100), 4)
                    ELSE NULL END as pct_change
                FROM hour_pairs hp
                INNER JOIN deduped cur ON cur.hour = hp.current_hour
                INNER JOIN deduped prev ON prev.hour = hp.prev_hour AND prev.person_id = cur.person_id
                WHERE hp.prev_hour IS NOT NULL
              )
              SELECT 
                hour,
                COUNT(*)::int as cohort_size,
                COUNT(CASE WHEN current_rank != prev_rank THEN 1 END)::int as rank_changes,
                ROUND(AVG(ABS(current_rank - prev_rank))::numeric, 2) as avg_rank_move,
                MAX(ABS(current_rank - prev_rank))::int as max_rank_move,
                ROUND(MIN(pct_change) FILTER (WHERE pct_change IS NOT NULL)::numeric, 4) as min_pct_change,
                ROUND(PERCENTILE_CONT(0.1) WITHIN GROUP (ORDER BY pct_change) FILTER (WHERE pct_change IS NOT NULL)::numeric, 4) as p10_pct_change,
                ROUND(PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY pct_change) FILTER (WHERE pct_change IS NOT NULL)::numeric, 4) as median_pct_change,
                ROUND(PERCENTILE_CONT(0.9) WITHIN GROUP (ORDER BY pct_change) FILTER (WHERE pct_change IS NOT NULL)::numeric, 4) as p90_pct_change,
                ROUND(MAX(pct_change) FILTER (WHERE pct_change IS NOT NULL)::numeric, 4) as max_pct_change,
                ROUND(STDDEV(pct_change) FILTER (WHERE pct_change IS NOT NULL)::numeric, 4) as score_volatility_stddev,
                COUNT(CASE WHEN ABS(pct_change) > 5 THEN 1 END)::int as big_movers_5pct,
                COUNT(CASE WHEN ABS(pct_change) > 0.5 OR ABS(current_rank - prev_rank) >= 3 THEN 1 END)::int as meaningful_changes,
                COUNT(CASE WHEN current_rank != prev_rank AND ABS(pct_change) <= 0.5 AND ABS(current_rank - prev_rank) < 3 THEN 1 END)::int as noise_shuffles,
                COUNT(CASE WHEN ABS(pct_change) >= 2 THEN 1 END)::int as movers_2pct
              FROM cohort_ranked
              GROUP BY hour
              ORDER BY hour DESC
              LIMIT 48
            `);
            return (churnRows.rows || []).map((r: any) => ({
              hour: new Date(r.hour).toISOString(),
              cohortSize: Number(r.cohort_size),
              rankChanges: Number(r.rank_changes),
              avgRankMove: Number(r.avg_rank_move) || 0,
              maxRankMove: Number(r.max_rank_move) || 0,
              minPctChange: Number(r.min_pct_change) || 0,
              p10PctChange: Number(r.p10_pct_change) || 0,
              medianPctChange: Number(r.median_pct_change) || 0,
              p90PctChange: Number(r.p90_pct_change) || 0,
              maxPctChange: Number(r.max_pct_change) || 0,
              scoreVolatilityStddev: Number(r.score_volatility_stddev) || 0,
              bigMovers5pct: Number(r.big_movers_5pct) || 0,
              meaningfulChanges: Number(r.meaningful_changes) || 0,
              noiseShuffles: Number(r.noise_shuffles) || 0,
              movers2pct: Number(r.movers_2pct) || 0,
            }));
          } catch (err) {
            return { error: "Failed to compute rank churn" };
          }
        })(),
        marketResolver: await (async () => {
          try {
            const { getResolverStats } = await import("./jobs/market-resolver");
            const stats = getResolverStats();
            const statusCounts = await db.execute(sql`
              SELECT status, COUNT(*)::int as count
              FROM prediction_markets
              GROUP BY status
            `);
            const byStatus: Record<string, number> = {};
            for (const row of (statusCounts.rows || [])) {
              byStatus[String(row.status)] = Number(row.count);
            }
            return { ...stats, marketsByStatus: byStatus };
          } catch {
            return { error: "Failed to load resolver stats" };
          }
        })(),
        // Scoring engine was simplified to a single raw-math path (mass * 0.40
        // + velocity * 0.60). Smoothing modes, EMA, rate limiting, catch-up,
        // recalibration, spike detection, anti-spam damping, velocity taper,
        // diversity multiplier, wiki-lag mute, and outage weight redistribution
        // were all removed. `smoothingMode: "off"` is the only value now and
        // is kept for client compatibility.
        engineModes: {
          smoothingMode: "off",
          newsAggregationMode: getNewsAggregationMode(),
          newsAggregationFlippedAt: getNewsAggregationFlippedAt()?.toISOString() ?? null,
          ingestIntervalMinutes: (() => {
            const raw = parseInt(process.env.INGEST_INTERVAL_MINUTES ?? "60", 10);
            const allowed = [5, 10, 15, 20, 30, 60];
            return allowed.includes(raw) ? raw : 60;
          })(),
          mediastackRefreshIntervalMinutes: getMediastackRefreshIntervalMinutes(),
          rollingWindowDaysBaseline: getRollingWindowDaysBaseline(),
          rollingWindowDaysNews: getRollingWindowDaysNews(),
          diagnosticsVerbose: (process.env.DIAGNOSTICS_VERBOSE ?? "true").trim().toLowerCase() !== "false",
        },
      });
    } catch (error: any) {
      console.error("Error fetching engine health:", error.message);
      res.status(500).json({ error: "Failed to fetch engine health diagnostics" });
    }
  });

  // Manual source-stats refresh — busts the 1-hour in-memory cache and recomputes
  // percentiles from the current 14-day window (and post-flip window for news).
  // Useful right after flipping NEWS_AGGREGATION_FLIPPED_AT on Railway so the
  // momentum thresholds reflect the new cutoff immediately instead of waiting
  // up to an hour for the next natural refresh.
  app.post("/api/admin/source-stats/refresh", requireAuth, requireAdmin, async (_req: AuthRequest, res) => {
    try {
      const stats = await refreshSourceStats();
      res.json({
        ok: true,
        refreshedAt: new Date().toISOString(),
        newsAggregationFlippedAt: getNewsAggregationFlippedAt()?.toISOString() ?? null,
        stats: {
          wiki: { count: stats.wiki.count, p25: stats.wiki.p25, p50: stats.wiki.p50, p75: stats.wiki.p75 },
          news: { count: stats.news.count, p25: stats.news.p25, p50: stats.news.p50, p75: stats.news.p75 },
          search: { count: stats.search.count, p25: stats.search.p25, p50: stats.search.p50, p75: stats.search.p75 },
        },
      });
    } catch (error: any) {
      console.error("[Source Stats Refresh] Error:", error?.message ?? error);
      res.status(500).json({ error: "Failed to refresh source stats" });
    }
  });

  // Score audit endpoint - per-person component breakdown for debugging
  app.get("/api/admin/score-audit/:personId", requireAuth, requireAdmin, async (req: AuthRequest, res) => {
    try {
      const { personId } = req.params;

      // days = how many days of history to pull for the inspector; default 2
      // (48 hourly ticks). Clamped [1, 14] to keep the payload small. Also
      // drives the minimum snapshot count the UI can render as sparklines.
      const rawDays = parseInt(String(req.query.days ?? "2"), 10);
      const days = Number.isFinite(rawDays) && rawDays >= 1 && rawDays <= 14 ? rawDays : 2;
      const snapshotLimit = days * 24 + 6; // a bit of headroom for live-tick rows

      const person = await db.select().from(trackedPeople).where(eq(trackedPeople.id, personId)).limit(1);
      if (person.length === 0) {
        return res.status(404).json({ error: "Person not found" });
      }

      const trendingEntry = await db.select().from(trendingPeople).where(eq(trendingPeople.name, person[0].name)).limit(1);

      const snapshots = await db.select().from(trendSnapshots)
        .where(eq(trendSnapshots.personId, personId))
        .orderBy(desc(trendSnapshots.timestamp), desc(trendSnapshots.id))
        .limit(snapshotLimit);

      const healthSnapshot = getCurrentHealthSnapshot();

      // Pull the live rolling percentiles so the UI can show baseline context
      // ("this news count is above/below the market-wide median") next to each
      // raw value. Cheap — in-memory cached in sourceStats.ts.
      const sourceStats = await getSourceStats();

      const snapshotBreakdown = snapshots.map(s => {
        let diag: Record<string, any> | null = null;
        try {
          diag = typeof s.diagnostics === 'string' ? JSON.parse(s.diagnostics) : (s.diagnostics as Record<string, any>);
        } catch { /* malformed diagnostics */ }
        return {
          timestamp: s.timestamp,
          runId: s.runId,
          rawValues: {
            wikiPageviews: s.wikiPageviews,
            newsCount: s.newsCount,
            searchVolume: s.searchVolume,
            wiki7dAvg: diag?.raw?.wiki7d ?? null,
          },
          scores: {
            massScore: s.massScore,
            velocityScore: s.velocityScore,
            velocityAdjusted: s.velocityAdjusted,
            trendScore: s.trendScore,
            fameIndex: s.fameIndex,
          },
          freshness: diag?.fresh ?? null,
          stabilization: diag?.stab ?? null,
          momentum: s.momentum,
          confidence: s.confidence,
          diversityMultiplier: s.diversityMultiplier,
          snapshotOrigin: s.snapshotOrigin,
          diagnostics: diag,
        };
      });

      res.json({
        person: {
          id: person[0].id,
          name: person[0].name,
          category: person[0].category,
          wikiSlug: person[0].wikiSlug,
          searchQueryOverride: person[0].searchQueryOverride,
        },
        currentRanking: trendingEntry.length > 0 ? {
          fameIndex: trendingEntry[0].fameIndex,
          fameIndexLive: trendingEntry[0].fameIndexLive,
          rank: trendingEntry[0].rank,
          liveRank: trendingEntry[0].liveRank,
          change24h: trendingEntry[0].change24h,
          change7d: trendingEntry[0].change7d,
          trendScore: trendingEntry[0].trendScore,
        } : null,
        sourceStats: {
          wiki: sourceStats.wiki,
          news: sourceStats.news,
          search: sourceStats.search,
        },
        sourceHealth: {
          news: {
            state: healthSnapshot.news.state,
            lastHealthyTimestamp: healthSnapshot.news.lastHealthyTimestamp,
            consecutiveFailures: healthSnapshot.news.consecutiveFailures,
            reason: healthSnapshot.news.reason,
          },
          search: {
            state: healthSnapshot.search.state,
            lastHealthyTimestamp: healthSnapshot.search.lastHealthyTimestamp,
            consecutiveFailures: healthSnapshot.search.consecutiveFailures,
            reason: healthSnapshot.search.reason,
          },
          wiki: {
            state: healthSnapshot.wiki.state,
            lastHealthyTimestamp: healthSnapshot.wiki.lastHealthyTimestamp,
            consecutiveFailures: healthSnapshot.wiki.consecutiveFailures,
            reason: healthSnapshot.wiki.reason,
          },
        },
        weightConfig: {
          massAllocation: 0.40,
          velocityAllocation: 0.60,
          velocityWeights: { wiki: PLATFORM_WEIGHTS.velocity.wiki, news: PLATFORM_WEIGHTS.velocity.news, search: PLATFORM_WEIGHTS.velocity.search, x: 0 },
          wikiVelocityBlend: "0.6*24h + 0.4*7d_avg",
          asymmetricCaps: "up=base, down=base*1.5",
          asymmetricEma: "down_alpha=base*1.5",
        },
        // Renamed from last10Snapshots; kept as alias for backward compat
        last10Snapshots: snapshotBreakdown,
        recentSnapshots: snapshotBreakdown,
        requestedDays: days,
        auditTimestamp: new Date().toISOString(),
      });
    } catch (error) {
      console.error("[Score Audit] Error:", error);
      res.status(500).json({ error: "Failed to generate score audit" });
    }
  });

  // Typeahead-style people search for the admin Score Inspector.
  // Case-insensitive prefix/substring match on tracked_people.name, capped to
  // 10 results. No auth beyond admin.
  app.get("/api/admin/people-search", requireAuth, requireAdmin, async (req: AuthRequest, res) => {
    try {
      const q = String(req.query.q ?? "").trim();
      if (q.length < 2) {
        return res.json({ query: q, results: [] });
      }
      const like = `%${q.replace(/[%_]/g, "\\$&")}%`;
      const rows = await db.execute(sql`
        SELECT tp.id, tp.name, tp.category, tp.avatar, tp.image_slug,
               trp.rank, trp.fame_index
        FROM tracked_people tp
        LEFT JOIN trending_people trp ON trp.name = tp.name
        WHERE tp.name ILIKE ${like}
        ORDER BY
          CASE WHEN LOWER(tp.name) LIKE LOWER(${q + "%"}) THEN 0 ELSE 1 END,
          trp.rank ASC NULLS LAST,
          tp.name ASC
        LIMIT 10
      `);
      const results = (rows.rows || []).map((r: any) => ({
        id: r.id,
        name: r.name,
        category: r.category,
        avatar: r.avatar || r.image_slug || null,
        rank: r.rank != null ? Number(r.rank) : null,
        fameIndex: r.fame_index != null ? Number(r.fame_index) : null,
      }));
      res.json({ query: q, results });
    } catch (error: any) {
      console.error("[People Search] Error:", error);
      res.status(500).json({ error: error?.message || "Failed to search people" });
    }
  });

  // Leaderboard diff: compare the top-N right now against the top-N from
  // `hours` ago (default 24). Joins current trending_people vs the closest
  // snapshot to now-hours for each person (within a ±2h window so we don't
  // mis-match a different day's tick). Returns movement flags the UI can
  // render as arrows: "new" (wasn't in top N), "dropped" (left top N),
  // "up"/"down"/"same".
  app.get("/api/admin/leaderboard-diff", requireAuth, requireAdmin, async (req: AuthRequest, res) => {
    try {
      const rawHours = parseInt(String(req.query.hours ?? "24"), 10);
      const hours = Number.isFinite(rawHours) && rawHours >= 1 && rawHours <= 168 ? rawHours : 24;
      const rawLimit = parseInt(String(req.query.limit ?? "20"), 10);
      const limit = Number.isFinite(rawLimit) && rawLimit >= 5 && rawLimit <= 50 ? rawLimit : 20;
      // Match window: snapshots within ±this many hours of the target time
      // count as "at N hours ago". 2h balances tolerance for occasional gaps
      // against accidentally matching an adjacent day.
      const matchWindowHours = 2;

      // For each person, pick their snapshot closest to (now - hours), compute
      // the rank those fame_indexes would have produced at that time, then
      // join against current trending_people. Using a CTE with ROW_NUMBER on
      // abs-time-delta picks the single closest snapshot per person.
      const result = await db.execute(sql`
        WITH target AS (
          SELECT (NOW() - (${hours} || ' hours')::interval) AS t
        ),
        closest AS (
          SELECT
            ts.person_id,
            ts.fame_index,
            ROW_NUMBER() OVER (
              PARTITION BY ts.person_id
              ORDER BY ABS(EXTRACT(EPOCH FROM ts.timestamp - (SELECT t FROM target)))
            ) AS rn
          FROM trend_snapshots ts, target
          WHERE ts.timestamp BETWEEN target.t - (${matchWindowHours} || ' hours')::interval
                                 AND target.t + (${matchWindowHours} || ' hours')::interval
            AND ts.snapshot_origin = 'ingest'
            AND ts.fame_index IS NOT NULL
        ),
        previous_ranked AS (
          SELECT
            person_id,
            fame_index AS prev_fame,
            ROW_NUMBER() OVER (ORDER BY fame_index DESC) AS prev_rank
          FROM closest WHERE rn = 1
        ),
        current_top AS (
          SELECT tp.id AS person_id, trp.name, trp.category, trp.avatar,
                 trp.rank AS current_rank, trp.fame_index AS current_fame,
                 trp.change_24h
          FROM trending_people trp
          LEFT JOIN tracked_people tp ON tp.name = trp.name
          WHERE trp.rank <= ${limit}
          ORDER BY trp.rank ASC
        ),
        previous_top AS (
          SELECT pr.person_id, pr.prev_fame, pr.prev_rank, tp.name, tp.category, tp.avatar
          FROM previous_ranked pr
          JOIN tracked_people tp ON tp.id = pr.person_id
          WHERE pr.prev_rank <= ${limit}
        )
        SELECT
          'current' AS which,
          ct.person_id, ct.name, ct.category, ct.avatar,
          ct.current_rank, ct.current_fame, ct.change_24h,
          pr.prev_rank, pr.prev_fame
        FROM current_top ct
        LEFT JOIN previous_ranked pr ON pr.person_id = ct.person_id
        UNION ALL
        SELECT
          'dropped' AS which,
          pt.person_id, pt.name, pt.category, pt.avatar,
          NULL AS current_rank, NULL AS current_fame, NULL AS change_24h,
          pt.prev_rank, pt.prev_fame
        FROM previous_top pt
        LEFT JOIN current_top ct ON ct.person_id = pt.person_id
        WHERE ct.person_id IS NULL
        ORDER BY which ASC, current_rank ASC NULLS LAST, prev_rank ASC NULLS LAST
      `);

      // Stats about the match window quality — lets the UI warn if we couldn't
      // find a snapshot near target time (e.g. first day of operation or
      // after a long ingest outage).
      const matchStatsRow = await db.execute(sql`
        WITH target AS (SELECT (NOW() - (${hours} || ' hours')::interval) AS t)
        SELECT
          COUNT(*)::int AS total_people,
          SUM(CASE WHEN exists_then THEN 1 ELSE 0 END)::int AS matched_people
        FROM (
          SELECT trp.name,
                 EXISTS (
                   SELECT 1 FROM trend_snapshots ts
                   JOIN tracked_people tp ON tp.id = ts.person_id
                   WHERE tp.name = trp.name
                     AND ts.timestamp BETWEEN (SELECT t FROM target) - (${matchWindowHours} || ' hours')::interval
                                          AND (SELECT t FROM target) + (${matchWindowHours} || ' hours')::interval
                     AND ts.snapshot_origin = 'ingest'
                 ) AS exists_then
          FROM trending_people trp
          WHERE trp.rank <= ${limit}
        ) x
      `);
      const matchStats = (matchStatsRow.rows?.[0] ?? {}) as Record<string, number>;

      const rows = (result.rows || []).map((r: any) => {
        const currentRank = r.current_rank != null ? Number(r.current_rank) : null;
        const prevRank = r.prev_rank != null ? Number(r.prev_rank) : null;
        let status: "new" | "dropped" | "up" | "down" | "same";
        let rankDelta: number | null = null;
        if (currentRank == null) {
          status = "dropped";
        } else if (prevRank == null) {
          status = "new";
        } else {
          rankDelta = prevRank - currentRank; // positive = moved up
          if (rankDelta > 0) status = "up";
          else if (rankDelta < 0) status = "down";
          else status = "same";
        }
        return {
          personId: r.person_id,
          name: r.name,
          category: r.category,
          avatar: r.avatar,
          currentRank,
          currentFameIndex: r.current_fame != null ? Number(r.current_fame) : null,
          change24h: r.change_24h != null ? Number(r.change_24h) : null,
          previousRank: prevRank,
          previousFameIndex: r.prev_fame != null ? Number(r.prev_fame) : null,
          rankDelta,
          fameIndexDelta:
            r.current_fame != null && r.prev_fame != null
              ? Number(r.current_fame) - Number(r.prev_fame)
              : null,
          status,
        };
      });

      res.json({
        hoursAgo: hours,
        limit,
        matchWindowHours,
        coverage: {
          totalPeople: Number(matchStats.total_people ?? 0),
          matchedPeople: Number(matchStats.matched_people ?? 0),
        },
        rows,
        computedAt: new Date().toISOString(),
      });
    } catch (error: any) {
      console.error("[Leaderboard Diff] Error:", error);
      res.status(500).json({ error: error?.message || "Failed to compute leaderboard diff" });
    }
  });

  // Upstream provider health — currently just Serper; extensible to Wiki/GDELT/X later.
  // Used by admins to verify after a top-up/outage that the provider is back online
  // without having to visit the provider's dashboard or scrape logs.
  app.get("/api/admin/providers/health", requireAuth, requireAdmin, async (_req: AuthRequest, res) => {
    try {
      const degraded = getSerperDegradedState();
      res.json({
        serper: {
          status: degraded ? "degraded" : "ok",
          reason: degraded?.reason ?? null,
          since: degraded?.since ?? null,
          lastStatus: degraded?.lastStatus ?? null,
          lastDetail: degraded?.lastDetail ?? null,
          stats: getSerperRunStats(),
        },
        checkedAt: new Date().toISOString(),
      });
    } catch (error: any) {
      console.error("[Providers Health] Error:", error);
      res.status(500).json({ error: "Failed to load provider health" });
    }
  });

  // Get admin stats
  app.get("/api/admin/stats", requireAuth, requireAdmin, async (req: AuthRequest, res) => {
    try {
      // Get counts
      const [usersCount] = await db.select({ count: sql<number>`count(*)` }).from(profiles);
      const [celebritiesCount] = await db.select({ count: sql<number>`count(*)` }).from(trackedPeople);
      const [votesCount] = await db.select({ count: sql<number>`count(*)` }).from(votes);
      
      res.json({
        totalUsers: Number(usersCount?.count || 0),
        totalCelebrities: Number(celebritiesCount?.count || 0),
        totalVotes: Number(votesCount?.count || 0),
        totalPredictions: 0,
        lastDataRefresh: null,
      });
    } catch (error: any) {
      console.error("Error fetching admin stats:", error.message);
      res.status(500).json({ error: "Failed to fetch stats" });
    }
  });

  // Get traffic stats for admin dashboard
  app.get("/api/admin/traffic", requireAuth, requireAdmin, async (req: AuthRequest, res) => {
    try {
      const now = new Date();
      const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      const sevenDaysAgo = new Date(today.getTime() - 7 * 24 * 60 * 60 * 1000);
      const thirtyDaysAgo = new Date(today.getTime() - 30 * 24 * 60 * 60 * 1000);
      
      // Single aggregated query for all counts (more efficient than multiple queries)
      const [stats] = await db.select({
        total: sql<number>`count(*)`,
        today: sql<number>`count(*) FILTER (WHERE ${pageViews.createdAt} >= ${today})`,
        last7Days: sql<number>`count(*) FILTER (WHERE ${pageViews.createdAt} >= ${sevenDaysAgo})`,
        last30Days: sql<number>`count(*) FILTER (WHERE ${pageViews.createdAt} >= ${thirtyDaysAgo})`,
      }).from(pageViews);
      
      // Top pages (last 7 days) - separate query with limit
      const topPages = await db.select({
        path: pageViews.path,
        views: sql<number>`count(*)`,
      })
        .from(pageViews)
        .where(gte(pageViews.createdAt, sevenDaysAgo))
        .groupBy(pageViews.path)
        .orderBy(sql`count(*) DESC`)
        .limit(5);

      // Top countries (last 30 days)
      let topCountries: Array<{ country: string | null; views: number }> = [];
      try {
        topCountries = await db.select({
          country: pageViews.country,
          views: sql<number>`count(*)`,
        })
          .from(pageViews)
          .where(and(
            gte(pageViews.createdAt, thirtyDaysAgo),
            isNotNull(pageViews.country),
          ))
          .groupBy(pageViews.country)
          .orderBy(sql`count(*) DESC`)
          .limit(10);
      } catch (countryError: any) {
        const code = String(countryError?.code ?? "");
        const message = String(countryError?.message ?? "");
        const missingCountryColumn = code === "42703" || /column\s+"?country"?\s+does not exist/i.test(message);
        if (!missingCountryColumn) throw countryError;
        console.warn("[/api/admin/traffic] country column missing on page_views; returning empty topCountries until migration is applied");
      }
      
      res.json({
        total: Number(stats?.total || 0),
        today: Number(stats?.today || 0),
        last7Days: Number(stats?.last7Days || 0),
        last30Days: Number(stats?.last30Days || 0),
        topPages: topPages.map(p => ({ path: p.path, views: Number(p.views) })),
        topCountries: topCountries.map(c => ({ country: c.country, views: Number(c.views) })),
      });
    } catch (error: any) {
      console.error("Error fetching traffic stats:", error.message);
      res.status(500).json({ error: "Failed to fetch traffic stats" });
    }
  });

  const ADMIN_CATEGORY_ID_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

  // Registry of canonical category ids (admin-managed; see content_categories migration).
  app.get("/api/admin/categories", requireAuth, requireAdmin, async (_req: AuthRequest, res) => {
    try {
      const rows = await db
        .select()
        .from(contentCategories)
        .orderBy(asc(contentCategories.sortOrder), asc(contentCategories.id));

      const buckets = await Promise.all([
        db.select({ id: trackedPeople.id, category: trackedPeople.category }).from(trackedPeople),
        db.select({ category: trendingPolls.category }).from(trendingPolls),
        db.select({ category: opinionPolls.category }).from(opinionPolls),
        db.select({ category: matchups.category }).from(matchups),
        db.select({ category: inductionCandidates.category }).from(inductionCandidates),
        db.select({ category: predictionMarkets.category }).from(predictionMarkets),
        db.select({ id: trendingPeople.id, category: trendingPeople.category }).from(trendingPeople),
      ]);

      const b = {
        trackedPeopleCats: buckets[0],
        trendingPollCats: buckets[1],
        opinionPollCats: buckets[2],
        faceOffCats: buckets[3],
        inductionCats: buckets[4],
        marketCats: buckets[5],
        trendingPeopleCats: buckets[6],
      };

      const payload = rows.map((row) => {
        const usage = usageBreakdownForId(row.id, b);
        return {
          id: row.id,
          label: row.label,
          sortOrder: row.sortOrder,
          createdAt: row.createdAt?.toISOString?.() ?? null,
          usage,
          totalUsage: sumCategoryUsage(usage),
        };
      });

      res.json(payload);
    } catch (error: any) {
      console.error("[admin/categories] list:", error);
      res.status(500).json({ error: "Failed to load categories" });
    }
  });

  app.post("/api/admin/categories", requireAuth, requireAdmin, async (req: AuthRequest, res) => {
    try {
      const parsed = z.object({
        id: z
          .string()
          .transform((s) => s.trim().toLowerCase())
          .pipe(z.string().min(1).max(64)),
        label: z
          .string()
          .transform((s) => s.trim())
          .pipe(z.string().min(1).max(120)),
      }).safeParse(req.body);
      if (!parsed.success) {
        return sendZodError(res, parsed.error);
      }
      const { id, label } = parsed.data;
      if (!ADMIN_CATEGORY_ID_RE.test(id)) {
        return res.status(400).json({
          error: "Invalid id. Use lowercase letters, digits, and single hyphens (e.g. film-tv).",
        });
      }

      const existing = await db.select({ id: contentCategories.id }).from(contentCategories).where(eq(contentCategories.id, id));
      if (existing.length > 0) {
        return res.status(409).json({ error: "A category with this id already exists." });
      }

      const sortRows = await db.select({ sortOrder: contentCategories.sortOrder }).from(contentCategories);
      const nextSort = (sortRows.length ? Math.max(...sortRows.map((r) => r.sortOrder)) : 0) + 10;

      await db.insert(contentCategories).values({
        id,
        label,
        sortOrder: nextSort,
      });

      res.status(201).json({ ok: true, id });
    } catch (error: any) {
      console.error("[admin/categories] create:", error);
      res.status(500).json({ error: "Failed to create category" });
    }
  });

  app.delete("/api/admin/categories/:id", requireAuth, requireAdmin, async (req: AuthRequest, res) => {
    try {
      const { id } = req.params;
      const [row] = await db.select().from(contentCategories).where(eq(contentCategories.id, id));
      if (!row) {
        return res.status(404).json({ error: "Category not found." });
      }

      const buckets = await Promise.all([
        db.select({ id: trackedPeople.id, category: trackedPeople.category }).from(trackedPeople),
        db.select({ category: trendingPolls.category }).from(trendingPolls),
        db.select({ category: opinionPolls.category }).from(opinionPolls),
        db.select({ category: matchups.category }).from(matchups),
        db.select({ category: inductionCandidates.category }).from(inductionCandidates),
        db.select({ category: predictionMarkets.category }).from(predictionMarkets),
        db.select({ id: trendingPeople.id, category: trendingPeople.category }).from(trendingPeople),
      ]);

      const b = {
        trackedPeopleCats: buckets[0],
        trendingPollCats: buckets[1],
        opinionPollCats: buckets[2],
        faceOffCats: buckets[3],
        inductionCats: buckets[4],
        marketCats: buckets[5],
        trendingPeopleCats: buckets[6],
      };

      const usage = usageBreakdownForId(id, b);
      const total = sumCategoryUsage(usage);
      if (total > 0) {
        return res.status(409).json({
          error:
            "Cannot delete this category while content still references it. Reassign or remove those items first.",
          usage,
        });
      }

      await db.delete(contentCategories).where(eq(contentCategories.id, id));
      res.json({ ok: true });
    } catch (error: any) {
      console.error("[admin/categories] delete:", error);
      res.status(500).json({ error: "Failed to delete category" });
    }
  });

  app.get("/api/admin/categories/:id/contents", requireAuth, requireAdmin, async (req: AuthRequest, res) => {
    try {
      const { id } = req.params;
      const [row] = await db.select().from(contentCategories).where(eq(contentCategories.id, id));
      if (!row) {
        return res.status(404).json({ error: "Category not found." });
      }

      const LIMIT = 100;

      const [
        peopleRows,
        trendingRows,
        opinionRows,
        faceRows,
        inductionRows,
        marketRows,
        leaderboardRows,
      ] = await Promise.all([
        db
          .select({
            id: trackedPeople.id,
            name: trackedPeople.name,
            category: trackedPeople.category,
            status: trackedPeople.status,
          })
          .from(trackedPeople),
        db
          .select({
            id: trendingPolls.id,
            headline: trendingPolls.headline,
            slug: trendingPolls.slug,
            status: trendingPolls.status,
            category: trendingPolls.category,
          })
          .from(trendingPolls),
        db
          .select({
            id: opinionPolls.id,
            title: opinionPolls.title,
            slug: opinionPolls.slug,
            visibility: opinionPolls.visibility,
            category: opinionPolls.category,
          })
          .from(opinionPolls),
        db
          .select({
            id: matchups.id,
            title: matchups.title,
            slug: matchups.slug,
            visibility: matchups.visibility,
            category: matchups.category,
          })
          .from(matchups),
        db
          .select({
            id: inductionCandidates.id,
            displayName: inductionCandidates.displayName,
            inductionStatus: inductionCandidates.inductionStatus,
            category: inductionCandidates.category,
          })
          .from(inductionCandidates),
        db
          .select({
            id: predictionMarkets.id,
            title: predictionMarkets.title,
            slug: predictionMarkets.slug,
            status: predictionMarkets.status,
            marketType: predictionMarkets.marketType,
            category: predictionMarkets.category,
          })
          .from(predictionMarkets),
        db
          .select({
            id: trendingPeople.id,
            name: trendingPeople.name,
            category: trendingPeople.category,
          })
          .from(trendingPeople),
      ]);

      const filterMap = <T extends { category: string | null }>(rows: T[]) =>
        rows.filter((r) => storedMatchesCanonicalCategory(r.category, id)).slice(0, LIMIT);

      const celebritiesMatching = peopleRows.filter((r) =>
        storedMatchesCanonicalCategory(r.category, id),
      );
      const celebIdsHere = new Set(celebritiesMatching.map((r) => r.id));
      const leaderboardSupplementary = leaderboardRows
        .filter((r) => storedMatchesCanonicalCategory(r.category, id))
        .filter((r) => !celebIdsHere.has(r.id))
        .slice(0, LIMIT);

      res.json({
        category: {
          id: row.id,
          label: row.label,
        },
        celebrities: celebritiesMatching.slice(0, LIMIT),
        trendingPolls: filterMap(trendingRows),
        opinionPolls: filterMap(opinionRows),
        faceOffs: filterMap(faceRows),
        inductionCandidates: filterMap(inductionRows),
        predictionMarkets: filterMap(marketRows),
        leaderboardRows: leaderboardSupplementary,
      });
    } catch (error: any) {
      console.error("[admin/categories] contents:", error);
      res.status(500).json({ error: "Failed to load category contents" });
    }
  });

  // ============ ENTITY RESOLUTION DIAGNOSTICS ============
  
  app.get("/api/admin/diagnostics/entity/:personId", requireAuth, requireAdmin, async (req: AuthRequest, res) => {
    try {
      const { runEntityDiagnostic } = await import("./diagnostics/entity-resolution");
      const result = await runEntityDiagnostic(req.params.personId);
      if (!result) {
        return res.status(404).json({ error: "Person not found" });
      }
      res.json(result);
    } catch (error: any) {
      console.error("Entity diagnostic error:", error.message);
      res.status(500).json({ error: "Failed to run entity diagnostic" });
    }
  });

  app.post("/api/admin/diagnostics/entity-batch", requireAuth, requireAdmin, async (req: AuthRequest, res) => {
    try {
      const { runBatchEntityDiagnostic } = await import("./diagnostics/entity-resolution");
      const personIds = req.body?.personIds as string[] | undefined;
      const results = await runBatchEntityDiagnostic(personIds);
      res.json({ results, total: results.length });
    } catch (error: any) {
      console.error("Batch entity diagnostic error:", error.message);
      res.status(500).json({ error: "Failed to run batch entity diagnostic" });
    }
  });

  // Refresh data (trigger data ingestion)
  app.post("/api/admin/refresh-data", requireAuth, requireAdmin, async (req: AuthRequest, res) => {
    try {
      const { runDataIngestion } = await import("./jobs/ingest");
      const result = await runDataIngestion();
      res.json({ 
        success: true, 
        message: "Data refresh completed",
        processed: result.processed,
        errors: result.errors,
        duration: result.duration,
      });
    } catch (error: any) {
      console.error("Error refreshing data:", error.message);
      res.status(500).json({ error: "Failed to refresh data" });
    }
  });
  
  // Run scoring engine PREVIEW (computes scores from cached API data WITHOUT writing to DB)
  // NOTE: This is a preview-only endpoint. Only ingest.ts writes to trending_people.
  app.post("/api/admin/run-scoring", requireAuth, requireAdmin, async (req: AuthRequest, res) => {
    try {
      const { runQuickScoring } = await import("./jobs/quick-score");
      const result = await runQuickScoring();
      res.json({ 
        success: true, 
        message: "Scoring PREVIEW complete (NOT written to DB - only ingest.ts writes)",
        processed: result.processed,
        errors: result.errors,
        healthSummary: result.healthSummary,
        previewResults: result.results.slice(0, 20), // Return top 20 for preview
      });
    } catch (error: any) {
      console.error("Error running scoring preview:", error.message);
      res.status(500).json({ error: "Failed to run scoring preview" });
    }
  });

  // Seed approval data for "Cast Your Vote" widget (Approval Leaderboard)
  app.post("/api/admin/seed-approval", requireAuth, requireAdmin, async (req: AuthRequest, res) => {
    try {
      const { seedApprovalData } = await import("./seed-approval-data");
      const result = await seedApprovalData();
      
      // Log the admin action
      const adminId = req.userId!;
      await db.insert(adminAuditLog).values({
        adminId,
        adminEmail: "admin",
        actionType: "seed_approval_data",
        targetTable: "user_votes",
        targetId: "approval-leaderboard",
        metadata: { seeded: result.seeded, skipped: result.skipped, errors: result.errors.length },
      });
      
      res.json({
        success: result.success,
        message: `Seeded ${result.seeded} celebrities, skipped ${result.skipped}`,
        seeded: result.seeded,
        skipped: result.skipped,
        errors: result.errors,
      });
    } catch (error: any) {
      console.error("Seed approval error:", error);
      res.status(500).json({ success: false, error: error.message });
    }
  });

  // Clear seed approval data
  app.post("/api/admin/clear-seed-approval", requireAuth, requireAdmin, async (req: AuthRequest, res) => {
    try {
      const { clearSeedApprovalData } = await import("./seed-approval-data");
      const result = await clearSeedApprovalData();
      res.json(result);
    } catch (error: any) {
      console.error("Clear seed approval error:", error);
      res.status(500).json({ success: false, error: error.message });
    }
  });

  // NOTE: POST /api/admin/capture-snapshots was removed. It called a no-op
  // (captureHourlySnapshots) that always returned `{ captured: 0, errors: 0 }`.
  // Snapshots are written exclusively by the ingest job; trigger a run via
  // POST /api/cron/refresh-data (or the in-process Ingestion scheduler).

  // Admin image upload to Supabase Storage
  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 5 * 1024 * 1024 },
    fileFilter: (_req, file, cb) => {
      const allowed = ['image/png', 'image/jpeg', 'image/webp'];
      if (allowed.includes(file.mimetype)) {
        cb(null, true);
      } else {
        cb(new Error('Only PNG, JPG, and WEBP files are allowed'));
      }
    },
  });

  app.post("/api/admin/upload-image", requireAuth, requireAdmin, upload.single('file'), async (req: AuthRequest, res) => {
    try {
      const file = req.file;
      if (!file) {
        return res.status(400).json({ error: "No file uploaded" });
      }

      const optimized = await optimizeImage(file.buffer);

      const moduleName = (req.body.moduleName as string) || "general";
      const slugOrId = (req.body.slugOrId as string) || "unnamed";
      const timestamp = Date.now();
      const filePath = `${moduleName}/${slugOrId}/${timestamp}${optimized.extension}`;
      const bucketName = "public-images";

      const targetSizeLimit = 5 * 1024 * 1024;
      const { data: buckets } = await supabaseServer.storage.listBuckets();
      const existingBucket = buckets?.find(b => b.name === bucketName);
      if (!existingBucket) {
        const { error: createError } = await supabaseServer.storage.createBucket(bucketName, {
          public: true,
          allowedMimeTypes: ['image/png', 'image/jpeg', 'image/webp'],
          fileSizeLimit: targetSizeLimit,
        });
        if (createError) {
          console.error("Failed to create bucket:", createError);
          return res.status(500).json({ error: "Failed to create storage bucket" });
        }
      } else if (
        existingBucket.file_size_limit !== undefined &&
        existingBucket.file_size_limit !== null &&
        existingBucket.file_size_limit < targetSizeLimit
      ) {
        await supabaseServer.storage.updateBucket(bucketName, {
          public: true,
          allowedMimeTypes: ['image/png', 'image/jpeg', 'image/webp'],
          fileSizeLimit: targetSizeLimit,
        });
      }

      const { data, error } = await supabaseServer.storage
        .from(bucketName)
        .upload(filePath, optimized.buffer, {
          contentType: optimized.contentType,
          upsert: false,
        });

      if (error) {
        console.error("Supabase upload error:", error);
        return res.status(500).json({ error: `Failed to upload image: ${error.message}` });
      }

      const { data: urlData } = supabaseServer.storage
        .from(bucketName)
        .getPublicUrl(filePath);

      res.json({ url: urlData.publicUrl, path: filePath });
    } catch (error: any) {
      console.error("Upload error:", error);
      if (
        error.message?.includes('Only PNG') ||
        error.message?.includes('Could not compress image below')
      ) {
        return res.status(400).json({ error: error.message });
      }
      res.status(500).json({ error: "Upload failed" });
    }
  });

  // User avatar upload — converts to optimized .webp via sharp and writes
  // to the `avatars` bucket at `${userId}/avatar.webp`. Mirrors the admin
  // upload pipeline so a user-supplied JPEG/PNG ends up at the same
  // bandwidth/quality profile as a CMS image. The legacy generative
  // pipeline writes `${userId}/avatar.png`; on a successful WebP upload
  // we fire-and-forget delete that PNG so the bucket has only the
  // currently-referenced avatar (the DB `avatarUrl` is the source of
  // truth, but we keep storage tidy).
  // Inline error handler for multer rejections on the avatar route.
  // Multer raises errors *before* the route handler runs (so the
  // route's try/catch never sees them), and the global error handler
  // in server/index.ts maps anything without an explicit `status` to
  // a 500 with the body `{ message: "Internal Server Error" }` —
  // which strips the actual reason ("File too large" / "Only PNG…").
  // This middleware intercepts those rejections first and surfaces a
  // user-friendly 400 with the standard `{ error }` shape so the
  // client toast can show what actually went wrong.
  const handleAvatarUploadErrors = (
    err: unknown,
    _req: Request,
    res: Response,
    next: NextFunction,
  ) => {
    if (!err) {
      return next();
    }
    if (err instanceof MulterError) {
      if (err.code === "LIMIT_FILE_SIZE") {
        return res.status(400).json({ error: "Image is too large. Max 5 MB." });
      }
      return res.status(400).json({ error: err.message });
    }
    if (err instanceof Error) {
      return res.status(400).json({ error: err.message });
    }
    return res.status(400).json({ error: "Avatar upload rejected" });
  };

  app.post(
    "/api/me/avatar/upload",
    requireAuth,
    upload.single("file"),
    handleAvatarUploadErrors,
    async (req: AuthRequest, res: Response) => {
      try {
        const file = req.file;
        if (!file) {
          return res.status(400).json({ error: "No file uploaded" });
        }

        const userId = req.userId!;

        // Avatars render at most ~96px in the UI today (and 288 in the
        // largest places like Settings), so a 512px WebP is more than
        // enough headroom for retina displays while keeping the file
        // tiny. Quality 85 is the sweet spot we use elsewhere for
        // photographic content.
        const optimized = await optimizeImage(file.buffer, {
          maxWidth: 512,
          quality: 85,
        });

        const bucketName = "avatars";
        const filePath = `${userId}/avatar.webp`;

        const { error: uploadError } = await supabaseServer.storage
          .from(bucketName)
          .upload(filePath, optimized.buffer, {
            contentType: optimized.contentType,
            upsert: true,
            cacheControl: "3600",
          });

        if (uploadError) {
          // Log the full storage error server-side, but don't echo
          // Supabase internals back to the client — the user just
          // needs to know the upload failed and to try again.
          console.error("Avatar upload error:", uploadError);
          return res.status(500).json({ error: "Avatar upload failed" });
        }

        // Best-effort cleanup of the legacy PNG path written by the
        // generative pipeline (`avatar.png`). If the user had a
        // generated avatar before uploading a photo, we don't want a
        // stale orphan sitting in the bucket. Failure is non-fatal:
        // the new WebP is already live and the DB will point at it.
        supabaseServer.storage
          .from(bucketName)
          .remove([`${userId}/avatar.png`])
          .catch((err) => {
            console.warn(
              "[avatar-upload] legacy PNG cleanup failed (non-fatal):",
              err?.message ?? err,
            );
          });

        const { data: urlData } = supabaseServer.storage
          .from(bucketName)
          .getPublicUrl(filePath);

        // Cache-bust the public URL so the new WebP is served
        // immediately instead of any previously cached image at the
        // same path.
        const url = `${urlData.publicUrl}?v=${Date.now()}`;
        res.json({ url, path: filePath });
      } catch (error: unknown) {
        console.error("Avatar upload error:", error);
        const message = error instanceof Error ? error.message : "";
        if (
          message.includes("Only PNG") ||
          message.includes("Could not compress image below")
        ) {
          return res.status(400).json({ error: message });
        }
        res.status(500).json({ error: "Avatar upload failed" });
      }
    },
  );

  // Get all users (for admin moderation)
  app.get("/api/admin/users", requireAuth, requireAdmin, async (req: AuthRequest, res) => {
    try {
      const search = (req.query.search as string) || "";
      
      let users;
      if (search) {
        users = await db.select().from(profiles)
          .where(sql`${profiles.username} ILIKE ${'%' + search + '%'}`)
          .limit(100);
      } else {
        users = await db.select().from(profiles).limit(100);
      }
      
      res.json(users.map(u => ({
        id: u.id,
        username: u.username,
        role: u.role,
        rank: u.rank,
        xpPoints: u.xpPoints,
        predictCredits: u.predictCredits,
        totalVotes: u.totalVotes,
        totalPredictions: u.totalPredictions,
        createdAt: u.createdAt,
        isBanned: u.role === 'banned',
      })));
    } catch (error: any) {
      console.error("Error fetching users:", error.message);
      res.status(500).json({ error: "Failed to fetch users" });
    }
  });

  // Adjust user credits (with audit logging) - uses transaction for consistency
  app.post("/api/admin/adjust-credits", requireAuth, requireAdmin, async (req: AuthRequest, res) => {
    try {
      const adminId = req.userId!;
      const { userId, amount, reason } = req.body;
      const numericAmount = Number(amount);
      
      if (!userId || amount === undefined || !reason || !Number.isFinite(numericAmount)) {
        return res.status(400).json({ error: "userId, amount, and reason are required" });
      }
      
      // Get current user balance
      const [user] = await db.select().from(profiles).where(eq(profiles.id, userId)).limit(1);
      if (!user) {
        return res.status(404).json({ error: "User not found" });
      }
      
      const { appliedAmount, newBalance, wasClamped } = applyAdminCreditAdjustment(user.predictCredits, numericAmount);
      const idempotencyKey = `admin_adjust_${adminId}_${userId}_${Date.now()}`;
      
      // Use transaction to ensure ledger and profile stay in sync
      await db.transaction(async (tx) => {
        // Create credit ledger entry
        await tx.insert(creditLedger).values({
          userId,
          txnType: 'admin_adjustment',
          amount: appliedAmount,
          walletType: 'VIRTUAL',
          balanceAfter: newBalance,
          source: 'admin',
          idempotencyKey,
          metadata: { reason, adjustedBy: adminId, requestedAmount: numericAmount, wasClamped },
        });
        
        // Update user balance
        await tx.update(profiles).set({ predictCredits: newBalance }).where(eq(profiles.id, userId));
        
        // Audit log
        await tx.insert(adminAuditLog).values({
          adminId,
          actionType: 'adjust_credits',
          targetTable: 'profiles',
          targetId: userId,
          previousData: { predictCredits: user.predictCredits },
          newData: { predictCredits: newBalance },
          metadata: { requestedAmount: numericAmount, appliedAmount, reason, wasClamped },
        });
      });
      
      // Notify the user when credits are granted (positive adjustment).
      // We deliberately don't ping for deductions — those are usually
      // moderation actions where a notification adds insult to injury;
      // the user can still see the entry in their credit history.
      if (appliedAmount > 0) {
        try {
          await createNotification({
            userId,
            kind: "credits_granted",
            title: `+${appliedAmount.toLocaleString("en-US")} credits granted`,
            body: reason ? `Reason: ${reason}` : "An admin added credits to your wallet.",
            href: "/me",
            entityType: "credit_ledger",
            entityId: idempotencyKey,
            metadata: { amount: appliedAmount, reason, source: "admin" },
            idempotencyKey: `credits_granted:${idempotencyKey}`,
          });
        } catch (err) {
          console.error("[notifications] credits_granted fanout failed:", err);
        }
      }

      res.json({ success: true, newBalance, appliedAmount, wasClamped });
    } catch (error: any) {
      console.error("Error adjusting credits:", error.message);
      res.status(500).json({ error: "Failed to adjust credits" });
    }
  });

  // Ban user (with audit logging)
  app.post("/api/admin/ban-user", requireAuth, requireAdmin, async (req: AuthRequest, res) => {
    try {
      const adminId = req.userId!;
      const { userId, reason } = req.body;
      
      if (!userId || !reason) {
        return res.status(400).json({ error: "userId and reason are required" });
      }
      
      // Get user
      const [user] = await db.select().from(profiles).where(eq(profiles.id, userId)).limit(1);
      if (!user) {
        return res.status(404).json({ error: "User not found" });
      }
      
      // Can't ban admins
      if (isAdminRole(user.role)) {
        return res.status(403).json({ error: "Cannot ban admin users" });
      }
      
      // Update role to banned
      await db.update(profiles).set({ role: 'banned' }).where(eq(profiles.id, userId));
      
      // Audit log
      await db.insert(adminAuditLog).values({
        adminId,
        actionType: 'ban_user',
        targetTable: 'profiles',
        targetId: userId,
        previousData: { role: user.role },
        newData: { role: 'banned' },
        metadata: { reason },
      });
      
      res.json({ success: true });
    } catch (error: any) {
      console.error("Error banning user:", error.message);
      res.status(500).json({ error: "Failed to ban user" });
    }
  });

  // ── Admin: compose + broadcast an announcement notification ─────────
  // Fans out an `announcement` kind to active users. Idempotency keyed
  // on a server-generated batch id so re-clicking the form doesn't
  // double-fan-out, and so individual user inserts don't collide if the
  // admin tweaks targeting and re-runs (each batch is a distinct id).
  //
  // Audience filters in v1:
  //   - 'all'    → every profile that has accepted ToS (excludes
  //                shadow accounts that never finished onboarding)
  //   - 'admins' → admin/moderator roles only (useful for ops dry-runs)
  app.post("/api/admin/announcements", requireAuth, requireAdmin, async (req: AuthRequest, res) => {
    try {
      const adminId = req.userId!;
      const schema = z.object({
        title: z.string().trim().min(3).max(140),
        body: z.string().trim().max(500).optional(),
        href: z.string().trim().max(500).optional(),
        audience: z.enum(["all", "admins"]).default("all"),
      });
      const parsed = schema.safeParse(req.body ?? {});
      if (!parsed.success) {
        return sendZodError(res, parsed.error);
      }
      const { title, body, href, audience } = parsed.data;

      let userQuery;
      if (audience === "admins") {
        userQuery = db
          .select({ id: profiles.id })
          .from(profiles)
          .where(inArray(profiles.role, ["admin", "moderator"]));
      } else {
        userQuery = db
          .select({ id: profiles.id })
          .from(profiles)
          .where(isNotNull(profiles.tosAcceptedAt));
      }
      const targets = await userQuery;

      // Each batch gets its own random id so re-running creates a new
      // fanout instead of a no-op. The admin-facing failure mode for
      // accidental double-clicks is "same audience receives two
      // announcements", which is mild — far better than silently
      // dropping a re-broadcast that genuinely should fire again.
      const batchId = randomUUID();
      const userIds = targets.map((t) => t.id);

      const inserted = await createNotificationsBulk(userIds, (userId) => ({
        userId,
        kind: "announcement",
        title,
        body,
        href,
        entityType: "announcement",
        entityId: batchId,
        metadata: { batchId, audience, sentBy: adminId },
        idempotencyKey: `announcement:${batchId}:${userId}`,
      }));

      await db.insert(adminAuditLog).values({
        adminId,
        actionType: "broadcast_announcement",
        targetTable: "notifications",
        targetId: batchId,
        metadata: { audience, title, recipients: userIds.length, inserted },
      });

      res.json({
        success: true,
        batchId,
        recipients: userIds.length,
        inserted,
      });
    } catch (error: any) {
      console.error("Error broadcasting announcement:", error.message);
      res.status(500).json({ error: "Failed to broadcast announcement" });
    }
  });

  // Hard-delete user (Supabase Auth + app data)
  app.post("/api/admin/delete-user", requireAuth, requireAdmin, async (req: AuthRequest, res) => {
    try {
      const adminId = req.userId!;
      const { userId, reason } = req.body as { userId?: string; reason?: string };
      const trimmedReason = reason?.trim();

      if (!userId || !trimmedReason) {
        return res.status(400).json({ error: "userId and reason are required" });
      }

      if (userId === adminId) {
        return res.status(403).json({ error: "You cannot delete your own account from the admin panel" });
      }

      const [user] = await db.select().from(profiles).where(eq(profiles.id, userId)).limit(1);
      if (!user) {
        return res.status(404).json({ error: "User not found" });
      }

      if (isAdminRole(user.role)) {
        return res.status(403).json({ error: "Cannot delete admin users" });
      }

      const userEmail = await getSupabaseAuthEmail(userId);
      const { error: authDeleteError } = await supabaseServer.auth.admin.deleteUser(userId);
      if (authDeleteError) {
        console.error(`[Admin Users] Supabase auth delete failed for ${userId}:`, authDeleteError.message);
        return res.status(502).json({ error: `Failed to delete Supabase auth user: ${authDeleteError.message}` });
      }

      await db.transaction(async (tx) => {
        await tx.delete(commentReports).where(eq(commentReports.reporterId, userId));
        await tx.delete(commentVotes).where(eq(commentVotes.userId, userId));
        await tx.delete(unifiedComments).where(eq(unifiedComments.userId, userId));
        await tx.delete(trendingPollVotes).where(eq(trendingPollVotes.userId, userId));
        await tx.delete(opinionPollVotes).where(eq(opinionPollVotes.userId, userId));
        await tx.delete(insightVotes).where(eq(insightVotes.userId, userId));
        await tx.delete(communityInsights).where(eq(communityInsights.userId, userId));
        await tx.delete(marketBets).where(eq(marketBets.userId, userId));
        await tx.delete(imageVotes).where(eq(imageVotes.userId, userId));
        await tx.delete(inductionVotes).where(eq(inductionVotes.userId, userId));
        await tx.delete(celebrityValueVotes).where(eq(celebrityValueVotes.userId, userId));
        await tx.delete(userVotes).where(eq(userVotes.userId, userId));
        await tx.delete(sentimentVotes).where(eq(sentimentVotes.userId, userId));
        await tx.delete(userFavourites).where(eq(userFavourites.userId, userId));
        await tx.delete(votes).where(eq(votes.userId, userId));
        await tx.delete(profileItemPrivacy).where(eq(profileItemPrivacy.userId, userId));
        await tx.delete(pageViews).where(eq(pageViews.userId, userId));
        await tx.delete(xpLedger).where(eq(xpLedger.userId, userId));
        await tx.delete(creditLedger).where(eq(creditLedger.userId, userId));
        await tx.delete(profiles).where(eq(profiles.id, userId));

        await tx.insert(adminAuditLog).values({
          adminId,
          actionType: "delete_user",
          targetTable: "profiles",
          targetId: userId,
          previousData: {
            id: user.id,
            username: user.username,
            role: user.role,
            rank: user.rank,
            predictCredits: user.predictCredits,
          },
          newData: null,
          metadata: {
            reason: trimmedReason,
            deletedAuthUser: true,
            authEmail: userEmail,
          },
        });
      });

      res.json({ success: true, userId });
    } catch (error: any) {
      console.error("Error deleting user:", error.message);
      res.status(500).json({ error: "Failed to delete user" });
    }
  });

  // Get prediction markets (for admin CMS)
  app.get("/api/admin/markets", requireAuth, requireAdmin, async (req: AuthRequest, res) => {
    try {
      const markets = await db
        .select()
        .from(predictionMarkets)
        .orderBy(asc(predictionMarkets.cmsDisplayOrder), desc(predictionMarkets.createdAt));
      res.json(markets);
    } catch (error: any) {
      console.error("Error fetching markets:", error.message);
      res.status(500).json({ error: "Failed to fetch markets" });
    }
  });

  // Get audit log entries
  app.get("/api/admin/audit-log", requireAuth, requireAdmin, async (req: AuthRequest, res) => {
    try {
      const { limit: limitParam, actionType, targetTable } = req.query;
      const limitNum = Math.min(parseInt(limitParam as string) || 50, 200);
      
      let query = db.select().from(adminAuditLog).orderBy(desc(adminAuditLog.createdAt)).limit(limitNum);
      
      const logs = await query;
      
      // Filter in JS for simplicity (small dataset)
      let filteredLogs = logs;
      if (actionType && typeof actionType === 'string') {
        filteredLogs = filteredLogs.filter(log => log.actionType === actionType);
      }
      if (targetTable && typeof targetTable === 'string') {
        filteredLogs = filteredLogs.filter(log => log.targetTable === targetTable);
      }
      
      res.json(filteredLogs);
    } catch (error: any) {
      console.error("Error fetching audit log:", error.message);
      res.status(500).json({ error: "Failed to fetch audit log" });
    }
  });

  // Get all celebrities for management
  app.get("/api/admin/celebrities", requireAuth, requireAdmin, async (req: AuthRequest, res) => {
    try {
      const { search, status } = req.query;
      
      let celebrities = await db.select().from(trackedPeople).orderBy(trackedPeople.name);
      
      if (search && typeof search === 'string') {
        const searchLower = search.toLowerCase();
        celebrities = celebrities.filter(c => 
          c.name.toLowerCase().includes(searchLower) ||
          (c.category && c.category.toLowerCase().includes(searchLower))
        );
      }
      
      if (status && typeof status === 'string') {
        celebrities = celebrities.filter(c => c.status === status);
      }

      const missingAvatarIds = celebrities.filter(c => !c.avatar).map(c => c.id);
      if (missingAvatarIds.length > 0) {
        const primaryImages = await db
          .select({ personId: celebrityImages.personId, imageUrl: celebrityImages.imageUrl })
          .from(celebrityImages)
          .where(and(
            inArray(celebrityImages.personId, missingAvatarIds),
            eq(celebrityImages.isPrimary, true),
          ));
        const avatarMap = new Map(primaryImages.map(r => [r.personId, r.imageUrl]));

        if (avatarMap.size < missingAvatarIds.length) {
          const fallbackImages = await db
            .selectDistinctOn([celebrityImages.personId], {
              personId: celebrityImages.personId,
              imageUrl: celebrityImages.imageUrl,
            })
            .from(celebrityImages)
            .where(inArray(celebrityImages.personId, missingAvatarIds.filter(id => !avatarMap.has(id))))
            .orderBy(celebrityImages.personId, celebrityImages.addedAt);
          for (const row of fallbackImages) {
            if (!avatarMap.has(row.personId)) avatarMap.set(row.personId, row.imageUrl);
          }
        }

        celebrities = celebrities.map(c => c.avatar ? c : { ...c, avatar: avatarMap.get(c.id) ?? null });
      }
      
      res.json(celebrities);
    } catch (error: any) {
      console.error("Error fetching celebrities:", error.message);
      res.status(500).json({ error: "Failed to fetch celebrities" });
    }
  });

  // Update celebrity
  app.patch("/api/admin/celebrities/:id", requireAuth, requireAdmin, async (req: AuthRequest, res) => {
    try {
      const { id } = req.params;
      const { name, category, status, wikiSlug, avatar, searchQueryOverride } = req.body;
      const adminId = req.userId!;

      const [existing] = await db.select().from(trackedPeople).where(eq(trackedPeople.id, id));
      if (!existing) {
        return res.status(404).json({ error: "Celebrity not found" });
      }

      const handleResult = normaliseSocialHandles(req.body);
      if (Object.keys(handleResult.errors).length > 0) {
        return res.status(400).json({ error: "Invalid handle(s)", fieldErrors: handleResult.errors });
      }

      const updates: any = { ...handleResult.values };
      if (name !== undefined) updates.name = name;
      if (category !== undefined) updates.category = category;
      if (status !== undefined) updates.status = status;
      if (wikiSlug !== undefined) updates.wikiSlug = wikiSlug;
      if (avatar !== undefined) updates.avatar = avatar;
      if (searchQueryOverride !== undefined) updates.searchQueryOverride = searchQueryOverride || null;

      const trendingUpdates: Record<string, unknown> = {};
      if (name !== undefined) trendingUpdates.name = name;
      if (category !== undefined) trendingUpdates.category = category;
      if (avatar !== undefined) trendingUpdates.avatar = avatar;

      await db.transaction(async (tx) => {
        await tx.update(trackedPeople).set(updates).where(eq(trackedPeople.id, id));

        // Keep the user-facing leaderboard and curate views in sync with admin edits.
        if (Object.keys(trendingUpdates).length > 0) {
          await tx.update(trendingPeople).set(trendingUpdates).where(eq(trendingPeople.id, id));
        }
      });
      
      // Audit log
      await db.insert(adminAuditLog).values({
        adminId,
        adminEmail: null,
        actionType: 'update_celebrity',
        targetTable: 'tracked_people',
        targetId: id,
        previousData: existing,
        newData: updates,
      });
      
      const [updated] = await db.select().from(trackedPeople).where(eq(trackedPeople.id, id));
      res.json(updated);
    } catch (error: any) {
      console.error("Error updating celebrity:", error.message);
      res.status(500).json({ error: "Failed to update celebrity" });
    }
  });

  // Get seed approval vote breakdown for a celebrity
  app.get("/api/admin/celebrities/:id/seed-approval-breakdown", requireAuth, requireAdmin, async (req: AuthRequest, res) => {
    try {
      const { id } = req.params;
      const [existing] = await db
        .select({ id: trackedPeople.id })
        .from(trackedPeople)
        .where(eq(trackedPeople.id, id))
        .limit(1);
      if (!existing) return res.status(404).json({ error: "Celebrity not found" });

      const seedRatingRows = await db
        .select({
          rating: userVotes.rating,
          cnt: sql<number>`cast(count(*) as int)`,
        })
        .from(userVotes)
        .where(
          and(
            eq(userVotes.personId, id),
            sql`${userVotes.userId} LIKE 'seed-system-approval%'`,
          ),
        )
        .groupBy(userVotes.rating);

      const counts: Record<"1" | "2" | "3" | "4" | "5", number> = {
        "1": 0,
        "2": 0,
        "3": 0,
        "4": 0,
        "5": 0,
      };
      for (const row of seedRatingRows) {
        const rating = Number(row.rating);
        if (rating >= 1 && rating <= 5) counts[String(rating) as keyof typeof counts] = Number(row.cnt);
      }

      const totalSeedVotes = counts["1"] + counts["2"] + counts["3"] + counts["4"] + counts["5"];
      res.json({ counts, totalSeedVotes });
    } catch (error: any) {
      console.error("Error in seed approval breakdown GET:", error);
      res.status(500).json({ error: "Failed to fetch seed approval breakdown" });
    }
  });

  // Replace seed approval vote breakdown for a celebrity
  app.put("/api/admin/celebrities/:id/seed-approval-breakdown", requireAuth, requireAdmin, async (req: AuthRequest, res) => {
    try {
      const { id } = req.params;
      const adminId = req.userId!;
      const incoming = req.body?.counts ?? {};

      const parseCount = (value: any) => {
        const n = Number(value);
        if (!Number.isFinite(n)) return 0;
        return Math.max(0, Math.floor(n));
      };

      const counts: Record<"1" | "2" | "3" | "4" | "5", number> = {
        "1": parseCount(incoming["1"]),
        "2": parseCount(incoming["2"]),
        "3": parseCount(incoming["3"]),
        "4": parseCount(incoming["4"]),
        "5": parseCount(incoming["5"]),
      };

      const [existing] = await db
        .select({ id: trackedPeople.id, name: trackedPeople.name })
        .from(trackedPeople)
        .where(eq(trackedPeople.id, id))
        .limit(1);
      if (!existing) return res.status(404).json({ error: "Celebrity not found" });

      // Remove all existing seed rows for this celebrity
      const { error: deleteError } = await supabaseServer
        .from("user_votes")
        .delete()
        .eq("person_id", id)
        .like("user_id", "seed-system-approval%");
      if (deleteError) {
        console.error("Error deleting existing seed votes:", deleteError);
        return res.status(500).json({ error: "Failed to replace seed votes" });
      }

      // Insert replacement seed rows with unique user_id values
      const rows: Array<{ user_id: string; person_id: string; person_name: string; rating: number }> = [];
      (["1", "2", "3", "4", "5"] as const).forEach((ratingKey) => {
        const rating = Number(ratingKey);
        for (let i = 0; i < counts[ratingKey]; i++) {
          rows.push({
            user_id: `seed-system-approval-manual-${id}-r${rating}-i${i + 1}`,
            person_id: id,
            person_name: existing.name,
            rating,
          });
        }
      });

      const batchSize = 500;
      for (let i = 0; i < rows.length; i += batchSize) {
        const chunk = rows.slice(i, i + batchSize);
        const { error: insertError } = await supabaseServer
          .from("user_votes")
          .insert(chunk);
        if (insertError) {
          console.error("Error inserting replacement seed votes:", insertError);
          return res.status(500).json({ error: "Failed to replace seed votes" });
        }
      }

      // Recompute display metrics from all votes (seed + real) — aggregate in DB
      const [allVotesAgg] = await db
        .select({
          cnt: sql<number>`cast(count(*) as int)`,
          sumRating: sql<number>`coalesce(sum(${userVotes.rating}), 0)::double precision`,
        })
        .from(userVotes)
        .where(eq(userVotes.personId, id));

      const approvalVotesCount = Number(allVotesAgg?.cnt ?? 0);
      const totalSum = Number(allVotesAgg?.sumRating ?? 0);
      const approvalAvgRating = approvalVotesCount > 0 ? totalSum / approvalVotesCount : null;
      const approvalPct = approvalAvgRating != null ? Math.round(((approvalAvgRating - 1) / 4) * 100) : null;

      const seedApprovalCount = counts["1"] + counts["2"] + counts["3"] + counts["4"] + counts["5"];
      const seedApprovalSum =
        counts["1"] * 1 +
        counts["2"] * 2 +
        counts["3"] * 3 +
        counts["4"] * 4 +
        counts["5"] * 5;

      await db
        .insert(celebrityMetrics)
        .values({
          celebrityId: id,
          seedApprovalCount,
          seedApprovalSum,
          approvalVotesCount,
          approvalAvgRating,
          approvalPct,
          updatedAt: new Date(),
        })
        .onConflictDoUpdate({
          target: celebrityMetrics.celebrityId,
          set: {
            seedApprovalCount,
            seedApprovalSum,
            approvalVotesCount,
            approvalAvgRating,
            approvalPct,
            updatedAt: new Date(),
          },
        });

      await db.insert(adminAuditLog).values({
        adminId,
        adminEmail: null,
        actionType: "update_seed_approval_breakdown",
        targetTable: "user_votes",
        targetId: id,
        newData: {
          counts,
          seedApprovalCount,
          seedApprovalSum,
          approvalVotesCount,
          approvalAvgRating,
          approvalPct,
        },
      });

      res.json({
        success: true,
        counts,
        seedApprovalCount,
        approvalVotesCount,
        approvalAvgRating,
        approvalPct,
      });
    } catch (error: any) {
      console.error("Error in seed approval breakdown PUT:", error);
      res.status(500).json({ error: "Failed to update seed approval breakdown" });
    }
  });

  // Delete celebrity
  app.delete("/api/admin/celebrities/:id", requireAuth, requireAdmin, async (req: AuthRequest, res) => {
    try {
      const { id } = req.params;
      const adminId = req.userId!;
      
      const [existing] = await db.select().from(trackedPeople).where(eq(trackedPeople.id, id));
      if (!existing) {
        return res.status(404).json({ error: "Celebrity not found" });
      }

      // Clean up references that don't have ON DELETE CASCADE in the DB yet
      await db.delete(trendingPeople).where(eq(trendingPeople.id, id));
      await db.update(matchups).set({ personAId: null }).where(eq(matchups.personAId, id));
      await db.update(matchups).set({ personBId: null }).where(eq(matchups.personBId, id));
      await db.update(marketEntries).set({ personId: null }).where(eq(marketEntries.personId, id));
      await db.update(predictionMarkets).set({ personId: null }).where(eq(predictionMarkets.personId, id));
      await db.update(opinionPollOptions).set({ personId: null }).where(eq(opinionPollOptions.personId, id));
      await db.delete(cardRelatedPeople).where(eq(cardRelatedPeople.personId, id));

      await db.delete(trackedPeople).where(eq(trackedPeople.id, id));
      
      // Audit log
      await db.insert(adminAuditLog).values({
        adminId,
        adminEmail: null,
        actionType: 'delete_celebrity',
        targetTable: 'tracked_people',
        targetId: id,
        previousData: existing,
      });
      
      res.json({ success: true });
    } catch (error: any) {
      console.error("Error deleting celebrity:", error.message);
      res.status(500).json({ error: "Failed to delete celebrity" });
    }
  });

  // ============ ADMIN: WIKI SLUG AUDIT ============
  let _wikiAuditRunning = false;

  app.post("/api/admin/wiki-slug-audit", requireAuth, requireAdmin, async (_req: AuthRequest, res) => {
    if (_wikiAuditRunning) {
      return res.status(429).json({ error: "Wiki slug audit is already running. Please wait." });
    }
    _wikiAuditRunning = true;

    try {
      const people = await db.select({
        id: trackedPeople.id,
        name: trackedPeople.name,
        wikiSlug: trackedPeople.wikiSlug,
      }).from(trackedPeople).orderBy(trackedPeople.name);

      const WIKI_UA = "VoxDex/1.0 (https://voxdex.com; contact@voxdex.com)";
      const BATCH_DELAY_MS = 120;
      const LOW_VIEW_THRESHOLD = 100;

      interface AuditEntry {
        personId: string;
        name: string;
        currentSlug: string | null;
        status: "ok" | "redirect" | "redirect_ok" | "low_views" | "missing" | "not_found" | "error";
        viewsPerDay: number | null;
        canonicalViews: number | null;
        suggestedSlug: string | null;
        note: string | null;
      }

      const results: AuditEntry[] = [];

      const fetchDayViews = async (slug: string): Promise<number | null> => {
        const yesterday = new Date();
        yesterday.setUTCDate(yesterday.getUTCDate() - 1);
        const dateStr = yesterday.toISOString().slice(0, 10).replace(/-/g, "");
        const pvUrl = `https://wikimedia.org/api/rest_v1/metrics/pageviews/per-article/en.wikipedia/all-access/all-agents/${encodeURIComponent(slug)}/daily/${dateStr}/${dateStr}`;
        const pvRes = await fetch(pvUrl, { headers: { "User-Agent": WIKI_UA, Accept: "application/json" } });
        if (!pvRes.ok) return null;
        const pvData = await pvRes.json() as any;
        return pvData?.items?.[0]?.views ?? 0;
      }

      for (const person of people) {
        if (!person.wikiSlug) {
          results.push({
            personId: person.id,
            name: person.name,
            currentSlug: null,
            status: "missing",
            viewsPerDay: null,
            canonicalViews: null,
            suggestedSlug: null,
            note: null,
          });
          continue;
        }

        try {
          const mwUrl = `https://en.wikipedia.org/w/api.php?action=query&titles=${encodeURIComponent(person.wikiSlug)}&redirects&format=json`;
          const mwRes = await fetch(mwUrl, { headers: { "User-Agent": WIKI_UA, Accept: "application/json" } });
          let canonicalSlug: string | null = null;
          let isRedirect = false;

          if (mwRes.ok) {
            const mwData = await mwRes.json() as any;
            const redirects = mwData?.query?.redirects;
            if (Array.isArray(redirects) && redirects.length > 0) {
              isRedirect = true;
              canonicalSlug = (redirects[redirects.length - 1].to as string).replace(/ /g, "_");
            }
            const pages = mwData?.query?.pages;
            if (pages && Object.keys(pages).some(k => k === "-1")) {
              results.push({
                personId: person.id,
                name: person.name,
                currentSlug: person.wikiSlug,
                status: "not_found",
                viewsPerDay: null,
                canonicalViews: null,
                suggestedSlug: null,
                note: null,
              });
              await new Promise(r => setTimeout(r, BATCH_DELAY_MS));
              continue;
            }
          }

          const viewsPerDay = await fetchDayViews(person.wikiSlug);

          let status: AuditEntry["status"];
          let suggestedSlug: string | null = null;
          let canonicalViews: number | null = null;
          let note: string | null = null;

          if (isRedirect && canonicalSlug) {
            // Compare views: redirect slug vs canonical slug
            canonicalViews = await fetchDayViews(canonicalSlug);
            await new Promise(r => setTimeout(r, BATCH_DELAY_MS));

            const redirectViews = viewsPerDay ?? 0;
            const canonViews = canonicalViews ?? 0;
            const totalViews = redirectViews + canonViews;

            if (canonViews > redirectViews) {
              status = "redirect";
              suggestedSlug = canonicalSlug;
              note = `Redirect gets ${redirectViews.toLocaleString()}/day, canonical gets ${canonViews.toLocaleString()}/day — consider switching. Ingestion now sums both (${totalViews.toLocaleString()} total).`;
            } else {
              status = "redirect_ok";
              note = `Redirect gets ${redirectViews.toLocaleString()}/day, canonical gets ${canonViews.toLocaleString()}/day — keep current slug. Ingestion sums both (${totalViews.toLocaleString()} total).`;
            }
          } else if (viewsPerDay !== null && viewsPerDay < LOW_VIEW_THRESHOLD) {
            status = "low_views";
            const searchUrl = `https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(person.name)}&srlimit=1&format=json`;
            const searchRes = await fetch(searchUrl, { headers: { "User-Agent": WIKI_UA, Accept: "application/json" } });
            if (searchRes.ok) {
              const searchData = await searchRes.json() as any;
              const topResult = searchData?.query?.search?.[0]?.title;
              if (topResult && topResult.replace(/ /g, "_") !== person.wikiSlug) {
                suggestedSlug = topResult.replace(/ /g, "_");
              }
            }
          } else {
            status = "ok";
          }

          results.push({
            personId: person.id,
            name: person.name,
            currentSlug: person.wikiSlug,
            status,
            viewsPerDay,
            canonicalViews,
            suggestedSlug,
            note,
          });
        } catch (err) {
          results.push({
            personId: person.id,
            name: person.name,
            currentSlug: person.wikiSlug,
            status: "error",
            viewsPerDay: null,
            canonicalViews: null,
            suggestedSlug: null,
            note: null,
          });
        }

        await new Promise(r => setTimeout(r, BATCH_DELAY_MS));
      }

      const issues = results.filter(r => r.status !== "ok" && r.status !== "redirect_ok");
      res.json({
        total: results.length,
        issueCount: issues.length,
        results: results.sort((a, b) => {
          const order: Record<string, number> = { redirect: 0, not_found: 1, low_views: 2, missing: 3, error: 4, redirect_ok: 5, ok: 6 };
          return (order[a.status] ?? 9) - (order[b.status] ?? 9);
        }),
      });
    } catch (error: any) {
      console.error("Error in wiki slug audit:", error);
      res.status(500).json({ error: "Wiki slug audit failed" });
    } finally {
      _wikiAuditRunning = false;
    }
  });

  // ============ ADMIN: MEDIASTACK NEWS AUDIT ============

  app.post("/api/admin/mediastack-audit", requireAuth, requireAdmin, async (_req: AuthRequest, res) => {
    try {
      const people = await db.select({
        id: trackedPeople.id,
        name: trackedPeople.name,
        newsQueryWidened: trackedPeople.newsQueryWidened,
        searchQueryOverride: trackedPeople.searchQueryOverride,
        category: trackedPeople.category,
      }).from(trackedPeople).orderBy(trackedPeople.name);

      const now = new Date();
      const STALE_HOURS = 24;

      interface MediastackAuditEntry {
        personId: string;
        name: string;
        category: string;
        queryUsed: string;
        articleCount: number | null;
        topHeadlines: string[];
        status: "ok" | "zero_articles" | "no_cache" | "stale";
        cacheAge: string | null;
        cachedAt: string | null;
        widenedQuery: string | null;
        widenedArticleCount: number | null;
        widenedHeadlines: string[];
      }

      // Build all cache keys upfront and batch-fetch from api_cache
      const cacheKeyMap = new Map<string, { id: string; name: string; category: string; newsQueryWidened: string | null; searchQueryOverride: string | null }>();
      const allCacheKeys: string[] = [];

      for (const person of people) {
        const slug = person.name.replace(/\s+/g, "_").toLowerCase();
        const primaryKey = `mediastack:news:${slug}`;
        const widenedKey = `mediastack:news:${slug}:widened`;
        cacheKeyMap.set(primaryKey, person);
        cacheKeyMap.set(widenedKey, person);
        allCacheKeys.push(primaryKey, widenedKey);
      }

      // Fetch all relevant cache entries in one query
      const cacheRows = allCacheKeys.length > 0
        ? await db.select({
            cacheKey: apiCache.cacheKey,
            responseData: apiCache.responseData,
            fetchedAt: apiCache.fetchedAt,
          }).from(apiCache).where(inArray(apiCache.cacheKey, allCacheKeys))
        : [];

      const cacheMap = new Map<string, { responseData: string; fetchedAt: Date }>();
      for (const row of cacheRows) {
        cacheMap.set(row.cacheKey, { responseData: row.responseData, fetchedAt: row.fetchedAt });
      }

      const results: MediastackAuditEntry[] = [];

      for (const person of people) {
        const slug = person.name.replace(/\s+/g, "_").toLowerCase();
        const primaryKey = `mediastack:news:${slug}`;
        const widenedKey = `mediastack:news:${slug}:widened`;

        const primaryCache = cacheMap.get(primaryKey);
        const widenedCache = cacheMap.get(widenedKey);

        let articleCount: number | null = null;
        let topHeadlines: string[] = [];
        let queryUsed = person.name;
        let cachedAt: string | null = null;
        let cacheAge: string | null = null;
        let status: MediastackAuditEntry["status"] = "no_cache";

        if (primaryCache) {
          try {
            const data = JSON.parse(primaryCache.responseData);
            articleCount = data.articleCount24h ?? 0;
            topHeadlines = (data.topHeadlines || []).slice(0, 3);
            queryUsed = data.query || person.name;
            cachedAt = primaryCache.fetchedAt.toISOString();

            const ageMs = now.getTime() - primaryCache.fetchedAt.getTime();
            const ageHours = ageMs / (1000 * 60 * 60);

            if (ageHours > STALE_HOURS) {
              cacheAge = `${Math.round(ageHours)}h ago`;
              status = "stale";
            } else if (ageHours >= 1) {
              cacheAge = `${Math.round(ageHours)}h ago`;
            } else {
              cacheAge = `${Math.round(ageMs / (1000 * 60))}m ago`;
            }

            if (status !== "stale") {
              status = (articleCount ?? 0) > 0 ? "ok" : "zero_articles";
            }
          } catch {
            status = "no_cache";
          }
        }

        let widenedArticleCount: number | null = null;
        let widenedHeadlines: string[] = [];
        let widenedQuery: string | null = person.newsQueryWidened || null;

        if (widenedCache) {
          try {
            const data = JSON.parse(widenedCache.responseData);
            widenedArticleCount = data.articleCount24h ?? 0;
            widenedHeadlines = (data.topHeadlines || []).slice(0, 3);
          } catch { /* ignore parse errors */ }
        }

        results.push({
          personId: person.id,
          name: person.name,
          category: person.category,
          queryUsed,
          articleCount,
          topHeadlines,
          status,
          cacheAge,
          cachedAt,
          widenedQuery,
          widenedArticleCount,
          widenedHeadlines,
        });
      }

      const issueCount = results.filter(r => r.status !== "ok").length;
      res.json({
        total: results.length,
        issueCount,
        results: results.sort((a, b) => {
          const order: Record<string, number> = { zero_articles: 0, no_cache: 1, stale: 2, ok: 3 };
          return (order[a.status] ?? 9) - (order[b.status] ?? 9);
        }),
      });
    } catch (error: any) {
      console.error("Error in mediastack audit:", error);
      res.status(500).json({ error: "Mediastack audit failed" });
    }
  });

  // ============ ADMIN: MEDIASTACK LIVE PROBE ============

  app.post("/api/admin/mediastack-probe", requireAuth, requireAdmin, async (req: AuthRequest, res) => {
    try {
      const { personName } = req.body;
      if (!personName || typeof personName !== "string") {
        return res.status(400).json({ error: "personName is required" });
      }

      const result = await probeMediastackLive(personName.trim());
      if (!result) {
        return res.status(503).json({ error: "Mediastack API key not configured" });
      }

      res.json(result);
    } catch (error: any) {
      console.error("Error in mediastack probe:", error);
      res.status(500).json({ error: "Mediastack probe failed" });
    }
  });

  // ============ ADMIN: SERPER SEARCH AUDIT (cached) ============

  app.post("/api/admin/audit-serper", requireAuth, requireAdmin, async (_req: AuthRequest, res) => {
    try {
      const people = await db.select({
        id: trackedPeople.id,
        name: trackedPeople.name,
        searchQueryOverride: trackedPeople.searchQueryOverride,
        category: trackedPeople.category,
      }).from(trackedPeople).orderBy(trackedPeople.name);

      const now = new Date();
      const STALE_HOURS = 24;

      interface SerperAuditEntry {
        personId: string;
        name: string;
        category: string;
        queryUsed: string;
        organicCount: number | null;
        topResultTitle: string | null;
        searchVolume: number | null;
        status: "ok" | "zero_results" | "no_cache" | "stale";
        cacheAge: string | null;
        cachedAt: string | null;
      }

      const allCacheKeys: string[] = [];
      for (const person of people) {
        const slug = person.name.replace(/\s+/g, "_").toLowerCase();
        allCacheKeys.push(`serper:search:${slug}`);
      }

      const cacheRows = allCacheKeys.length > 0
        ? await db.select({
            cacheKey: apiCache.cacheKey,
            responseData: apiCache.responseData,
            fetchedAt: apiCache.fetchedAt,
          }).from(apiCache).where(inArray(apiCache.cacheKey, allCacheKeys))
        : [];

      const cacheMap = new Map<string, { responseData: string; fetchedAt: Date }>();
      for (const row of cacheRows) {
        cacheMap.set(row.cacheKey, { responseData: row.responseData, fetchedAt: row.fetchedAt });
      }

      const results: SerperAuditEntry[] = [];

      for (const person of people) {
        const slug = person.name.replace(/\s+/g, "_").toLowerCase();
        const cacheKey = `serper:search:${slug}`;
        const row = cacheMap.get(cacheKey);

        const queryUsed = (person.searchQueryOverride?.trim() || person.name) as string;
        let organicCount: number | null = null;
        let topResultTitle: string | null = null;
        let searchVolume: number | null = null;
        let cachedAt: string | null = null;
        let cacheAge: string | null = null;
        let status: SerperAuditEntry["status"] = "no_cache";

        if (row) {
          try {
            const data = JSON.parse(row.responseData) as {
              organicCount?: number;
              topResultTitle?: string | null;
              searchVolume?: number;
              topStories?: Array<{ title?: string }>;
              peopleAlsoAsk?: string[];
              relatedSearches?: string[];
            };
            searchVolume = typeof data.searchVolume === "number" ? data.searchVolume : null;
            if (typeof data.organicCount === "number") {
              organicCount = data.organicCount;
            }
            topResultTitle =
              (typeof data.topResultTitle === "string" ? data.topResultTitle : null)
              ?? (data.topStories?.[0]?.title ?? null)
              ?? (typeof data.peopleAlsoAsk?.[0] === "string" ? data.peopleAlsoAsk[0] : null)
              ?? (typeof data.relatedSearches?.[0] === "string" ? data.relatedSearches[0] : null)
              ?? null;

            cachedAt = row.fetchedAt.toISOString();
            const ageMs = now.getTime() - row.fetchedAt.getTime();
            const ageHours = ageMs / (1000 * 60 * 60);

            if (ageHours > STALE_HOURS) {
              cacheAge = `${Math.round(ageHours)}h ago`;
              status = "stale";
            } else if (ageHours >= 1) {
              cacheAge = `${Math.round(ageHours)}h ago`;
            } else {
              cacheAge = `${Math.round(ageMs / (1000 * 60))}m ago`;
            }

            if (status !== "stale") {
              const zero =
                typeof data.organicCount === "number"
                  ? data.organicCount === 0
                  : (data.searchVolume ?? 0) === 0;
              status = zero ? "zero_results" : "ok";
            }
          } catch {
            status = "no_cache";
          }
        }

        results.push({
          personId: person.id,
          name: person.name,
          category: person.category,
          queryUsed,
          organicCount,
          topResultTitle,
          searchVolume,
          status,
          cacheAge,
          cachedAt,
        });
      }

      const issueCount = results.filter((r) => r.status !== "ok").length;
      const order: Record<string, number> = {
        zero_results: 0,
        no_cache: 1,
        stale: 2,
        ok: 3,
      };
      res.json({
        total: results.length,
        issueCount,
        results: results.sort(
          (a, b) => (order[a.status] ?? 9) - (order[b.status] ?? 9)
        ),
      });
    } catch (error: any) {
      console.error("Error in serper audit:", error);
      res.status(500).json({ error: "Serper audit failed" });
    }
  });

  // ============ ADMIN: SERPER SEARCH LIVE PROBE ============

  app.post("/api/admin/serper-refresh", requireAuth, requireAdmin, async (req: AuthRequest, res) => {
    try {
      const { personIds } = req.body ?? {};
      if (!Array.isArray(personIds) || personIds.length === 0) {
        return res.status(400).json({ error: "personIds[] is required" });
      }

      const uniquePersonIds = Array.from(new Set(personIds.filter((v: unknown) => typeof v === "string" && v.trim())));
      if (uniquePersonIds.length === 0) {
        return res.status(400).json({ error: "No valid personIds provided" });
      }
      if (uniquePersonIds.length > 25) {
        return res.status(400).json({ error: "Too many personIds (max 25)" });
      }

      const people = await db
        .select({
          id: trackedPeople.id,
          name: trackedPeople.name,
          searchQueryOverride: trackedPeople.searchQueryOverride,
        })
        .from(trackedPeople)
        .where(inArray(trackedPeople.id, uniquePersonIds));

      const limit = pLimit(2);
      const refreshed: Array<{
        personId: string;
        name: string;
        organicCount: number | null;
        topResultTitle: string | null;
        searchVolume: number;
      }> = [];
      const failed: Array<{ personId: string; name: string; reason: string }> = [];

      await Promise.all(people.map((person) =>
        limit(async () => {
          const refreshedResult = await refreshSerperCacheForPerson(
            person.name,
            person.searchQueryOverride ?? null
          );
          if (!refreshedResult) {
            failed.push({
              personId: person.id,
              name: person.name,
              reason: "Serper live refresh failed",
            });
            return;
          }
          refreshed.push({
            personId: person.id,
            name: person.name,
            organicCount: refreshedResult.organicCount ?? null,
            topResultTitle: refreshedResult.topResultTitle ?? null,
            searchVolume: refreshedResult.searchVolume,
          });
        })
      ));

      const missingIds = uniquePersonIds.filter((id) => !people.some((p) => p.id === id));
      for (const id of missingIds) {
        failed.push({ personId: id, name: id, reason: "Person not found" });
      }

      res.json({
        requestedCount: uniquePersonIds.length,
        refreshedCount: refreshed.length,
        failedCount: failed.length,
        refreshed,
        failed,
      });
    } catch (error: any) {
      console.error("Error in serper refresh:", error);
      res.status(500).json({ error: "Serper refresh failed" });
    }
  });

  app.post("/api/admin/serper-probe", requireAuth, requireAdmin, async (req: AuthRequest, res) => {
    try {
      const { personName, searchQueryOverride } = req.body ?? {};
      if (!personName || typeof personName !== "string") {
        return res.status(400).json({ error: "personName is required" });
      }

      const result = await probeSerperSearchLive(personName.trim(), searchQueryOverride ?? null);
      if (!result) {
        return res.status(503).json({ error: "Serper API key not configured or probe failed" });
      }

      res.json({
        organicCount: result.organicCount ?? 0,
        topResultTitle: result.topResultTitle ?? null,
        searchVolume: result.searchVolume,
      });
    } catch (error: any) {
      console.error("Error in serper probe:", error);
      res.status(500).json({ error: "Serper probe failed" });
    }
  });

  // ============ ADMIN: SCORE BREAKDOWN (Why Did This Move?) ============
  app.get("/api/admin/celebrities/:id/score-breakdown", requireAuth, requireAdmin, async (req: AuthRequest, res) => {
    try {
      const { id } = req.params;
      
      // Get celebrity
      const [celebrity] = await db.select().from(trackedPeople).where(eq(trackedPeople.id, id));
      if (!celebrity) {
        return res.status(404).json({ error: "Celebrity not found" });
      }
      
      // Get latest 2 on-hour snapshots for this celebrity (current + previous hour)
      const recentSnapshots = await db.select()
        .from(trendSnapshots)
        .where(and(
          eq(trendSnapshots.personId, id),
          sql`${trendSnapshots.timestamp} = date_trunc('hour', ${trendSnapshots.timestamp})`,
          eq(trendSnapshots.snapshotOrigin, 'ingest')
        ))
        .orderBy(desc(trendSnapshots.timestamp), desc(trendSnapshots.id))
        .limit(2);
      
      const latestSnapshot = recentSnapshots[0];
      const previousSnapshot = recentSnapshots[1] || null;
      
      if (!latestSnapshot) {
        return res.status(404).json({ error: "No snapshot data found for this celebrity" });
      }
      
      // Get current rank from leaderboard
      const allSnapshots = await db.select({
        personId: trendSnapshots.personId,
        fameIndex: trendSnapshots.fameIndex,
      })
        .from(trendSnapshots)
        .where(sql`timestamp = date_trunc('hour', timestamp) AND snapshot_origin = 'ingest' AND timestamp = (SELECT MAX(timestamp) FROM trend_snapshots ts2 WHERE ts2.person_id = trend_snapshots.person_id AND ts2.timestamp = date_trunc('hour', ts2.timestamp) AND ts2.snapshot_origin = 'ingest')`)
        .orderBy(desc(trendSnapshots.fameIndex));
      
      const currentRank = allSnapshots.findIndex(s => s.personId === id) + 1;
      
      // Get previous rank from previous snapshot's fame index
      let previousRank = currentRank;
      if (previousSnapshot) {
        const prevAllSnapshots = await db.execute(sql`
          SELECT person_id, fame_index 
          FROM trend_snapshots 
          WHERE timestamp = date_trunc('hour', timestamp)
            AND snapshot_origin = 'ingest'
            AND timestamp = (
              SELECT MAX(timestamp) FROM trend_snapshots 
              WHERE timestamp < ${latestSnapshot.timestamp}
                AND timestamp = date_trunc('hour', timestamp)
                AND snapshot_origin = 'ingest'
            )
          ORDER BY fame_index DESC
        `);
        const prevRankIndex = (prevAllSnapshots.rows as any[]).findIndex(s => s.person_id === id);
        previousRank = prevRankIndex >= 0 ? prevRankIndex + 1 : currentRank;
      }
      
      // Get 24h historical on-hour snapshots for the chart
      const time24hAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
      const historicalSnapshots = await db.select({
        timestamp: trendSnapshots.timestamp,
        fameIndex: trendSnapshots.fameIndex,
        trendScore: trendSnapshots.trendScore,
        wikiPageviews: trendSnapshots.wikiPageviews,
        newsCount: trendSnapshots.newsCount,
        searchVolume: trendSnapshots.searchVolume,
      })
        .from(trendSnapshots)
        .where(and(
          eq(trendSnapshots.personId, id),
          gte(trendSnapshots.timestamp, time24hAgo),
          sql`${trendSnapshots.timestamp} = date_trunc('hour', ${trendSnapshots.timestamp})`,
          eq(trendSnapshots.snapshotOrigin, 'ingest')
        ))
        .orderBy(trendSnapshots.timestamp);
      
      // Get population stats for percentile comparison
      const sourceStats = await getSourceStats();
      
      // Raw inputs from latest snapshot
      const rawInputs = {
        wikiPageviews: latestSnapshot.wikiPageviews || 0,
        newsCount: latestSnapshot.newsCount || 0,
        searchVolume: latestSnapshot.searchVolume || 0,
      };
      
      // Calculate normalized percentiles for each source
      const normalizedPercentiles = {
        wiki: normalizeSourceValue(rawInputs.wikiPageviews, sourceStats.wiki),
        news: normalizeSourceValue(rawInputs.newsCount, sourceStats.news),
        search: normalizeSourceValue(rawInputs.searchVolume, sourceStats.search),
      };
      
      // Get 7-day baselines for this celebrity for spike detection
      const time7dAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
      const baselineResult = await db.execute(sql`
        SELECT 
          PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY wiki_pageviews) as wiki_p50,
          PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY news_count) as news_p50,
          PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY search_volume) as search_p50
        FROM trend_snapshots
        WHERE person_id = ${id}
          AND timestamp >= ${time7dAgo}
          AND timestamp = date_trunc('hour', timestamp)
          AND snapshot_origin = 'ingest'
      `);
      
      const baselines = {
        wiki: Number((baselineResult.rows[0] as any)?.wiki_p50) || rawInputs.wikiPageviews,
        news: Number((baselineResult.rows[0] as any)?.news_p50) || rawInputs.newsCount,
        search: Number((baselineResult.rows[0] as any)?.search_p50) || rawInputs.searchVolume,
      };

      // Spike detection / stabilization parameters were removed along with the
      // underlying mechanisms. Expose constant placeholders so existing admin
      // UI consumers don't break.
      const spikeStatus = { wiki: false, news: false, search: false };

      // Final score breakdown
      const scoreBreakdown = {
        massScore: latestSnapshot.massScore || 0,
        velocityScore: latestSnapshot.velocityScore || 0,
        velocityAdjusted: latestSnapshot.velocityAdjusted || 0,
        diversityMultiplier: latestSnapshot.diversityMultiplier || 1.0,
        trendScore: latestSnapshot.trendScore,
        fameIndex: latestSnapshot.fameIndex || 0,
        momentum: latestSnapshot.momentum,
        drivers: latestSnapshot.drivers,
      };
      
      // Weights configuration
      const weights = {
        mass: MASS_ALLOCATION,
        velocity: VELOCITY_ALLOCATION,
        velocityBreakdown: {
          wiki: PLATFORM_WEIGHTS.velocity.wiki,
          news: PLATFORM_WEIGHTS.velocity.news,
          search: PLATFORM_WEIGHTS.velocity.search,
        },
      };
      
      // Population stats for context
      const populationStats = {
        wiki: sourceStats.wiki,
        news: sourceStats.news,
        search: sourceStats.search,
      };
      
      // Previous hour comparison for quick debugging
      const prevFameIndex = previousSnapshot?.fameIndex ?? 0;
      const currFameIndex = latestSnapshot.fameIndex ?? 0;
      const previousHourComparison = previousSnapshot ? {
        previousFameIndex: prevFameIndex,
        rawFameIndexBeforeStabilization: currFameIndex, // Using final since raw isn't stored
        currentFameIndex: currFameIndex,
        rawChangePercent: prevFameIndex > 0 
          ? ((currFameIndex - prevFameIndex) / prevFameIndex) * 100 
          : 0,
        finalChangePercent: prevFameIndex > 0 
          ? ((currFameIndex - prevFameIndex) / prevFameIndex) * 100 
          : 0,
        wasRateLimited: false, // Rate limiting flag not stored in schema
        previousRank,
        currentRank,
      } : null;
      
      // Source freshness (when was each source last updated)
      const sourceFreshness = {
        wiki: {
          lastUpdated: latestSnapshot.timestamp,
          value: latestSnapshot.wikiPageviews || 0,
          isStale: false, // Within the same snapshot, considered fresh
        },
        news: {
          lastUpdated: latestSnapshot.timestamp,
          value: latestSnapshot.newsCount || 0,
          isStale: false,
        },
        search: {
          lastUpdated: latestSnapshot.timestamp,
          value: latestSnapshot.searchVolume || 0,
          isStale: false,
        },
      };
      
      res.json({
        celebrity: {
          id: celebrity.id,
          name: celebrity.name,
          category: celebrity.category,
          avatar: celebrity.avatar,
        },
        snapshotTimestamp: latestSnapshot.timestamp,
        rawInputs,
        baselines,
        normalizedPercentiles,
        spikeStatus,
        scoreBreakdown,
        weights,
        populationStats,
        historicalSnapshots,
        previousHourComparison,
        sourceFreshness,
        currentRank,
      });
    } catch (error: any) {
      console.error("Error fetching score breakdown:", error.message);
      res.status(500).json({ error: "Failed to fetch score breakdown" });
    }
  });

  // Add new celebrity
  app.post("/api/admin/celebrities", requireAuth, requireAdmin, async (req: AuthRequest, res) => {
    try {
      const { name, category, status, wikiSlug, avatar, searchQueryOverride } = req.body;
      const adminId = req.userId!;

      if (!name) {
        return res.status(400).json({ error: "Name is required" });
      }

      const handleResult = normaliseSocialHandles(req.body);
      if (Object.keys(handleResult.errors).length > 0) {
        return res.status(400).json({ error: "Invalid handle(s)", fieldErrors: handleResult.errors });
      }

      const [created] = await db.insert(trackedPeople).values({
        name,
        category: category || 'Other',
        status: status || 'main_leaderboard',
        imageSlug: generateImageSlug(name),
        wikiSlug: wikiSlug || null,
        avatar: avatar || null,
        searchQueryOverride: searchQueryOverride || null,
        xHandle: handleResult.values.xHandle ?? null,
        instagramHandle: handleResult.values.instagramHandle ?? null,
        tiktokHandle: handleResult.values.tiktokHandle ?? null,
        youtubeId: handleResult.values.youtubeId ?? null,
        spotifyId: handleResult.values.spotifyId ?? null,
      }).returning();

      await db.insert(celebrityMetrics).values({ celebrityId: created.id }).onConflictDoNothing();
      
      // Audit log
      await db.insert(adminAuditLog).values({
        adminId,
        adminEmail: null,
        actionType: 'create_celebrity',
        targetTable: 'tracked_people',
        targetId: created.id,
        newData: created,
      });
      
      res.json(created);
    } catch (error: any) {
      console.error("Error creating celebrity:", error.message);
      res.status(500).json({ error: "Failed to create celebrity" });
    }
  });

  // Backfill imageSlug for tracked_people with null slug
  app.post("/api/admin/backfill-image-slugs", requireAuth, requireAdmin, async (_req: AuthRequest, res) => {
    try {
      const allPeople = await db.select({ id: trackedPeople.id, name: trackedPeople.name, imageSlug: trackedPeople.imageSlug })
        .from(trackedPeople);

      const missing = allPeople.filter(p => {
        if (!p.imageSlug || p.imageSlug.trim() === '') return true;
        return p.imageSlug !== generateImageSlug(p.name);
      });
      const nullCount = missing.filter(p => !p.imageSlug || p.imageSlug.trim() === '').length;
      const staleCount = missing.length - nullCount;

      let updated = 0;
      for (const person of missing) {
        const slug = generateImageSlug(person.name);
        await db.update(trackedPeople)
          .set({ imageSlug: slug })
          .where(eq(trackedPeople.id, person.id));
        updated++;
      }

      res.json({
        updated,
        total: missing.length,
        nullSlugs: nullCount,
        staleSlugs: staleCount,
        totalTracked: allPeople.length,
        sampleSlugs: allPeople.slice(0, 5).map(p => ({
          name: p.name,
          currentSlug: p.imageSlug,
          generatedSlug: generateImageSlug(p.name),
        })),
        examples: missing.slice(0, 10).map(p => ({
          name: p.name,
          oldSlug: p.imageSlug,
          newSlug: generateImageSlug(p.name),
        })),
      });
    } catch (error: any) {
      console.error("Error backfilling image slugs:", error);
      res.status(500).json({ error: "Backfill failed" });
    }
  });

  // Sync Supabase storage images into celebrity_images table for curate gallery
  app.post("/api/admin/sync-curate-images", requireAuth, requireAdmin, async (_req: AuthRequest, res) => {
    try {
      const supabaseUrl = process.env.SUPABASE_URL;
      if (!supabaseUrl) return res.status(503).json({ error: "SUPABASE_URL not configured" });

      const allPeople = await db.select({ id: trackedPeople.id, name: trackedPeople.name, imageSlug: trackedPeople.imageSlug, avatar: trackedPeople.avatar })
        .from(trackedPeople);
      const people = allPeople.filter(p => p.imageSlug && p.imageSlug.trim() !== '');

      const BUCKET = "celebrity-large";
      const publicBase = `${supabaseUrl}/storage/v1/object/public/${BUCKET}`;
      let totalSynced = 0;
      let peopleProcessed = 0;
      let errors: string[] = [];
      let foldersMissing: string[] = [];
      let foldersEmpty: string[] = [];
      let alreadySynced: string[] = [];
      const touchedPersonIds = new Set<string>();
      const sampleListResults: Array<{ name: string; slug: string; rawFiles: string[]; imageFiles: string[] }> = [];

      for (const person of people) {
        const slug = person.imageSlug!.trim();
        const { data: files, error: listError } = await supabaseServer.storage.from(BUCKET).list(slug);

        if (sampleListResults.length < 3) {
          sampleListResults.push({
            name: person.name,
            slug,
            rawFiles: files?.map(f => f.name) ?? [],
            imageFiles: files?.filter(f => /\.(webp|jpg|jpeg|png)$/i.test(f.name)).map(f => f.name) ?? [],
          });
        }

        if (listError || !files) {
          errors.push(`${person.name}: ${listError?.message || "no files"}`);
          foldersMissing.push(slug);
          continue;
        }

        if (files.length === 0) {
          foldersMissing.push(slug);
          continue;
        }

        const imageFiles = files.filter(f => /\.(webp|jpg|jpeg|png)$/i.test(f.name));
        if (imageFiles.length === 0) {
          foldersEmpty.push(`${slug} (files: ${files.map(f => f.name).join(', ')})`);
          continue;
        }

        const existing = await db.select({ imageUrl: celebrityImages.imageUrl })
          .from(celebrityImages)
          .where(eq(celebrityImages.personId, person.id));
        const existingFilenames = new Set(
          existing
            .map(r => extractImageFilenameFromUrl(r.imageUrl))
            .filter((filename): filename is string => Boolean(filename))
        );

        const hasPrimary = existing.length > 0
          ? (await db.select({ cnt: count() }).from(celebrityImages)
              .where(and(eq(celebrityImages.personId, person.id), eq(celebrityImages.isPrimary, true))))[0]?.cnt > 0
          : false;

        let insertedForPerson = 0;
        for (const file of imageFiles) {
          const filename = file.name;
          const publicUrl = buildCelebrityLargePublicUrl(supabaseUrl, slug, filename);
          if (existingFilenames.has(filename)) continue;

          const isFirst = !hasPrimary && insertedForPerson === 0 && filename.startsWith("1.");
          await db.insert(celebrityImages).values({
            personId: person.id,
            imageUrl: publicUrl,
            source: "supabase-sync",
            isPrimary: isFirst,
          });
          existingFilenames.add(filename);
          insertedForPerson++;
        }

        if (insertedForPerson > 0) {
          totalSynced += insertedForPerson;
          peopleProcessed++;
          touchedPersonIds.add(person.id);
        } else if (imageFiles.length > 0) {
          alreadySynced.push(slug);
        }
      }

      // Backfill trackedPeople.avatar for anyone missing one
      let avatarsBackfilled = 0;
      const missingAvatarPeople = allPeople.filter(p => !p.avatar);
      if (missingAvatarPeople.length > 0) {
        const missingIds = missingAvatarPeople.map(p => p.id);
        const primaryImages = await db
          .select({ personId: celebrityImages.personId, imageUrl: celebrityImages.imageUrl })
          .from(celebrityImages)
          .where(and(inArray(celebrityImages.personId, missingIds), eq(celebrityImages.isPrimary, true)));
        const backfillMap = new Map(primaryImages.map(r => [r.personId, r.imageUrl]));

        if (backfillMap.size < missingIds.length) {
          const fallback = await db
            .selectDistinctOn([celebrityImages.personId], {
              personId: celebrityImages.personId,
              imageUrl: celebrityImages.imageUrl,
            })
            .from(celebrityImages)
            .where(inArray(celebrityImages.personId, missingIds.filter(id => !backfillMap.has(id))))
            .orderBy(celebrityImages.personId, celebrityImages.addedAt);
          for (const row of fallback) {
            if (!backfillMap.has(row.personId)) backfillMap.set(row.personId, row.imageUrl);
          }
        }

        const backfillList: { personId: string; imageUrl: string }[] = [];
        backfillMap.forEach((imageUrl, personId) => {
          backfillList.push({ personId, imageUrl });
        });
        for (const row of backfillList) {
          // Use the shared helper so BOTH tracked_people.avatar and
          // trending_people.avatar are kept in sync with the curate winner.
          await syncWinningAvatarForPerson(row.personId);
          touchedPersonIds.add(row.personId);
          avatarsBackfilled++;
        }
      }

      // Re-sync the curate winner for every person we touched so both
      // denormalized avatar columns stay aligned.
      for (const personId of touchedPersonIds) {
        await syncWinningAvatarForPerson(personId);
      }

      res.json({
        totalSynced,
        peopleProcessed,
        totalPeopleScanned: people.length,
        totalTrackedWithoutSlug: allPeople.length - people.length,
        avatarsBackfilled,
        foldersMissing: foldersMissing.length,
        foldersMissingSample: foldersMissing.slice(0, 10),
        foldersEmpty: foldersEmpty.length,
        foldersEmptySample: foldersEmpty.slice(0, 10),
        alreadySynced: alreadySynced.length,
        alreadySyncedSample: alreadySynced.slice(0, 10),
        sampleListResults,
        errors: errors.length > 0 ? errors.slice(0, 20) : undefined,
      });
    } catch (error: any) {
      console.error("Error syncing curate images:", error);
      res.status(500).json({ error: "Sync failed" });
    }
  });

  app.post("/api/admin/dedupe-curate-images", requireAuth, requireAdmin, async (_req: AuthRequest, res) => {
    try {
      const people = await db
        .select({ id: trackedPeople.id, name: trackedPeople.name, imageSlug: trackedPeople.imageSlug })
        .from(trackedPeople)
        .where(and(isNotNull(trackedPeople.imageSlug), ne(trackedPeople.imageSlug, "")));

      let totalDeleted = 0;
      let peopleAffected = 0;
      const examples: Array<{ name: string; before: number; after: number }> = [];

      for (const person of people) {
        const slug = person.imageSlug?.trim();
        if (!slug) continue;

        const images = await db
          .select({
            id: celebrityImages.id,
            imageUrl: celebrityImages.imageUrl,
            addedAt: celebrityImages.addedAt,
          })
          .from(celebrityImages)
          .where(eq(celebrityImages.personId, person.id))
          .orderBy(asc(celebrityImages.addedAt), asc(celebrityImages.id));

        if (images.length === 0) continue;

        const before = images.length;
        const groups = new Map<string, typeof images>();
        const deleteIds = new Set<string>();

        for (const image of images) {
          const filename = extractImageFilenameFromUrl(image.imageUrl);
          if (!filename) {
            deleteIds.add(image.id);
            continue;
          }
          const list = groups.get(filename) ?? [];
          list.push(image);
          groups.set(filename, list);
        }

        for (const [filename, group] of Array.from(groups.entries())) {
          const currentSlugMatches = group.filter((image: { id: string; imageUrl: string; addedAt: Date }) =>
            imageUrlMatchesCurrentSlugPath(image.imageUrl, slug, filename)
          );

          if (currentSlugMatches.length === 1) {
            for (const image of group) {
              if (image.id !== currentSlugMatches[0].id) deleteIds.add(image.id);
            }
            continue;
          }

          if (currentSlugMatches.length > 1) {
            const keepId = currentSlugMatches[0].id;
            for (const image of group) {
              if (image.id !== keepId) deleteIds.add(image.id);
            }
            continue;
          }

          for (const image of group) {
            deleteIds.add(image.id);
          }
        }

        if (deleteIds.size === 0) continue;

        await db
          .delete(celebrityImages)
          .where(inArray(celebrityImages.id, Array.from(deleteIds)));

        await syncWinningAvatarForPerson(person.id);

        const after = before - deleteIds.size;
        totalDeleted += deleteIds.size;
        peopleAffected++;
        if (examples.length < 10) {
          examples.push({ name: person.name, before, after });
        }
      }

      res.json({ totalDeleted, peopleAffected, examples });
    } catch (error: any) {
      console.error("Error deduping curate images:", error);
      res.status(500).json({ error: "Dedupe failed" });
    }
  });

  // Get celebrity images for management
  app.get("/api/admin/celebrities/:id/images", requireAuth, requireAdmin, async (req: AuthRequest, res) => {
    try {
      const { id } = req.params;
      const images = await db.select().from(celebrityImages)
        .where(eq(celebrityImages.personId, id))
        .orderBy(desc(celebrityImages.votesUp), asc(celebrityImages.addedAt));
      res.json(images);
    } catch (error: any) {
      console.error("Error fetching celebrity images:", error.message);
      res.status(500).json({ error: "Failed to fetch images" });
    }
  });

  // Add celebrity image
  app.post("/api/admin/celebrities/:id/images", requireAuth, requireAdmin, async (req: AuthRequest, res) => {
    try {
      const { id } = req.params;
      const { imageUrl, isPrimary } = req.body;
      const adminId = req.userId!;
      
      if (!imageUrl) {
        return res.status(400).json({ error: "Image URL is required" });
      }
      
      // If setting as primary, unset all other primary images
      if (isPrimary) {
        await db.update(celebrityImages).set({ isPrimary: false }).where(eq(celebrityImages.personId, id));
      }
      
      const [created] = await db.insert(celebrityImages).values({
        personId: id,
        imageUrl,
        isPrimary: isPrimary || false,
      }).returning();
      
      // Audit log
      await db.insert(adminAuditLog).values({
        adminId,
        adminEmail: null,
        actionType: 'add_celebrity_image',
        targetTable: 'celebrity_images',
        targetId: created.id,
        newData: created,
      });
      
      res.json(created);
    } catch (error: any) {
      console.error("Error adding celebrity image:", error.message);
      res.status(500).json({ error: "Failed to add image" });
    }
  });

  // Delete celebrity image
  app.delete("/api/admin/celebrities/:id/images/:imageId", requireAuth, requireAdmin, async (req: AuthRequest, res) => {
    try {
      const { id, imageId } = req.params;
      const adminId = req.userId!;
      
      const [existing] = await db.select().from(celebrityImages)
        .where(and(eq(celebrityImages.id, imageId), eq(celebrityImages.personId, id)));
      
      if (!existing) {
        return res.status(404).json({ error: "Image not found" });
      }
      
      await db.delete(celebrityImages).where(eq(celebrityImages.id, imageId));
      
      // Audit log
      await db.insert(adminAuditLog).values({
        adminId,
        adminEmail: null,
        actionType: 'delete_celebrity_image',
        targetTable: 'celebrity_images',
        targetId: imageId,
        previousData: existing,
      });
      
      res.json({ success: true });
    } catch (error: any) {
      console.error("Error deleting celebrity image:", error.message);
      res.status(500).json({ error: "Failed to delete image" });
    }
  });

  // Set primary celebrity image
  app.post("/api/admin/celebrities/:id/images/:imageId/set-primary", requireAuth, requireAdmin, async (req: AuthRequest, res) => {
    try {
      const { id, imageId } = req.params;
      const adminId = req.userId!;
      
      // Unset all primary images for this celebrity
      await db.update(celebrityImages).set({ isPrimary: false }).where(eq(celebrityImages.personId, id));
      
      // Set the new primary
      await db.update(celebrityImages).set({ isPrimary: true }).where(eq(celebrityImages.id, imageId));
      
      // Also update the main avatar on BOTH tracked_people and trending_people
      // so every consumer surface (leaderboard, sentiment polls, opinion polls,
      // predict cards, value cards) shows the same image. Without the
      // trending_people update the two columns drift out of sync.
      const [image] = await db.select().from(celebrityImages).where(eq(celebrityImages.id, imageId));
      if (image) {
        await db.update(trackedPeople).set({ avatar: image.imageUrl }).where(eq(trackedPeople.id, id));
        await db.update(trendingPeople).set({ avatar: image.imageUrl }).where(eq(trendingPeople.id, id));
      }
      
      // Audit log
      await db.insert(adminAuditLog).values({
        adminId,
        adminEmail: null,
        actionType: 'set_primary_image',
        targetTable: 'celebrity_images',
        targetId: imageId,
        metadata: { personId: id },
      });
      
      res.json({ success: true });
    } catch (error: any) {
      console.error("Error setting primary image:", error.message);
      res.status(500).json({ error: "Failed to set primary image" });
    }
  });

  // Get community insights for moderation
  app.get("/api/admin/moderation/insights", requireAuth, requireAdmin, async (req: AuthRequest, res) => {
    try {
      const { status } = req.query;
      
      let insights = await db.select({
        id: communityInsights.id,
        personId: communityInsights.personId,
        userId: communityInsights.userId,
        content: communityInsights.content,
        createdAt: communityInsights.createdAt,
        upvotes: sql<number>`(SELECT COUNT(*) FROM insight_votes WHERE insight_id = ${communityInsights.id} AND vote_type = 'up')`,
        downvotes: sql<number>`(SELECT COUNT(*) FROM insight_votes WHERE insight_id = ${communityInsights.id} AND vote_type = 'down')`,
      }).from(communityInsights).orderBy(desc(communityInsights.createdAt)).limit(100);
      
      res.json(insights);
    } catch (error: any) {
      console.error("Error fetching insights for moderation:", error.message);
      res.status(500).json({ error: "Failed to fetch insights" });
    }
  });

  // Delete community insight (moderation)
  app.delete("/api/admin/moderation/insights/:id", requireAuth, requireAdmin, async (req: AuthRequest, res) => {
    try {
      const { id } = req.params;
      const { reason } = req.body;
      const adminId = req.userId!;
      
      const [existing] = await db.select().from(communityInsights).where(eq(communityInsights.id, id));
      if (!existing) {
        return res.status(404).json({ error: "Insight not found" });
      }
      
      // Delete associated votes and unified replies first
      await db.delete(insightVotes).where(eq(insightVotes.insightId, id));
      await db.delete(unifiedComments).where(and(
        eq(unifiedComments.parentType, "community_insight"),
        eq(unifiedComments.parentId, id),
      ));
      await db.delete(communityInsights).where(eq(communityInsights.id, id));
      
      // Audit log
      await db.insert(adminAuditLog).values({
        adminId,
        adminEmail: null,
        actionType: 'delete_insight',
        targetTable: 'community_insights',
        targetId: id,
        previousData: existing,
        metadata: { reason },
      });
      
      res.json({ success: true });
    } catch (error: any) {
      console.error("Error deleting insight:", error.message);
      res.status(500).json({ error: "Failed to delete insight" });
    }
  });

  // Get comments for moderation. Enriched with author info (incl. is_agent
  // flag) and parent info (title, slug, category, personId) so the admin
  // page can show "@username (agent) on Tesla market: 'comment text…'"
  // with a deep-link instead of an opaque UUID. Supports filters:
  //   ?parentType=matchup|trending_poll|opinion_poll|open_market|community_insight
  //   ?author=agents|humans|all   (default: all)
  //   ?q=substring                 (case-insensitive comment body search)
  //   ?limit=200                   (default 100, capped at 500)
  app.get("/api/admin/moderation/comments", requireAuth, requireAdmin, async (req: AuthRequest, res) => {
    try {
      const parentTypeFilter = typeof req.query.parentType === "string" ? req.query.parentType : null;
      const authorFilter = typeof req.query.author === "string" ? req.query.author : "all";
      const q = typeof req.query.q === "string" ? req.query.q.trim() : "";
      const limit = Math.max(1, Math.min(500, Number(req.query.limit ?? 100) || 100));

      const conditions = [] as any[];
      if (parentTypeFilter && (COMMENT_PARENT_TYPES as readonly string[]).includes(parentTypeFilter)) {
        conditions.push(eq(unifiedComments.parentType, parentTypeFilter as CommentParentType));
      }
      if (authorFilter === "agents") {
        conditions.push(eq(profiles.isAgent, true));
      } else if (authorFilter === "humans") {
        conditions.push(sql`COALESCE(${profiles.isAgent}, false) = false`);
      }
      if (q.length > 0) {
        conditions.push(sql`${unifiedComments.body} ILIKE ${`%${q}%`}`);
      }
      conditions.push(sql`${unifiedComments.deletedAt} IS NULL`);

      const rows = await db.select({
        id: unifiedComments.id,
        parentType: unifiedComments.parentType,
        parentId: unifiedComments.parentId,
        parentCommentId: unifiedComments.parentCommentId,
        userId: unifiedComments.userId,
        body: unifiedComments.body,
        createdAt: unifiedComments.createdAt,
        authorUsername: profiles.username,
        authorAvatarUrl: profiles.avatarUrl,
        authorIsAgent: profiles.isAgent,
        authorId: profiles.id,
      }).from(unifiedComments)
        .leftJoin(profiles, eq(unifiedComments.userId, profiles.id))
        .where(conditions.length > 0 ? and(...conditions) : undefined)
        .orderBy(desc(unifiedComments.createdAt))
        .limit(limit);

      // Group parent IDs by type so we can do one query per parent table.
      const idsByType = new Map<string, Set<string>>();
      for (const row of rows) {
        if (!idsByType.has(row.parentType)) idsByType.set(row.parentType, new Set());
        idsByType.get(row.parentType)!.add(row.parentId);
      }

      const matchupMeta = new Map<string, { title: string; slug: string | null; category: string | null }>();
      const trendingPollMeta = new Map<string, { title: string; slug: string | null; category: string | null }>();
      const opinionPollMeta = new Map<string, { title: string; slug: string | null; category: string | null }>();
      const marketMeta = new Map<string, { title: string; slug: string; category: string | null }>();
      const insightMeta = new Map<string, { personId: string; personName: string | null }>();

      const toArray = (s: Set<string> | undefined) => (s ? Array.from(s) : []);

      const matchupIds = toArray(idsByType.get("matchup"));
      const trendingIds = toArray(idsByType.get("trending_poll"));
      const opinionIds = toArray(idsByType.get("opinion_poll"));
      const marketIds = toArray(idsByType.get("open_market"));
      const insightIds = toArray(idsByType.get("community_insight"));

      await Promise.all([
        matchupIds.length > 0
          ? db.select({ id: matchups.id, title: matchups.title, slug: matchups.slug, category: matchups.category })
              .from(matchups).where(inArray(matchups.id, matchupIds))
              .then((res) => res.forEach((r) => matchupMeta.set(r.id, { title: r.title, slug: r.slug, category: r.category })))
          : Promise.resolve(),
        trendingIds.length > 0
          ? db.select({ id: trendingPolls.id, title: trendingPolls.headline, slug: trendingPolls.slug, category: trendingPolls.category })
              .from(trendingPolls).where(inArray(trendingPolls.id, trendingIds))
              .then((res) => res.forEach((r) => trendingPollMeta.set(r.id, { title: r.title, slug: r.slug, category: r.category })))
          : Promise.resolve(),
        opinionIds.length > 0
          ? db.select({ id: opinionPolls.id, title: opinionPolls.title, slug: opinionPolls.slug, category: opinionPolls.category })
              .from(opinionPolls).where(inArray(opinionPolls.id, opinionIds))
              .then((res) => res.forEach((r) => opinionPollMeta.set(r.id, { title: r.title, slug: r.slug, category: r.category })))
          : Promise.resolve(),
        marketIds.length > 0
          ? db.select({ id: predictionMarkets.id, title: predictionMarkets.title, slug: predictionMarkets.slug, category: predictionMarkets.category })
              .from(predictionMarkets).where(inArray(predictionMarkets.id, marketIds))
              .then((res) => res.forEach((r) => marketMeta.set(r.id, { title: r.title, slug: r.slug, category: r.category })))
          : Promise.resolve(),
        insightIds.length > 0
          ? db.select({
              id: communityInsights.id,
              personId: communityInsights.personId,
              personName: trackedPeople.name,
            })
              .from(communityInsights)
              .leftJoin(trackedPeople, eq(communityInsights.personId, trackedPeople.id))
              .where(inArray(communityInsights.id, insightIds))
              .then((res) => res.forEach((r) =>
                insightMeta.set(r.id, { personId: r.personId, personName: r.personName })
              ))
          : Promise.resolve(),
      ]);

      const enriched = rows.map((row) => {
        let parentTitle: string | null = null;
        let parentLink: string | null = null;
        let parentCategory: string | null = null;

        if (row.parentType === "matchup") {
          const m = matchupMeta.get(row.parentId);
          parentTitle = m?.title ?? null;
          parentCategory = m?.category ?? null;
          parentLink = m?.slug ? `/vote/matchups/${m.slug}` : null;
        } else if (row.parentType === "trending_poll") {
          const m = trendingPollMeta.get(row.parentId);
          parentTitle = m?.title ?? null;
          parentCategory = m?.category ?? null;
          parentLink = m?.slug ? `/polls/${m.slug}` : null;
        } else if (row.parentType === "opinion_poll") {
          const m = opinionPollMeta.get(row.parentId);
          parentTitle = m?.title ?? null;
          parentCategory = m?.category ?? null;
          parentLink = m?.slug ? `/polls/${m.slug}` : null;
        } else if (row.parentType === "open_market") {
          const m = marketMeta.get(row.parentId);
          parentTitle = m?.title ?? null;
          parentCategory = m?.category ?? null;
          parentLink = m?.slug ? `/markets/${m.slug}` : null;
        } else if (row.parentType === "community_insight") {
          const m = insightMeta.get(row.parentId);
          parentTitle = m?.personName ? `Insight on ${m.personName}` : null;
          parentLink = m?.personId ? `/celebrity/${m.personId}` : null;
        }

        const isAgent = !!row.authorIsAgent;
        const username = row.authorId ? row.authorUsername : DELETED_COMMENT_AUTHOR_USERNAME;

        return {
          id: row.id,
          parentType: row.parentType,
          parentId: row.parentId,
          parentCommentId: row.parentCommentId,
          parentTitle,
          parentLink,
          parentCategory,
          // Backwards compatibility with the old shape:
          insightId: row.parentType === "community_insight" ? row.parentId : null,
          content: row.body,
          body: row.body,
          createdAt: row.createdAt,
          userId: row.userId,
          username,
          avatarUrl: row.authorAvatarUrl,
          isAgent,
          authorLink: username && username !== DELETED_COMMENT_AUTHOR_USERNAME ? `/u/${username}` : null,
        };
      });

      res.json(enriched);
    } catch (error: any) {
      console.error("Error fetching comments for moderation:", error.message);
      res.status(500).json({ error: "Failed to fetch comments" });
    }
  });

  // Delete comment (moderation)
  app.delete("/api/admin/moderation/comments/:id", requireAuth, requireAdmin, async (req: AuthRequest, res) => {
    try {
      const { id } = req.params;
      const { reason } = req.body;
      const adminId = req.userId!;
      
      const [existing] = await db.select().from(unifiedComments).where(eq(unifiedComments.id, id));
      if (!existing) {
        return res.status(404).json({ error: "Comment not found" });
      }
      
      // Delete associated votes first
      await db.delete(commentVotes).where(eq(commentVotes.commentId, id));
      await db.delete(unifiedComments).where(eq(unifiedComments.id, id));
      
      // Audit log
      await db.insert(adminAuditLog).values({
        adminId,
        adminEmail: null,
        actionType: 'delete_comment',
        targetTable: 'comments',
        targetId: id,
        previousData: existing,
        metadata: { reason },
      });
      
      res.json({ success: true });
    } catch (error: any) {
      console.error("Error deleting comment:", error.message);
      res.status(500).json({ error: "Failed to delete comment" });
    }
  });

  // PATCH /api/admin/moderation/comments/:id — admin edits a comment body.
  // Restricted to AGENT-authored comments only. Editing real users' words
  // would be a serious trust/integrity issue (and arguably defamation
  // exposure); the use case here is purely cleaning up early-generation
  // artifacts on simulated content (em-dashes, etc.) before launch.
  // Always writes a full audit-log row capturing the previous body.
  app.patch("/api/admin/moderation/comments/:id", requireAuth, requireAdmin, async (req: AuthRequest, res) => {
    try {
      const { id } = req.params;
      const { body, reason } = req.body ?? {};
      const adminId = req.userId!;

      if (typeof body !== "string") {
        return res.status(400).json({ error: "body must be a string" });
      }
      const trimmed = body.trim();
      if (trimmed.length === 0) {
        return res.status(400).json({ error: "body cannot be empty (use delete instead)" });
      }
      // Same upper bound as the user-facing comment composer (see schema —
      // we don't enforce a hard cap on the column, but 2000 chars matches
      // what the LLM generator targets and keeps the moderation row
      // visually scannable).
      if (trimmed.length > 2000) {
        return res.status(400).json({ error: "body cannot exceed 2000 characters" });
      }

      // Pull the comment + author in one query so we can check is_agent.
      const [existing] = await db
        .select({
          comment: unifiedComments,
          authorIsAgent: profiles.isAgent,
        })
        .from(unifiedComments)
        .leftJoin(profiles, eq(unifiedComments.userId, profiles.id))
        .where(eq(unifiedComments.id, id));

      if (!existing || !existing.comment) {
        return res.status(404).json({ error: "Comment not found" });
      }
      if (existing.comment.deletedAt) {
        return res.status(410).json({ error: "Comment has been deleted" });
      }
      if (!existing.authorIsAgent) {
        // Hard guard. We do not allow admins to silently rewrite
        // human-authored content from the moderation panel.
        return res.status(403).json({ error: "Only agent-authored comments can be edited" });
      }
      if (existing.comment.body === trimmed) {
        // No-op edit — return current row without touching the DB or
        // polluting the audit log.
        return res.json({ success: true, comment: existing.comment, unchanged: true });
      }

      const previousBody = existing.comment.body;
      const [updated] = await db
        .update(unifiedComments)
        .set({ body: trimmed, updatedAt: new Date() })
        .where(eq(unifiedComments.id, id))
        .returning();

      await db.insert(adminAuditLog).values({
        adminId,
        adminEmail: null,
        actionType: 'edit_agent_comment',
        targetTable: 'comments',
        targetId: id,
        previousData: { body: previousBody },
        newData: { body: trimmed },
        metadata: {
          reason: typeof reason === "string" ? reason : null,
          authorUserId: existing.comment.userId,
          parentType: existing.comment.parentType,
          parentId: existing.comment.parentId,
        },
      });

      res.json({ success: true, comment: updated });
    } catch (error: any) {
      console.error("Error editing comment:", error?.message ?? error);
      res.status(500).json({ error: "Failed to edit comment" });
    }
  });

  // Matchups CRUD
  app.get("/api/admin/matchups", requireAuth, requireAdmin, async (req: AuthRequest, res) => {
    try {
      const matchupList = await db.select().from(matchups).orderBy(matchups.displayOrder, desc(matchups.createdAt));
      res.json(matchupList);
    } catch (error: any) {
      console.error("Error fetching matchups:", error.message);
      res.status(500).json({ error: "Failed to fetch matchups" });
    }
  });

  app.post("/api/admin/matchups", requireAuth, requireAdmin, async (req: AuthRequest, res) => {
    try {
      const { title, category, optionAText, optionAImage, optionBText, optionBImage, isActive, visibility, featured, slug, personAId, personBId, promptText, description, seedVotesA, seedVotesB, relatedPersonIds } = req.body;
      const adminId = req.userId!;
      
      if (!title || !optionAText || !optionBText) {
        return res.status(400).json({ error: "Title and both options are required" });
      }
      
      // Get next display order
      const [maxOrder] = await db.select({ max: sql<number>`COALESCE(MAX(display_order), 0)` }).from(matchups);
      const nextOrder = (maxOrder?.max || 0) + 1;
      
      const effectiveVisibility = visibility || 'live';
      const [created] = await db.insert(matchups).values({
        title,
        category: category || 'General',
        optionAText,
        optionAImage: optionAImage || null,
        optionBText,
        optionBImage: optionBImage || null,
        isActive: effectiveVisibility === 'live',
        displayOrder: nextOrder,
        visibility: effectiveVisibility,
        featured: featured || false,
        slug: slug || null,
        personAId: personAId || null,
        personBId: personBId || null,
        promptText: promptText || null,
        description: description || null,
        seedVotesA: parseInt(seedVotesA) || 0,
        seedVotesB: parseInt(seedVotesB) || 0,
      }).returning();

      if (Array.isArray(relatedPersonIds)) {
        await syncRelatedPeople("matchup", created.id, relatedPersonIds.filter(Boolean));
      }
      
      // Audit log
      await db.insert(adminAuditLog).values({
        adminId,
        adminEmail: null,
        actionType: 'create_faceoff',
        targetTable: 'face_offs',
        targetId: created.id,
        newData: created,
      });
      
      res.json(created);
    } catch (error: any) {
      console.error("Error creating matchup:", error.message);
      res.status(500).json({ error: "Failed to create matchup" });
    }
  });

  app.get("/api/admin/matchups/check-slug", requireAuth, requireAdmin, async (req: AuthRequest, res) => {
    try {
      const { slug, excludeId } = req.query;
      if (!slug) return res.json({ available: false });
      
      const results = await db.select({ id: matchups.id }).from(matchups).where(eq(matchups.slug, slug as string));
      
      const available = results.length === 0 || (excludeId && results.length === 1 && results[0].id === excludeId);
      res.json({ available });
    } catch (error: any) {
      res.status(500).json({ error: "Failed to check slug" });
    }
  });

  app.patch("/api/admin/matchups/:id", requireAuth, requireAdmin, async (req: AuthRequest, res) => {
    try {
      const { id } = req.params;
      const { title, category, optionAText, optionAImage, optionBText, optionBImage, isActive, displayOrder, visibility, featured, slug, personAId, personBId, promptText, description, seedVotesA, seedVotesB, relatedPersonIds } = req.body;
      const adminId = req.userId!;
      
      const [existing] = await db.select().from(matchups).where(eq(matchups.id, id));
      if (!existing) {
        return res.status(404).json({ error: "Matchup not found" });
      }
      
      const updates: any = {};
      if (title !== undefined) updates.title = title;
      if (category !== undefined) updates.category = category;
      if (optionAText !== undefined) updates.optionAText = optionAText;
      if (optionAImage !== undefined) updates.optionAImage = optionAImage;
      if (optionBText !== undefined) updates.optionBText = optionBText;
      if (optionBImage !== undefined) updates.optionBImage = optionBImage;
      if (isActive !== undefined) { updates.isActive = isActive; updates.visibility = isActive ? 'live' : 'inactive'; }
      if (displayOrder !== undefined) updates.displayOrder = displayOrder;
      if (visibility !== undefined) { updates.visibility = visibility; updates.isActive = visibility === 'live'; }
      if (featured !== undefined) updates.featured = featured;
      if (slug !== undefined) updates.slug = slug;
      if (personAId !== undefined) updates.personAId = personAId;
      if (personBId !== undefined) updates.personBId = personBId;
      if (promptText !== undefined) updates.promptText = promptText;
      if (description !== undefined) updates.description = description || null;
      if (seedVotesA !== undefined) updates.seedVotesA = parseInt(seedVotesA) || 0;
      if (seedVotesB !== undefined) updates.seedVotesB = parseInt(seedVotesB) || 0;
      
      await db.update(matchups).set(updates).where(eq(matchups.id, id));

      if (Array.isArray(relatedPersonIds)) {
        await syncRelatedPeople("matchup", id, relatedPersonIds.filter(Boolean));
      }
      
      // Audit log
      await db.insert(adminAuditLog).values({
        adminId,
        adminEmail: null,
        actionType: 'update_faceoff',
        targetTable: 'face_offs',
        targetId: id,
        previousData: existing,
        newData: updates,
      });
      
      const [updated] = await db.select().from(matchups).where(eq(matchups.id, id));
      res.json(updated);
    } catch (error: any) {
      console.error("Error updating matchup:", error.message);
      res.status(500).json({ error: "Failed to update matchup" });
    }
  });

  app.delete("/api/admin/matchups/:id", requireAuth, requireAdmin, async (req: AuthRequest, res) => {
    try {
      const { id } = req.params;
      const adminId = req.userId!;
      
      const [existing] = await db.select().from(matchups).where(eq(matchups.id, id));
      if (!existing) {
        return res.status(404).json({ error: "Matchup not found" });
      }
      
      // Delete associated votes first
      await db.delete(votes).where(and(eq(votes.voteType, 'face_off'), eq(votes.targetId, id)));
      await db.delete(matchups).where(eq(matchups.id, id));
      
      // Audit log
      await db.insert(adminAuditLog).values({
        adminId,
        adminEmail: null,
        actionType: 'delete_faceoff',
        targetTable: 'face_offs',
        targetId: id,
        previousData: existing,
      });
      
      res.json({ success: true });
    } catch (error: any) {
      console.error("Error deleting matchup:", error.message);
      res.status(500).json({ error: "Failed to delete matchup" });
    }
  });

  // Reorder matchups
  app.post("/api/admin/matchups/reorder", requireAuth, requireAdmin, async (req: AuthRequest, res) => {
    try {
      const { orderedIds } = req.body;
      const adminId = req.userId!;
      
      if (!Array.isArray(orderedIds)) {
        return res.status(400).json({ error: "orderedIds must be an array" });
      }
      
      // Batch update display order in parallel
      if (orderedIds.length > 0) {
        await Promise.all(
          orderedIds.map((id, i) =>
            db.update(matchups).set({ displayOrder: i + 1 }).where(eq(matchups.id, id))
          )
        );
      }
      
      // Audit log
      await db.insert(adminAuditLog).values({
        adminId,
        adminEmail: null,
        actionType: 'reorder_faceoffs',
        targetTable: 'face_offs',
        targetId: 'bulk',
        newData: { orderedIds },
      });
      
      res.json({ success: true });
    } catch (error: any) {
      console.error("Error reordering matchups:", error.message);
      res.status(500).json({ error: "Failed to reorder matchups" });
    }
  });

  app.post("/api/admin/matchups/:id/generate-ai-draft", requireAuth, requireAdmin, async (req: AuthRequest, res) => {
    try {
      const { id } = req.params;
      const { field, currentContent } = req.body;

      if (!field || field !== "description") {
        return res.status(400).json({ error: "field must be 'description'" });
      }

      const [matchup] = await db.select().from(matchups).where(eq(matchups.id, id)).limit(1);
      if (!matchup) return res.status(404).json({ error: "Matchup not found" });

      let nameA: string | null = null;
      let nameB: string | null = null;
      if (matchup.personAId) {
        const [p] = await db.select({ name: trackedPeople.name }).from(trackedPeople).where(eq(trackedPeople.id, matchup.personAId)).limit(1);
        if (p) nameA = p.name;
      }
      if (matchup.personBId) {
        const [p] = await db.select({ name: trackedPeople.name }).from(trackedPeople).where(eq(trackedPeople.id, matchup.personBId)).limit(1);
        if (p) nameB = p.name;
      }
      const linkedBlock =
        nameA || nameB
          ? `\nLinked profiles: Option A${nameA ? ` (${nameA})` : ""}, Option B${nameB ? ` (${nameB})` : ""}`
          : "";

      const requestContent = typeof currentContent === "string" ? currentContent.trim() : "";
      const dbContent = String(matchup.description || "").trim();
      const existingContent = requestContent || dbContent;
      const existingBlock = existingContent
        ? `\nCurrent content for reference (improve upon this):\n"${existingContent}"`
        : "";

      const systemPrompt = `You are writing content for a head-to-head matchup on VoxDex, a trend-tracking and prediction platform. Matchups let users pick between Option A and Option B. Use web search to keep facts current and accurate. Write plain text only. Keep it concise and easy to scan. Use short paragraphs with blank lines between them. If a list improves clarity, you may use simple '-' bullet points. Do not use markdown headers or bold formatting.`;

      const userPrompt = `Matchup title: "${matchup.title}"
Category: ${matchup.category || "General"}
Option A: "${matchup.optionAText}"
Option B: "${matchup.optionBText}"
${matchup.promptText ? `Pre-vote prompt shown to users: "${matchup.promptText}"` : ""}${linkedBlock}${existingBlock}

Write a concise context section for this matchup. This is shown on the detail page under a "Context" heading.

Requirements:
- Prefer 2-3 short paragraphs (1-3 sentences each), separated by blank lines.
- Optionally use 3-5 '-' bullet points only if it makes the content clearer.
- Stay balanced: explain both sides without picking a winner.
- Cover only the essentials: why this pairing matters, what distinguishes the options, and recent context.
- Avoid long tangents and avoid repeating the option labels verbatim if you can vary wording naturally.

Target length: about 90-150 words.`;

      const openai = new OpenAI({
        apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY || process.env.OPENAI_API_KEY,
      });

      const response = await openai.responses.create({
        model: getAiModel("aiDrafts"),
        tools: [{ type: "web_search" as any }],
        instructions: systemPrompt,
        input: userPrompt,
        max_output_tokens: 450,
        temperature: 0.7,
      } as any);

      const content = stripCitations(((response as any).output_text
        || ((response as any).output || [])
             .filter((item: any) => item.type === "message")
             .flatMap((item: any) => item.content || [])
             .find((part: any) => part.type === "output_text" || part.type === "text")
             ?.text)?.trim() || "");
      if (!content) return res.status(500).json({ error: "AI returned empty content" });

      console.log(`[Matchups] AI draft generated for matchup ${id}, field=description`);
      res.json({ content });
    } catch (error: any) {
      console.error("[Matchups] AI draft error:", error?.message || error);
      res.status(500).json({ error: "Failed to generate draft" });
    }
  });

  // ===========================================
  // PUBLIC: TRENDING POLLS
  // ===========================================

  function slugifyHeadline(s: string): string {
    return s.toLowerCase().replace(/[''`"]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  }

  function isConventionImageUrl(url: string | null): boolean {
    return url != null && url.includes('/sentiment-polls/') && url.endsWith('/1.webp');
  }

  function sentimentPollImageUrl(slug: string): string | null {
    if (!process.env.SUPABASE_URL) return null;
    return `${process.env.SUPABASE_URL}/storage/v1/object/public/sentiment-polls/${slug}/1.webp`;
  }

  app.get("/api/trending-polls", optionalAuth, async (req, res) => {
    try {
      const userId = (req as AuthRequest).userId || null;

      const orderTerms = await orderRecencyForUser(
        req as AuthRequest,
        trendingPolls.createdAt,
        trendingPolls.category,
      );

      const polls = await db
        .select({
          id: trendingPolls.id,
          headline: trendingPolls.headline,
          subjectText: trendingPolls.subjectText,
          description: trendingPolls.description,
          category: trendingPolls.category,
          personId: trendingPolls.personId,
          imageUrl: trendingPolls.imageUrl,
          slug: trendingPolls.slug,
          seedSupportCount: trendingPolls.seedSupportCount,
          seedNeutralCount: trendingPolls.seedNeutralCount,
          seedOpposeCount: trendingPolls.seedOpposeCount,
          status: trendingPolls.status,
          createdAt: trendingPolls.createdAt,
          personName: trackedPeople.name,
          personAvatar: trendingPeople.avatar,
        })
        .from(trendingPolls)
        .leftJoin(trackedPeople, eq(trendingPolls.personId, trackedPeople.id))
        .leftJoin(trendingPeople, eq(trendingPolls.personId, trendingPeople.id))
        .where(eq(trendingPolls.status, 'live'))
        .orderBy(...orderTerms, asc(trendingPolls.displayOrder));

      const pollIds = polls.map(p => p.id);
      const relatedMap = await getRelatedPeopleForCards("sentiment_poll", pollIds);

      const userVoteMap: Record<string, string> = {};
      if (userId && pollIds.length > 0) {
        const userVotes = await db
          .select({ pollId: trendingPollVotes.pollId, choice: trendingPollVotes.choice })
          .from(trendingPollVotes)
          .where(and(eq(trendingPollVotes.userId, userId), inArray(trendingPollVotes.pollId, pollIds)));
        for (const v of userVotes) {
          userVoteMap[v.pollId] = v.choice;
        }
      }

      const result = polls.map(p => {
        const total = (p.seedSupportCount || 0) + (p.seedNeutralCount || 0) + (p.seedOpposeCount || 0);
        const effectiveSlug = p.slug || slugifyHeadline(p.headline);
        let imageUrl = p.imageUrl || sentimentPollImageUrl(effectiveSlug);
        return {
          id: p.id,
          headline: p.headline,
          subjectText: p.subjectText,
          description: p.description,
          category: p.category,
          personId: p.personId,
          personName: p.personName || null,
          personAvatar: p.personAvatar || null,
          imageUrl,
          slug: p.slug || null,
          totalVotes: total,
          approvePercent: total > 0 ? Math.round(((p.seedSupportCount || 0) / total) * 100) : 0,
          neutralPercent: total > 0 ? Math.round(((p.seedNeutralCount || 0) / total) * 100) : 0,
          disapprovePercent: total > 0 ? Math.round(((p.seedOpposeCount || 0) / total) * 100) : 0,
          status: p.status,
          relatedPersonIds: (relatedMap[p.id] || []).map(rp => rp.id),
          relatedPeople: relatedMap[p.id] || [],
          userVote: userVoteMap[p.id] || null,
        };
      });

      res.json(result);
    } catch (error: any) {
      console.error("Error fetching public trending polls:", error.message);
      res.status(500).json({ error: "Failed to fetch trending polls" });
    }
  });

  // ===========================================
  // PUBLIC: TRENDING POLL DETAIL (by slug)
  // ===========================================

  app.get("/api/polls/:slug", optionalAuth, async (req, res) => {
    try {
      const { slug } = req.params;
      const authReq = req as AuthRequest;
      const userId = authReq.userId || null;

      const [poll] = await db
        .select({
          id: trendingPolls.id,
          headline: trendingPolls.headline,
          subjectText: trendingPolls.subjectText,
          description: trendingPolls.description,
          category: trendingPolls.category,
          personId: trendingPolls.personId,
          imageUrl: trendingPolls.imageUrl,
          slug: trendingPolls.slug,
          featured: trendingPolls.featured,
          visibility: trendingPolls.visibility,
          status: trendingPolls.status,
          timeline: trendingPolls.timeline,
          deadlineAt: trendingPolls.deadlineAt,
          seedSupportCount: trendingPolls.seedSupportCount,
          seedNeutralCount: trendingPolls.seedNeutralCount,
          seedOpposeCount: trendingPolls.seedOpposeCount,
          createdAt: trendingPolls.createdAt,
          personName: trackedPeople.name,
          personAvatar: trendingPeople.avatar,
        })
        .from(trendingPolls)
        .leftJoin(trackedPeople, eq(trendingPolls.personId, trackedPeople.id))
        .leftJoin(trendingPeople, eq(trendingPolls.personId, trendingPeople.id))
        .where(eq(trendingPolls.slug, slug))
        .limit(1);

      if (!poll) {
        return res.status(404).json({ error: "Poll not found" });
      }

      const realVotes = await db
        .select({
          choice: trendingPollVotes.choice,
          cnt: count(),
        })
        .from(trendingPollVotes)
        .where(eq(trendingPollVotes.pollId, poll.id))
        .groupBy(trendingPollVotes.choice);

      const realCounts: Record<string, number> = {};
      for (const rv of realVotes) {
        realCounts[rv.choice] = Number(rv.cnt);
      }

      const supportCount = (poll.seedSupportCount || 0) + (realCounts['support'] || 0);
      const neutralCount = (poll.seedNeutralCount || 0) + (realCounts['neutral'] || 0);
      const opposeCount = (poll.seedOpposeCount || 0) + (realCounts['oppose'] || 0);
      const totalVotes = supportCount + neutralCount + opposeCount;

      let userVote: string | null = null;
      if (userId) {
        const [uv] = await db
          .select({ choice: trendingPollVotes.choice })
          .from(trendingPollVotes)
          .where(and(
            eq(trendingPollVotes.pollId, poll.id),
            eq(trendingPollVotes.userId, userId)
          ))
          .limit(1);
        if (uv) userVote = uv.choice;
      }

      const effectiveSlug = poll.slug || slugifyHeadline(poll.headline);
      const imageUrl = poll.imageUrl || sentimentPollImageUrl(effectiveSlug);

      res.json({
        ...poll,
        imageUrl,
        personAvatar: poll.personAvatar || null,
        supportCount,
        neutralCount,
        opposeCount,
        totalVotes,
        approvePercent: totalVotes > 0 ? Math.round((supportCount / totalVotes) * 100) : 0,
        neutralPercent: totalVotes > 0 ? Math.round((neutralCount / totalVotes) * 100) : 0,
        disapprovePercent: totalVotes > 0 ? Math.round((opposeCount / totalVotes) * 100) : 0,
        userVote,
      });
    } catch (error: any) {
      console.error("Error fetching poll by slug:", error.message);
      res.status(500).json({ error: "Failed to fetch poll" });
    }
  });

  // ===========================================
  // PUBLIC: TRENDING POLL VOTE
  // ===========================================

  app.post("/api/polls/:slug/vote", requireAuth, async (req, res) => {
    try {
      const authReq = req as AuthRequest;
      if (!checkVoteRateLimit(authReq.userId!)) {
        return res.status(429).json({ error: "Too many votes. Please slow down." });
      }
      const { slug } = req.params;
      const { choice } = req.body;

      if (!choice || !['support', 'neutral', 'oppose'].includes(choice)) {
        return res.status(400).json({ error: "Choice must be 'support', 'neutral', or 'oppose'" });
      }

      const [poll] = await db
        .select({ id: trendingPolls.id, category: trendingPolls.category })
        .from(trendingPolls)
        .where(eq(trendingPolls.slug, slug))
        .limit(1);

      if (!poll) {
        return res.status(404).json({ error: "Poll not found" });
      }

      const [existing] = await db
        .select()
        .from(trendingPollVotes)
        .where(and(
          eq(trendingPollVotes.pollId, poll.id),
          eq(trendingPollVotes.userId, authReq.userId!)
        ))
        .limit(1);

      let xpResult;
      if (existing) {
        await db
          .update(trendingPollVotes)
          .set({ choice, updatedAt: new Date() })
          .where(eq(trendingPollVotes.id, existing.id));
      } else {
        await db.transaction(async (tx) => {
          await tx
            .insert(trendingPollVotes)
            .values({
              pollId: poll.id,
              userId: authReq.userId!,
              choice,
            });

          await tx.update(profiles)
            .set({ totalVotes: sql`${profiles.totalVotes} + 1` })
            .where(eq(profiles.id, authReq.userId!));
        });

        // Phase 3: engagement signal for the poll's category.
        await upsertEngagement({
          userId: authReq.userId!,
          categoryId: poll.category,
          voteDelta: 1,
          source: "trending-poll-vote",
        });

        try {
          xpResult = await gamificationService.awardXp(
            authReq.userId!, 'vote_sentiment',
            `trending_poll_${poll.id}_${authReq.userId}`,
            { pollId: poll.id, choice }
          );
        } catch (e) { console.error("XP award failed:", e); }
      }

      res.json({ success: true, choice, xp: xpResult ?? null });
    } catch (error: any) {
      console.error("Error voting on poll:", error.message);
      res.status(500).json({ error: "Failed to cast vote" });
    }
  });

  // ===========================================
  // ADMIN: TRENDING POLLS CRUD
  // ===========================================

  app.get("/api/admin/trending-polls", requireAuth, requireAdmin, async (req: AuthRequest, res) => {
    try {
      const pollList = await db
        .select()
        .from(trendingPolls)
        .orderBy(asc(trendingPolls.displayOrder), desc(trendingPolls.createdAt));
      res.json(pollList);
    } catch (error: any) {
      console.error("Error fetching trending polls:", error.message);
      res.status(500).json({ error: "Failed to fetch trending polls" });
    }
  });

  app.post("/api/admin/trending-polls", requireAuth, requireAdmin, async (req: AuthRequest, res) => {
    try {
      const { status, category, headline, subjectText, personId, description, timeline, deadlineAt, imageUrl, seedSupportCount, seedNeutralCount, seedOpposeCount, slug, featured, visibility, relatedPersonIds } = req.body;
      const adminId = req.userId!;

      if (!headline || !subjectText || !category) {
        return res.status(400).json({ error: "Headline, subject text, and category are required" });
      }

      const effectiveVisibility = visibility || status || "draft";
      const effectiveStatus = (effectiveVisibility === "inactive") ? "draft" : effectiveVisibility;
      const [maxOrd] = await db.select({ max: sql<number>`COALESCE(MAX(display_order), 0)` }).from(trendingPolls);
      const nextDisplayOrder = (maxOrd?.max || 0) + 1;
      const [created] = await db.insert(trendingPolls).values({
        status: effectiveStatus,
        category,
        headline,
        subjectText,
        personId: personId || null,
        description: description || null,
        timeline: timeline || null,
        deadlineAt: deadlineAt ? new Date(deadlineAt) : null,
        imageUrl: imageUrl || null,
        seedSupportCount: seedSupportCount || 0,
        seedNeutralCount: seedNeutralCount || 0,
        seedOpposeCount: seedOpposeCount || 0,
        slug: slug || null,
        featured: featured ?? false,
        visibility: effectiveVisibility,
        displayOrder: nextDisplayOrder,
        createdBy: adminId,
      }).returning();

      if (Array.isArray(relatedPersonIds)) {
        await syncRelatedPeople("sentiment_poll", created.id, relatedPersonIds.filter(Boolean));
      }

      await db.insert(adminAuditLog).values({
        adminId,
        adminEmail: null,
        actionType: 'create_trending_poll',
        targetTable: 'trending_polls',
        targetId: created.id,
        newData: created,
      });

      res.json(created);
    } catch (error: any) {
      console.error("Error creating trending poll:", error.message, error.detail || "");
      const detail = error.detail || error.message || "Unknown error";
      if (detail.includes("foreign key") || detail.includes("violates")) {
        res.status(400).json({ error: "Invalid linked celebrity ID. Please select a celebrity from the dropdown.", details: detail });
      } else {
        res.status(500).json({ error: `Failed to create trending poll: ${detail}`, details: detail });
      }
    }
  });

  app.patch("/api/admin/trending-polls/:id", requireAuth, requireAdmin, async (req: AuthRequest, res) => {
    try {
      const { id } = req.params;
      const adminId = req.userId!;

      const [existing] = await db.select().from(trendingPolls).where(eq(trendingPolls.id, id));
      if (!existing) {
        return res.status(404).json({ error: "Trending poll not found" });
      }

      const { status, category, headline, subjectText, personId, description, timeline, deadlineAt, imageUrl, seedSupportCount, seedNeutralCount, seedOpposeCount, slug, featured, visibility, displayOrder, relatedPersonIds } = req.body;

      const updates: any = { updatedAt: new Date() };
      if (visibility !== undefined) {
        updates.visibility = visibility;
        updates.status = (visibility === "inactive") ? "draft" : visibility;
      } else if (status !== undefined) {
        updates.status = status;
      }
      if (category !== undefined) updates.category = category;
      if (headline !== undefined) updates.headline = headline;
      if (subjectText !== undefined) updates.subjectText = subjectText;
      if (personId !== undefined) updates.personId = personId || null;
      if (description !== undefined) updates.description = description || null;
      if (timeline !== undefined) updates.timeline = timeline || null;
      if (deadlineAt !== undefined) updates.deadlineAt = deadlineAt ? new Date(deadlineAt) : null;
      if (imageUrl !== undefined) updates.imageUrl = imageUrl || null;
      if (seedSupportCount !== undefined) updates.seedSupportCount = seedSupportCount;
      if (seedNeutralCount !== undefined) updates.seedNeutralCount = seedNeutralCount;
      if (seedOpposeCount !== undefined) updates.seedOpposeCount = seedOpposeCount;
      if (slug !== undefined) updates.slug = slug || null;
      if (featured !== undefined) updates.featured = featured;
      if (displayOrder !== undefined) updates.displayOrder = displayOrder;

      if ((slug !== undefined || headline !== undefined) && imageUrl === undefined) {
        if (isConventionImageUrl(existing.imageUrl)) {
          updates.imageUrl = null;
        }
      }

      const [updated] = await db.update(trendingPolls).set(updates).where(eq(trendingPolls.id, id)).returning();

      if (Array.isArray(relatedPersonIds)) {
        await syncRelatedPeople("sentiment_poll", id, relatedPersonIds.filter(Boolean));
      }

      await db.insert(adminAuditLog).values({
        adminId,
        adminEmail: null,
        actionType: 'update_trending_poll',
        targetTable: 'trending_polls',
        targetId: id,
        previousData: existing,
        newData: updated,
      });

      res.json(updated);
    } catch (error: any) {
      console.error("Error updating trending poll:", error.message, error.detail || "");
      const detail = error.detail || error.message || "Unknown error";
      if (detail.includes("foreign key") || detail.includes("violates")) {
        res.status(400).json({ error: "Invalid linked celebrity ID. Please select a celebrity from the dropdown.", details: detail });
      } else {
        res.status(500).json({ error: `Failed to update trending poll: ${detail}`, details: detail });
      }
    }
  });

  app.delete("/api/admin/trending-polls/:id", requireAuth, requireAdmin, async (req: AuthRequest, res) => {
    try {
      const { id } = req.params;
      const adminId = req.userId!;

      const [existing] = await db.select().from(trendingPolls).where(eq(trendingPolls.id, id));
      if (!existing) {
        return res.status(404).json({ error: "Trending poll not found" });
      }

      await db.delete(trendingPolls).where(eq(trendingPolls.id, id));

      await db.insert(adminAuditLog).values({
        adminId,
        adminEmail: null,
        actionType: 'delete_trending_poll',
        targetTable: 'trending_polls',
        targetId: id,
        previousData: existing,
      });

      res.json({ success: true });
    } catch (error: any) {
      console.error("Error deleting trending poll:", error.message);
      res.status(500).json({ error: "Failed to delete trending poll" });
    }
  });

  app.post("/api/admin/trending-polls/reorder", requireAuth, requireAdmin, async (req: AuthRequest, res) => {
    try {
      const { orderedIds } = req.body;
      const adminId = req.userId!;
      if (!Array.isArray(orderedIds)) {
        return res.status(400).json({ error: "orderedIds must be an array" });
      }
      if (orderedIds.length > 0) {
        await Promise.all(
          orderedIds.map((id: string, i: number) =>
            db.update(trendingPolls).set({ displayOrder: i + 1, updatedAt: new Date() }).where(eq(trendingPolls.id, id)),
          ),
        );
      }
      await db.insert(adminAuditLog).values({
        adminId,
        adminEmail: null,
        actionType: "reorder_trending_polls",
        targetTable: "trending_polls",
        targetId: "bulk",
        newData: { orderedIds },
      });
      res.json({ success: true });
    } catch (error: any) {
      console.error("Error reordering trending polls:", error.message);
      res.status(500).json({ error: "Failed to reorder trending polls" });
    }
  });

  function stripCitations(text: string): string {
    const withoutCitations = text
      .replace(/\s*\(\[([^\]]*)\]\([^)]*\)\)/g, "")
      .replace(/\s*\[([^\]]*)\]\([^)]*\)/g, "")
      .trim();

    return withoutCitations
      .split("\n")
      .map((line) => line.replace(/[ \t]{2,}/g, " ").trimEnd())
      .join("\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
  }

  app.post("/api/admin/trending-polls/:id/generate-ai-draft", requireAuth, requireAdmin, async (req: AuthRequest, res) => {
    try {
      const { id } = req.params;
      const { field, currentContent } = req.body;

      if (!field || !["subjectText", "description"].includes(field)) {
        return res.status(400).json({ error: "field must be 'subjectText' or 'description'" });
      }

      const [poll] = await db.select().from(trendingPolls).where(eq(trendingPolls.id, id)).limit(1);
      if (!poll) return res.status(404).json({ error: "Poll not found" });

      let linkedPerson: { name: string; trendScore: number | null; category: string | null } | null = null;
      if (poll.personId) {
        const [person] = await db.select({
          name: trendingPeople.name,
          trendScore: trendingPeople.trendScore,
          category: trendingPeople.category,
        }).from(trendingPeople).where(eq(trendingPeople.id, poll.personId)).limit(1);
        if (person) linkedPerson = person;
      }

      const linkedPersonBlock = linkedPerson
        ? `\nLinked celebrity: ${linkedPerson.name} (trend score: ${linkedPerson.trendScore?.toLocaleString() ?? "N/A"}, category: ${linkedPerson.category ?? "N/A"})`
        : "";
      const requestContent = typeof currentContent === "string" ? currentContent.trim() : "";
      const dbContent = String(poll[field as keyof typeof poll] || "").trim();
      const existingContent = requestContent || dbContent;
      const existingBlock = existingContent
        ? `\nCurrent content for reference (improve upon this):\n"${existingContent}"`
        : "";

      const systemPrompt = `You are writing content for a sentiment poll on VoxDex, a trend-tracking and prediction platform. Sentiment polls let users vote Support, Neutral, or Oppose on current topics. Use web search to keep facts current and accurate. Write plain text only. Keep it concise and easy to scan. Use short paragraphs with blank lines between them. If a list improves clarity, you may use simple '-' bullet points. Do not use markdown headers or bold formatting.`;

      let userPrompt: string;
      let maxTokens: number;

      if (field === "subjectText") {
        userPrompt = `Poll headline: "${poll.headline}"
Category: ${poll.category || "General"}${linkedPersonBlock}${existingBlock}

Write a compelling 1-3 sentence question or statement for this sentiment poll card. It should clearly frame the debate and invite users to weigh in with Support, Neutral, or Oppose. Be provocative but fair — present the tension without taking a side.`;
        maxTokens = 250;
      } else {
        userPrompt = `Poll headline: "${poll.headline}"
Category: ${poll.category || "General"}
Subject/Question: "${poll.subjectText || ""}"${linkedPersonBlock}${existingBlock}

Write a concise context section for this sentiment poll. This is shown on the detail page under a "Context" heading.

Requirements:
- Prefer 2-3 short paragraphs (1-3 sentences each), separated by blank lines.
- Optionally use 3-5 '-' bullet points only if it makes the content clearer.
- Stay balanced, factual, and neutral.
- Cover only the essentials: background, key perspectives, and what changed recently.
- Avoid long tangents and avoid repeating the headline.

Target length: about 90-150 words.`;
        maxTokens = 450;
      }

      const openai = new OpenAI({
        apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY || process.env.OPENAI_API_KEY,
      });

      const response = await openai.responses.create({
        model: getAiModel("aiDrafts"),
        tools: [{ type: "web_search" as any }],
        instructions: systemPrompt,
        input: userPrompt,
        max_output_tokens: maxTokens,
        temperature: 0.7,
      } as any);

      const content = stripCitations(((response as any).output_text
        || ((response as any).output || [])
             .filter((item: any) => item.type === "message")
             .flatMap((item: any) => item.content || [])
             .find((part: any) => part.type === "output_text" || part.type === "text")
             ?.text)?.trim() || "");
      if (!content) return res.status(500).json({ error: "AI returned empty content" });

      console.log(`[Sentiment Polls] AI draft generated for poll ${id}, field=${field}`);
      res.json({ content });
    } catch (error: any) {
      console.error("[Sentiment Polls] AI draft error:", error?.message || error);
      res.status(500).json({ error: "Failed to generate draft" });
    }
  });

  app.post("/api/admin/trending-polls/sync-image-urls", requireAuth, requireAdmin, async (req: AuthRequest, res) => {
    try {
      const polls = await db.select({
        id: trendingPolls.id,
        imageUrl: trendingPolls.imageUrl,
        personId: trendingPolls.personId,
      }).from(trendingPolls);

      let cleared = 0;
      for (const p of polls) {
        if (!p.personId && isConventionImageUrl(p.imageUrl)) {
          await db.update(trendingPolls)
            .set({ imageUrl: null })
            .where(eq(trendingPolls.id, p.id));
          cleared++;
        }
      }

      res.json({ success: true, cleared, total: polls.length });
    } catch (error: any) {
      console.error("Error syncing image URLs:", error.message);
      res.status(500).json({ error: "Failed to sync image URLs" });
    }
  });

  // ===========================================
  // ADMIN: IMPORT SENTIMENT POLLS FROM CSV
  // ===========================================

  app.post("/api/admin/import-sentiment-polls-csv", requireAuth, requireAdmin, async (req: AuthRequest, res) => {
    try {
      const { csvContent } = req.body;
      if (!csvContent || typeof csvContent !== "string") {
        return res.status(400).json({ error: "csvContent (string) is required" });
      }

      const VALID_CATS = new Set(["Tech", "Politics", "Business", "Music", "Sports", "Film & TV", "Gaming", "Creator", "misc", "Food & Drink", "Lifestyle"]);
      const CAT_MAP: Record<string, string> = {
        "custom topic": "misc", "custom": "misc", "misc": "misc",
        "tech": "Tech", "politics": "Politics", "business": "Business",
        "music": "Music", "sports": "Sports",
        "acting": "Film & TV", "film-tv": "Film & TV", "film & tv": "Film & TV",
        "gaming": "Gaming",
        "creator": "Creator",
        "food-drink": "Food & Drink", "food & drink": "Food & Drink",
        "lifestyle": "Lifestyle",
      };

      const normalizeCat = (raw: string): string | null => {
        const lower = raw.trim().toLowerCase();
        if (CAT_MAP[lower]) return CAT_MAP[lower];
        const cap = raw.trim().charAt(0).toUpperCase() + raw.trim().slice(1).toLowerCase();
        return VALID_CATS.has(cap) ? cap : (VALID_CATS.has(raw.trim()) ? raw.trim() : null);
      };

      const parseCSVContent = (content: string): string[][] => {
        const rows: string[][] = [];
        let i = 0;
        while (i < content.length) {
          const row: string[] = [];
          while (i < content.length && content[i] !== '\n') {
            if (content[i] === '"') {
              let cell = '';
              i++;
              while (i < content.length) {
                if (content[i] === '"' && content[i + 1] === '"') { cell += '"'; i += 2; }
                else if (content[i] === '"') { i++; break; }
                else { cell += content[i]; i++; }
              }
              row.push(cell);
              if (i < content.length && content[i] === ',') i++;
            } else {
              let cell = '';
              while (i < content.length && content[i] !== ',' && content[i] !== '\n') { cell += content[i]; i++; }
              row.push(cell.trim());
              if (i < content.length && content[i] === ',') i++;
            }
          }
          if (content[i] === '\n') i++;
          if (row.length > 0 && row.some(c => c !== '')) rows.push(row);
        }
        return rows;
      }

      const allRows = parseCSVContent(csvContent);
      if (allRows.length < 2) return res.status(400).json({ error: "CSV has no data rows" });

      const headers = allRows[0].map((h: string) => h.trim().toLowerCase());
      const idx = {
        category: headers.findIndex((h: string) => h === 'category'),
        headline: headers.findIndex((h: string) => h === 'headline'),
        slug: headers.findIndex((h: string) => h === 'slug'),
        subjectText: headers.findIndex((h: string) => h.replace(/[\s/]+/g, '').includes('subject') || h.includes('question')),
        description: headers.findIndex((h: string) => h === 'description'),
        celebrity: headers.findIndex((h: string) => h.includes('celebrity') || h.includes('linked')),
        seedSupport: headers.findIndex((h: string) => h.includes('support')),
        seedNeutral: headers.findIndex((h: string) => h.includes('neutral')),
        seedOppose: headers.findIndex((h: string) => h.includes('oppose')),
      };

      const allPeople = await db.select({ id: trackedPeople.id, name: trackedPeople.name }).from(trackedPeople);
      const peopleByName = new Map<string, string>();
      for (const p of allPeople) peopleByName.set(p.name.toLowerCase().trim(), p.id);

      let created = 0, updated = 0, skipped = 0;
      const warnings: string[] = [];
      const errors: string[] = [];

      for (let i = 1; i < allRows.length; i++) {
        const row = allRows[i];
        const rowNum = i + 1;
        const rawCat = row[idx.category]?.trim() || '';
        const category = normalizeCat(rawCat);
        if (!category) { errors.push(`Row ${rowNum}: Unknown category "${rawCat}"`); skipped++; continue; }

        const headline = row[idx.headline]?.trim() || '';
        const slug = row[idx.slug]?.trim().toLowerCase() || '';
        if (!headline || !slug) { errors.push(`Row ${rowNum}: Missing headline or slug`); skipped++; continue; }

        const subjectText = row[idx.subjectText]?.trim() || '';
        const description = row[idx.description]?.trim() || '';
        const rawCelebrity = row[idx.celebrity]?.trim() || '';
        let personId: string | null = null;
        if (rawCelebrity) {
          const match = peopleByName.get(rawCelebrity.toLowerCase().trim());
          if (match) { personId = match; }
          else { warnings.push(`Row ${rowNum}: Celebrity "${rawCelebrity}" not found`); }
        }

        const parseSeed = (raw: string, field: string): number => {
          const v = parseInt((raw || '').trim(), 10);
          if (isNaN(v) || v < 0) { if ((raw || '').trim()) warnings.push(`Row ${rowNum}: Invalid ${field} "${raw}", using 0`); return 0; }
          return v;
        };

        const seedSupportCount = parseSeed(row[idx.seedSupport], 'Seed Support');
        const seedNeutralCount = parseSeed(row[idx.seedNeutral], 'Seed Neutral');
        const seedOpposeCount = parseSeed(row[idx.seedOppose], 'Seed Oppose');

        try {
          const result = await db.execute(sql`
            INSERT INTO trending_polls (
              id, category, headline, slug, subject_text, description,
              person_id, seed_support_count, seed_neutral_count, seed_oppose_count,
              status, visibility, featured, created_at, updated_at
            ) VALUES (
              gen_random_uuid(), ${category}, ${headline}, ${slug}, ${subjectText}, ${description},
              ${personId}, ${seedSupportCount}, ${seedNeutralCount}, ${seedOpposeCount},
              'live', 'live', false, NOW(), NOW()
            )
            ON CONFLICT (slug) DO UPDATE SET
              category = EXCLUDED.category,
              headline = EXCLUDED.headline,
              subject_text = EXCLUDED.subject_text,
              description = EXCLUDED.description,
              person_id = EXCLUDED.person_id,
              seed_support_count = EXCLUDED.seed_support_count,
              seed_neutral_count = EXCLUDED.seed_neutral_count,
              seed_oppose_count = EXCLUDED.seed_oppose_count,
              status = 'live',
              visibility = 'live',
              updated_at = NOW()
            RETURNING (xmax = 0) AS inserted
          `);
          const wasInserted = (result.rows[0] as any)?.inserted;
          if (wasInserted === true || wasInserted === 't') created++; else updated++;
        } catch (err: any) {
          errors.push(`Row ${rowNum} (${slug}): ${err.message}`);
          skipped++;
        }
      }

      res.json({ success: true, created, updated, skipped, warnings, errors });
    } catch (error: any) {
      console.error("Error importing sentiment polls CSV:", error.message);
      res.status(500).json({ error: "Import failed", details: error.message });
    }
  });

  // ===========================================
  // ADMIN: SEED TRENDING POLLS FROM HARDCODED DATA
  // ===========================================

  app.post("/api/admin/seed-trending-polls", requireAuth, requireAdmin, async (req: AuthRequest, res) => {
    try {
      const SEED_TOPICS = [
        { headline: "Elon buys Twitter", description: "Was the $44B acquisition a smart move?", category: "Tech", approvePercent: 35, neutralPercent: 20, disapprovePercent: 45, totalVotes: 89432, personName: "Elon Musk" },
        { headline: "AI replacing jobs", description: "Should we embrace or regulate AI in the workplace?", category: "Tech", approvePercent: 28, neutralPercent: 32, disapprovePercent: 40, totalVotes: 156789 },
        { headline: "Taylor's Eras Tour pricing", description: "Are dynamic ticket prices fair to fans?", category: "Music", approvePercent: 15, neutralPercent: 25, disapprovePercent: 60, totalVotes: 234567, personName: "Taylor Swift" },
        { headline: "Spotify's royalty model", description: "Are artists fairly compensated by streaming?", category: "Music", approvePercent: 22, neutralPercent: 28, disapprovePercent: 50, totalVotes: 145678 },
        { headline: "MrBeast's philanthropy", description: "Is it genuine or just content?", category: "Creator", approvePercent: 68, neutralPercent: 20, disapprovePercent: 12, totalVotes: 98765, personName: "MrBeast" },
        { headline: "NFL Sunday Ticket pricing", description: "Is streaming football too expensive?", category: "Sports", approvePercent: 18, neutralPercent: 22, disapprovePercent: 60, totalVotes: 76543 },
        { headline: "Meta's rebrand to AI company", description: "Is the pivot from social media working?", category: "Tech", approvePercent: 25, neutralPercent: 35, disapprovePercent: 40, totalVotes: 112345, personName: "Mark Zuckerberg" },
        { headline: "Drake vs Kendrick beef", description: "Who won the rap battle?", category: "Music", approvePercent: 45, neutralPercent: 15, disapprovePercent: 40, totalVotes: 287654, personName: "Drake" },
        { headline: "LeBron's longevity", description: "Greatest athlete of all time?", category: "Sports", approvePercent: 55, neutralPercent: 25, disapprovePercent: 20, totalVotes: 198765, personName: "LeBron James" },
        { headline: "Crypto regulation", description: "Should governments control digital currencies?", category: "Business", approvePercent: 40, neutralPercent: 20, disapprovePercent: 40, totalVotes: 134567 },
        { headline: "TikTok ban debate", description: "National security vs free speech?", category: "Politics", approvePercent: 35, neutralPercent: 30, disapprovePercent: 35, totalVotes: 256789 },
        { headline: "OpenAI board drama", description: "Was firing Sam Altman justified?", category: "Tech", approvePercent: 15, neutralPercent: 25, disapprovePercent: 60, totalVotes: 189432, personName: "Sam Altman" },
        { headline: "Beyonce's country album", description: "Authentic exploration or cultural appropriation?", category: "Music", approvePercent: 65, neutralPercent: 20, disapprovePercent: 15, totalVotes: 176543, personName: "Beyonce" },
        { headline: "YouTube Premium worth it?", description: "Is ad-free viewing worth the subscription?", category: "Creator", approvePercent: 48, neutralPercent: 22, disapprovePercent: 30, totalVotes: 87654 },
        { headline: "F1's US expansion", description: "Is Formula 1 becoming too commercial?", category: "Sports", approvePercent: 40, neutralPercent: 35, disapprovePercent: 25, totalVotes: 65432 },
        { headline: "Billionaire space race", description: "Vanity project or advancing humanity?", category: "Tech", approvePercent: 30, neutralPercent: 25, disapprovePercent: 45, totalVotes: 145678 },
        { headline: "Student loan forgiveness", description: "Fair policy or overreach?", category: "Politics", approvePercent: 52, neutralPercent: 18, disapprovePercent: 30, totalVotes: 234567 },
        { headline: "Ozempic for weight loss", description: "Medical breakthrough or vanity?", category: "Business", approvePercent: 38, neutralPercent: 32, disapprovePercent: 30, totalVotes: 112345 },
        { headline: "Twitch streamer earnings", description: "Are top streamers overpaid?", category: "Creator", approvePercent: 25, neutralPercent: 35, disapprovePercent: 40, totalVotes: 78965 },
        { headline: "Climate activism tactics", description: "Is disruption effective or counterproductive?", category: "Politics", approvePercent: 35, neutralPercent: 25, disapprovePercent: 40, totalVotes: 167890 },
      ];

      let inserted = 0;
      let skipped = 0;
      const [seedMaxOrd] = await db.select({ max: sql<number>`COALESCE(MAX(display_order), 0)` }).from(trendingPolls);
      let nextDisplayOrder = (seedMaxOrd?.max || 0) + 1;

      for (const topic of SEED_TOPICS) {
        const [existing] = await db
          .select({ id: trendingPolls.id })
          .from(trendingPolls)
          .where(eq(trendingPolls.headline, topic.headline))
          .limit(1);

        if (existing) {
          skipped++;
          continue;
        }

        let personId: string | null = null;
        if (topic.personName) {
          const [matched] = await db
            .select({ id: trackedPeople.id })
            .from(trackedPeople)
            .where(ilike(trackedPeople.name, topic.personName))
            .limit(1);
          if (matched) {
            personId = matched.id;
          }
        }

        const seedSupportCount = Math.round((topic.approvePercent / 100) * topic.totalVotes);
        const seedNeutralCount = Math.round((topic.neutralPercent / 100) * topic.totalVotes);
        const seedOpposeCount = Math.round((topic.disapprovePercent / 100) * topic.totalVotes);

        await db.insert(trendingPolls).values({
          status: 'live',
          category: topic.category,
          headline: topic.headline,
          subjectText: topic.description,
          description: topic.description,
          personId,
          imageUrl: null,
          seedSupportCount,
          seedNeutralCount,
          seedOpposeCount,
          displayOrder: nextDisplayOrder,
          createdBy: req.userId || null,
        });
        nextDisplayOrder += 1;

        inserted++;
      }

      res.json({ success: true, inserted, skipped });
    } catch (error: any) {
      console.error("Error seeding trending polls:", error.message);
      res.status(500).json({ error: "Failed to seed trending polls" });
    }
  });

  // ===========================================
  // PUBLIC: OPINION POLLS (Multi-option polls)
  // ===========================================

  const OPINION_POLL_BUCKET_BASE = process.env.SUPABASE_URL
    ? `${process.env.SUPABASE_URL}/storage/v1/object/public/opinion-polls`
    : null;

  function slugifyOptionName(name: string): string {
    return name.toLowerCase().trim().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, "");
  }

  function opinionPollImageUrl(pollSlug: string | null | undefined): string | null {
    if (!OPINION_POLL_BUCKET_BASE || !pollSlug) return null;
    return `${OPINION_POLL_BUCKET_BASE}/${pollSlug}/1.webp`;
  }

  function opinionOptionImageUrl(pollSlug: string | null | undefined, optionName: string): string | null {
    if (!OPINION_POLL_BUCKET_BASE || !pollSlug) return null;
    return `${OPINION_POLL_BUCKET_BASE}/${pollSlug}/${slugifyOptionName(optionName)}.webp`;
  }

  // Returns a single poll in the same shape as GET /api/opinion-polls (list shape):
  // options[].votes/percent, totalOptions, totalVotes, userVote, relatedPeople.
  // Intentionally NOT the detail shape (no realVotes/seedVotes/orderIndex/commentCount)
  // so the client can patch the ['/api/opinion-polls'] cache directly with this payload.
  async function loadOpinionPollListShape(pollId: string, userId: string | null) {
    const [poll] = await db
      .select()
      .from(opinionPolls)
      .where(eq(opinionPolls.id, pollId))
      .limit(1);

    if (!poll) return null;

    const [relatedMap, optionRows, voteCounts, userVoteRows] = await Promise.all([
      getRelatedPeopleForCards("opinion_poll", [poll.id]),
      db
        .select({
          id: opinionPollOptions.id,
          name: opinionPollOptions.name,
          imageUrl: opinionPollOptions.imageUrl,
          personId: opinionPollOptions.personId,
          orderIndex: opinionPollOptions.orderIndex,
          seedCount: opinionPollOptions.seedCount,
          personName: trackedPeople.name,
          personAvatar: trendingPeople.avatar,
        })
        .from(opinionPollOptions)
        .leftJoin(trackedPeople, eq(opinionPollOptions.personId, trackedPeople.id))
        .leftJoin(trendingPeople, eq(opinionPollOptions.personId, trendingPeople.id))
        .where(eq(opinionPollOptions.pollId, poll.id))
        .orderBy(asc(opinionPollOptions.orderIndex)),
      db
        .select({
          optionId: opinionPollVotes.optionId,
          cnt: count(),
        })
        .from(opinionPollVotes)
        .where(eq(opinionPollVotes.pollId, poll.id))
        .groupBy(opinionPollVotes.optionId),
      userId
        ? db
            .select({ optionId: opinionPollVotes.optionId })
            .from(opinionPollVotes)
            .where(and(eq(opinionPollVotes.pollId, poll.id), eq(opinionPollVotes.userId, userId)))
            .limit(1)
        : Promise.resolve([] as Array<{ optionId: string }>),
    ]);

    const voteCountByOptionId = new Map(voteCounts.map(v => [v.optionId, Number(v.cnt)]));
    const optionsWithVotes = optionRows.map(o => {
      const realVotes = voteCountByOptionId.get(o.id) || 0;
      const seedVotes = o.seedCount || 0;
      return { ...o, displayVotes: realVotes + seedVotes };
    });
    const totalDisplayVotes = optionsWithVotes.reduce((sum, o) => sum + o.displayVotes, 0);
    const userVote = userVoteRows[0]?.optionId ?? null;
    const pollImage = poll.imageUrl || opinionPollImageUrl(poll.slug);

    return {
      ...poll,
      imageUrl: pollImage,
      options: optionsWithVotes.map(o => ({
        id: o.id,
        name: o.name,
        imageUrl: o.personAvatar || o.imageUrl || opinionOptionImageUrl(poll.slug, o.name),
        personId: o.personId,
        personName: o.personName || null,
        votes: o.displayVotes,
        percent: totalDisplayVotes > 0 ? Math.round((o.displayVotes / totalDisplayVotes) * 100) : 0,
      })),
      totalOptions: optionRows.length,
      totalVotes: totalDisplayVotes,
      userVote,
      relatedPersonIds: (relatedMap[poll.id] || []).map(rp => rp.id),
      relatedPeople: relatedMap[poll.id] || [],
    };
  }

  app.get("/api/opinion-polls", async (req, res) => {
    try {
      // Global /api/* middleware already populates req.userId from the
      // Authorization header (best-effort), so we read it directly instead
      // of paying for a duplicate Supabase getUser() round-trip.
      const userId = (req as AuthRequest).userId ?? null;

      const orderTerms = await orderRecencyForUser(
        req as AuthRequest,
        opinionPolls.createdAt,
        opinionPolls.category,
      );

      const polls = await db
        .select()
        .from(opinionPolls)
        .where(eq(opinionPolls.visibility, 'live'))
        .orderBy(...orderTerms, asc(opinionPolls.displayOrder));

      const opPollIds = polls.map(p => p.id);
      if (opPollIds.length === 0) {
        return res.json([]);
      }

      const [relatedMap, optionRows, voteCounts, userVotes] = await Promise.all([
        getRelatedPeopleForCards("opinion_poll", opPollIds),
        db
          .select({
            pollId: opinionPollOptions.pollId,
            id: opinionPollOptions.id,
            name: opinionPollOptions.name,
            imageUrl: opinionPollOptions.imageUrl,
            personId: opinionPollOptions.personId,
            orderIndex: opinionPollOptions.orderIndex,
            seedCount: opinionPollOptions.seedCount,
            personName: trackedPeople.name,
            personAvatar: trendingPeople.avatar,
          })
          .from(opinionPollOptions)
          .leftJoin(trackedPeople, eq(opinionPollOptions.personId, trackedPeople.id))
          .leftJoin(trendingPeople, eq(opinionPollOptions.personId, trendingPeople.id))
          .where(inArray(opinionPollOptions.pollId, opPollIds))
          .orderBy(asc(opinionPollOptions.pollId), asc(opinionPollOptions.orderIndex)),
        db
          .select({
            pollId: opinionPollVotes.pollId,
            optionId: opinionPollVotes.optionId,
            cnt: count(),
          })
          .from(opinionPollVotes)
          .where(inArray(opinionPollVotes.pollId, opPollIds))
          .groupBy(opinionPollVotes.pollId, opinionPollVotes.optionId),
        userId
          ? db
            .select({
              pollId: opinionPollVotes.pollId,
              optionId: opinionPollVotes.optionId,
            })
            .from(opinionPollVotes)
            .where(and(
              eq(opinionPollVotes.userId, userId),
              inArray(opinionPollVotes.pollId, opPollIds),
            ))
          : Promise.resolve([]),
      ]);

      const optionsByPollId = new Map<string, typeof optionRows>();
      for (const option of optionRows) {
        const existing = optionsByPollId.get(option.pollId);
        if (existing) existing.push(option);
        else optionsByPollId.set(option.pollId, [option]);
      }

      const voteCountByOptionId = new Map(voteCounts.map(v => [v.optionId, Number(v.cnt)]));
      const userVoteByPollId = new Map(userVotes.map(v => [v.pollId, v.optionId]));

      const result = polls.map((poll) => {
        const options = optionsByPollId.get(poll.id) || [];
        const optionsWithVotes = options.map(o => {
          const realVotes = voteCountByOptionId.get(o.id) || 0;
          const seedVotes = o.seedCount || 0;
          const displayVotes = realVotes + seedVotes;
          return { ...o, displayVotes };
        });
        const totalDisplayVotes = optionsWithVotes.reduce((sum, o) => sum + o.displayVotes, 0);
        const userVote = userVoteByPollId.get(poll.id) || null;

        const pollImage = poll.imageUrl || opinionPollImageUrl(poll.slug);

        return {
          ...poll,
          imageUrl: pollImage,
          options: optionsWithVotes.map(o => ({
            id: o.id,
            name: o.name,
            imageUrl: o.personAvatar || o.imageUrl || opinionOptionImageUrl(poll.slug, o.name),
            personId: o.personId,
            personName: o.personName || null,
            votes: o.displayVotes,
            percent: totalDisplayVotes > 0 ? Math.round((o.displayVotes / totalDisplayVotes) * 100) : 0,
          })),
          totalOptions: options.length,
          totalVotes: totalDisplayVotes,
          userVote,
          relatedPersonIds: (relatedMap[poll.id] || []).map(rp => rp.id),
          relatedPeople: relatedMap[poll.id] || [],
        };
      });

      res.json(result);
    } catch (error: any) {
      console.error("Error fetching opinion polls:", error.message);
      res.status(500).json({ error: "Failed to fetch opinion polls" });
    }
  });

  app.get("/api/opinion-polls/:slug", optionalAuth, async (req, res) => {
    try {
      const { slug } = req.params;
      const authReq = req as AuthRequest;
      const userId = authReq.userId || null;

      const [poll] = await db
        .select()
        .from(opinionPolls)
        .where(eq(opinionPolls.slug, slug))
        .limit(1);

      if (!poll) {
        return res.status(404).json({ error: "Opinion poll not found" });
      }

      const options = await db
        .select({
          id: opinionPollOptions.id,
          name: opinionPollOptions.name,
          imageUrl: opinionPollOptions.imageUrl,
          personId: opinionPollOptions.personId,
          orderIndex: opinionPollOptions.orderIndex,
          seedCount: opinionPollOptions.seedCount,
          personName: trackedPeople.name,
          personAvatar: trendingPeople.avatar,
        })
        .from(opinionPollOptions)
        .leftJoin(trackedPeople, eq(opinionPollOptions.personId, trackedPeople.id))
        .leftJoin(trendingPeople, eq(opinionPollOptions.personId, trendingPeople.id))
        .where(eq(opinionPollOptions.pollId, poll.id))
        .orderBy(asc(opinionPollOptions.orderIndex));

      const voteCounts = await db
        .select({
          optionId: opinionPollVotes.optionId,
          cnt: count(),
        })
        .from(opinionPollVotes)
        .where(eq(opinionPollVotes.pollId, poll.id))
        .groupBy(opinionPollVotes.optionId);

      const voteMap = new Map(voteCounts.map(v => [v.optionId, Number(v.cnt)]));

      const optionsWithVotes = options.map(o => {
        const realVotes = voteMap.get(o.id) || 0;
        const seedVotes = o.seedCount || 0;
        const displayVotes = realVotes + seedVotes;
        return { ...o, realVotes, seedVotes, displayVotes };
      });
      const totalDisplayVotes = optionsWithVotes.reduce((sum, o) => sum + o.displayVotes, 0);

      let userVote: string | null = null;
      if (userId) {
        const [uv] = await db
          .select({ optionId: opinionPollVotes.optionId })
          .from(opinionPollVotes)
          .where(and(eq(opinionPollVotes.pollId, poll.id), eq(opinionPollVotes.userId, userId)))
          .limit(1);
        if (uv) userVote = uv.optionId;
      }

      const [commentCount] = await db
        .select({ cnt: count() })
        .from(unifiedComments)
        .where(and(
          eq(unifiedComments.parentType, "opinion_poll"),
          eq(unifiedComments.parentId, poll.id),
        ));

      const pollImage = poll.imageUrl || opinionPollImageUrl(poll.slug);

      res.json({
        ...poll,
        imageUrl: pollImage,
        options: optionsWithVotes.map(o => ({
          id: o.id,
          name: o.name,
          imageUrl: o.personAvatar || o.imageUrl || opinionOptionImageUrl(poll.slug, o.name),
          personId: o.personId,
          personName: o.personName || null,
          orderIndex: o.orderIndex,
          votes: o.displayVotes,
          realVotes: o.realVotes,
          seedVotes: o.seedVotes,
          percent: totalDisplayVotes > 0 ? Math.round((o.displayVotes / totalDisplayVotes) * 100) : 0,
        })),
        totalVotes: totalDisplayVotes,
        userVote,
        commentCount: Number(commentCount?.cnt || 0),
      });
    } catch (error: any) {
      console.error("Error fetching opinion poll:", error.message);
      res.status(500).json({ error: "Failed to fetch opinion poll" });
    }
  });

  app.post("/api/opinion-polls/:slug/vote", requireAuth, async (req: AuthRequest, res) => {
    try {
      const { slug } = req.params;
      const { optionId, remove } = req.body;
      const wantsRemove = remove === true || remove === "true";
      const userId = req.userId!;
      if (!checkVoteRateLimit(userId)) {
        return res.status(429).json({ error: "Too many votes. Please slow down." });
      }

      const [poll] = await db
        .select({ id: opinionPolls.id, category: opinionPolls.category })
        .from(opinionPolls)
        .where(eq(opinionPolls.slug, slug))
        .limit(1);

      if (!poll) {
        return res.status(404).json({ error: "Poll not found" });
      }

      if (wantsRemove) {
        const [existingRemove] = await db
          .select({ id: opinionPollVotes.id })
          .from(opinionPollVotes)
          .where(and(eq(opinionPollVotes.pollId, poll.id), eq(opinionPollVotes.userId, userId)))
          .limit(1);
        if (existingRemove) {
          await db.delete(opinionPollVotes).where(eq(opinionPollVotes.id, existingRemove.id));
          await db
            .update(profiles)
            .set({ totalVotes: sql`GREATEST(${profiles.totalVotes} - 1, 0)` })
            .where(eq(profiles.id, userId));
        }
        const updatedPoll = await loadOpinionPollListShape(poll.id, userId);
        return res.json({ success: true, removed: true, poll: updatedPoll });
      }

      if (!optionId) {
        return res.status(400).json({ error: "optionId is required" });
      }

      const [option] = await db
        .select({ id: opinionPollOptions.id })
        .from(opinionPollOptions)
        .where(and(eq(opinionPollOptions.id, optionId), eq(opinionPollOptions.pollId, poll.id)))
        .limit(1);

      if (!option) {
        return res.status(400).json({ error: "Invalid option for this poll" });
      }

      const [existing] = await db
        .select({
          id: opinionPollVotes.id,
          optionId: opinionPollVotes.optionId,
          createdAt: opinionPollVotes.createdAt,
          updatedAt: opinionPollVotes.updatedAt,
        })
        .from(opinionPollVotes)
        .where(and(eq(opinionPollVotes.pollId, poll.id), eq(opinionPollVotes.userId, userId)))
        .limit(1);

      const sameUtcDay = (a: Date, b: Date) =>
        a.getUTCFullYear() === b.getUTCFullYear() &&
        a.getUTCMonth() === b.getUTCMonth() &&
        a.getUTCDate() === b.getUTCDate();

      let xpResult;
      if (existing) {
        if (existing.optionId !== optionId) {
          const created = new Date(existing.createdAt);
          const updated = new Date(existing.updatedAt);
          const now = new Date();
          const alreadyChangedBefore = updated.getTime() > created.getTime() + 2000;
          if (alreadyChangedBefore && sameUtcDay(updated, now)) {
            return res.status(403).json({
              error: "You can only change your vote once per day for this poll.",
            });
          }
        }
        await db.update(opinionPollVotes)
          .set({ optionId, updatedAt: new Date() })
          .where(eq(opinionPollVotes.id, existing.id));
      } else {
        await db.transaction(async (tx) => {
          await tx.insert(opinionPollVotes).values({
            pollId: poll.id,
            optionId,
            userId,
          });

          await tx.update(profiles)
            .set({ totalVotes: sql`${profiles.totalVotes} + 1` })
            .where(eq(profiles.id, userId));
        });

        // Phase 3: engagement signal for the poll's category.
        await upsertEngagement({
          userId,
          categoryId: poll.category,
          voteDelta: 1,
          source: "opinion-poll-vote",
        });

        try {
          xpResult = await gamificationService.awardXp(
            userId, 'vote_opinion',
            `opinion_poll_${poll.id}_${userId}`,
            { pollId: poll.id, optionId }
          );
        } catch (e) { console.error("XP award failed:", e); }
      }

      const updatedPoll = await loadOpinionPollListShape(poll.id, userId);
      res.json({ success: true, xp: xpResult ?? null, poll: updatedPoll });
    } catch (error: any) {
      console.error("Error voting on opinion poll:", error.message);
      res.status(500).json({ error: "Failed to vote" });
    }
  });

  // ===========================================
  // ADMIN: OPINION POLLS CRUD
  // ===========================================

  app.get("/api/admin/opinion-polls", requireAuth, requireAdmin, async (req: AuthRequest, res) => {
    try {
      const polls = await db
        .select()
        .from(opinionPolls)
        .orderBy(asc(opinionPolls.displayOrder), desc(opinionPolls.createdAt));
      const result = await Promise.all(polls.map(async (poll) => {
        const options = await db
          .select({
            id: opinionPollOptions.id,
            name: opinionPollOptions.name,
            imageUrl: opinionPollOptions.imageUrl,
            personId: opinionPollOptions.personId,
            orderIndex: opinionPollOptions.orderIndex,
            seedCount: opinionPollOptions.seedCount,
          })
          .from(opinionPollOptions)
          .where(eq(opinionPollOptions.pollId, poll.id))
          .orderBy(asc(opinionPollOptions.orderIndex));

        const [realVoteCount] = await db
          .select({ cnt: count() })
          .from(opinionPollVotes)
          .where(eq(opinionPollVotes.pollId, poll.id));

        const totalSeedVotes = options.reduce((sum, o) => sum + (o.seedCount || 0), 0);

        return { ...poll, options, totalVotes: Number(realVoteCount?.cnt || 0) + totalSeedVotes };
      }));
      res.json(result);
    } catch (error: any) {
      console.error("Error fetching admin opinion polls:", error.message);
      res.status(500).json({ error: "Failed to fetch opinion polls" });
    }
  });

  app.post("/api/admin/opinion-polls", requireAuth, requireAdmin, async (req: AuthRequest, res) => {
    try {
      const { title, slug, category, description, summary, imageUrl, featured, visibility, options, relatedPersonIds } = req.body;
      const adminId = req.userId!;

      if (!title || !slug || !category) {
        return res.status(400).json({ error: "Title, slug, and category are required" });
      }

      if (!options || !Array.isArray(options) || options.length < 3 || options.length > 20) {
        return res.status(400).json({ error: "Between 3 and 20 options are required" });
      }

      const [maxOrd] = await db.select({ max: sql<number>`COALESCE(MAX(display_order), 0)` }).from(opinionPolls);
      const nextDisplayOrder = (maxOrd?.max || 0) + 1;
      const [created] = await db.insert(opinionPolls).values({
        title,
        slug,
        category,
        description: description || null,
        summary: summary || null,
        imageUrl: imageUrl || null,
        featured: featured ?? false,
        visibility: visibility || 'draft',
        displayOrder: nextDisplayOrder,
        createdBy: adminId,
      }).returning();

      if (options.length > 0) {
        await db.insert(opinionPollOptions).values(
          options.map((opt: any, i: number) => ({
            pollId: created.id,
            name: opt.name,
            imageUrl: opt.imageUrl || null,
            personId: opt.personId || null,
            orderIndex: i,
            seedCount: opt.seedCount || 0,
          }))
        );
      }

      if (Array.isArray(relatedPersonIds)) {
        await syncRelatedPeople("opinion_poll", created.id, relatedPersonIds.filter(Boolean));
      }

      await db.insert(adminAuditLog).values({
        adminId,
        adminEmail: null,
        actionType: 'create_opinion_poll',
        targetTable: 'opinion_polls',
        targetId: created.id,
        newData: { ...created, options },
      });

      res.json(created);
    } catch (error: any) {
      console.error("Error creating opinion poll:", error.message, error.detail || "");
      const detail = error.detail || error.message || "Unknown error";
      if (detail.includes("unique") || detail.includes("duplicate")) {
        res.status(400).json({ error: "A poll with this slug already exists. Please choose a different slug." });
      } else {
        res.status(500).json({ error: `Failed to create opinion poll: ${detail}` });
      }
    }
  });

  app.patch("/api/admin/opinion-polls/:id", requireAuth, requireAdmin, async (req: AuthRequest, res) => {
    try {
      const { id } = req.params;
      const adminId = req.userId!;
      const { title, slug, category, description, summary, imageUrl, featured, visibility, displayOrder, options, relatedPersonIds } = req.body;

      const [existing] = await db.select().from(opinionPolls).where(eq(opinionPolls.id, id));
      if (!existing) {
        return res.status(404).json({ error: "Opinion poll not found" });
      }

      const updates: any = { updatedAt: new Date() };
      if (title !== undefined) updates.title = title;
      if (slug !== undefined) updates.slug = slug;
      if (category !== undefined) updates.category = category;
      if (description !== undefined) updates.description = description || null;
      if (summary !== undefined) updates.summary = summary || null;
      if (imageUrl !== undefined) updates.imageUrl = imageUrl || null;
      if (featured !== undefined) updates.featured = featured;
      if (visibility !== undefined) updates.visibility = visibility;
      if (displayOrder !== undefined) updates.displayOrder = displayOrder;

      const [updated] = await db.update(opinionPolls).set(updates).where(eq(opinionPolls.id, id)).returning();

      if (options && Array.isArray(options)) {
        await db.delete(opinionPollOptions).where(eq(opinionPollOptions.pollId, id));
        if (options.length > 0) {
          await db.insert(opinionPollOptions).values(
            options.map((opt: any, i: number) => ({
              pollId: id,
              name: opt.name,
              imageUrl: opt.imageUrl || null,
              personId: opt.personId || null,
              orderIndex: i,
              seedCount: opt.seedCount || 0,
            }))
          );
        }
      }

      if (Array.isArray(relatedPersonIds)) {
        await syncRelatedPeople("opinion_poll", id, relatedPersonIds.filter(Boolean));
      }

      await db.insert(adminAuditLog).values({
        adminId,
        adminEmail: null,
        actionType: 'update_opinion_poll',
        targetTable: 'opinion_polls',
        targetId: id,
        previousData: existing,
        newData: updated,
      });

      res.json(updated);
    } catch (error: any) {
      console.error("Error updating opinion poll:", error.message, error.detail || "");
      const detail = error.detail || error.message || "Unknown error";
      res.status(500).json({ error: `Failed to update opinion poll: ${detail}` });
    }
  });

  app.delete("/api/admin/opinion-polls/:id", requireAuth, requireAdmin, async (req: AuthRequest, res) => {
    try {
      const { id } = req.params;
      const adminId = req.userId!;

      const [existing] = await db.select().from(opinionPolls).where(eq(opinionPolls.id, id));
      if (!existing) {
        return res.status(404).json({ error: "Opinion poll not found" });
      }

      await db.delete(opinionPolls).where(eq(opinionPolls.id, id));

      await db.insert(adminAuditLog).values({
        adminId,
        adminEmail: null,
        actionType: 'delete_opinion_poll',
        targetTable: 'opinion_polls',
        targetId: id,
        previousData: existing,
      });

      res.json({ success: true });
    } catch (error: any) {
      console.error("Error deleting opinion poll:", error.message);
      res.status(500).json({ error: "Failed to delete opinion poll" });
    }
  });

  app.post("/api/admin/opinion-polls/reorder", requireAuth, requireAdmin, async (req: AuthRequest, res) => {
    try {
      const { orderedIds } = req.body;
      const adminId = req.userId!;
      if (!Array.isArray(orderedIds)) {
        return res.status(400).json({ error: "orderedIds must be an array" });
      }
      if (orderedIds.length > 0) {
        await Promise.all(
          orderedIds.map((id: string, i: number) =>
            db.update(opinionPolls).set({ displayOrder: i + 1, updatedAt: new Date() }).where(eq(opinionPolls.id, id)),
          ),
        );
      }
      await db.insert(adminAuditLog).values({
        adminId,
        adminEmail: null,
        actionType: "reorder_opinion_polls",
        targetTable: "opinion_polls",
        targetId: "bulk",
        newData: { orderedIds },
      });
      res.json({ success: true });
    } catch (error: any) {
      console.error("Error reordering opinion polls:", error.message);
      res.status(500).json({ error: "Failed to reorder opinion polls" });
    }
  });

  app.post("/api/admin/opinion-polls/:id/generate-ai-draft", requireAuth, requireAdmin, async (req: AuthRequest, res) => {
    try {
      const { id } = req.params;
      const { field, currentContent } = req.body;

      if (!field || !["description", "summary"].includes(field)) {
        return res.status(400).json({ error: "field must be 'description' or 'summary'" });
      }

      const [poll] = await db.select().from(opinionPolls).where(eq(opinionPolls.id, id)).limit(1);
      if (!poll) return res.status(404).json({ error: "Poll not found" });

      const options = await db.select().from(opinionPollOptions)
        .where(eq(opinionPollOptions.pollId, id))
        .orderBy(asc(opinionPollOptions.orderIndex));

      const optionNames = options.map(o => o.name).join(", ");
      const requestContent = typeof currentContent === "string" ? currentContent.trim() : "";
      const dbContent = String(poll[field as keyof typeof poll] || "").trim();
      const existingContent = requestContent || dbContent;
      const existingBlock = existingContent
        ? `\nCurrent content for reference (improve upon this):\n"${existingContent}"`
        : "";

      const systemPrompt = `You are writing content for an opinion poll on VoxDex, a trend-tracking and prediction platform. Opinion polls let users pick a favorite option from a list. Use web search to keep facts current and accurate. Write plain text only. Keep it concise and easy to scan. Use short paragraphs with blank lines between them. If a list improves clarity, you may use simple '-' bullet points. Do not use markdown headers or bold formatting.`;

      let userPrompt: string;
      let maxTokens: number;

      if (field === "description") {
        userPrompt = `Poll title: "${poll.title}"
Category: ${poll.category || "General"}
Options: ${optionNames}${existingBlock}

Write a compelling 1-3 sentence question or framing statement for this opinion poll card. It should clearly present the choice and invite engagement. Make it conversational and intriguing.`;
        maxTokens = 250;
      } else {
        userPrompt = `Poll title: "${poll.title}"
Category: ${poll.category || "General"}
Options: ${optionNames}
${poll.description ? `Subject/Question: "${poll.description}"` : ""}${existingBlock}

Write a concise context section for this opinion poll. This is shown on the detail page under a "Context" heading.

Requirements:
- Prefer 2-3 short paragraphs (1-3 sentences each), separated by blank lines.
- Optionally use 3-5 '-' bullet points only if it improves readability.
- Be balanced and neutral across options.
- Focus on essentials: why this choice matters, what distinguishes options, and recent context.
- Keep it practical and avoid overexplaining.

Target length: about 90-150 words.`;
        maxTokens = 450;
      }

      const openai = new OpenAI({
        apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY || process.env.OPENAI_API_KEY,
      });

      const response = await openai.responses.create({
        model: getAiModel("aiDrafts"),
        tools: [{ type: "web_search" as any }],
        instructions: systemPrompt,
        input: userPrompt,
        max_output_tokens: maxTokens,
        temperature: 0.7,
      } as any);

      const content = stripCitations(((response as any).output_text
        || ((response as any).output || [])
             .filter((item: any) => item.type === "message")
             .flatMap((item: any) => item.content || [])
             .find((part: any) => part.type === "output_text" || part.type === "text")
             ?.text)?.trim() || "");
      if (!content) return res.status(500).json({ error: "AI returned empty content" });

      console.log(`[Opinion Polls] AI draft generated for poll ${id}, field=${field}`);
      res.json({ content });
    } catch (error: any) {
      console.error("[Opinion Polls] AI draft error:", error?.message || error);
      res.status(500).json({ error: "Failed to generate draft" });
    }
  });

  registerCronRoutes(app);

  // ============ APPROVAL LEADERS ============
  // Get highest and lowest rated celebrities based on user votes
  app.get("/api/approval-leaders", async (req, res) => {
    try {
      const voteStats = await db
        .select({
          personId: userVotes.personId,
          personName: sql<string>`max(${userVotes.personName})`,
          voteCount: sql<number>`cast(count(*) as int)`,
          totalRating: sql<number>`coalesce(sum(${userVotes.rating}), 0)::double precision`,
        })
        .from(userVotes)
        .groupBy(userVotes.personId);

      if (!voteStats || voteStats.length === 0) {
        // Return fallback celebrities for design preview when no votes exist
        // Fetch actual avatar images from trending_people table
        const [elonData] = await db.select({ avatar: trendingPeople.avatar, category: trendingPeople.category })
          .from(trendingPeople)
          .where(sql`LOWER(${trendingPeople.name}) LIKE '%elon musk%'`)
          .limit(1);
        
        const [nickData] = await db.select({ avatar: trendingPeople.avatar, category: trendingPeople.category })
          .from(trendingPeople)
          .where(sql`LOWER(${trendingPeople.name}) LIKE '%nick fuentes%'`)
          .limit(1);

        const fallbackHighest = {
          personId: "elon-musk",
          personName: "Elon Musk",
          avgRating: 4.7,
          voteCount: 0,
          approvalPercent: 92.5,
          avatar: elonData?.avatar || null,
          category: elonData?.category || "Tech"
        };
        const fallbackLowest = {
          personId: "nick-fuentes",
          personName: "Nick Fuentes",
          avgRating: 1.3,
          voteCount: 0,
          approvalPercent: 7.5,
          avatar: nickData?.avatar || null,
          category: nickData?.category || "Politics"
        };
        return res.json({ highest: fallbackHighest, lowest: fallbackLowest, isFallback: true });
      }

      const personStats = voteStats.map((p) => {
        const vc = Number(p.voteCount);
        const tr = Number(p.totalRating);
        const avg = vc > 0 ? tr / vc : 0;
        return {
          personId: p.personId,
          personName: p.personName,
          avgRating: avg,
          voteCount: vc,
          approvalPercent: vc > 0 ? Math.round(((avg - 1) / 4) * 100) : 0,
        };
      });

      // Sort to find highest and lowest
      personStats.sort((a, b) => b.avgRating - a.avgRating);
      
      const highest = personStats[0] || null;
      const lowest = personStats.length > 1 ? personStats[personStats.length - 1] : null;

      // Get avatar from trending_people for each
      let highestWithAvatar = null;
      let lowestWithAvatar = null;

      if (highest) {
        const [personData] = await db.select({ avatar: trendingPeople.avatar, category: trendingPeople.category })
          .from(trendingPeople)
          .where(eq(trendingPeople.id, highest.personId))
          .limit(1);
        highestWithAvatar = {
          ...highest,
          avatar: personData?.avatar || null,
          category: personData?.category || null,
        };
      }

      if (lowest) {
        const [personData] = await db.select({ avatar: trendingPeople.avatar, category: trendingPeople.category })
          .from(trendingPeople)
          .where(eq(trendingPeople.id, lowest.personId))
          .limit(1);
        lowestWithAvatar = {
          ...lowest,
          avatar: personData?.avatar || null,
          category: personData?.category || null,
        };
      }

      res.json({
        highest: highestWithAvatar,
        lowest: lowestWithAvatar,
      });
    } catch (error: any) {
      console.error("[Approval Leaders] Error:", error);
      res.status(500).json({ error: "Failed to fetch approval leaders" });
    }
  });

  // ============ REAL-WORLD MARKETS (Open Markets) API ============

  async function getMarketEngagementPreview(marketIds: string[]) {
    const recentParticipantsByMarket = new Map<string, Array<{
      userId: string;
      username: string | null;
      displayName: string;
      avatarUrl: string | null;
      isAgent: boolean;
    }>>();
    const activeParticipantCountByMarket = new Map<string, number>();
    const latestRationaleByMarket = new Map<string, {
      text: string;
      authorUsername: string | null;
      authorDisplayName: string;
      authorAvatarUrl: string | null;
      isAgent: boolean;
    }>();

    if (marketIds.length === 0) {
      return {
        recentParticipantsByMarket,
        activeParticipantCountByMarket,
        latestRationaleByMarket,
      };
    }

    const bets = await db
      .select({
        marketId: marketBets.marketId,
        userId: marketBets.userId,
        createdAt: marketBets.createdAt,
        betMetadata: marketBets.betMetadata,
      })
      .from(marketBets)
      .where(and(
        inArray(marketBets.marketId, marketIds),
        eq(marketBets.status, "active"),
      ))
      .orderBy(desc(marketBets.createdAt));

    if (bets.length === 0) {
      return {
        recentParticipantsByMarket,
        activeParticipantCountByMarket,
        latestRationaleByMarket,
      };
    }

    const userIds = Array.from(new Set(bets.map((bet) => bet.userId)));
    const profileRows = userIds.length > 0
      ? await db
          .select({
            id: profiles.id,
            username: profiles.username,
            avatarUrl: profiles.avatarUrl,
            isAgent: profiles.isAgent,
          })
          .from(profiles)
          .where(inArray(profiles.id, userIds))
      : [];

    const profileMap = new Map(profileRows.map((profile) => [profile.id, profile]));
    const participantSets = new Map<string, Set<string>>();
    const countedParticipants = new Map<string, Set<string>>();

    for (const bet of bets) {
      const profile = profileMap.get(bet.userId);
      const displayName = profile?.username || "Anonymous";
      const username = profile?.username || null;
      const avatarUrl = profile?.avatarUrl || null;
      const isAgent = profile?.isAgent ?? false;

      const counted = countedParticipants.get(bet.marketId) || new Set<string>();
      counted.add(bet.userId);
      countedParticipants.set(bet.marketId, counted);
      activeParticipantCountByMarket.set(bet.marketId, counted.size);

      const seen = participantSets.get(bet.marketId) || new Set<string>();
      if (!seen.has(bet.userId)) {
        seen.add(bet.userId);
        participantSets.set(bet.marketId, seen);

        const participants = recentParticipantsByMarket.get(bet.marketId) || [];
        if (participants.length < 3) {
          participants.push({
            userId: bet.userId,
            username,
            displayName,
            avatarUrl,
            isAgent,
          });
          recentParticipantsByMarket.set(bet.marketId, participants);
        }
      }

      const rationaleText =
        bet.betMetadata &&
        typeof bet.betMetadata === "object" &&
        "rationale" in (bet.betMetadata as Record<string, unknown>)
          ? String((bet.betMetadata as Record<string, unknown>).rationale || "").trim()
          : "";

      if (isAgent && rationaleText && !latestRationaleByMarket.has(bet.marketId)) {
        latestRationaleByMarket.set(bet.marketId, {
          text: rationaleText,
          authorUsername: username,
          authorDisplayName: displayName,
          authorAvatarUrl: avatarUrl,
          isAgent,
        });
      }
    }

    return {
      recentParticipantsByMarket,
      activeParticipantCountByMarket,
      latestRationaleByMarket,
    };
  }

  app.get("/api/open-markets", optionalAuth, async (req: AuthRequest, res) => {
    try {
      const { category, featured, limit } = req.query;

      const conditions = [
        eq(predictionMarkets.marketType, "community"),
        eq(predictionMarkets.status, "OPEN"),
        inArray(predictionMarkets.visibility, ["live", "inactive"]),
      ];

      if (category && typeof category === "string") {
        conditions.push(eq(predictionMarkets.category, category));
      }

      if (featured === "true") {
        conditions.push(eq(predictionMarkets.featured, true));
      }

      const orderTerms = await orderFeaturedRecencyForUser(
        req,
        predictionMarkets.featured,
        predictionMarkets.createdAt,
        predictionMarkets.category,
      );

      const markets = await db
        .select()
        .from(predictionMarkets)
        .where(and(...conditions))
        .orderBy(
          ...orderTerms,
          asc(predictionMarkets.cmsDisplayOrder),
        )
        .limit(limit && typeof limit === "string" ? parseInt(limit, 10) || 50 : 50);

      const marketIds = markets.map((m) => m.id);
      let entries: any[] = [];
      if (marketIds.length > 0) {
        entries = await db
          .select()
          .from(marketEntries)
          .where(inArray(marketEntries.marketId, marketIds))
          .orderBy(asc(marketEntries.displayOrder));
      }

      const entriesByMarket = new Map<string, typeof entries>();
      for (const entry of entries) {
        const list = entriesByMarket.get(entry.marketId) || [];
        list.push(entry);
        entriesByMarket.set(entry.marketId, list);
      }

      const personIds = markets.map(m => m.personId).filter(Boolean) as string[];
      let personAvatars = new Map<string, string>();
      let personNames = new Map<string, string>();
      if (personIds.length > 0) {
        const people = await db
          .select({ id: trendingPeople.id, avatar: trendingPeople.avatar, name: trendingPeople.name })
          .from(trendingPeople)
          .where(inArray(trendingPeople.id, personIds));
        for (const p of people) {
          if (p.avatar) personAvatars.set(p.id, p.avatar);
          if (p.name) personNames.set(p.id, p.name);
        }
      }

      const engagement = await getMarketEngagementPreview(marketIds);
      const relatedMap = await getRelatedPeopleForCards("world_market", marketIds);

      const result = markets.map((m) => ({
        ...m,
        entries: entriesByMarket.get(m.id) || [],
        linkedPersonAvatar: m.personId ? personAvatars.get(m.personId) || null : null,
        linkedPersonName: m.personId ? personNames.get(m.personId) || null : null,
        recentParticipants: engagement.recentParticipantsByMarket.get(m.id) || [],
        activeParticipantCount: engagement.activeParticipantCountByMarket.get(m.id) || 0,
        latestRationale: engagement.latestRationaleByMarket.get(m.id) || null,
        relatedPersonIds: (relatedMap[m.id] || []).map(rp => rp.id),
        relatedPeople: relatedMap[m.id] || [],
      }));

      res.json(result);
    } catch (error: any) {
      console.error("[Open Markets] List error:", error);
      res.status(500).json({ error: "Failed to fetch open markets" });
    }
  });

  app.get("/api/open-markets/:slug", async (req, res) => {
    try {
      const { slug } = req.params;

      const [market] = await db
        .select({
          id: predictionMarkets.id,
          marketType: predictionMarkets.marketType,
          status: predictionMarkets.status,
          title: predictionMarkets.title,
          slug: predictionMarkets.slug,
          summary: predictionMarkets.summary,
          rules: predictionMarkets.rules,
          startAt: predictionMarkets.startAt,
          endAt: predictionMarkets.endAt,
          resolvedAt: predictionMarkets.resolvedAt,
          openMarketType: predictionMarkets.openMarketType,
          teaser: predictionMarkets.teaser,
          description: predictionMarkets.description,
          category: predictionMarkets.category,
          tags: predictionMarkets.tags,
          coverImageUrl: predictionMarkets.coverImageUrl,
          sourceUrl: predictionMarkets.sourceUrl,
          featured: predictionMarkets.featured,
          timezone: predictionMarkets.timezone,
          resolutionCriteria: predictionMarkets.resolutionCriteria,
          resolutionSources: predictionMarkets.resolutionSources,
          resolutionNotes: predictionMarkets.resolutionNotes,
          resolveMethod: predictionMarkets.resolveMethod,
          voidReason: predictionMarkets.voidReason,
          closeAt: predictionMarkets.closeAt,
          personId: predictionMarkets.personId,
          visibility: predictionMarkets.visibility,
          inactiveMessage: predictionMarkets.inactiveMessage,
          weekNumber: predictionMarkets.weekNumber,
          tieRule: predictionMarkets.tieRule,
          cadence: predictionMarkets.cadence,
          baselineScore: predictionMarkets.baselineScore,
          seedParticipants: predictionMarkets.seedParticipants,
          seedVolume: predictionMarkets.seedVolume,
          underlying: predictionMarkets.underlying,
          metric: predictionMarkets.metric,
          strike: predictionMarkets.strike,
          unit: predictionMarkets.unit,
          createdAt: predictionMarkets.createdAt,
        })
        .from(predictionMarkets)
        .where(
          and(
            eq(predictionMarkets.slug, slug),
            inArray(predictionMarkets.visibility, ["live", "inactive", "archived"])
          )
        )
        .limit(1);

      if (!market) {
        return res.status(404).json({ error: "Market not found" });
      }

      const entries = await db
        .select()
        .from(marketEntries)
        .where(eq(marketEntries.marketId, market.id))
        .orderBy(asc(marketEntries.displayOrder));

      const betCounts = await db
        .select({
          entryId: marketBets.entryId,
          betCount: count(),
        })
        .from(marketBets)
        .where(eq(marketBets.marketId, market.id))
        .groupBy(marketBets.entryId);

      const betCountMap = new Map<string, number>();
      for (const bc of betCounts) {
        betCountMap.set(bc.entryId, Number(bc.betCount));
      }

      const entriesWithCounts = entries.map((e) => ({
        ...e,
        betCount: betCountMap.get(e.id) || 0,
      }));

      const [participantResult] = await db
        .select({
          uniqueParticipants: sql<number>`COUNT(DISTINCT ${marketBets.userId})`,
        })
        .from(marketBets)
        .where(eq(marketBets.marketId, market.id));

      let linkedPersonName: string | null = null;
      let linkedPersonAvatar: string | null = null;
      if (market.personId) {
        const [person] = await db
          .select({ name: trendingPeople.name, avatar: trendingPeople.avatar })
          .from(trendingPeople)
          .where(eq(trendingPeople.id, market.personId))
          .limit(1);
        if (person) {
          linkedPersonName = person.name;
          linkedPersonAvatar = person.avatar;
        }
      }

      const resolutionSummary = buildMarketResolutionSummary(market.resolutionNotes);

      res.json({
        ...market,
        entries: entriesWithCounts,
        // Deprecated in C2: client comment surfaces now fetch /api/comments explicitly.
        comments: [],
        totalParticipants: Number(participantResult?.uniqueParticipants || 0),
        linkedPersonName,
        linkedPersonAvatar,
        resolutionSummary,
      });
    } catch (error) {
      console.error("[Open Markets] Detail error:", error);
      res.status(500).json({ error: "Failed to fetch market details" });
    }
  });

  app.post("/api/admin/open-markets", requireAuth, requireAdmin, async (req, res) => {
    try {
      const authReq = req as AuthRequest;
      const {
        title, slug, openMarketType, teaser, summary, description, category,
        tags, coverImageUrl, sourceUrl, featured, timezone, startAt, endAt,
        closeAt, resolutionCriteria, resolutionSources, resolveMethod, rules,
        seedParticipants, seedVolume, underlying, metric, strike, unit,
        entries: entryList, personId, isLive, visibility, inactiveMessage,
        relatedPersonIds,
      } = req.body;

      if (!openMarketType || !["binary", "multi", "updown"].includes(openMarketType)) {
        return res.status(400).json({ error: "openMarketType must be binary, multi, or updown" });
      }

      if (!title || !slug || !endAt) {
        return res.status(400).json({ error: "title, slug, and endAt are required" });
      }

      if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) {
        return res.status(400).json({ error: "slug must be URL-safe (lowercase letters, numbers, dashes)" });
      }

      if (!Array.isArray(entryList) || entryList.length === 0) {
        return res.status(400).json({ error: "entries array is required" });
      }

      if (openMarketType === "binary" && entryList.length !== 2) {
        return res.status(400).json({ error: "Binary markets must have exactly 2 entries" });
      }

      if (openMarketType === "multi" && (entryList.length < 3 || entryList.length > 20)) {
        return res.status(400).json({ error: "Multi markets must have 3-20 entries" });
      }

      if (openMarketType === "updown") {
        if (entryList.length !== 2) {
          return res.status(400).json({ error: "Up/Down markets must have exactly 2 entries" });
        }
        if (!underlying || !metric || !strike || !unit) {
          return res.status(400).json({ error: "Up/Down markets require underlying, metric, strike, and unit" });
        }
      }

      const [cmsMax] = await db
        .select({ max: sql<number>`COALESCE(MAX(cms_display_order), 0)` })
        .from(predictionMarkets)
        .where(eq(predictionMarkets.marketType, "community"));
      const nextCmsOrder = (cmsMax?.max || 0) + 1;

      const [createdMarket] = await db
        .insert(predictionMarkets)
        .values({
          marketType: "community",
          title,
          slug,
          openMarketType,
          teaser: teaser || null,
          summary: summary || null,
          description: description || null,
          category: category || null,
          tags: tags || null,
          coverImageUrl: coverImageUrl || null,
          sourceUrl: sourceUrl || null,
          featured: featured || false,
          timezone: timezone || "UTC",
          startAt: startAt ? new Date(startAt) : new Date(),
          endAt: new Date(endAt),
          closeAt: closeAt ? new Date(closeAt) : null,
          resolutionCriteria: resolutionCriteria || null,
          resolutionSources: resolutionSources || null,
          resolveMethod: resolveMethod || null,
          rules: rules || null,
          seedParticipants: seedParticipants || 0,
          seedVolume: seedVolume ? String(seedVolume) : "0",
          underlying: underlying || null,
          metric: metric || null,
          strike: strike ? String(strike) : null,
          unit: unit || null,
          createdBy: authReq.userId,
          status: "OPEN",
          personId: personId || null,
          isLive: isLive !== false,
          visibility: ["draft", "live", "inactive", "archived"].includes(visibility) ? visibility : "live",
          inactiveMessage: inactiveMessage || null,
          cmsDisplayOrder: nextCmsOrder,
        })
        .returning();

      const createdEntries = await db
        .insert(marketEntries)
        .values(
          entryList.map((e: any, i: number) => ({
            marketId: createdMarket.id,
            entryType: e.personId ? "person" : "custom" as const,
            personId: e.personId || null,
            label: e.label,
            description: e.description || null,
            displayOrder: e.displayOrder ?? i,
            seedCount: e.seedCount || 0,
            imageUrl: e.imageUrl || null,
          }))
        )
        .returning();

      if (Array.isArray(relatedPersonIds)) {
        await syncRelatedPeople("world_market", createdMarket.id, relatedPersonIds.filter(Boolean));
      }

      res.json({ ...createdMarket, entries: createdEntries });
    } catch (error: any) {
      console.error("[Open Markets] Create error:", error);
      if (error?.code === "23505") {
        return res.status(409).json({ error: "A market with this slug already exists" });
      }
      res.status(500).json({ error: "Failed to create market" });
    }
  });

  app.patch("/api/admin/open-markets/:id", requireAuth, requireAdmin, async (req, res) => {
    try {
      const { id } = req.params;

      const [existing] = await db
        .select()
        .from(predictionMarkets)
        .where(
          and(
            eq(predictionMarkets.id, id),
            eq(predictionMarkets.marketType, "community")
          )
        )
        .limit(1);

      if (!existing) {
        return res.status(404).json({ error: "Market not found" });
      }

      if (existing.status !== "OPEN") {
        return res.status(400).json({ error: "Can only update markets with OPEN status" });
      }

      const {
        title, teaser, summary, description, category, tags, coverImageUrl,
        sourceUrl, featured, timezone, startAt, endAt, closeAt,
        resolutionCriteria, resolutionSources, resolveMethod, rules,
        seedParticipants, seedVolume, underlying, metric, strike, unit,
        openMarketType, personId, isLive, visibility, inactiveMessage, entries: entryList,
        relatedPersonIds,
      } = req.body;

      const updates: Record<string, any> = { updatedAt: new Date() };
      if (title !== undefined) updates.title = title;
      if (teaser !== undefined) updates.teaser = teaser;
      if (summary !== undefined) updates.summary = summary;
      if (description !== undefined) updates.description = description;
      if (category !== undefined) updates.category = category;
      if (tags !== undefined) updates.tags = tags;
      if (coverImageUrl !== undefined) updates.coverImageUrl = coverImageUrl;
      if (sourceUrl !== undefined) updates.sourceUrl = sourceUrl;
      if (featured !== undefined) updates.featured = featured;
      if (timezone !== undefined) updates.timezone = timezone;
      if (startAt !== undefined) updates.startAt = new Date(startAt);
      if (endAt !== undefined) updates.endAt = new Date(endAt);
      if (closeAt !== undefined) updates.closeAt = closeAt ? new Date(closeAt) : null;
      if (resolutionCriteria !== undefined) updates.resolutionCriteria = resolutionCriteria;
      if (resolutionSources !== undefined) updates.resolutionSources = resolutionSources;
      if (resolveMethod !== undefined) updates.resolveMethod = resolveMethod;
      if (rules !== undefined) updates.rules = rules;
      if (seedParticipants !== undefined) updates.seedParticipants = seedParticipants;
      if (seedVolume !== undefined) updates.seedVolume = String(seedVolume);
      if (underlying !== undefined) updates.underlying = underlying;
      if (metric !== undefined) updates.metric = metric;
      if (strike !== undefined) updates.strike = strike ? String(strike) : null;
      if (unit !== undefined) updates.unit = unit;
      if (openMarketType !== undefined) updates.openMarketType = openMarketType;
      if (personId !== undefined) updates.personId = personId || null;
      if (isLive !== undefined) updates.isLive = isLive;
      if (visibility !== undefined && ["draft", "live", "inactive", "archived"].includes(visibility)) {
        updates.visibility = visibility;
        updates.isLive = visibility === "live" || visibility === "inactive";
      }
      if (inactiveMessage !== undefined) updates.inactiveMessage = inactiveMessage || null;

      const [updated] = await db
        .update(predictionMarkets)
        .set(updates)
        .where(eq(predictionMarkets.id, id))
        .returning();

      if (entryList && Array.isArray(entryList)) {
        const existingEntries = await db
          .select()
          .from(marketEntries)
          .where(eq(marketEntries.marketId, id))
          .orderBy(asc(marketEntries.displayOrder));

        for (let i = 0; i < entryList.length; i++) {
          const e = entryList[i];
          if (i < existingEntries.length) {
            await db
              .update(marketEntries)
              .set({
                label: e.label,
                description: e.description || null,
                displayOrder: e.displayOrder ?? i,
                seedCount: e.seedCount || 0,
                imageUrl: e.imageUrl || null,
                personId: e.personId || null,
                entryType: e.personId ? "person" : "custom",
              })
              .where(eq(marketEntries.id, existingEntries[i].id));
          } else {
            await db
              .insert(marketEntries)
              .values({
                marketId: id,
                entryType: e.personId ? "person" : "custom",
                personId: e.personId || null,
                label: e.label,
                description: e.description || null,
                displayOrder: e.displayOrder ?? i,
                seedCount: e.seedCount || 0,
                imageUrl: e.imageUrl || null,
              });
          }
        }
        if (existingEntries.length > entryList.length) {
          const idsToRemove = existingEntries.slice(entryList.length).map(e => e.id);
          if (idsToRemove.length > 0) {
            await db.delete(marketEntries).where(inArray(marketEntries.id, idsToRemove));
          }
        }
      }

      if (Array.isArray(relatedPersonIds)) {
        await syncRelatedPeople("world_market", id, relatedPersonIds.filter(Boolean));
      }

      const finalEntries = await db
        .select()
        .from(marketEntries)
        .where(eq(marketEntries.marketId, id))
        .orderBy(asc(marketEntries.displayOrder));

      res.json({ ...updated, entries: finalEntries });
    } catch (error) {
      console.error("[Open Markets] Update error:", error);
      res.status(500).json({ error: "Failed to update market" });
    }
  });

  app.post("/api/admin/open-markets/:id/settle", requireAuth, requireAdmin, async (req, res) => {
    try {
      const authReq = req as AuthRequest;
      const { id } = req.params;
      const { winnerEntryId, resolutionNotes } = req.body;

      if (!winnerEntryId) {
        return res.status(400).json({ error: "winnerEntryId is required" });
      }

      const [market] = await db
        .select()
        .from(predictionMarkets)
        .where(
          and(
            eq(predictionMarkets.id, id),
            eq(predictionMarkets.marketType, "community")
          )
        )
        .limit(1);

      if (!market) {
        return res.status(404).json({ error: "Market not found" });
      }

      if (market.status !== "OPEN" && market.status !== "CLOSED_PENDING") {
        return res.status(400).json({ error: "Market is not OPEN or CLOSED_PENDING" });
      }

      const [winnerEntry] = await db
        .select()
        .from(marketEntries)
        .where(
          and(
            eq(marketEntries.id, winnerEntryId),
            eq(marketEntries.marketId, id)
          )
        )
        .limit(1);

      if (!winnerEntry) {
        return res.status(400).json({ error: "Winner entry not found in this market" });
      }

      const { settleMarketBets } = await import("./jobs/market-resolver");
      const settlementResult = await settleMarketBets(id, winnerEntryId, {
        resolveMethod: "admin_manual",
        resolutionNotes: resolutionNotes || null,
        settledBy: authReq.userId,
      });

      const [updatedMarket] = await db
        .select()
        .from(predictionMarkets)
        .where(eq(predictionMarkets.id, id))
        .limit(1);

      res.json({ ...updatedMarket, settlement: settlementResult });
    } catch (error) {
      console.error("[Open Markets] Settle error:", error);
      res.status(500).json({ error: "Failed to settle market" });
    }
  });

  app.post("/api/admin/open-markets/:id/void", requireAuth, requireAdmin, async (req, res) => {
    try {
      const { id } = req.params;
      const { voidReason } = req.body;

      if (!voidReason) {
        return res.status(400).json({ error: "voidReason is required" });
      }

      const [market] = await db
        .select()
        .from(predictionMarkets)
        .where(
          and(
            eq(predictionMarkets.id, id),
            eq(predictionMarkets.marketType, "community")
          )
        )
        .limit(1);

      if (!market) {
        return res.status(404).json({ error: "Market not found" });
      }

      if (market.status === "RESOLVED" || market.status === "VOID") {
        return res.status(400).json({ error: "Market is already resolved or voided" });
      }

      const { voidMarketBets } = await import("./jobs/market-resolver");
      await voidMarketBets(id);

      const [updatedMarket] = await db
        .update(predictionMarkets)
        .set({
          status: "VOID",
          voidReason,
          settledBy: (req as AuthRequest).userId ?? null,
          resolveMethod: "admin_manual",
          resolutionNotes: JSON.stringify({
            type: "community",
            pendingReason: "admin_voided",
            adminReason: voidReason,
          }),
          updatedAt: new Date(),
        })
        .where(eq(predictionMarkets.id, id))
        .returning();

      res.json(updatedMarket);
    } catch (error) {
      console.error("[Open Markets] Void error:", error);
      res.status(500).json({ error: "Failed to void market" });
    }
  });

  app.delete("/api/admin/open-markets/:id", requireAuth, requireAdmin, async (req: AuthRequest, res) => {
    try {
      const { id } = req.params;
      const [market] = await db
        .select()
        .from(predictionMarkets)
        .where(and(eq(predictionMarkets.id, id), eq(predictionMarkets.marketType, "community")))
        .limit(1);

      if (!market) {
        return res.status(404).json({ error: "World market not found" });
      }

      const { voidMarketBets } = await import("./jobs/market-resolver");
      if (market.status !== "VOID" && market.status !== "RESOLVED") {
        await voidMarketBets(id);
      }

      await syncRelatedPeople("world_market", id, []);
      await db.delete(predictionMarkets).where(eq(predictionMarkets.id, id));

      await db.insert(adminAuditLog).values({
        adminId: req.userId!,
        adminEmail: null,
        actionType: "delete",
        targetTable: "prediction_markets",
        targetId: id,
        metadata: { marketType: "community", title: market.title, slug: market.slug },
      });

      res.json({ success: true });
    } catch (error: any) {
      console.error("[Open Markets] Delete error:", error);
      res.status(500).json({ error: error?.message || "Failed to delete market" });
    }
  });

  app.post("/api/admin/open-markets/reorder", requireAuth, requireAdmin, async (req: AuthRequest, res) => {
    try {
      const { orderedIds } = req.body;
      const adminId = req.userId!;
      if (!Array.isArray(orderedIds)) {
        return res.status(400).json({ error: "orderedIds must be an array" });
      }
      if (orderedIds.length > 0) {
        await Promise.all(
          orderedIds.map((id: string, i: number) =>
            db
              .update(predictionMarkets)
              .set({ cmsDisplayOrder: i + 1, updatedAt: new Date() })
              .where(and(eq(predictionMarkets.id, id), eq(predictionMarkets.marketType, "community"))),
          ),
        );
      }
      await db.insert(adminAuditLog).values({
        adminId,
        adminEmail: null,
        actionType: "reorder_world_markets",
        targetTable: "prediction_markets",
        targetId: "bulk",
        metadata: { marketType: "community", orderedIds },
      });
      res.json({ success: true });
    } catch (error: any) {
      console.error("[Open Markets] Reorder error:", error);
      res.status(500).json({ error: "Failed to reorder world markets" });
    }
  });

  // ── Bulk import World Markets ──────────────────────────────────────
  app.post("/api/admin/open-markets/import", requireAuth, requireAdmin, async (req, res) => {
    try {
      const authReq = req as AuthRequest;
      const dryRun = req.query.dryRun === "true";
      const { markets: importRows } = req.body;

      if (!Array.isArray(importRows) || importRows.length === 0) {
        return res.status(400).json({ error: "markets array is required and must not be empty" });
      }

      const VALID_TYPES = ["binary", "multi", "updown"];
      const VALID_CATEGORIES = ["politics", "tech", "music", "sports", "business", "creator", "Film & TV", "gaming", "misc", "Food & Drink", "Lifestyle"];
      const SLUG_REGEX = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

      const allPeople = await db.select({ id: trackedPeople.id, name: trackedPeople.name }).from(trackedPeople);
      const peopleByName = new Map(allPeople.map(p => [p.name.toLowerCase(), p.id]));

      const existingSlugs = new Set(
        (await db.select({ slug: predictionMarkets.slug }).from(predictionMarkets)).map(m => m.slug)
      );

      type Severity = "error" | "warning" | "info";
      interface ImportMessage { severity: Severity; field?: string; message: string }
      interface RowResult {
        index: number;
        slug: string;
        title: string;
        status: "created" | "skipped" | "error";
        messages: ImportMessage[];
        marketId?: string;
      }

      const results: RowResult[] = [];
      const seenSlugs = new Set<string>();
      const [impCmsStart] = await db
        .select({ max: sql<number>`COALESCE(MAX(cms_display_order), 0)` })
        .from(predictionMarkets)
        .where(eq(predictionMarkets.marketType, "community"));
      let nextImportCmsOrder = (impCmsStart?.max || 0) + 1;

      for (let i = 0; i < importRows.length; i++) {
        const row = importRows[i];
        const msgs: ImportMessage[] = [];
        let hasError = false;

        const title = row.title?.trim();
        const slug = row.slug?.trim();
        const openMarketType = row.type?.toLowerCase();
        const teaser = row.teaser?.trim() || null;
        const category = row.category?.trim().toLowerCase() || null;
        const linkedPersonName = row.linkedPerson?.trim() || null;
        const endAtRaw = row.resolutionDate || row.endAt;
        const resolutionCriteria = row.resolutionCriteria?.trim() || null;
        const closeAtRaw = row.closeAt || null;
        const sourceNote = row.sourceNote || row.source || null;

        // Up/Down fields
        const underlying = row.underlying?.trim() || null;
        const metric = row.metric?.trim() || null;
        const strike = row.strike != null ? String(row.strike) : null;
        const unit = row.unit?.trim() || "$";

        // Entries
        const entries: { label: string; seedCount: number; description?: string }[] = [];
        if (Array.isArray(row.entries)) {
          for (const e of row.entries) {
            if (e.label?.trim()) entries.push({ label: e.label.trim(), seedCount: e.seedCount || 0, description: e.description || undefined });
          }
        } else {
          for (let o = 1; o <= 20; o++) {
            const label = row[`option${o}`]?.toString().trim();
            const seed = parseInt(row[`seed${o}`]) || 0;
            if (label) entries.push({ label, seedCount: seed });
          }
        }

        // ── Validation ──
        if (!title) { msgs.push({ severity: "error", field: "title", message: "Title is required" }); hasError = true; }
        if (!slug) { msgs.push({ severity: "error", field: "slug", message: "Slug is required" }); hasError = true; }
        else if (!SLUG_REGEX.test(slug)) { msgs.push({ severity: "error", field: "slug", message: "Slug must be URL-safe (lowercase, numbers, dashes)" }); hasError = true; }
        else if (existingSlugs.has(slug) || seenSlugs.has(slug)) { msgs.push({ severity: "error", field: "slug", message: `Duplicate slug: ${slug}` }); hasError = true; }

        if (!openMarketType || !VALID_TYPES.includes(openMarketType)) {
          msgs.push({ severity: "error", field: "type", message: `Invalid type "${row.type}". Must be binary, multi, or updown` }); hasError = true;
        }

        if (!endAtRaw) { msgs.push({ severity: "error", field: "resolutionDate", message: "Resolution date is required" }); hasError = true; }
        else {
          const endDate = new Date(endAtRaw);
          if (isNaN(endDate.getTime())) { msgs.push({ severity: "error", field: "resolutionDate", message: "Invalid resolution date" }); hasError = true; }
          else if (endDate <= new Date()) { msgs.push({ severity: "error", field: "resolutionDate", message: "Resolution date is in the past" }); hasError = true; }
        }

        if (category && !VALID_CATEGORIES.includes(category)) {
          msgs.push({ severity: "warning", field: "category", message: `Category "${category}" not in standard list; will be used as-is` });
        }

        if (entries.length === 0) { msgs.push({ severity: "error", field: "entries", message: "At least one entry is required" }); hasError = true; }
        else if (openMarketType === "binary" && entries.length !== 2) { msgs.push({ severity: "error", field: "entries", message: "Binary markets must have exactly 2 entries" }); hasError = true; }
        else if (openMarketType === "multi" && (entries.length < 3 || entries.length > 20)) { msgs.push({ severity: "error", field: "entries", message: "Multi markets must have 3-20 entries" }); hasError = true; }
        else if (openMarketType === "updown" && entries.length !== 2) { msgs.push({ severity: "error", field: "entries", message: "Up/Down markets must have exactly 2 entries" }); hasError = true; }

        if (openMarketType === "updown") {
          if (!underlying) msgs.push({ severity: "error", field: "underlying", message: "Up/Down markets require underlying asset" });
          if (!strike) msgs.push({ severity: "error", field: "strike", message: "Up/Down markets require strike value" });
          if (!underlying || !strike) hasError = true;
        }

        // Resolve linked person
        let resolvedPersonId: string | null = null;
        let secondaryPersonName: string | null = null;
        if (linkedPersonName) {
          if (linkedPersonName.includes("/")) {
            const parts = linkedPersonName.split("/").map((s: string) => s.trim());
            const primaryName = parts[0];
            secondaryPersonName = parts.slice(1).join(", ");
            resolvedPersonId = peopleByName.get(primaryName.toLowerCase()) || null;
            if (!resolvedPersonId) msgs.push({ severity: "warning", field: "linkedPerson", message: `Primary person "${primaryName}" not found in tracked people` });
            msgs.push({ severity: "info", field: "linkedPerson", message: `Secondary person "${secondaryPersonName}" stored in metadata` });
          } else {
            resolvedPersonId = peopleByName.get(linkedPersonName.toLowerCase()) || null;
            if (!resolvedPersonId) msgs.push({ severity: "warning", field: "linkedPerson", message: `Person "${linkedPersonName}" not found in tracked people` });
          }
        }

        if (hasError) {
          results.push({ index: i, slug: slug || `row-${i}`, title: title || "(missing)", status: "error", messages: msgs });
          continue;
        }

        seenSlugs.add(slug);

        if (dryRun) {
          msgs.push({ severity: "info", message: "Dry run — would create this market" });
          results.push({ index: i, slug, title, status: "created", messages: msgs });
          continue;
        }

        // ── Insert ──
        try {
          const endAt = new Date(endAtRaw);
          const closeAt = closeAtRaw ? new Date(closeAtRaw) : endAt;
          const metadata: Record<string, unknown> = {};
          if (sourceNote) metadata.source = sourceNote;
          if (secondaryPersonName) metadata.secondaryPerson = secondaryPersonName;
          if (row.fitScore != null) metadata.fitScore = row.fitScore;
          if (row.settlementDifficulty) metadata.settlementDifficulty = row.settlementDifficulty;
          if (row.timeHorizon) metadata.timeHorizon = row.timeHorizon;
          if (row.launchWave) metadata.launchWave = row.launchWave;

          const [created] = await db.insert(predictionMarkets).values({
            marketType: "community",
            title,
            slug,
            openMarketType,
            teaser,
            category,
            personId: resolvedPersonId,
            endAt,
            closeAt,
            startAt: new Date(),
            resolutionCriteria: resolutionCriteria ? [resolutionCriteria] : null,
            resolveMethod: "admin_manual",
            status: "OPEN",
            visibility: "draft",
            isLive: false,
            featured: false,
            timezone: "UTC",
            underlying,
            metric,
            strike,
            unit: openMarketType === "updown" ? unit : null,
            metadata: Object.keys(metadata).length > 0 ? metadata : null,
            createdBy: authReq.userId,
            seedParticipants: 0,
            seedVolume: "0",
            cmsDisplayOrder: nextImportCmsOrder,
          }).returning();
          nextImportCmsOrder += 1;

          await db.insert(marketEntries).values(
            entries.map((e, idx) => ({
              marketId: created.id,
              entryType: "custom" as const,
              label: e.label,
              description: e.description || null,
              displayOrder: idx,
              seedCount: 0,
            }))
          );

          existingSlugs.add(slug);
          results.push({ index: i, slug, title, status: "created", messages: msgs, marketId: created.id });
        } catch (insertErr: any) {
          if (insertErr?.code === "23505") {
            msgs.push({ severity: "error", message: "Slug conflict during insert" });
            results.push({ index: i, slug, title, status: "error", messages: msgs });
          } else {
            throw insertErr;
          }
        }
      }

      const summary = {
        dryRun,
        total: importRows.length,
        created: results.filter(r => r.status === "created").length,
        skipped: results.filter(r => r.status === "skipped").length,
        errors: results.filter(r => r.status === "error").length,
        results,
      };

      res.json(summary);
    } catch (error) {
      console.error("[Open Markets] Import error:", error);
      res.status(500).json({ error: "Failed to import markets" });
    }
  });

  // ── Batch update visibility for World Markets ──────────────────────
  app.post("/api/admin/open-markets/batch-visibility", requireAuth, requireAdmin, async (req, res) => {
    try {
      const { marketIds, visibility } = req.body;

      if (!Array.isArray(marketIds) || marketIds.length === 0) {
        return res.status(400).json({ error: "marketIds array is required" });
      }
      if (!["draft", "live", "inactive", "archived"].includes(visibility)) {
        return res.status(400).json({ error: "visibility must be draft, live, inactive, or archived" });
      }

      const updated = await db.update(predictionMarkets)
        .set({
          visibility,
          isLive: visibility === "live" || visibility === "inactive",
          updatedAt: new Date(),
        })
        .where(
          and(
            inArray(predictionMarkets.id, marketIds),
            eq(predictionMarkets.marketType, "community")
          )
        )
        .returning({ id: predictionMarkets.id, title: predictionMarkets.title, visibility: predictionMarkets.visibility });

      res.json({ updated: updated.length, markets: updated });
    } catch (error) {
      console.error("[Open Markets] Batch visibility error:", error);
      res.status(500).json({ error: "Failed to update visibility" });
    }
  });

  // ── Get market with entries (for admin edit) ───────────────────────
  app.get("/api/admin/open-markets/:id", requireAuth, requireAdmin, async (req, res) => {
    try {
      const { id } = req.params;
      const [market] = await db.select().from(predictionMarkets)
        .where(and(eq(predictionMarkets.id, id), eq(predictionMarkets.marketType, "community")))
        .limit(1);

      if (!market) return res.status(404).json({ error: "Market not found" });

      const entries = await db.select().from(marketEntries)
        .where(eq(marketEntries.marketId, id))
        .orderBy(asc(marketEntries.displayOrder));

      res.json({ ...market, entries });
    } catch (error) {
      console.error("[Open Markets] Admin detail error:", error);
      res.status(500).json({ error: "Failed to fetch market" });
    }
  });

  app.post("/api/admin/open-markets/:id/generate-summary", requireAuth, requireAdmin, async (req: AuthRequest, res) => {
    try {
      const { id } = req.params;

      const [market] = await db.select().from(predictionMarkets)
        .where(and(eq(predictionMarkets.id, id), eq(predictionMarkets.marketType, "community")))
        .limit(1);
      if (!market) return res.status(404).json({ error: "Market not found" });

      const entries = await db.select().from(marketEntries)
        .where(eq(marketEntries.marketId, id))
        .orderBy(asc(marketEntries.displayOrder));

      let linkedPerson: { name: string; trendScore: number | null; category: string | null } | null = null;
      if (market.personId) {
        const [person] = await db.select({
          name: trendingPeople.name,
          trendScore: trendingPeople.trendScore,
          category: trendingPeople.category,
        }).from(trendingPeople).where(eq(trendingPeople.id, market.personId)).limit(1);
        if (person) linkedPerson = person;
      }

      const outcomesStr = entries.map(e => e.label).join(", ");
      const resolutionCriteria = Array.isArray(market.resolutionCriteria) && market.resolutionCriteria.length > 0
        ? market.resolutionCriteria.join("; ")
        : "Not specified";
      const resolutionDate = market.endAt ? new Date(market.endAt).toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" }) : "Not specified";
      const linkedPersonBlock = linkedPerson
        ? `\nLinked to: ${linkedPerson.name} (current trend score: ${linkedPerson.trendScore?.toLocaleString() ?? "N/A"}, category: ${linkedPerson.category ?? "N/A"})`
        : "";

      const systemPrompt = `You are writing a brief market context summary for a prediction market on VoxDex, a trend-tracking and prediction platform. Use web search to ensure all facts are current and accurate. Write plain text only — no markdown, no headers, no bullets, no bold. Use blank lines between paragraphs for readability.`;

      const userPrompt = `Market: "${market.title}"
Category: ${market.category || "General"}
${market.teaser ? `Teaser: "${market.teaser}"` : ""}
Resolution Date: ${resolutionDate}
Resolution Criteria: ${resolutionCriteria}
Outcomes: ${outcomesStr}${linkedPersonBlock}

Write 2-3 short paragraphs (separated by blank lines) that help users make an informed prediction. Focus on enduring background context, the stakes involved, historical precedent, and the key factors that will ultimately decide the outcome. Be factual and neutral — do not recommend a side.`;

      const openai = new OpenAI({
        apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY || process.env.OPENAI_API_KEY,
      });

      const response = await openai.responses.create({
        model: getAiModel("worldMarkets"),
        tools: [{ type: "web_search" as any }],
        instructions: systemPrompt,
        input: userPrompt,
        max_output_tokens: 1000,
        temperature: 0.7,
      } as any);

      const summary = stripCitations(((response as any).output_text
        || ((response as any).output || [])
             .filter((item: any) => item.type === "message")
             .flatMap((item: any) => item.content || [])
             .find((part: any) => part.type === "output_text" || part.type === "text")
             ?.text)?.trim() || "");
      if (!summary) return res.status(500).json({ error: "AI returned an empty summary" });

      console.log(`[World Markets] AI summary generated for market ${id} ("${market.title?.slice(0, 50)}")`);
      res.json({ summary });
    } catch (error: any) {
      console.error("[World Markets] AI summary generation error:", error?.message || error);
      res.status(500).json({ error: "Failed to generate summary" });
    }
  });

  app.post("/api/admin/open-markets/:id/generate-teaser", requireAuth, requireAdmin, async (req: AuthRequest, res) => {
    try {
      const { id } = req.params;
      const { summary: existingSummary } = req.body || {};

      const [market] = await db.select().from(predictionMarkets)
        .where(and(eq(predictionMarkets.id, id), eq(predictionMarkets.marketType, "community")))
        .limit(1);
      if (!market) return res.status(404).json({ error: "Market not found" });

      const entries = await db.select().from(marketEntries)
        .where(eq(marketEntries.marketId, id))
        .orderBy(asc(marketEntries.displayOrder));

      let linkedPerson: string | null = null;
      if (market.personId) {
        const [person] = await db.select({ name: trendingPeople.name })
          .from(trendingPeople).where(eq(trendingPeople.id, market.personId)).limit(1);
        if (person) linkedPerson = person.name;
      }

      const outcomesStr = entries.map(e => e.label).join(", ");
      const resolutionDate = market.endAt
        ? new Date(market.endAt).toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" })
        : "Not specified";

      const systemPrompt = `You are a creative copywriter writing a very short teaser tagline for a prediction market card on VoxDex. The teaser appears below the title and should hook readers into wanting to make a prediction. Use web search to find a fresh, timely angle — a recent stat, cultural moment, or narrative hook. Write plain text only — no markdown, no quotes, no period at the end unless it reads better with one. Maximum 12 words. Be wildly creative and different each time.`;

      const userPrompt = `Market: "${market.title}"
Category: ${market.category || "General"}
Outcomes: ${outcomesStr}
Resolution Date: ${resolutionDate}${linkedPerson ? `\nLinked to: ${linkedPerson}` : ""}${existingSummary ? `\nContext (use as background, don't just paraphrase): "${existingSummary}"` : ""}

Write a single short, punchy tagline (max 12 words). Think newspaper sub-headline, movie poster tagline, or provocative question. Do NOT repeat or paraphrase the title or summary. Find a completely fresh angle — a surprising stat, a cultural reference, an emotional hook, or a bold claim. Each generation should feel totally different from the last.`;

      const openai = new OpenAI({
        apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY || process.env.OPENAI_API_KEY,
      });

      const extractTeaser = (response: any): string => {
        const raw = (response as any).output_text
          || ((response as any).output || [])
               .filter((item: any) => item.type === "message")
               .flatMap((item: any) => item.content || [])
               .filter((part: any) => part.type === "output_text" || part.type === "text")
               .map((part: any) => part.text)
               .join(" ")
          || ((response as any).output || [])
               .filter((item: any) => item.type === "text")
               .map((item: any) => item.text)
               .join(" ")
          || "";
        return stripCitations(raw.trim());
      }

      const MAX_ATTEMPTS = 3;
      let teaser = "";
      for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
        const useWebSearch = attempt <= 2;
        const response = await openai.responses.create({
          model: getAiModel("worldMarkets"),
          ...(useWebSearch ? { tools: [{ type: "web_search" as any }] } : {}),
          instructions: systemPrompt,
          input: userPrompt,
          max_output_tokens: 300,
          temperature: 0.85,
        } as any);

        teaser = extractTeaser(response);
        if (teaser) {
          console.log(`[World Markets] AI teaser generated for market ${id} (attempt ${attempt}): "${teaser}"`);
          break;
        }
        console.warn(`[World Markets] AI teaser attempt ${attempt}/${MAX_ATTEMPTS} empty for market ${id}.`,
          "keys:", Object.keys(response || {}),
          "output:", JSON.stringify((response as any)?.output?.slice?.(0, 5) ?? (response as any)?.output_text?.slice?.(0, 300) ?? "none"));
      }

      if (!teaser) {
        return res.status(500).json({ error: "AI returned an empty teaser" });
      }

      res.json({ teaser });
    } catch (error: any) {
      console.error("[World Markets] AI teaser generation error:", error?.message || error);
      res.status(500).json({ error: "Failed to generate teaser" });
    }
  });

  const MIN_BET_STAKE = 5;

  async function placeMarketBet(params: {
    userId: string;
    marketId: string;
    entryId: string;
    stakeAmount: number;
    direction?: "yes" | "no";
  }) {
    const { userId, marketId, entryId, stakeAmount, direction = "yes" } = params;

    if (!Number.isInteger(stakeAmount) || stakeAmount < MIN_BET_STAKE) {
      return { error: `Stake must be a whole number of at least ${MIN_BET_STAKE} credits`, status: 400 as const };
    }

    const [entry] = await db
      .select()
      .from(marketEntries)
      .where(
        and(
          eq(marketEntries.id, entryId),
          eq(marketEntries.marketId, marketId)
        )
      )
      .limit(1);

    if (!entry) {
      return { error: "Entry not found in this market", status: 400 as const };
    }

    const result = await db.transaction(async (tx) => {
      const [updatedProfile] = await tx
        .update(profiles)
        .set({
          predictCredits: sql`${profiles.predictCredits} - ${stakeAmount}`,
          totalPredictions: sql`${profiles.totalPredictions} + 1`,
        })
        .where(and(
          eq(profiles.id, userId),
          sql`${profiles.predictCredits} >= ${stakeAmount}`
        ))
        .returning({ predictCredits: profiles.predictCredits });

      if (!updatedProfile) {
        throw new Error("Insufficient credits");
      }

      const allEntries = await tx
        .select({ totalStake: marketEntries.totalStake, noStake: marketEntries.noStake, id: marketEntries.id })
        .from(marketEntries)
        .where(eq(marketEntries.marketId, marketId));

      const currentEntry = allEntries.find(e => e.id === entryId);
      const otherEntries = allEntries.filter(e => e.id !== entryId);
      const totalPoolBefore = allEntries.reduce((sum, e) => sum + e.totalStake + e.noStake, 0);
      const totalNoPoolBefore = allEntries.reduce((sum, e) => sum + e.noStake, 0);

      let potentialPayout: number;
      if (direction === "no") {
        const likelyWinningEntry = otherEntries.reduce<typeof allEntries[number] | null>(
          (best, entry) => {
            if (!best) return entry;
            return entry.totalStake > best.totalStake ? entry : best;
          },
          null,
        );
        const winnerPoolBefore =
          (likelyWinningEntry?.totalStake ?? 0) +
          (totalNoPoolBefore - (likelyWinningEntry?.noStake ?? 0));
        const winnerPoolAfter = winnerPoolBefore + stakeAmount;
        const totalPoolAfter = totalPoolBefore + stakeAmount;
        potentialPayout = Math.round(
          (stakeAmount / Math.max(winnerPoolAfter, 1)) * totalPoolAfter
        );
      } else {
        const winnerPoolBefore =
          (currentEntry?.totalStake ?? 0) +
          otherEntries.reduce((sum, entry) => sum + entry.noStake, 0);
        const winnerPoolAfter = winnerPoolBefore + stakeAmount;
        const totalPoolAfter = totalPoolBefore + stakeAmount;
        potentialPayout = Math.round(
          (stakeAmount / Math.max(winnerPoolAfter, 1)) * totalPoolAfter
        );
      }

      const [insertedBet] = await tx
        .insert(marketBets)
        .values({
          marketId,
          entryId,
          userId,
          stakeAmount,
          potentialPayout,
          status: "active",
          direction,
        })
        .returning();

      await tx.insert(creditLedger).values({
        userId,
        txnType: 'prediction_stake',
        amount: -stakeAmount,
        walletType: 'VIRTUAL',
        balanceAfter: updatedProfile.predictCredits,
        source: 'user_action',
        idempotencyKey: `stake_${marketId}_${insertedBet.id}`,
        metadata: { marketId, entryId, betId: insertedBet.id, direction },
      });

      if (direction === "no") {
        await tx
          .update(marketEntries)
          .set({ noStake: sql`${marketEntries.noStake} + ${stakeAmount}` })
          .where(eq(marketEntries.id, entryId));
      } else {
        await tx
          .update(marketEntries)
          .set({ totalStake: sql`${marketEntries.totalStake} + ${stakeAmount}` })
          .where(eq(marketEntries.id, entryId));
      }

      return { bet: { ...insertedBet, remainingCredits: updatedProfile.predictCredits }, potentialPayout };
    });

    // Phase 3: stake-weighted prediction engagement signal. Resolve the
    // market's category at write time; nullable column so guard.
    try {
      const [marketRow] = await db
        .select({ category: predictionMarkets.category })
        .from(predictionMarkets)
        .where(eq(predictionMarkets.id, marketId))
        .limit(1);
      await upsertEngagement({
        userId,
        categoryId: marketRow?.category,
        stakeCredits: stakeAmount,
        source: "market-bet",
      });
    } catch (e) {
      console.warn("[market-bet] engagement lookup failed:", e);
      captureBackgroundError(e, {
        surface: "market-bet.engagement",
        userId,
        marketId,
      });
    }

    let xpResult;
    try {
      xpResult = await gamificationService.awardXp(
        userId, 'place_prediction',
        `prediction_${marketId}_${result.bet.id}_${userId}`,
        { marketId, entryId, stakeAmount }
      );
    } catch (e) { console.error("XP award failed:", e); }

    return {
      data: {
        ...result.bet,
        potentialPayout: result.potentialPayout,
        remainingCredits: result.bet.remainingCredits,
        xp: xpResult ?? null,
      },
      status: 200 as const,
    };
  }

  app.post("/api/open-markets/:slug/bet", requireAuth, async (req, res) => {
    try {
      const authReq = req as AuthRequest;
      const { slug } = req.params;
      const { entryId, stakeAmount, direction } = req.body;

      if (!entryId || !stakeAmount || typeof stakeAmount !== "number" || stakeAmount <= 0) {
        return res.status(400).json({ error: "Valid entryId and positive stakeAmount are required" });
      }

      const validDirection = direction === "no" ? "no" as const : "yes" as const;

      if (!checkBetRateLimit(authReq.userId!)) {
        return res.status(429).json({ error: "You're moving fast! Try again in a moment" });
      }

      const [market] = await db
        .select({
          id: predictionMarkets.id,
          closeAt: predictionMarkets.closeAt,
          endAt: predictionMarkets.endAt,
        })
        .from(predictionMarkets)
        .where(
          and(
            eq(predictionMarkets.slug, slug),
            eq(predictionMarkets.marketType, "community"),
            eq(predictionMarkets.status, "OPEN"),
            // Match native-market parity: never accept bets on draft / inactive
            // / archived markets even if their status row is still OPEN.
            eq(predictionMarkets.visibility, "live"),
          )
        )
        .limit(1);

      if (!market) {
        return res.status(404).json({ error: "Market not found or not open" });
      }

      // Match native-market parity: defend against late bets if the resolver
      // hasn't flipped status yet. Either closeAt OR endAt being past is
      // enough to lock the market.
      const now = new Date();
      if (
        (market.closeAt && new Date(market.closeAt) < now) ||
        (market.endAt && new Date(market.endAt) < now)
      ) {
        return res.status(400).json({ error: "Betting is closed for this market" });
      }

      const result = await placeMarketBet({
        userId: authReq.userId!,
        marketId: market.id,
        entryId,
        stakeAmount,
        direction: validDirection,
      });

      if ("error" in result) {
        return res.status(result.status).json({ error: result.error });
      }

      return res.json(result.data);
    } catch (error: any) {
      if (error?.message === "Insufficient credits") {
        return res.status(400).json({ error: "Insufficient credits" });
      }
      console.error("[Open Markets] Bet error:", error);
      res.status(500).json({ error: "Failed to place bet" });
    }
  });

  app.post("/api/native-markets/updown/:marketId/bet", requireAuth, async (req, res) => {
    try {
      const authReq = req as AuthRequest;
      const { marketId } = req.params;
      const { entryId, stakeAmount } = req.body;

      if (!entryId || !stakeAmount || typeof stakeAmount !== "number" || stakeAmount <= 0) {
        return res.status(400).json({ error: "Valid entryId and positive stakeAmount are required" });
      }

      if (!checkBetRateLimit(authReq.userId!)) {
        return res.status(429).json({ error: "You're moving fast! Try again in a moment" });
      }

      const [market] = await db
        .select({
          id: predictionMarkets.id,
          closeAt: predictionMarkets.closeAt,
          endAt: predictionMarkets.endAt,
        })
        .from(predictionMarkets)
        .where(
          and(
            eq(predictionMarkets.id, marketId),
            eq(predictionMarkets.marketType, "updown"),
            eq(predictionMarkets.status, "OPEN"),
            eq(predictionMarkets.visibility, "live")
          )
        )
        .limit(1);

      if (!market) {
        return res.status(404).json({ error: "Market not found or not open" });
      }

      const now = new Date();
      if (market.endAt) {
        const bettingCutoff = getWeeklyBettingCutoff(market.endAt);
        if (now > bettingCutoff) {
          return res.status(400).json({
            error: "Betting closes Friday at 23:59 UTC. This market is now locked.",
            bettingCutoff: bettingCutoff.toISOString(),
          });
        }
      }
      if (
        (market.closeAt && new Date(market.closeAt) < now) ||
        (market.endAt && new Date(market.endAt) < now)
      ) {
        return res.status(400).json({ error: "Betting is closed for this market" });
      }

      const result = await placeMarketBet({
        userId: authReq.userId!,
        marketId: market.id,
        entryId,
        stakeAmount,
      });

      if ("error" in result) {
        return res.status(result.status).json({ error: result.error });
      }

      return res.json(result.data);
    } catch (error: any) {
      if (error?.message === "Insufficient credits") {
        return res.status(400).json({ error: "Insufficient credits" });
      }
      console.error("[Native Markets] Updown bet error:", error);
      res.status(500).json({ error: "Failed to place bet" });
    }
  });

  app.post("/api/native-markets/:marketId/bet", requireAuth, async (req, res) => {
    try {
      const authReq = req as AuthRequest;
      const { marketId } = req.params;

      // Zod-validate the bet body. stakeAmount is capped at a generous ceiling
      // (10M credits) so a fat-fingered or malicious payload can't try to bet
      // BigInts / Infinity and confuse the downstream credit math.
      const betSchema = z.object({
        entryId: z.string().min(1).max(128),
        stakeAmount: z.number().int().positive().max(10_000_000),
      });
      let parsed: { entryId: string; stakeAmount: number };
      try {
        parsed = betSchema.parse(req.body ?? {});
      } catch (err) {
        if (err instanceof ZodError) return sendZodError(res, err);
        return sendBadRequest(res, "Invalid bet body");
      }
      const { entryId, stakeAmount } = parsed;

      if (!checkBetRateLimit(authReq.userId!)) {
        return res.status(429).json({ error: "You're moving fast! Try again in a moment" });
      }

      const [market] = await db
        .select({
          id: predictionMarkets.id,
          closeAt: predictionMarkets.closeAt,
          endAt: predictionMarkets.endAt,
        })
        .from(predictionMarkets)
        .where(
          and(
            eq(predictionMarkets.id, marketId),
            inArray(predictionMarkets.marketType, ["updown", "h2h", "gainer"]),
            eq(predictionMarkets.status, "OPEN"),
            eq(predictionMarkets.visibility, "live")
          )
        )
        .limit(1);

      if (!market) {
        return res.status(404).json({ error: "Market not found or not open" });
      }

      const now = new Date();
      if (market.endAt) {
        const bettingCutoff = getWeeklyBettingCutoff(market.endAt);
        if (now > bettingCutoff) {
          return res.status(400).json({
            error: "Betting closes Friday at 23:59 UTC. This market is now locked.",
            bettingCutoff: bettingCutoff.toISOString(),
          });
        }
      }
      if (
        (market.closeAt && new Date(market.closeAt) < now) ||
        (market.endAt && new Date(market.endAt) < now)
      ) {
        return res.status(400).json({ error: "Betting is closed for this market" });
      }

      const result = await placeMarketBet({
        userId: authReq.userId!,
        marketId: market.id,
        entryId,
        stakeAmount,
      });

      if ("error" in result) {
        return res.status(result.status).json({ error: result.error });
      }

      return res.json(result.data);
    } catch (error: any) {
      if (error?.message === "Insufficient credits") {
        return res.status(400).json({ error: "Insufficient credits" });
      }
      console.error("[Native Markets] Bet error:", error);
      res.status(500).json({ error: "Failed to place bet" });
    }
  });

  // --- Weekly Jackpot endpoints ---

  interface JackpotBetMetadata { predictedScore: number; }

  async function ensureJackpotEntry(marketId: string, txOrDb: any = db): Promise<string> {
    const [existing] = await txOrDb
      .select({ id: marketEntries.id })
      .from(marketEntries)
      .where(eq(marketEntries.marketId, marketId))
      .limit(1);
    if (existing) return existing.id;
    try {
      const [created] = await txOrDb.insert(marketEntries).values({
        marketId,
        entryType: "custom",
        label: "Score Prediction",
        displayOrder: 0,
      }).returning({ id: marketEntries.id });
      return created.id;
    } catch (e: any) {
      if (e.code === "23505") {
        const [retry] = await txOrDb
          .select({ id: marketEntries.id })
          .from(marketEntries)
          .where(eq(marketEntries.marketId, marketId))
          .limit(1);
        if (retry) return retry.id;
      }
      throw e;
    }
  }

  app.post("/api/native-markets/:marketId/jackpot-bet", requireAuth, async (req, res) => {
    try {
      const authReq = req as AuthRequest;
      const { marketId } = req.params;

      // Zod-validate. JACKPOT_MAX_PREDICTED_SCORE is the enforced cap — using
      // it directly here keeps the validation error message and business rule
      // in lock-step if the constant ever changes.
      const jackpotBetSchema = z.object({
        predictedScore: z.number().int().positive().max(JACKPOT_MAX_PREDICTED_SCORE),
      });
      let parsed: { predictedScore: number };
      try {
        parsed = jackpotBetSchema.parse(req.body ?? {});
      } catch (err) {
        if (err instanceof ZodError) return sendZodError(res, err);
        return sendBadRequest(res, "Invalid jackpot bet body");
      }
      const { predictedScore } = parsed;

      if (!checkBetRateLimit(authReq.userId!)) {
        return res.status(429).json({ error: "You're moving fast! Try again in a moment" });
      }

      const [market] = await db
        .select({
          id: predictionMarkets.id,
          endAt: predictionMarkets.endAt,
          status: predictionMarkets.status,
          visibility: predictionMarkets.visibility,
          marketType: predictionMarkets.marketType,
          category: predictionMarkets.category,
        })
        .from(predictionMarkets)
        .where(
          and(
            eq(predictionMarkets.id, marketId),
            eq(predictionMarkets.marketType, "jackpot"),
            eq(predictionMarkets.status, "OPEN"),
            eq(predictionMarkets.visibility, "live")
          )
        )
        .limit(1);

      if (!market) {
        return res.status(404).json({ error: "Jackpot market not found or not open" });
      }

      const now = new Date();
      const bettingCutoff = getWeeklyBettingCutoff(market.endAt!);
      if (now > bettingCutoff) {
        return res.status(400).json({
          error: "Jackpot entries close on Friday at 23:59 UTC. This jackpot is now locked.",
          bettingCutoff: bettingCutoff.toISOString(),
        });
      }

      const result = await db.transaction(async (tx) => {
        const entryId = await ensureJackpotEntry(marketId, tx);

        const [existingClaim] = await tx
          .select({ id: marketBets.id, userId: marketBets.userId })
          .from(marketBets)
          .where(
            and(
              eq(marketBets.marketId, marketId),
              eq(marketBets.status, "active"),
              sql`${marketBets.betMetadata}->>'predictedScore' = ${String(predictedScore)}`
            )
          )
          .limit(1);

        if (existingClaim) {
          const isSelf = existingClaim.userId === authReq.userId;
          const suggestions: number[] = [];
          if (!isSelf) {
            for (const offset of [1, -1, 2, -2, 5, -5, 10, -10]) {
              const candidate = predictedScore + offset;
              if (candidate <= 0) continue;
              const [taken] = await tx
                .select({ id: marketBets.id })
                .from(marketBets)
                .where(
                  and(
                    eq(marketBets.marketId, marketId),
                    eq(marketBets.status, "active"),
                    sql`${marketBets.betMetadata}->>'predictedScore' = ${String(candidate)}`
                  )
                )
                .limit(1);
              if (!taken) {
                suggestions.push(candidate);
                if (suggestions.length >= 3) break;
              }
            }
          }
          return {
            conflict: true as const,
            isSelf,
            suggestions,
          };
        }

        const [updatedProfile] = await tx
          .update(profiles)
          .set({
            predictCredits: sql`${profiles.predictCredits} - ${JACKPOT_TICKET_COST}`,
            totalPredictions: sql`${profiles.totalPredictions} + 1`,
          })
          .where(and(
            eq(profiles.id, authReq.userId!),
            sql`${profiles.predictCredits} >= ${JACKPOT_TICKET_COST}`
          ))
          .returning({ predictCredits: profiles.predictCredits });

        if (!updatedProfile) {
          throw new Error("Insufficient credits");
        }

        const [insertedBet] = await tx
          .insert(marketBets)
          .values({
            marketId,
            entryId,
            userId: authReq.userId!,
            stakeAmount: JACKPOT_TICKET_COST,
            status: "active",
            betMetadata: { predictedScore },
          })
          .returning();

        await tx.insert(creditLedger).values({
          userId: authReq.userId!,
          txnType: "prediction_stake",
          amount: -JACKPOT_TICKET_COST,
          walletType: "VIRTUAL",
          balanceAfter: updatedProfile.predictCredits,
          source: "user_action",
          idempotencyKey: `jackpot_stake_${marketId}_${insertedBet.id}`,
          metadata: { marketId, entryId, betId: insertedBet.id, predictedScore },
        });

        await tx
          .update(marketEntries)
          .set({ totalStake: sql`${marketEntries.totalStake} + ${JACKPOT_TICKET_COST}` })
          .where(eq(marketEntries.id, entryId));

        const [entryStats] = await tx
          .select({ totalStake: marketEntries.totalStake })
          .from(marketEntries)
          .where(eq(marketEntries.id, entryId));

        const totalBetsCount = await tx
          .select({ count: sql<number>`count(*)::int` })
          .from(marketBets)
          .where(and(eq(marketBets.marketId, marketId), eq(marketBets.status, "active")));

        return {
          conflict: false as const,
          betId: insertedBet.id,
          remainingCredits: updatedProfile.predictCredits,
          totalPool: entryStats?.totalStake ?? JACKPOT_TICKET_COST,
          totalEntries: totalBetsCount[0]?.count ?? 1,
        };
      });

      if (result.conflict) {
        if (result.isSelf) {
          return res.status(409).json({
            error: "NUMBER_TAKEN",
            message: "You already claimed this number.",
            predictedScore,
          });
        }
        return res.status(409).json({
          error: "NUMBER_TAKEN",
          message: "That number is already claimed. Try a nearby number.",
          predictedScore,
          suggestions: result.suggestions,
        });
      }

      // Phase 3: stake-weighted engagement signal for the jackpot
      // market's category. market.category was added to the initial
      // select above specifically for this call.
      await upsertEngagement({
        userId: authReq.userId!,
        categoryId: market.category,
        stakeCredits: JACKPOT_TICKET_COST,
        source: "jackpot-bet",
      });

      let xpResult;
      try {
        xpResult = await gamificationService.awardXp(
          authReq.userId!, 'place_prediction',
          `prediction_${marketId}_${(result as any).betId}_${authReq.userId}`,
          { marketId, stakeAmount: JACKPOT_TICKET_COST }
        );
      } catch (e) { console.error("XP award for jackpot entry failed:", e); }

      return res.json({
        betId: (result as any).betId,
        predictedScore,
        remainingCredits: (result as any).remainingCredits,
        totalPool: (result as any).totalPool,
        totalEntries: (result as any).totalEntries,
        xp: xpResult ?? null,
      });
    } catch (error: any) {
      if (error?.message === "Insufficient credits") {
        return res.status(400).json({ error: "Insufficient credits. You need 100 credits to enter." });
      }
      console.error("[Jackpot] Bet error:", error);
      res.status(500).json({ error: "Failed to place jackpot entry" });
    }
  });

  app.get("/api/native-markets/:marketId/jackpot-entries", requireAuth, async (req, res) => {
    try {
      const authReq = req as AuthRequest;
      const { marketId } = req.params;

      const [market] = await db
        .select({ id: predictionMarkets.id, endAt: predictionMarkets.endAt, marketType: predictionMarkets.marketType })
        .from(predictionMarkets)
        .where(and(eq(predictionMarkets.id, marketId), eq(predictionMarkets.marketType, "jackpot")))
        .limit(1);

      if (!market) {
        return res.status(404).json({ error: "Jackpot market not found" });
      }

      const userBets = await db
        .select({
          id: marketBets.id,
          betMetadata: marketBets.betMetadata,
          createdAt: marketBets.createdAt,
          status: marketBets.status,
        })
        .from(marketBets)
        .where(
          and(
            eq(marketBets.marketId, marketId),
            eq(marketBets.userId, authReq.userId!),
            eq(marketBets.status, "active")
          )
        )
        .orderBy(marketBets.createdAt);

      const [entryStats] = await db
        .select({ totalStake: marketEntries.totalStake })
        .from(marketEntries)
        .where(eq(marketEntries.marketId, marketId))
        .limit(1);

      const totalBetsResult = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(marketBets)
        .where(and(eq(marketBets.marketId, marketId), eq(marketBets.status, "active")));

      const bettingCutoff = getWeeklyBettingCutoff(market.endAt!);

      return res.json({
        entries: userBets.map(b => ({
          betId: b.id,
          predictedScore: (b.betMetadata as JackpotBetMetadata | null)?.predictedScore ?? null,
          placedAt: b.createdAt.toISOString(),
        })),
        totalPool: entryStats?.totalStake ?? 0,
        totalEntries: totalBetsResult[0]?.count ?? 0,
        bettingCutoff: bettingCutoff.toISOString(),
        isCutoffPassed: new Date() > bettingCutoff,
      });
    } catch (error: any) {
      console.error("[Jackpot] Entries error:", error);
      res.status(500).json({ error: "Failed to fetch jackpot entries" });
    }
  });

  app.get("/api/native-markets/:marketId/jackpot-taken-numbers", requireAuth, async (req: AuthRequest, res) => {
    try {
      const { marketId } = req.params;

      const bets = await db
        .select({ betMetadata: marketBets.betMetadata })
        .from(marketBets)
        .where(
          and(
            eq(marketBets.marketId, marketId),
            eq(marketBets.status, "active")
          )
        );

      const takenNumbers = bets
        .map(b => (b.betMetadata as JackpotBetMetadata | null)?.predictedScore)
        .filter((n): n is number => typeof n === "number");

      return res.json({ takenNumbers });
    } catch (error: any) {
      console.error("[Jackpot] Taken numbers error:", error);
      res.status(500).json({ error: "Failed to fetch taken numbers" });
    }
  });

  app.get("/api/native-markets/jackpot-last-winner/:personId", async (req, res) => {
    try {
      const { personId } = req.params;

      const [resolved] = await db
        .select({
          id: predictionMarkets.id,
          resolutionNotes: predictionMarkets.resolutionNotes,
          resolvedAt: predictionMarkets.resolvedAt,
          title: predictionMarkets.title,
        })
        .from(predictionMarkets)
        .where(
          and(
            eq(predictionMarkets.personId, personId),
            eq(predictionMarkets.marketType, "jackpot"),
            eq(predictionMarkets.status, "RESOLVED")
          )
        )
        .orderBy(desc(predictionMarkets.resolvedAt))
        .limit(1);

      if (!resolved || !resolved.resolutionNotes) {
        return res.json({ hasResult: false });
      }

      let notes: any;
      try {
        notes = JSON.parse(resolved.resolutionNotes);
      } catch {
        return res.json({ hasResult: false });
      }

      if (!notes.actualScore || notes.outcome === "no_entries") {
        return res.json({ hasResult: false });
      }

      let winnerUsername: string | null = null;
      const winnerIds = Array.isArray(notes.winnerUserId) ? notes.winnerUserId : notes.winnerUserId ? [notes.winnerUserId] : [];
      if (winnerIds.length > 0) {
        const winnerProfiles = await db
          .select({ id: profiles.id, username: profiles.username })
          .from(profiles)
          .where(inArray(profiles.id, winnerIds));
        const names = winnerProfiles
          .map(p => p.username)
          .filter(Boolean);
        winnerUsername = names.length > 0 ? names.join(", ") : null;
      }

      return res.json({
        hasResult: true,
        actualScore: notes.actualScore,
        winningPrediction: notes.winningPrediction,
        margin: notes.margin,
        payout: notes.payout,
        totalEntries: notes.totalEntries,
        winnerUsername,
        resolvedAt: resolved.resolvedAt?.toISOString() ?? null,
      });
    } catch (error: any) {
      console.error("[Jackpot] Last winner error:", error);
      res.status(500).json({ error: "Failed to fetch last winner" });
    }
  });

  app.get("/api/native-markets/:marketId/history", optionalAuth, async (req: AuthRequest, res) => {
    try {
      const { marketId } = req.params;

      const [market] = await db
        .select({
          id: predictionMarkets.id,
          personId: predictionMarkets.personId,
          startAt: predictionMarkets.startAt,
          endAt: predictionMarkets.endAt,
          metadata: predictionMarkets.metadata,
          status: predictionMarkets.status,
        })
        .from(predictionMarkets)
        .where(eq(predictionMarkets.id, marketId))
        .limit(1);

      if (!market) {
        return res.status(404).json({ error: "Market not found" });
      }

      if (!market.personId) {
        return res.status(400).json({ error: "Market has no linked person" });
      }

      const history = await db
        .select({
          timestamp: trendSnapshots.timestamp,
          fameIndex: trendSnapshots.fameIndex,
        })
        .from(trendSnapshots)
        .where(
          and(
            eq(trendSnapshots.personId, market.personId),
            gte(trendSnapshots.timestamp, market.startAt),
            lte(trendSnapshots.timestamp, sql`now()`)
          )
        )
        .orderBy(asc(trendSnapshots.timestamp));

      const meta = market.metadata as Record<string, any> | null;
      const baselineScore = meta?.openingScore?.score ?? null;

      const [person] = await db
        .select({ trendScore: trendingPeople.trendScore })
        .from(trendingPeople)
        .where(eq(trendingPeople.id, market.personId))
        .limit(1);

      const currentScore = person?.trendScore ?? null;

      let userEntry: {
        enteredAt: Date;
        enteredScore: number | null;
        pick: string;
        stake: number;
      } | null = null;

      if (req.userId) {
        const [bet] = await db
          .select({
            createdAt: marketBets.createdAt,
            stakeAmount: marketBets.stakeAmount,
            entryId: marketBets.entryId,
          })
          .from(marketBets)
          .where(
            and(
              eq(marketBets.marketId, marketId),
              eq(marketBets.userId, req.userId)
            )
          )
          .orderBy(desc(marketBets.createdAt))
          .limit(1);

        if (bet) {
          const [entry] = await db
            .select({ label: marketEntries.label })
            .from(marketEntries)
            .where(eq(marketEntries.id, bet.entryId))
            .limit(1);

          let enteredScore: number | null = null;
          if (history.length > 0) {
            let closest = history[0];
            let minDiff = Math.abs(new Date(history[0].timestamp).getTime() - new Date(bet.createdAt).getTime());
            for (const snap of history) {
              const diff = Math.abs(new Date(snap.timestamp).getTime() - new Date(bet.createdAt).getTime());
              if (diff < minDiff) {
                minDiff = diff;
                closest = snap;
              }
            }
            enteredScore = closest.fameIndex;
          }

          userEntry = {
            enteredAt: bet.createdAt,
            enteredScore,
            pick: entry?.label ?? bet.entryId,
            stake: bet.stakeAmount,
          };
        }
      }

      return res.json({
        marketId: market.id,
        personId: market.personId,
        baselineScore,
        currentScore,
        startAt: market.startAt,
        endAt: market.endAt,
        status: market.status,
        history,
        userEntry,
      });
    } catch (error) {
      console.error("[Native Markets] History error:", error);
      res.status(500).json({ error: "Failed to fetch market history" });
    }
  });

  // ============ NATIVE PREDICTION MARKET ENDPOINTS ============

  app.get("/api/native-markets/:type", optionalAuth, async (req: AuthRequest, res) => {
    try {
      const { type } = req.params;
      const validTypes = ['jackpot', 'updown', 'h2h', 'gainer'];
      if (!validTypes.includes(type)) {
        return res.status(400).json({ error: "Invalid market type" });
      }

      // Only the Weekly Up/Down feed renders as a card stack on the Predict
      // page; the others are leaderboard-driven and reordering them would
      // confuse rank semantics. Personalised + cold-start ordering therefore
      // only applies to type === 'updown'.
      const orderTerms = type === 'updown'
        ? await orderFeaturedCategoryForUser(
            req,
            predictionMarkets.featured,
            predictionMarkets.category,
          )
        : [desc(predictionMarkets.featured), predictionMarkets.category];

      const nowForCutoff = new Date();
      const fetchOpenNativeMarkets = async () =>
        db.select()
          .from(predictionMarkets)
          .where(
            and(
              eq(predictionMarkets.marketType, type),
              eq(predictionMarkets.status, "OPEN"),
              inArray(predictionMarkets.visibility, ["live", "inactive"]),
              gt(predictionMarkets.endAt, nowForCutoff),
            )
          )
          .orderBy(...orderTerms);

      let markets = await fetchOpenNativeMarkets();
      if (markets.length === 0) {
        const nowMs = Date.now();
        const lastAttemptAt = _nativeMarketsSelfHealByType.get(type) ?? 0;
        if (nowMs - lastAttemptAt > NATIVE_MARKETS_SELF_HEAL_COOLDOWN_MS) {
          _nativeMarketsSelfHealByType.set(type, nowMs);
          try {
            const ensureResult = await ensureWeeklyMarketsForCurrentWeek("read-self-heal");
            console.log(
              `[Native Markets] Self-heal attempt type=${type} outcome=${ensureResult.outcome} week=${ensureResult.weekNumber} before=${ensureResult.openBefore} after=${ensureResult.openAfter}`,
            );
          } catch (selfHealError: any) {
            console.warn(`[Native Markets] Self-heal failed for type=${type}:`, selfHealError?.message || selfHealError);
          }
          markets = await fetchOpenNativeMarkets();
        }
      }

      const marketIds = markets.map(m => m.id);
      let entries: any[] = [];
      if (marketIds.length > 0) {
        entries = await db.select()
          .from(marketEntries)
          .where(inArray(marketEntries.marketId, marketIds))
          .orderBy(marketEntries.displayOrder);
      }

      const engagement = await getMarketEngagementPreview(marketIds);
      const addLifecycleFields = (m: { endAt: Date | null }) => {
        const lifecycle = deriveNativeMarketLifecycle(m.endAt, nowForCutoff);
        return {
          bettingCutoff: lifecycle.bettingCutoff?.toISOString() ?? null,
          resolutionDeadline: lifecycle.resolutionDeadline?.toISOString() ?? null,
          lifecycleStatus: lifecycle.status,
          isCutoffPassed: lifecycle.isCutoffPassed,
        };
      };

      if (type === 'updown' || type === 'jackpot') {
        const personIds = markets.map(m => m.personId).filter(Boolean) as string[];
        let persons: any[] = [];
        if (personIds.length > 0) {
          persons = await db.select().from(trendingPeople).where(inArray(trendingPeople.id, personIds));
        }
        const personMap = Object.fromEntries(persons.map(p => [p.id, p]));

        const enriched = markets.map(m => ({
          ...m,
          ...addLifecycleFields(m),
          person: m.personId ? personMap[m.personId] || null : null,
          entries: entries.filter(e => e.marketId === m.id),
          recentParticipants: engagement.recentParticipantsByMarket.get(m.id) || [],
          activeParticipantCount: engagement.activeParticipantCountByMarket.get(m.id) || 0,
          latestRationale: engagement.latestRationaleByMarket.get(m.id) || null,
        }));
        return res.json(enriched);
      }

      if (type === 'h2h' || type === 'gainer') {
        const personEntryIds = entries.filter(e => e.personId).map(e => e.personId!);
        let persons: any[] = [];
        if (personEntryIds.length > 0) {
          persons = await db.select().from(trendingPeople).where(inArray(trendingPeople.id, personEntryIds));
        }
        const personMap = Object.fromEntries(persons.map(p => [p.id, p]));

        const enriched = markets.map(m => {
          const mEntries = entries.filter(e => e.marketId === m.id).map(e => ({
            ...e,
            person: e.personId ? personMap[e.personId] || null : null,
          }));

          // Deterministic VoxDex-model probability for H2H cards. Two-entry
          // markets only; anything else (gainer, malformed) leaves the field
          // undefined so the client can skip rendering the pill.
          let modelP1Percent: number | undefined;
          let modelConfidence: "low" | "medium" | "high" | undefined;
          if (type === 'h2h' && mEntries.length === 2) {
            const p1 = mEntries[0]?.person;
            const p2 = mEntries[1]?.person;
            if (p1 && p2) {
              const model = h2hModelProbability(
                { fameIndex: Number(p1.fameIndex ?? 0), momentum: p1.momentum ?? undefined },
                { fameIndex: Number(p2.fameIndex ?? 0), momentum: p2.momentum ?? undefined },
              );
              modelP1Percent = model.p1;
              modelConfidence = model.confidence;
            }
          }

          return {
            ...m,
            ...addLifecycleFields(m),
            entries: mEntries,
            recentParticipants: engagement.recentParticipantsByMarket.get(m.id) || [],
            activeParticipantCount: engagement.activeParticipantCountByMarket.get(m.id) || 0,
            latestRationale: engagement.latestRationaleByMarket.get(m.id) || null,
            ...(modelP1Percent !== undefined ? { modelP1Percent, modelConfidence } : {}),
          };
        });
        return res.json(enriched);
      }

      res.json(markets.map(m => ({
        ...m,
        ...addLifecycleFields(m),
        entries: entries.filter(e => e.marketId === m.id),
        recentParticipants: engagement.recentParticipantsByMarket.get(m.id) || [],
        activeParticipantCount: engagement.activeParticipantCountByMarket.get(m.id) || 0,
        latestRationale: engagement.latestRationaleByMarket.get(m.id) || null,
      })));
    } catch (error: any) {
      console.error("Error fetching native markets:", error.message);
      res.status(500).json({ error: "Failed to fetch native markets" });
    }
  });

  app.get("/api/predict/recent-activity", async (_req, res) => {
    try {
      const requestedLimit = typeof _req.query.limit === "string" ? parseInt(_req.query.limit, 10) : 20;
      const queryLimit = Math.max(1, Math.min(requestedLimit || 20, 100));

      const recentBets = await db
        .select({
          id: marketBets.id,
          marketId: marketBets.marketId,
          entryId: marketBets.entryId,
          userId: marketBets.userId,
          stakeAmount: marketBets.stakeAmount,
          confidence: marketBets.confidence,
          createdAt: marketBets.createdAt,
          betMetadata: marketBets.betMetadata,
        })
        .from(marketBets)
        .where(eq(marketBets.status, "active"))
        .orderBy(desc(marketBets.createdAt))
        .limit(queryLimit);

      if (recentBets.length === 0) {
        return res.json([]);
      }

      const userIds = Array.from(new Set(recentBets.map((bet) => bet.userId)));
      const marketIds = Array.from(new Set(recentBets.map((bet) => bet.marketId)));
      const entryIds = Array.from(new Set(recentBets.map((bet) => bet.entryId)));

      const { getSimulationProfile, shouldShowPublicConfidence } = await import("./agents/simulationProfile");
      const { agentConfigs: agentConfigsTable } = await import("@shared/schema");

      const [profileRows, marketRows, entryRows, agentRows] = await Promise.all([
        db
          .select({
            id: profiles.id,
            username: profiles.username,
            avatarUrl: profiles.avatarUrl,
            isAgent: profiles.isAgent,
            isPublic: profiles.isPublic,
          })
          .from(profiles)
          .where(inArray(profiles.id, userIds)),
        db
          .select({
            id: predictionMarkets.id,
            title: predictionMarkets.title,
            slug: predictionMarkets.slug,
            marketType: predictionMarkets.marketType,
            status: predictionMarkets.status,
            visibility: predictionMarkets.visibility,
          })
          .from(predictionMarkets)
          .where(inArray(predictionMarkets.id, marketIds)),
        db
          .select({
            id: marketEntries.id,
            label: marketEntries.label,
          })
          .from(marketEntries)
          .where(inArray(marketEntries.id, entryIds)),
        db
          .select({
            userId: agentConfigsTable.userId,
            simulationProfile: agentConfigsTable.simulationProfile,
          })
          .from(agentConfigsTable)
          .where(inArray(agentConfigsTable.userId, userIds)),
      ]);

      const profileMap = new Map(profileRows.map((profile) => [profile.id, profile]));
      const marketMap = new Map(marketRows.map((market) => [market.id, market]));
      const entryMap = new Map(entryRows.map((entry) => [entry.id, entry]));
      const agentSimulationMap = new Map(
        agentRows.map((row) => [row.userId, getSimulationProfile(row.simulationProfile)] as const),
      );

      const activity = recentBets
        .map((bet) => {
          const profile = profileMap.get(bet.userId);
          const market = marketMap.get(bet.marketId);
          const entry = entryMap.get(bet.entryId);

          if (!market || !entry) return null;
          if (market.status !== "OPEN") return null;
          if (!["live", "inactive"].includes(market.visibility || "")) return null;

          const rationale =
            bet.betMetadata &&
            typeof bet.betMetadata === "object" &&
            "rationale" in (bet.betMetadata as Record<string, unknown>)
              ? String((bet.betMetadata as Record<string, unknown>).rationale || "").trim()
              : null;

          const rawConfidence = bet.confidence ? Number(bet.confidence) : null;
          let displayConfidence: number | null = rawConfidence;
          if (profile?.isAgent) {
            const sim = agentSimulationMap.get(bet.userId);
            displayConfidence = sim && rawConfidence != null && shouldShowPublicConfidence(sim, `bet:${bet.id}`)
              ? rawConfidence
              : null;
          }

          return {
            id: bet.id,
            createdAt: bet.createdAt,
            stakeAmount: bet.stakeAmount,
            confidence: displayConfidence,
            choiceLabel: entry.label,
            marketId: market.id,
            marketTitle: market.title,
            marketSlug: market.slug,
            marketType: market.marketType,
            username: profile?.username || null,
            displayName: profile?.username || "Anonymous",
            avatarUrl: profile?.avatarUrl || null,
            isAgent: profile?.isAgent ?? false,
            isPublic: profile?.isPublic ?? false,
            rationale: rationale || null,
          };
        })
        .filter(Boolean);

      res.json(activity);
    } catch (error: any) {
      console.error("Error fetching recent prediction activity:", error.message);
      res.status(500).json({ error: "Failed to fetch recent prediction activity" });
    }
  });

  app.post("/api/admin/native-markets/generate-updown", requireAuth, requireAdmin, async (req: AuthRequest, res) => {
    try {
      const created = await generateWeeklyUpDown();
      const jan1 = new Date(new Date().getUTCFullYear(), 0, 1);
      const weekNumber = Math.ceil(((Date.now() - jan1.getTime()) / 86400000 + jan1.getUTCDay() + 1) / 7);
      await db.insert(adminAuditLog).values({ adminId: req.userId!, adminEmail: null, actionType: "create", targetTable: "prediction_markets", targetId: "bulk-updown", metadata: { type: "updown", created, weekNumber } });
      res.json({ success: true, created, weekNumber });
    } catch (error: any) {
      console.error("Error generating updown markets:", error.message);
      res.status(500).json({ error: "Failed to generate updown markets" });
    }
  });

  app.post("/api/admin/native-markets/generate-jackpot", requireAuth, requireAdmin, async (req: AuthRequest, res) => {
    try {
      const created = await generateWeeklyJackpot();
      const jan1 = new Date(new Date().getUTCFullYear(), 0, 1);
      const weekNumber = Math.ceil(((Date.now() - jan1.getTime()) / 86400000 + jan1.getUTCDay() + 1) / 7);
      await db.insert(adminAuditLog).values({ adminId: req.userId!, adminEmail: null, actionType: "create", targetTable: "prediction_markets", targetId: "bulk-jackpot", metadata: { type: "jackpot", created, weekNumber } });
      res.json({ success: true, created, weekNumber });
    } catch (error: any) {
      console.error("Error generating jackpot markets:", error.message);
      res.status(500).json({ error: "Failed to generate jackpot markets" });
    }
  });

  app.post("/api/admin/native-markets/h2h", requireAuth, requireAdmin, async (req: AuthRequest, res) => {
    try {
      const { personAId, personBId, category, visibility = "live", featured = false, seedConfig } = req.body;

      if (!personAId || !personBId) {
        return res.status(400).json({ error: "Both person A and person B are required" });
      }
      if (personAId === personBId) {
        return res.status(400).json({ error: "Person A and B must be different" });
      }

      const [personA] = await db.select().from(trackedPeople).where(eq(trackedPeople.id, personAId));
      const [personB] = await db.select().from(trackedPeople).where(eq(trackedPeople.id, personBId));

      if (!personA || !personB) {
        return res.status(404).json({ error: "One or both celebrities not found" });
      }

      const now = new Date();
      const dayOfWeek = now.getUTCDay();
      const mondayOffset = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
      const monday = new Date(now);
      monday.setUTCDate(now.getUTCDate() + mondayOffset);
      monday.setUTCHours(0, 0, 0, 0);
      const sunday = new Date(monday);
      sunday.setUTCDate(monday.getUTCDate() + 6);
      sunday.setUTCHours(23, 59, 59, 999);

      const jan1 = new Date(now.getUTCFullYear(), 0, 1);
      const weekNumber = Math.ceil(((now.getTime() - jan1.getTime()) / 86400000 + jan1.getUTCDay() + 1) / 7);

      const title = `${personA.name} vs ${personB.name}`;
      let slug = `h2h-${personA.name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-vs-${personB.name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-week-${weekNumber}`;

      const h2hSnapRows = await db.execute(sql`
        SELECT DISTINCT ON (person_id) person_id, fame_index, timestamp
        FROM trend_snapshots
        WHERE person_id IN (${personAId}, ${personBId})
        ORDER BY person_id, timestamp DESC
      `);
      const h2hOpeningScores: any[] = [];
      for (const row of (h2hSnapRows.rows || [])) {
        if (row.fame_index != null) {
          h2hOpeningScores.push({ personId: String(row.person_id), score: Number(row.fame_index), snapshotAt: new Date(row.timestamp as string).toISOString() });
        }
      }
      const h2hMetadata = h2hOpeningScores.length > 0 ? { openingScores: h2hOpeningScores } : undefined;

      const defaultSeedConfig = {
        enabled: true,
        targetParticipantsMin: 40,
        targetParticipantsMax: 120,
        targetPoolMin: 10000,
        targetPoolMax: 35000,
        distributionBias: { personA: 50, personB: 50 },
      };

      let market: any;
      try {
        [market] = await db.insert(predictionMarkets).values({
          marketType: "h2h",
          title,
          slug,
          category: category || personA.category?.toLowerCase() || "misc",
          visibility,
          featured,
          status: "OPEN",
          startAt: monday,
          endAt: sunday,
          weekNumber,
          seedParticipants: 0,
          seedVolume: "0",
          metadata: h2hMetadata,
          seedConfig: seedConfig || defaultSeedConfig,
        }).returning();
      } catch (slugErr: any) {
        if (slugErr.code === '23505') {
          slug = `${slug}-${randomUUID().slice(0, 6)}`;
          [market] = await db.insert(predictionMarkets).values({
            marketType: "h2h",
            title,
            slug,
            category: category || personA.category?.toLowerCase() || "misc",
            visibility,
            featured,
            status: "OPEN",
            startAt: monday,
            endAt: sunday,
            weekNumber,
            seedParticipants: 0,
            seedVolume: "0",
            metadata: h2hMetadata,
            seedConfig: seedConfig || defaultSeedConfig,
          }).returning();
        } else {
          throw slugErr;
        }
      }

      await db.insert(marketEntries).values([
        {
          marketId: market.id,
          entryType: "person",
          personId: personA.id,
          label: personA.name,
          displayOrder: 0,
          seedCount: 0,
          imageUrl: personA.avatar,
        },
        {
          marketId: market.id,
          entryType: "person",
          personId: personB.id,
          label: personB.name,
          displayOrder: 1,
          seedCount: 0,
          imageUrl: personB.avatar,
        },
      ]);

      await db.insert(adminAuditLog).values({
        adminId: req.userId!,
        adminEmail: null,
        actionType: "create",
        targetTable: "prediction_markets",
        targetId: market.id,
        metadata: { type: "h2h", title, personAId, personBId },
      });

      res.json(market);
    } catch (error: any) {
      console.error("Error creating H2H market:", error.message);
      res.status(500).json({ error: "Failed to create H2H market" });
    }
  });

  app.post("/api/admin/native-markets/gainer", requireAuth, requireAdmin, async (req: AuthRequest, res) => {
    try {
      const { category, personIds, visibility = "live", featured = false, seedConfig } = req.body;
      const normalizedCategory = normalizeMarketCategory(category);

      if (!CANONICAL_MARKET_CATEGORIES.includes(normalizedCategory as typeof CANONICAL_MARKET_CATEGORIES[number])) {
        return res.status(400).json({ error: "Invalid category" });
      }
      if (!personIds || !Array.isArray(personIds) || personIds.length === 0) {
        return res.status(400).json({ error: "At least one person ID required" });
      }
      const now = new Date();
      const dayOfWeek = now.getUTCDay();
      const mondayOffset = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
      const monday = new Date(now);
      monday.setUTCDate(now.getUTCDate() + mondayOffset);
      monday.setUTCHours(0, 0, 0, 0);
      const sunday = new Date(monday);
      sunday.setUTCDate(monday.getUTCDate() + 6);
      sunday.setUTCHours(23, 59, 59, 999);

      const jan1 = new Date(now.getUTCFullYear(), 0, 1);
      const weekNumber = Math.ceil(((now.getTime() - jan1.getTime()) / 86400000 + jan1.getUTCDay() + 1) / 7);

      const existingGainers = await db.select().from(predictionMarkets).where(and(
        eq(predictionMarkets.marketType, "gainer"),
        eq(predictionMarkets.weekNumber, weekNumber)
      ));
      const existingGainer = existingGainers.find((market) => normalizeMarketCategory(market.category) === normalizedCategory);
      if (existingGainer) {
        return res.status(409).json({ error: `A Category Race market for ${getMarketCategoryLabel(normalizedCategory)} already exists this week`, existingId: existingGainer.id });
      }

      const persons = await db.select().from(trackedPeople).where(inArray(trackedPeople.id, personIds));
      if (persons.length !== personIds.length) {
        return res.status(400).json({ error: "Some person IDs not found" });
      }
      const orderedPersonIds = personIds as string[];
      const personOrder = new Map<string, number>(orderedPersonIds.map((personId: string, index: number) => [personId, index]));
      persons.sort((a, b) => (personOrder.get(a.id) ?? Number.MAX_SAFE_INTEGER) - (personOrder.get(b.id) ?? Number.MAX_SAFE_INTEGER));

      const title = `Category Race: ${getMarketCategoryLabel(normalizedCategory)}`;
      let slug = `gainer-${normalizedCategory}-week-${weekNumber}`;

      const gainerSnapRows = personIds.length > 0
        ? await db.execute(sql`
            SELECT DISTINCT ON (person_id) person_id, fame_index, timestamp
            FROM trend_snapshots
            WHERE person_id IN (${sql.join(personIds.map(id => sql`${id}`), sql`, `)})
              AND timestamp > NOW() - INTERVAL '14 days'
            ORDER BY person_id, timestamp DESC
          `)
        : { rows: [] };
      const gainerOpeningScores: any[] = [];
      for (const row of (gainerSnapRows.rows || [])) {
        if (row.fame_index != null) {
          gainerOpeningScores.push({ personId: String(row.person_id), score: Number(row.fame_index), snapshotAt: new Date(row.timestamp as string).toISOString() });
        }
      }
      const gainerMetadata = gainerOpeningScores.length > 0 ? { openingScores: gainerOpeningScores } : undefined;

      const defaultSeedConfig = {
        enabled: true,
        targetParticipantsMin: 25,
        targetParticipantsMax: 60,
        targetPoolMin: 8000,
        targetPoolMax: 20000,
        distributionBias: {},
      };

      let market: any;
      try {
        [market] = await db.insert(predictionMarkets).values({
          marketType: "gainer",
          title,
          slug,
          category: normalizedCategory,
          visibility,
          featured,
          status: "OPEN",
          startAt: monday,
          endAt: sunday,
          weekNumber,
          seedParticipants: 0,
          seedVolume: "0",
          metadata: gainerMetadata,
          seedConfig: seedConfig || defaultSeedConfig,
        }).returning();
      } catch (slugErr: any) {
        if (slugErr.code === '23505') {
          slug = `${slug}-${randomUUID().slice(0, 6)}`;
          [market] = await db.insert(predictionMarkets).values({
            marketType: "gainer",
            title,
            slug,
            category: normalizedCategory,
            visibility,
            featured,
            status: "OPEN",
            startAt: monday,
            endAt: sunday,
            weekNumber,
            seedParticipants: 0,
            seedVolume: "0",
            metadata: gainerMetadata,
            seedConfig: seedConfig || defaultSeedConfig,
          }).returning();
        } else {
          throw slugErr;
        }
      }

      const entryValues = persons.map((person, idx) => ({
        marketId: market.id,
        entryType: "person" as const,
        personId: person.id,
        label: person.name,
        displayOrder: idx,
        seedCount: 0,
        imageUrl: person.avatar,
      }));

      await db.insert(marketEntries).values(entryValues);

      await db.insert(adminAuditLog).values({
        adminId: req.userId!,
        adminEmail: null,
        actionType: "create",
        targetTable: "prediction_markets",
        targetId: market.id,
        metadata: { type: "gainer", category, personCount: personIds.length },
      });

      res.json(market);
    } catch (error: any) {
      console.error("Error creating gainer market:", error.message);
      res.status(500).json({ error: "Failed to create gainer market" });
    }
  });

  // Batch-generate ~15 H2H matchups from the top-ranked people for this week
  app.post("/api/admin/native-markets/generate-h2h", requireAuth, requireAdmin, async (req: AuthRequest, res) => {
    try {
      const created = await generateWeeklyH2H();
      const jan1 = new Date(new Date().getUTCFullYear(), 0, 1);
      const weekNumber = Math.ceil(((Date.now() - jan1.getTime()) / 86400000 + jan1.getUTCDay() + 1) / 7);
      await db.insert(adminAuditLog).values({ adminId: req.userId!, adminEmail: null, actionType: "create", targetTable: "prediction_markets", targetId: "bulk-h2h", metadata: { type: "h2h", created, weekNumber } });
      res.json({ success: true, created, weekNumber });
    } catch (error: any) {
      console.error("Error generating H2H markets:", error.message);
      res.status(500).json({ error: "Failed to generate H2H markets" });
    }
  });

  app.post("/api/admin/native-markets/generate-gainer", requireAuth, requireAdmin, async (req: AuthRequest, res) => {
    try {
      const { created, updated } = await generateWeeklyGainer();
      const jan1 = new Date(new Date().getUTCFullYear(), 0, 1);
      const weekNumber = Math.ceil(((Date.now() - jan1.getTime()) / 86400000 + jan1.getUTCDay() + 1) / 7);
      await db.insert(adminAuditLog).values({ adminId: req.userId!, adminEmail: null, actionType: "create", targetTable: "prediction_markets", targetId: "bulk-gainer", metadata: { type: "gainer", created, updated, weekNumber } });
      res.json({ success: true, created, updated, weekNumber });
    } catch (error: any) {
      console.error("Error generating gainer markets:", error.message);
      res.status(500).json({ error: "Failed to generate gainer markets" });
    }
  });

  app.get("/api/admin/native-markets/gainer/diagnostics", requireAuth, requireAdmin, async (_req: AuthRequest, res) => {
    try {
      const { monday, sunday, weekNumber } = getWeekContext();

      const tracked = await db.select({
        id: trackedPeople.id,
        category: trackedPeople.category,
        status: trackedPeople.status,
      }).from(trackedPeople);
      const mainLeaderboard = tracked.filter(t => t.status === "main_leaderboard");

      const byCategory: Record<string, number> = {};
      for (const p of mainLeaderboard) {
        const cat = normalizeMarketCategory(p.category || "misc");
        byCategory[cat] = (byCategory[cat] || 0) + 1;
      }

      const trendingCount = await db.select({ id: trendingPeople.id }).from(trendingPeople);

      const existingGainers = await db.select({
        id: predictionMarkets.id,
        category: predictionMarkets.category,
        status: predictionMarkets.status,
        visibility: predictionMarkets.visibility,
        startAt: predictionMarkets.startAt,
        endAt: predictionMarkets.endAt,
        title: predictionMarkets.title,
      }).from(predictionMarkets).where(and(
        eq(predictionMarkets.marketType, "gainer"),
        eq(predictionMarkets.weekNumber, weekNumber),
      ));

      const eligibleCategories = Object.entries(byCategory)
        .filter(([, count]) => count >= 3)
        .map(([cat]) => cat);

      const existingCategorySet = new Set(existingGainers.map(g => normalizeMarketCategory(g.category)));
      const missingCategories = eligibleCategories.filter(cat => !existingCategorySet.has(cat));
      const tooFewCategories = Object.entries(byCategory)
        .filter(([, count]) => count < 3)
        .map(([cat, count]) => ({ category: cat, count }));

      res.json({
        weekNumber,
        monday: monday.toISOString(),
        sunday: sunday.toISOString(),
        trackedPeopleTotal: tracked.length,
        trackedPeopleMainLeaderboard: mainLeaderboard.length,
        trendingPeopleTotal: trendingCount.length,
        categoryCounts: byCategory,
        eligibleCategories,
        tooFewCategories,
        existingGainerMarkets: existingGainers.map(g => ({
          id: g.id,
          title: g.title,
          category: g.category,
          status: g.status,
          visibility: g.visibility,
          startAt: g.startAt,
          endAt: g.endAt,
        })),
        missingCategories,
        willUseFallback: mainLeaderboard.length === 0 && trendingCount.length > 0,
      });
    } catch (error: any) {
      console.error("Error fetching gainer diagnostics:", error.message);
      res.status(500).json({ error: "Failed to fetch gainer diagnostics" });
    }
  });

  app.post("/api/admin/native-markets/gainer/normalize-categories", requireAuth, requireAdmin, async (_req: AuthRequest, res) => {
    try {
      const gainerMarkets = await db.select({
        id: predictionMarkets.id,
        category: predictionMarkets.category,
        title: predictionMarkets.title,
      }).from(predictionMarkets).where(eq(predictionMarkets.marketType, "gainer"));

      const updates = gainerMarkets
        .map((market) => {
          const normalizedCategory = normalizeMarketCategory(market.category);
          const normalizedTitle = `Category Race: ${getMarketCategoryLabel(normalizedCategory)}`;
          const needsUpdate = market.category !== normalizedCategory || market.title !== normalizedTitle;

          return needsUpdate
            ? {
                id: market.id,
                category: normalizedCategory,
                title: normalizedTitle,
              }
            : null;
        })
        .filter((market): market is { id: string; category: string; title: string } => market !== null);

      for (const market of updates) {
        await db.update(predictionMarkets).set({
          category: market.category,
          title: market.title,
          updatedAt: new Date(),
        }).where(eq(predictionMarkets.id, market.id));
      }

      res.json({ success: true, updated: updates.length });
    } catch (error: any) {
      console.error("Error normalizing gainer categories:", error.message);
      res.status(500).json({ error: "Failed to normalize gainer categories" });
    }
  });

  app.post("/api/admin/backfill-total-votes", requireAuth, requireAdmin, async (req: AuthRequest, res) => {
    try {
      const result = await db.transaction(async (tx) => {
        const rows: { userId: string; cnt: string }[] = await tx.execute(sql`
          WITH all_votes AS (
            SELECT user_id FROM votes WHERE vote_type = 'face_off'
            UNION ALL SELECT user_id FROM sentiment_votes
            UNION ALL SELECT user_id FROM celebrity_value_votes
            UNION ALL SELECT user_id FROM trending_poll_votes
            UNION ALL SELECT user_id FROM opinion_poll_votes
            UNION ALL SELECT user_id FROM image_votes
            UNION ALL SELECT user_id FROM induction_votes
          ),
          counts AS (
            SELECT user_id, COUNT(*)::int AS cnt FROM all_votes GROUP BY user_id
          )
          UPDATE profiles
          SET total_votes = COALESCE(counts.cnt, 0)
          FROM counts
          WHERE profiles.id = counts.user_id
            AND profiles.total_votes IS DISTINCT FROM counts.cnt
          RETURNING profiles.id
        `) as any;

        const updatedCount = Array.isArray(rows) ? rows.length : 0;

        await tx.insert(adminAuditLog).values({
          adminId: req.userId!,
          actionType: "backfill_total_votes",
          targetTable: "profiles",
          targetId: "all",
          newData: { profilesUpdated: updatedCount },
        });

        return updatedCount;
      });

      res.json({ success: true, profilesUpdated: result });
    } catch (error: any) {
      console.error("Error backfilling total votes:", error.message);
      res.status(500).json({ error: "Failed to backfill total votes" });
    }
  });

  app.patch("/api/admin/native-markets/:id", requireAuth, requireAdmin, async (req: AuthRequest, res) => {
    try {
      const { id } = req.params;
      const { visibility, featured, seedConfig, inactiveMessage } = req.body;

      const [existing] = await db.select().from(predictionMarkets).where(eq(predictionMarkets.id, id));
      if (!existing) {
        return res.status(404).json({ error: "Market not found" });
      }

      const updates: any = { updatedAt: new Date() };
      if (visibility !== undefined) updates.visibility = visibility;
      if (featured !== undefined) updates.featured = featured;
      if (seedConfig !== undefined) updates.seedConfig = seedConfig;
      if (inactiveMessage !== undefined) updates.inactiveMessage = inactiveMessage;

      const [updated] = await db.update(predictionMarkets)
        .set(updates)
        .where(eq(predictionMarkets.id, id))
        .returning();

      await db.insert(adminAuditLog).values({
        adminId: req.userId!,
        adminEmail: null,
        actionType: "update",
        targetTable: "prediction_markets",
        targetId: id,
        metadata: { type: existing.marketType, changes: Object.keys(updates) },
      });

      res.json(updated);
    } catch (error: any) {
      console.error("Error updating native market:", error.message);
      res.status(500).json({ error: "Failed to update market" });
    }
  });

  app.post("/api/admin/native-markets/bulk-visibility", requireAuth, requireAdmin, async (req: AuthRequest, res) => {
    try {
      const { marketIds, visibility } = req.body;
      if (!marketIds?.length || !['live', 'inactive', 'archived', 'draft'].includes(visibility)) {
        return res.status(400).json({ error: "Invalid parameters" });
      }

      await db.update(predictionMarkets)
        .set({ visibility, updatedAt: new Date() })
        .where(inArray(predictionMarkets.id, marketIds));

      await db.insert(adminAuditLog).values({
        adminId: req.userId!,
        adminEmail: null,
        actionType: "update",
        targetTable: "prediction_markets",
        targetId: "bulk",
        metadata: { visibility, count: marketIds.length },
      });

      res.json({ success: true, updated: marketIds.length });
    } catch (error: any) {
      console.error("Error bulk updating visibility:", error.message);
      res.status(500).json({ error: "Failed to bulk update" });
    }
  });

  app.delete("/api/admin/native-markets/:id", requireAuth, requireAdmin, async (req: AuthRequest, res) => {
    try {
      const { id } = req.params;
      const [existing] = await db.select().from(predictionMarkets).where(eq(predictionMarkets.id, id));
      if (!existing) {
        return res.status(404).json({ error: "Market not found" });
      }

      await db.delete(predictionMarkets).where(eq(predictionMarkets.id, id));

      await db.insert(adminAuditLog).values({
        adminId: req.userId!,
        adminEmail: null,
        actionType: "delete",
        targetTable: "prediction_markets",
        targetId: id,
        metadata: { type: existing.marketType, title: existing.title },
      });

      res.json({ success: true });
    } catch (error: any) {
      console.error("Error deleting native market:", error.message);
      res.status(500).json({ error: "Failed to delete market" });
    }
  });

  app.post("/api/admin/native-markets/:id/settle", requireAuth, requireAdmin, async (req: AuthRequest, res) => {
    try {
      const { id } = req.params;
      const { winnerEntryId, notes } = req.body;

      const [market] = await db.select().from(predictionMarkets).where(eq(predictionMarkets.id, id));
      if (!market) return res.status(404).json({ error: "Market not found" });
      if (market.status === "RESOLVED" || market.status === "VOID") return res.status(400).json({ error: "Market already resolved or voided" });

      if (market.marketType === "jackpot" && winnerEntryId) {
        return res.status(400).json({ error: "Jackpot markets cannot be settled by entry. Use void or let the auto-resolver handle it." });
      }

      const { settleMarketBets, voidMarketBets } = await import("./jobs/market-resolver");
      let settlementResult = null;

      if (winnerEntryId) {
        settlementResult = await settleMarketBets(id, winnerEntryId, {
          resolveMethod: "admin_manual",
          resolutionNotes: notes,
          settledBy: req.userId!,
          voidReason: null,
        });
      } else {
        const refunded = await voidMarketBets(id);
        settlementResult = { voided: true, refunded };
        await db.update(predictionMarkets).set({
          settledBy: req.userId!,
          resolveMethod: "admin_manual",
          resolutionNotes: notes,
          voidReason: notes || "Admin voided",
          updatedAt: new Date(),
        }).where(eq(predictionMarkets.id, id));
      }

      await db.insert(adminAuditLog).values({
        adminId: req.userId!,
        adminEmail: null,
        actionType: "update",
        targetTable: "prediction_markets",
        targetId: id,
        metadata: { action: "settle", winnerEntryId, type: market.marketType, settlement: settlementResult },
      });

      res.json({ success: true, settlement: settlementResult });
    } catch (error: any) {
      console.error("Error settling market:", error.message);
      res.status(500).json({ error: "Failed to settle market" });
    }
  });

  app.get("/api/admin/credit-reconciliation", requireAuth, requireAdmin, async (req: AuthRequest, res) => {
    try {
      const allProfiles = await db.select({ id: profiles.id, predictCredits: profiles.predictCredits }).from(profiles).where(eq(profiles.isAgent, false));

      const ledgerSums = await db
        .select({
          userId: creditLedger.userId,
          ledgerSum: sql<number>`COALESCE(SUM(${creditLedger.amount}), 0)::int`,
          entryCount: sql<number>`COUNT(*)::int`,
        })
        .from(creditLedger)
        .groupBy(creditLedger.userId);

      const ledgerMap = new Map(ledgerSums.map(l => [l.userId, { sum: l.ledgerSum, count: l.entryCount }]));

      const discrepancies: Array<{
        userId: string;
        profileBalance: number;
        ledgerSum: number;
        delta: number;
        ledgerEntries: number;
      }> = [];

      for (const p of allProfiles) {
        const ledger = ledgerMap.get(p.id);
        if (!ledger) continue;
        const delta = p.predictCredits - ledger.sum;
        if (delta !== 0) {
          console.log(`[CREDIT DRIFT] userId=${p.id} cached=${p.predictCredits} ledger=${ledger.sum} drift=${delta}`);
          discrepancies.push({
            userId: p.id,
            profileBalance: p.predictCredits,
            ledgerSum: ledger.sum,
            delta,
            ledgerEntries: ledger.count,
          });
        }
      }

      res.json({
        totalProfiles: allProfiles.length,
        profilesWithLedger: ledgerSums.length,
        reconciledCount: ledgerSums.length - discrepancies.length,
        discrepancyCount: discrepancies.length,
        discrepancies,
      });
    } catch (error: any) {
      console.error("Error in credit reconciliation:", error.message);
      res.status(500).json({ error: "Failed to run reconciliation" });
    }
  });

  app.get("/api/admin/markets/:id/payout-summary", requireAuth, requireAdmin, async (req: AuthRequest, res) => {
    try {
      const { id } = req.params;
      const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
      if (!UUID_RE.test(id)) return res.status(400).json({ error: "Invalid market ID" });

      const [market] = await db.select().from(predictionMarkets).where(eq(predictionMarkets.id, id)).limit(1);
      if (!market) return res.status(404).json({ error: "Market not found" });

      const bets = await db.select().from(marketBets).where(eq(marketBets.marketId, id));
      const settledBets = bets.filter(b => b.status === 'won' || b.status === 'lost' || b.status === 'refunded');
      const winnerBets = bets.filter(b => b.status === 'won');
      const loserBets = bets.filter(b => b.status === 'lost');

      const totalPool = bets.reduce((s, b) => s + b.stakeAmount, 0);
      const totalPayouts = winnerBets.reduce((s, b) => s + (b.payoutAmount ?? 0), 0);
      const remainder = totalPool - totalPayouts;
      const largestPayout = winnerBets.length > 0 ? Math.max(...winnerBets.map(b => b.payoutAmount ?? 0)) : 0;

      const ledgerEntries = await db.select({ id: creditLedger.id, txnType: creditLedger.txnType })
        .from(creditLedger)
        .where(sql`${creditLedger.idempotencyKey} LIKE ${'%' + id + '%'}`);

      res.json({
        marketId: id,
        marketType: market.marketType,
        status: market.status,
        totalPool,
        totalBets: bets.length,
        settledBets: settledBets.length,
        winnersCount: winnerBets.length,
        losersCount: loserBets.length,
        totalPayouts,
        remainder,
        remainderPolicy: 'burned',
        largestPayout,
        ledgerEntries: {
          total: ledgerEntries.length,
          stakes: ledgerEntries.filter(e => e.txnType === 'prediction_stake').length,
          payouts: ledgerEntries.filter(e => e.txnType === 'prediction_payout').length,
          refunds: ledgerEntries.filter(e => e.txnType === 'prediction_refund').length,
        },
      });
    } catch (error: any) {
      console.error("Error fetching payout summary:", error.message);
      res.status(500).json({ error: "Failed to fetch payout summary" });
    }
  });

  app.get("/api/admin/ops-summary", requireAuth, requireAdmin, async (req: AuthRequest, res) => {
    try {
      const [{ pendingCount }] = await db.select({ pendingCount: sql<number>`count(*)::int` })
        .from(predictionMarkets)
        .where(eq(predictionMarkets.status, "CLOSED_PENDING"));

      const twoHoursFromNow = new Date(Date.now() + 2 * 60 * 60 * 1000);
      const [{ closingSoonCount }] = await db.select({ closingSoonCount: sql<number>`count(*)::int` })
        .from(predictionMarkets)
        .where(and(
          eq(predictionMarkets.status, "OPEN"),
          lte(predictionMarkets.endAt, twoHoursFromNow),
        ));

      const { getLastResolverRunAt } = await import("./jobs/market-resolver");
      const resolverLastRunAt = getLastResolverRunAt();
      const resolverAgeMinutes = resolverLastRunAt
        ? Math.floor((Date.now() - resolverLastRunAt.getTime()) / (1000 * 60))
        : null;

      const allProfiles = await db.select({ id: profiles.id, predictCredits: profiles.predictCredits }).from(profiles).where(eq(profiles.isAgent, false));
      const ledgerSums = await db
        .select({
          userId: creditLedger.userId,
          ledgerSum: sql<number>`COALESCE(SUM(${creditLedger.amount}), 0)::int`,
        })
        .from(creditLedger)
        .groupBy(creditLedger.userId);
      const ledgerMap = new Map(ledgerSums.map(l => [l.userId, l.ledgerSum]));
      let driftUserCount = 0;
      for (const p of allProfiles) {
        const sum = ledgerMap.get(p.id);
        if (sum !== undefined && p.predictCredits !== sum) driftUserCount++;
      }

      res.json({
        pendingCount,
        closingSoonCount,
        resolverLastRunAt: resolverLastRunAt?.toISOString() ?? null,
        resolverAgeMinutes,
        resolverHealthy: resolverAgeMinutes !== null && resolverAgeMinutes <= 10,
        driftUserCount,
      });
    } catch (error: any) {
      console.error("Error fetching ops summary:", error.message);
      res.status(500).json({ error: "Failed to fetch ops summary" });
    }
  });

  app.get("/api/admin/markets/pending", requireAuth, requireAdmin, async (req: AuthRequest, res) => {
    try {
      const pendingMarkets = await db.select().from(predictionMarkets)
        .where(eq(predictionMarkets.status, "CLOSED_PENDING"))
        .orderBy(predictionMarkets.endAt);

      const marketIds = pendingMarkets.map(m => m.id);
      let betStats: Record<string, { pool: number; betCount: number; uniqueBettors: number; maxStakeUser: { userId: string; total: number } | null }> = {};
      
      if (marketIds.length > 0) {
        const bets = await db.select().from(marketBets).where(sql`${marketBets.marketId} IN (${sql.join(marketIds.map(id => sql`${id}`), sql`, `)})`);
        
        for (const bet of bets) {
          if (!betStats[bet.marketId]) {
            betStats[bet.marketId] = { pool: 0, betCount: 0, uniqueBettors: 0, maxStakeUser: null };
          }
          betStats[bet.marketId].pool += bet.stakeAmount;
          betStats[bet.marketId].betCount += 1;
        }
        
        for (const mid of marketIds) {
          if (!betStats[mid]) {
            betStats[mid] = { pool: 0, betCount: 0, uniqueBettors: 0, maxStakeUser: null };
          }
          const mBets = bets.filter(b => b.marketId === mid);
          const userTotals = new Map<string, number>();
          for (const b of mBets) {
            userTotals.set(b.userId, (userTotals.get(b.userId) || 0) + b.stakeAmount);
          }
          betStats[mid].uniqueBettors = userTotals.size;
          let maxUser: { userId: string; total: number } | null = null;
          for (const [uid, total] of Array.from(userTotals.entries())) {
            if (!maxUser || total > maxUser.total) maxUser = { userId: uid, total };
          }
          betStats[mid].maxStakeUser = maxUser;
        }
      }

      const entries = marketIds.length > 0
        ? await db.select().from(marketEntries).where(sql`${marketEntries.marketId} IN (${sql.join(marketIds.map(id => sql`${id}`), sql`, `)})`)
        : [];
      const entriesByMarket = new Map<string, typeof entries>();
      for (const e of entries) {
        if (!entriesByMarket.has(e.marketId)) entriesByMarket.set(e.marketId, []);
        entriesByMarket.get(e.marketId)!.push(e);
      }

      const now = Date.now();
      const result = pendingMarkets.map(m => {
        const stats = betStats[m.id] || { pool: 0, betCount: 0, uniqueBettors: 0, maxStakeUser: null };
        const pendingMs = m.endAt ? now - new Date(m.endAt).getTime() : 0;
        const pendingMinutes = Math.floor(pendingMs / (1000 * 60));
        const pendingHours = Math.floor(pendingMs / (1000 * 60 * 60));
        const concentration = stats.pool > 0 && stats.maxStakeUser ? stats.maxStakeUser.total / stats.pool : 0;
        const parsedNotes =
          typeof m.resolutionNotes === "string" && m.resolutionNotes.trim().startsWith("{")
            ? (() => {
                try {
                  return JSON.parse(m.resolutionNotes);
                } catch {
                  return null;
                }
              })()
            : null;
        const pendingReason =
          parsedNotes?.pendingReason ||
          (m.marketType === "community"
            ? "community_requires_manual_resolution"
            : m.marketType === "jackpot"
              ? "jackpot_requires_manual_cleanup"
              : "pending_review");
        
        const warnings: string[] = [];
        if (stats.betCount === 0) warnings.push("no_bets");
        if (pendingMinutes > 30) warnings.push("stuck");
        if (concentration > 0.6) warnings.push("concentration");

        return {
          ...m,
          pool: stats.pool,
          betCount: stats.betCount,
          uniqueBettors: stats.uniqueBettors,
          pendingHours,
          pendingReason,
          warnings,
          entries: entriesByMarket.get(m.id) || [],
        };
      });

      res.json(result);
    } catch (error: any) {
      console.error("Error fetching pending markets:", error.message);
      res.status(500).json({ error: "Failed to fetch pending markets" });
    }
  });

  app.post("/api/admin/markets/pending/cleanup", requireAuth, requireAdmin, async (req: AuthRequest, res) => {
    try {
      const olderThanHoursRaw = Number(req.body?.olderThanHours ?? 24);
      const olderThanHours = Number.isFinite(olderThanHoursRaw)
        ? Math.max(1, Math.min(olderThanHoursRaw, 24 * 90))
        : 24;
      const cutoff = new Date(Date.now() - olderThanHours * 60 * 60 * 1000);

      const staleMarkets = await db
        .select()
        .from(predictionMarkets)
        .where(and(
          eq(predictionMarkets.status, "CLOSED_PENDING"),
          lte(predictionMarkets.endAt, cutoff),
        ))
        .orderBy(asc(predictionMarkets.endAt));

      const marketIds = staleMarkets.map((market) => market.id);
      const activeBetCounts = new Map<string, number>();

      if (marketIds.length > 0) {
        const betCounts = await db
          .select({
            marketId: marketBets.marketId,
            count: count(),
          })
          .from(marketBets)
          .where(and(
            inArray(marketBets.marketId, marketIds),
            eq(marketBets.status, "active"),
          ))
          .groupBy(marketBets.marketId);

        for (const row of betCounts) {
          activeBetCounts.set(row.marketId, Number(row.count));
        }
      }

      const { voidMarketBets } = await import("./jobs/market-resolver");
      const cleaned: Array<{ id: string; title: string; marketType: string; action: string }> = [];
      const skipped: Array<{ id: string; title: string; marketType: string; reason: string }> = [];

      for (const market of staleMarkets) {
        const activeBetCount = activeBetCounts.get(market.id) || 0;

        if (market.marketType === "jackpot") {
          await voidMarketBets(market.id);
          await db
            .update(predictionMarkets)
            .set({
              voidReason: `Admin stale pending cleanup (${olderThanHours}h threshold)`,
              settledBy: req.userId!,
              resolutionNotes: JSON.stringify({
                type: "jackpot",
                pendingReason: "jackpot_cleaned_up",
                cleanupThresholdHours: olderThanHours,
              }),
              updatedAt: new Date(),
            })
            .where(eq(predictionMarkets.id, market.id));
          cleaned.push({ id: market.id, title: market.title, marketType: market.marketType, action: "voided" });
          continue;
        }

        if (market.marketType === "community" && activeBetCount === 0) {
          await voidMarketBets(market.id);
          await db
            .update(predictionMarkets)
            .set({
              voidReason: `Admin stale pending cleanup (${olderThanHours}h threshold, zero active bets)`,
              settledBy: req.userId!,
              resolutionNotes: JSON.stringify({
                type: "community",
                pendingReason: "community_auto_voided_zero_bets",
                cleanupThresholdHours: olderThanHours,
              }),
              updatedAt: new Date(),
            })
            .where(eq(predictionMarkets.id, market.id));
          cleaned.push({ id: market.id, title: market.title, marketType: market.marketType, action: "voided_zero_bets" });
          continue;
        }

        skipped.push({
          id: market.id,
          title: market.title,
          marketType: market.marketType,
          reason:
            market.marketType === "community"
              ? "manual_resolution_required"
              : "unsupported_cleanup_type",
        });
      }

      await db.insert(adminAuditLog).values({
        adminId: req.userId!,
        adminEmail: null,
        actionType: "cleanup",
        targetTable: "prediction_markets",
        targetId: "closed_pending",
        metadata: {
          olderThanHours,
          cleanedCount: cleaned.length,
          skippedCount: skipped.length,
        },
      });

      res.json({
        olderThanHours,
        found: staleMarkets.length,
        cleaned,
        skipped,
      });
    } catch (error: any) {
      console.error("Error cleaning stale pending markets:", error.message);
      res.status(500).json({ error: "Failed to clean stale pending markets" });
    }
  });

  app.get("/api/admin/markets/resolved", requireAuth, requireAdmin, async (req: AuthRequest, res) => {
    try {
      const resolvedMarkets = await db.select().from(predictionMarkets)
        .where(sql`${predictionMarkets.status} IN ('RESOLVED', 'VOID')`)
        .orderBy(desc(predictionMarkets.resolvedAt))
        .limit(50);

      const marketIds = resolvedMarkets.map(m => m.id);
      let betStats: Record<string, { pool: number; betCount: number; uniqueBettors: number; winnersCount: number; losersCount: number; totalPayouts: number }> = {};
      
      if (marketIds.length > 0) {
        const bets = await db.select().from(marketBets).where(sql`${marketBets.marketId} IN (${sql.join(marketIds.map(id => sql`${id}`), sql`, `)})`);
        
        for (const mid of marketIds) {
          const mBets = bets.filter(b => b.marketId === mid);
          const uniqueUsers = new Set(mBets.map(b => b.userId));
          betStats[mid] = {
            pool: mBets.reduce((s, b) => s + b.stakeAmount, 0),
            betCount: mBets.length,
            uniqueBettors: uniqueUsers.size,
            winnersCount: mBets.filter(b => b.status === 'won').length,
            losersCount: mBets.filter(b => b.status === 'lost').length,
            totalPayouts: mBets.filter(b => b.status === 'won').reduce((s, b) => s + (b.payoutAmount ?? 0), 0),
          };
        }
      }

      const profilesMap = new Map<string, string>();
      const settlerIds = resolvedMarkets.map(m => m.settledBy).filter(Boolean) as string[];
      if (settlerIds.length > 0) {
        const settlers = await db.select({ id: profiles.id, username: profiles.username }).from(profiles)
          .where(sql`${profiles.id} IN (${sql.join(settlerIds.map(id => sql`${id}`), sql`, `)})`);
        for (const s of settlers) {
          profilesMap.set(s.id, s.username || s.id);
        }
      }

      const result = resolvedMarkets.map(m => {
        const stats = betStats[m.id] || { pool: 0, betCount: 0, uniqueBettors: 0, winnersCount: 0, losersCount: 0, totalPayouts: 0 };
        const remainder = stats.pool - stats.totalPayouts;
        return {
          ...m,
          pool: stats.pool,
          betCount: stats.betCount,
          uniqueBettors: stats.uniqueBettors,
          winnersCount: stats.winnersCount,
          losersCount: stats.losersCount,
          totalPayouts: stats.totalPayouts,
          remainder,
          resolverName: m.resolveMethod === "admin_manual" && m.settledBy ? (profilesMap.get(m.settledBy) || "Admin") : "Auto",
        };
      });

      res.json(result);
    } catch (error: any) {
      console.error("Error fetching resolved markets:", error.message);
      res.status(500).json({ error: "Failed to fetch resolved markets" });
    }
  });

  app.get("/api/admin/markets/:id/preview-resolution", requireAuth, requireAdmin, async (req: AuthRequest, res) => {
    try {
      const { id } = req.params;
      const [market] = await db.select().from(predictionMarkets).where(eq(predictionMarkets.id, id)).limit(1);
      if (!market) return res.status(404).json({ error: "Market not found" });

      const entries = await db.select().from(marketEntries).where(eq(marketEntries.marketId, id));
      const bets = await db.select().from(marketBets).where(and(eq(marketBets.marketId, id), eq(marketBets.status, 'active')));

      const totalPool = bets.reduce((s, b) => s + b.stakeAmount, 0);

      const usernames = new Map<string, string>();
      const userIds = Array.from(new Set(bets.map(b => b.userId)));
      if (userIds.length > 0) {
        const profs = await db.select({ id: profiles.id, username: profiles.username }).from(profiles)
          .where(sql`${profiles.id} IN (${sql.join(userIds.map(uid => sql`${uid}`), sql`, `)})`);
        for (const p of profs) usernames.set(p.id, p.username || p.id.slice(0, 8));
      }

      const previews = entries.map(entry => {
        const entryBets = bets.filter(b => b.entryId === entry.id);
        const winnerPool = entryBets.reduce((s, b) => s + b.stakeAmount, 0);
        const loserBets = bets.filter(b => b.entryId !== entry.id);

        let payoutsDistributed = 0;
        const payoutDetails: { userId: string; username: string; stake: number; payout: number }[] = [];

        if (winnerPool > 0 && totalPool > 0) {
          for (const wb of entryBets) {
            const share = wb.stakeAmount / winnerPool;
            const payout = Math.round(share * totalPool);
            payoutsDistributed += payout;
            payoutDetails.push({
              userId: wb.userId,
              username: usernames.get(wb.userId) || wb.userId.slice(0, 8),
              stake: wb.stakeAmount,
              payout,
            });
          }
        }

        const remainder = totalPool - payoutsDistributed;

        return {
          entryId: entry.id,
          entryLabel: entry.label,
          totalStaked: winnerPool,
          betCount: entryBets.length,
          winnersCount: entryBets.length,
          losersCount: loserBets.length,
          totalPayouts: payoutsDistributed,
          remainder,
          payoutDetails: payoutDetails.sort((a, b) => b.payout - a.payout).slice(0, 10),
        };
      });

      res.json({
        marketId: id,
        title: market.title,
        marketType: market.marketType,
        totalPool,
        totalBets: bets.length,
        uniqueBettors: new Set(bets.map(b => b.userId)).size,
        entries: previews,
      });
    } catch (error: any) {
      console.error("Error previewing resolution:", error.message);
      res.status(500).json({ error: "Failed to preview resolution" });
    }
  });

  app.get("/api/admin/users/:id/credit-history", requireAuth, requireAdmin, async (req: AuthRequest, res) => {
    try {
      const { id } = req.params;
      const page = Math.max(1, parseInt(req.query.page as string) || 1);
      const pageSize = 50;
      const offset = (page - 1) * pageSize;

      const [profile] = await db.select().from(profiles).where(eq(profiles.id, id)).limit(1);
      if (!profile) return res.status(404).json({ error: "User not found" });

      const [{ count: totalCount }] = await db.select({ count: sql<number>`count(*)::int` })
        .from(creditLedger)
        .where(eq(creditLedger.userId, id));

      const history = await db.select().from(creditLedger)
        .where(eq(creditLedger.userId, id))
        .orderBy(desc(creditLedger.createdAt))
        .limit(pageSize)
        .offset(offset);

      const allEntries = await db.select({ amount: creditLedger.amount }).from(creditLedger)
        .where(eq(creditLedger.userId, id));
      const ledgerSum = allEntries.reduce((s, h) => s + h.amount, 0);
      const drift = profile.predictCredits - ledgerSum;
      const authEmail = await getSupabaseAuthEmail(id);

      res.json({
        profile: {
          id: profile.id,
          username: profile.username,
          email: authEmail,
          role: profile.role,
          rank: profile.rank,
          xpPoints: profile.xpPoints,
          predictCredits: profile.predictCredits,
          totalVotes: profile.totalVotes,
          totalPredictions: profile.totalPredictions,
          winRate: profile.winRate,
          createdAt: profile.createdAt,
        },
        ledgerSum,
        drift,
        entries: history,
        total: totalCount,
        page,
        pageSize,
        totalPages: Math.ceil(totalCount / pageSize),
      });
    } catch (error: any) {
      console.error("Error fetching credit history:", error.message);
      res.status(500).json({ error: "Failed to fetch credit history" });
    }
  });

  app.post("/api/admin/test-payout-pipeline", requireAuth, requireAdmin, async (req: AuthRequest, res) => {
    if (process.env.ENABLE_TEST_ENDPOINTS !== 'true') {
      return res.status(403).json({ error: "Test endpoints disabled. Set ENABLE_TEST_ENDPOINTS=true to enable." });
    }
    try {
      const { settleMarketBets } = await import("./jobs/market-resolver");

      const testPersonRows = await db.select({ id: trackedPeople.id, name: trackedPeople.name }).from(trackedPeople).limit(1);
      if (testPersonRows.length === 0) return res.status(500).json({ error: "No tracked people found" });
      const testPerson = testPersonRows[0];

      const testProfileRows = await db.select({ id: profiles.id, predictCredits: profiles.predictCredits }).from(profiles).limit(2);
      if (testProfileRows.length < 2) return res.status(500).json({ error: "Need at least 2 profiles for test" });

      const userA = testProfileRows[0];
      const userB = testProfileRows[1];
      const creditsBefore = { userA: userA.predictCredits, userB: userB.predictCredits };
      const stakeA = 100;
      const stakeB = 100;
      const totalPool = stakeA + stakeB;

      const testSlug = `test-payout-${Date.now()}`;
      const [testMarket] = await db.insert(predictionMarkets).values({
        marketType: "updown",
        title: "[TEST] Payout Pipeline Test",
        slug: testSlug,
        personId: testPerson.id,
        category: "test",
        visibility: "hidden",
        status: "OPEN",
        startAt: new Date(Date.now() - 2 * 60 * 60 * 1000),
        endAt: new Date(Date.now() - 60 * 1000),
        weekNumber: 0,
        seedParticipants: 0,
        seedVolume: "0",
      }).returning();

      const [upEntry] = await db.insert(marketEntries).values({
        marketId: testMarket.id,
        entryType: "custom",
        label: "Up",
        displayOrder: 0,
      }).returning();

      const [downEntry] = await db.insert(marketEntries).values({
        marketId: testMarket.id,
        entryType: "custom",
        label: "Down",
        displayOrder: 1,
      }).returning();

      await db.update(profiles).set({ predictCredits: creditsBefore.userA - stakeA }).where(eq(profiles.id, userA.id));
      await db.update(profiles).set({ predictCredits: creditsBefore.userB - stakeB }).where(eq(profiles.id, userB.id));

      const [betA] = await db.insert(marketBets).values({
        marketId: testMarket.id, entryId: upEntry.id, userId: userA.id, stakeAmount: stakeA, status: "active",
      }).returning();
      const [betB] = await db.insert(marketBets).values({
        marketId: testMarket.id, entryId: downEntry.id, userId: userB.id, stakeAmount: stakeB, status: "active",
      }).returning();

      await db.insert(creditLedger).values([
        {
          userId: userA.id, txnType: 'prediction_stake', amount: -stakeA, walletType: 'VIRTUAL',
          balanceAfter: creditsBefore.userA - stakeA, source: 'user_action',
          idempotencyKey: `stake_${testMarket.id}_${betA.id}`, metadata: { marketId: testMarket.id, entryId: upEntry.id, betId: betA.id },
        },
        {
          userId: userB.id, txnType: 'prediction_stake', amount: -stakeB, walletType: 'VIRTUAL',
          balanceAfter: creditsBefore.userB - stakeB, source: 'user_action',
          idempotencyKey: `stake_${testMarket.id}_${betB.id}`, metadata: { marketId: testMarket.id, entryId: downEntry.id, betId: betB.id },
        },
      ]);

      const settlement = await settleMarketBets(testMarket.id, upEntry.id);

      const invariants: Record<string, { passed: boolean; detail: string }> = {};

      invariants.poolConservation = {
        passed: Math.abs(settlement.remainder) <= 1,
        detail: `pool=${settlement.totalPool}, payouts=${settlement.payoutsDistributed}, remainder=${settlement.remainder}`,
      };

      invariants.winnersCount = {
        passed: settlement.winnersCount === 1,
        detail: `expected=1, actual=${settlement.winnersCount}`,
      };

      invariants.losersCount = {
        passed: settlement.losersCount === 1,
        detail: `expected=1, actual=${settlement.losersCount}`,
      };

      const betsAfter = await db.select().from(marketBets).where(eq(marketBets.marketId, testMarket.id));
      const winnerBet = betsAfter.find(b => b.entryId === upEntry.id);
      const loserBet = betsAfter.find(b => b.entryId === downEntry.id);

      invariants.losersGetNothing = {
        passed: loserBet?.payoutAmount === 0,
        detail: `loserPayout=${loserBet?.payoutAmount}`,
      };

      invariants.winnerGetsTotalPool = {
        passed: winnerBet?.payoutAmount === totalPool,
        detail: `winnerPayout=${winnerBet?.payoutAmount}, totalPool=${totalPool}`,
      };

      const updatedA = await db.select({ predictCredits: profiles.predictCredits }).from(profiles).where(eq(profiles.id, userA.id));
      const updatedB = await db.select({ predictCredits: profiles.predictCredits }).from(profiles).where(eq(profiles.id, userB.id));

      const expectedABalance = creditsBefore.userA - stakeA + totalPool;
      const expectedBBalance = creditsBefore.userB - stakeB;
      invariants.winnerBalanceIntegrity = {
        passed: updatedA[0]?.predictCredits === expectedABalance,
        detail: `expected=${expectedABalance}, actual=${updatedA[0]?.predictCredits}`,
      };
      invariants.loserBalanceIntegrity = {
        passed: updatedB[0]?.predictCredits === expectedBBalance,
        detail: `expected=${expectedBBalance}, actual=${updatedB[0]?.predictCredits}`,
      };

      const ledgerEntries = await db.select().from(creditLedger)
        .where(sql`${creditLedger.idempotencyKey} LIKE ${'%' + testMarket.id + '%'}`);
      const stakeEntries = ledgerEntries.filter(e => e.txnType === 'prediction_stake');
      const payoutEntries = ledgerEntries.filter(e => e.txnType === 'prediction_payout');

      invariants.stakeLedgerEntries = {
        passed: stakeEntries.length === 2,
        detail: `expected=2 stake entries, actual=${stakeEntries.length}`,
      };
      invariants.payoutLedgerEntries = {
        passed: payoutEntries.length === 1,
        detail: `expected=1 payout entry, actual=${payoutEntries.length}`,
      };

      await db.update(predictionMarkets).set({ status: "OPEN" as any }).where(eq(predictionMarkets.id, testMarket.id));
      await db.update(marketBets).set({ status: "active", settledAt: null, payoutAmount: 0 }).where(eq(marketBets.marketId, testMarket.id));
      await db.update(profiles).set({ predictCredits: updatedA[0]?.predictCredits }).where(eq(profiles.id, userA.id));

      const settlement2 = await settleMarketBets(testMarket.id, upEntry.id);

      invariants.idempotency = {
        passed: settlement2.alreadySettled !== true && settlement2.totalPool === totalPool,
        detail: `secondSettle: alreadySettled=${settlement2.alreadySettled}, pool=${settlement2.totalPool}`,
      };

      await db.update(predictionMarkets).set({ status: "RESOLVED" as any }).where(eq(predictionMarkets.id, testMarket.id));
      const settlement3 = await settleMarketBets(testMarket.id, upEntry.id);
      invariants.resolvedIdempotency = {
        passed: settlement3.alreadySettled === true,
        detail: `thirdSettle on RESOLVED: alreadySettled=${settlement3.alreadySettled}`,
      };

      const allPassed = Object.values(invariants).every(i => i.passed);

      const results = {
        passed: allPassed,
        testMarketId: testMarket.id,
        invariants,
        settlement,
        bets: betsAfter.map(b => ({ id: b.id, entryId: b.entryId, userId: b.userId, status: b.status, payoutAmount: b.payoutAmount, stakeAmount: b.stakeAmount })),
        ledgerSummary: { stakeEntries: stakeEntries.length, payoutEntries: payoutEntries.length, totalLedger: ledgerEntries.length },
        credits: {
          userA: { before: creditsBefore.userA, staked: stakeA, afterStake: creditsBefore.userA - stakeA, afterPayout: updatedA[0]?.predictCredits },
          userB: { before: creditsBefore.userB, staked: stakeB, afterStake: creditsBefore.userB - stakeB, afterPayout: updatedB[0]?.predictCredits },
        },
      };

      await db.delete(creditLedger).where(sql`${creditLedger.idempotencyKey} LIKE ${'%' + testMarket.id + '%'}`);
      await db.delete(marketBets).where(eq(marketBets.marketId, testMarket.id));
      await db.delete(marketEntries).where(eq(marketEntries.marketId, testMarket.id));
      await db.delete(predictionMarkets).where(eq(predictionMarkets.id, testMarket.id));

      await db.update(profiles).set({ predictCredits: creditsBefore.userA }).where(eq(profiles.id, userA.id));
      await db.update(profiles).set({ predictCredits: creditsBefore.userB }).where(eq(profiles.id, userB.id));

      res.json(results);
    } catch (error: any) {
      console.error("Error in payout pipeline test:", error.message);
      res.status(500).json({ error: "Payout pipeline test failed", details: error.message });
    }
  });

  app.patch("/api/admin/native-markets/h2h/:id/entries", requireAuth, requireAdmin, async (req: AuthRequest, res) => {
    try {
      const { id } = req.params;
      const { personAId, personBId } = req.body;

      const [market] = await db.select().from(predictionMarkets).where(
        and(eq(predictionMarkets.id, id), eq(predictionMarkets.marketType, "h2h"))
      );
      if (!market) return res.status(404).json({ error: "H2H market not found" });

      const [personA] = await db.select().from(trackedPeople).where(eq(trackedPeople.id, personAId));
      const [personB] = await db.select().from(trackedPeople).where(eq(trackedPeople.id, personBId));
      if (!personA || !personB) return res.status(404).json({ error: "Person not found" });

      await db.delete(marketEntries).where(eq(marketEntries.marketId, id));

      await db.insert(marketEntries).values([
        { marketId: id, entryType: "person", personId: personA.id, label: personA.name, displayOrder: 0, seedCount: 0, imageUrl: personA.avatar },
        { marketId: id, entryType: "person", personId: personB.id, label: personB.name, displayOrder: 1, seedCount: 0, imageUrl: personB.avatar },
      ]);

      await db.update(predictionMarkets).set({
        title: `${personA.name} vs ${personB.name}`,
        updatedAt: new Date(),
      }).where(eq(predictionMarkets.id, id));

      res.json({ success: true });
    } catch (error: any) {
      console.error("Error updating H2H entries:", error.message);
      res.status(500).json({ error: "Failed to update entries" });
    }
  });

  app.patch("/api/admin/native-markets/gainer/:id/entries", requireAuth, requireAdmin, async (req: AuthRequest, res) => {
    try {
      const { id } = req.params;
      const { personIds } = req.body;

      if (!personIds?.length) {
        return res.status(400).json({ error: "At least one person ID required" });
      }

      const [market] = await db.select().from(predictionMarkets).where(
        and(eq(predictionMarkets.id, id), eq(predictionMarkets.marketType, "gainer"))
      );
      if (!market) return res.status(404).json({ error: "Gainer market not found" });

      const persons = await db.select().from(trackedPeople).where(inArray(trackedPeople.id, personIds));
      if (persons.length !== personIds.length) {
        return res.status(400).json({ error: "Some person IDs not found" });
      }
      const orderedPersonIds = personIds as string[];
      const personOrder = new Map<string, number>(orderedPersonIds.map((personId: string, index: number) => [personId, index]));
      persons.sort((a, b) => (personOrder.get(a.id) ?? Number.MAX_SAFE_INTEGER) - (personOrder.get(b.id) ?? Number.MAX_SAFE_INTEGER));

      await db.delete(marketEntries).where(eq(marketEntries.marketId, id));

      const entryValues = persons.map((person, idx) => ({
        marketId: id,
        entryType: "person" as const,
        personId: person.id,
        label: person.name,
        displayOrder: idx,
        seedCount: 0,
        imageUrl: person.avatar,
      }));

      await db.insert(marketEntries).values(entryValues);

      await db.update(predictionMarkets).set({ updatedAt: new Date() }).where(eq(predictionMarkets.id, id));

      res.json({ success: true });
    } catch (error: any) {
      console.error("Error updating gainer entries:", error.message);
      res.status(500).json({ error: "Failed to update entries" });
    }
  });

  app.post("/api/admin/seed-engine/run", requireAuth, requireAdmin, async (req: AuthRequest, res) => {
    try {
      const { runSeedBatch } = await import("./jobs/seed-engine");
      const result = await runSeedBatch(true);
      res.json(result);
    } catch (error: any) {
      console.error("Error running seed batch:", error.message);
      res.status(500).json({ error: "Failed to run seed batch" });
    }
  });

  app.post("/api/admin/weekly-reset", requireAuth, requireAdmin, async (req: AuthRequest, res) => {
    try {
      const { weekNumber: currentWeek } = getWeekContext();

      const openMarkets = await db.select()
        .from(predictionMarkets)
        .where(
          and(
            eq(predictionMarkets.status, "OPEN"),
            inArray(predictionMarkets.marketType, ["updown", "h2h", "gainer", "jackpot"])
          )
        );

      let settled = 0;
      for (const market of openMarkets) {
        if (market.weekNumber && market.weekNumber < currentWeek) {
          await voidMarketBets(market.id);
          await db.update(predictionMarkets).set({
            voidReason: "Auto-voided by weekly reset safety path",
            settledBy: req.userId!,
            resolutionNotes: JSON.stringify({
              type: market.marketType,
              pendingReason: "weekly_reset_auto_void",
            }),
            updatedAt: new Date(),
          }).where(eq(predictionMarkets.id, market.id));
          settled++;
        }
      }

      res.json({ settled, currentWeek });
    } catch (error: any) {
      console.error("Error running weekly reset:", error.message);
      res.status(500).json({ error: "Failed to run weekly reset" });
    }
  });

  // ============ ADMIN: UNDERRATED/OVERRATED MANAGEMENT ============

  // GET /api/admin/vote/underrated - List all U/O cards for admin
  app.get("/api/admin/vote/underrated", requireAuth, requireAdmin, async (req: AuthRequest, res) => {
    try {
      const results = await db
        .select({
          id: trendingPeople.id,
          name: trendingPeople.name,
          category: trendingPeople.category,
          avatar: trendingPeople.avatar,
          rank: trendingPeople.rank,
          trendScore: celebrityMetrics.trendScore,
          underratedPct: celebrityMetrics.underratedPct,
          overratedPct: celebrityMetrics.overratedPct,
          fairlyRatedPct: celebrityMetrics.fairlyRatedPct,
          underratedVotesCount: celebrityMetrics.underratedVotesCount,
          overratedVotesCount: celebrityMetrics.overratedVotesCount,
          fairlyRatedVotesCount: celebrityMetrics.fairlyRatedVotesCount,
          valueScore: celebrityMetrics.valueScore,
          visibility: celebrityMetrics.visibility,
        })
        .from(trendingPeople)
        .leftJoin(celebrityMetrics, eq(trendingPeople.id, celebrityMetrics.celebrityId))
        .orderBy(asc(trendingPeople.rank));

      res.json({ data: results, totalCount: results.length });
    } catch (error: any) {
      console.error("Error fetching admin U/O cards:", error);
      res.status(500).json({ error: "Failed to fetch U/O cards" });
    }
  });

  // POST /api/admin/vote/underrated/sync - Sync U/O cards from leaderboard (idempotent)
  app.post("/api/admin/vote/underrated/sync", requireAuth, requireAdmin, async (req: AuthRequest, res) => {
    try {
      const allPeople = await db.select({ id: trendingPeople.id }).from(trendingPeople);
      const existingMetrics = await db.select({ celebrityId: celebrityMetrics.celebrityId }).from(celebrityMetrics);
      const existingIds = new Set(existingMetrics.map(m => m.celebrityId));

      const toInsert = allPeople
        .filter((p) => !existingIds.has(p.id))
        .map((p) => ({ celebrityId: p.id, updatedAt: new Date() }));
      if (toInsert.length > 0) {
        await db.insert(celebrityMetrics).values(toInsert);
      }

      res.json({ created: toInsert.length, total: allPeople.length });
    } catch (error: any) {
      console.error("Error syncing U/O cards:", error);
      res.status(500).json({ error: "Failed to sync U/O cards" });
    }
  });

  // PATCH /api/admin/vote/underrated/:id/visibility - Update U/O visibility
  app.patch("/api/admin/vote/underrated/:id/visibility", requireAuth, requireAdmin, async (req: AuthRequest, res) => {
    try {
      const { id } = req.params;
      const { visibility } = req.body;
      if (!visibility || !['live', 'inactive', 'archived'].includes(visibility)) {
        return res.status(400).json({ error: "visibility must be 'live', 'inactive', or 'archived'" });
      }
      await db.update(celebrityMetrics).set({ visibility, updatedAt: new Date() }).where(eq(celebrityMetrics.celebrityId, id));
      res.json({ success: true });
    } catch (error: any) {
      console.error("Error updating U/O visibility:", error);
      res.status(500).json({ error: "Failed to update visibility" });
    }
  });

  // ============ ADMIN: CURATE PROFILE MANAGEMENT ============

  // GET /api/admin/vote/curate-profile - List all curate profile cards for admin
  app.get("/api/admin/vote/curate-profile", requireAuth, requireAdmin, async (req: AuthRequest, res) => {
    try {
      const results = await db
        .select({
          id: trendingPeople.id,
          name: trendingPeople.name,
          category: trendingPeople.category,
          avatar: trendingPeople.avatar,
          rank: trendingPeople.rank,
          curateVisibility: celebrityMetrics.curateVisibility,
        })
        .from(trendingPeople)
        .leftJoin(celebrityMetrics, eq(trendingPeople.id, celebrityMetrics.celebrityId))
        .orderBy(asc(trendingPeople.rank));

      const imageStats = await db
        .select({
          personId: celebrityImages.personId,
          imageCount: count(),
          totalVotes: sql<number>`COALESCE(SUM(${celebrityImages.votesUp}), 0)`,
        })
        .from(celebrityImages)
        .groupBy(celebrityImages.personId);

      const imageMap = new Map(imageStats.map(s => [s.personId, { imageCount: Number(s.imageCount), totalVotes: Number(s.totalVotes) }]));

      const data = results.map(r => ({
        ...r,
        curateVisibility: r.curateVisibility || 'live',
        imageCount: imageMap.get(r.id)?.imageCount || 0,
        totalVotes: imageMap.get(r.id)?.totalVotes || 0,
      }));

      res.json({ data, totalCount: data.length });
    } catch (error: any) {
      console.error("Error fetching admin curate profile cards:", error);
      res.status(500).json({ error: "Failed to fetch curate profile cards" });
    }
  });

  // PATCH /api/admin/vote/curate-profile/:id/visibility - Update curate profile visibility
  app.patch("/api/admin/vote/curate-profile/:id/visibility", requireAuth, requireAdmin, async (req: AuthRequest, res) => {
    try {
      const { id } = req.params;
      const { visibility } = req.body;
      if (!visibility || !['live', 'inactive', 'archived'].includes(visibility)) {
        return res.status(400).json({ error: "visibility must be 'live', 'inactive', or 'archived'" });
      }
      await db.update(celebrityMetrics).set({ curateVisibility: visibility, updatedAt: new Date() }).where(eq(celebrityMetrics.celebrityId, id));
      res.json({ success: true });
    } catch (error: any) {
      console.error("Error updating curate visibility:", error);
      res.status(500).json({ error: "Failed to update visibility" });
    }
  });

  // GET /api/admin/vote/curate-profile/:id/images - List all images for a celebrity
  app.get("/api/admin/vote/curate-profile/:id/images", requireAuth, requireAdmin, async (req: AuthRequest, res) => {
    try {
      const { id } = req.params;
      const images = await db
        .select()
        .from(celebrityImages)
        .where(eq(celebrityImages.personId, id))
        .orderBy(desc(celebrityImages.votesUp));
      res.json({ data: images });
    } catch (error: any) {
      console.error("Error fetching celebrity images:", error);
      res.status(500).json({ error: "Failed to fetch images" });
    }
  });

  // PATCH /api/admin/vote/curate-profile/images/:imageId/seed-votes - Set seed votes for an image
  app.patch("/api/admin/vote/curate-profile/images/:imageId/seed-votes", requireAuth, requireAdmin, async (req: AuthRequest, res) => {
    try {
      const { imageId } = req.params;
      const { votesUp } = req.body;
      if (typeof votesUp !== 'number' || votesUp < 0) {
        return res.status(400).json({ error: "votesUp must be a non-negative number" });
      }
      const [image] = await db.select().from(celebrityImages).where(eq(celebrityImages.id, imageId));
      if (!image) return res.status(404).json({ error: "Image not found" });

      await db.update(celebrityImages)
        .set({ votesUp })
        .where(eq(celebrityImages.id, imageId));

      await syncWinningAvatarForPerson(image.personId);

      res.json({ success: true });
    } catch (error: any) {
      console.error("Error setting seed votes:", error);
      res.status(500).json({ error: "Failed to set seed votes" });
    }
  });

  // POST /api/admin/vote/curate-profile/:id/images - Add a new image for a celebrity
  app.post("/api/admin/vote/curate-profile/:id/images", requireAuth, requireAdmin, upload.single('file'), async (req: AuthRequest, res) => {
    try {
      const { id } = req.params;
      const file = req.file;

      if (!file) {
        return res.status(400).json({ error: "No file uploaded" });
      }

      const optimized = await optimizeImage(file.buffer, {
        maxWidth: 800,
        quality: 80,
        targetBytes: 200 * 1024,
        minQuality: 60,
        minWidth: 640,
      });

      const timestamp = Date.now();
      const filePath = `curate-profile/${id}/${timestamp}${optimized.extension}`;
      const bucketName = "public-images";

      const targetSizeLimit = 5 * 1024 * 1024;
      const { data: buckets } = await supabaseServer.storage.listBuckets();
      const existingBucket = buckets?.find(b => b.name === bucketName);
      if (!existingBucket) {
        const { error: createError } = await supabaseServer.storage.createBucket(bucketName, {
          public: true,
          allowedMimeTypes: ['image/png', 'image/jpeg', 'image/webp'],
          fileSizeLimit: targetSizeLimit,
        });
        if (createError) {
          console.error("Failed to create bucket:", createError);
          return res.status(500).json({ error: "Failed to create storage bucket" });
        }
      } else if (
        existingBucket.file_size_limit !== undefined &&
        existingBucket.file_size_limit !== null &&
        existingBucket.file_size_limit < targetSizeLimit
      ) {
        await supabaseServer.storage.updateBucket(bucketName, {
          public: true,
          allowedMimeTypes: ['image/png', 'image/jpeg', 'image/webp'],
          fileSizeLimit: targetSizeLimit,
        });
      }

      const { error: uploadError } = await supabaseServer.storage
        .from(bucketName)
        .upload(filePath, optimized.buffer, {
          contentType: optimized.contentType,
          upsert: false,
        });

      if (uploadError) {
        console.error("Supabase upload error:", uploadError);
        return res.status(500).json({ error: "Failed to upload image" });
      }

      const { data: urlData } = supabaseServer.storage
        .from(bucketName)
        .getPublicUrl(filePath);

      const source = (req.body.source as string) || "admin_upload";

      const [{ cnt: existingImageCount }] = await db
        .select({ cnt: count() })
        .from(celebrityImages)
        .where(eq(celebrityImages.personId, id));
      const isFirstImageForPerson = Number(existingImageCount) === 0;
      const publicUrl = urlData.publicUrl;

      const [newImage] = await db.insert(celebrityImages).values({
        personId: id,
        imageUrl: publicUrl,
        source,
        isPrimary: isFirstImageForPerson,
        votesUp: 0,
        votesDown: 0,
      }).returning();

      if (isFirstImageForPerson) {
        await db.update(trackedPeople).set({ avatar: publicUrl }).where(eq(trackedPeople.id, id));
        await db.update(trendingPeople).set({ avatar: publicUrl }).where(eq(trendingPeople.id, id));
      }

      res.json({ success: true, image: newImage });
    } catch (error: any) {
      console.error("Error adding celebrity image:", error);
      if (
        error.message?.includes('Only PNG') ||
        error.message?.includes('Could not compress image below')
      ) {
        return res.status(400).json({ error: error.message });
      }
      res.status(500).json({ error: "Failed to add image" });
    }
  });

  // DELETE /api/admin/vote/curate-profile/images/:imageId - Delete a celebrity image
  app.delete("/api/admin/vote/curate-profile/images/:imageId", requireAuth, requireAdmin, async (req: AuthRequest, res) => {
    try {
      const { imageId } = req.params;

      const [image] = await db.select().from(celebrityImages).where(eq(celebrityImages.id, imageId)).limit(1);
      if (!image) return res.status(404).json({ error: "Image not found" });

      if (image.imageUrl.includes('supabase')) {
        try {
          const publicPrefix = '/storage/v1/object/public/';
          const idx = image.imageUrl.indexOf(publicPrefix);
          if (idx !== -1) {
            const afterPrefix = image.imageUrl.substring(idx + publicPrefix.length);
            const slashIdx = afterPrefix.indexOf('/');
            if (slashIdx !== -1) {
              const bucketName = afterPrefix.substring(0, slashIdx);
              const objectPath = afterPrefix.substring(slashIdx + 1);
              await supabaseServer.storage.from(bucketName).remove([objectPath]);
            }
          }
        } catch (e) {
          console.warn("Failed to delete from Supabase storage:", e);
        }
      }

      await db.delete(celebrityImages).where(eq(celebrityImages.id, imageId));
      res.json({ success: true });
    } catch (error: any) {
      console.error("Error deleting celebrity image:", error);
      res.status(500).json({ error: "Failed to delete image" });
    }
  });

  // ============ ADMIN: INDUCTION QUEUE MANAGEMENT ============

  // GET /api/vote/induction - Public: list active induction candidates
  app.get("/api/vote/induction", optionalAuth, async (req: AuthRequest, res) => {
    try {
      const orderTerms = await orderSeedVotesForUser(
        req,
        inductionCandidates.seedVotes,
        inductionCandidates.category,
      );
      const candidates = await db
        .select()
        .from(inductionCandidates)
        .where(eq(inductionCandidates.isActive, true))
        .orderBy(...orderTerms);
      res.json({ data: candidates, totalCount: candidates.length });
    } catch (error: any) {
      console.error("Error fetching induction candidates:", error);
      res.status(500).json({ error: "Failed to fetch induction candidates" });
    }
  });

  app.get("/api/me/induction-votes", requireAuth, async (req: AuthRequest, res) => {
    try {
      const rows = await db
        .select({ candidateId: inductionVotes.candidateId })
        .from(inductionVotes)
        .where(eq(inductionVotes.userId, req.userId!));
      res.json(rows.map(r => r.candidateId));
    } catch (error: any) {
      console.error("Error fetching user induction votes:", error);
      res.status(500).json({ error: "Failed to fetch induction votes" });
    }
  });

  // POST /api/vote/induction/:id/vote - Auth: vote for an induction candidate (one vote per user per candidate)
  app.post("/api/vote/induction/:id/vote", requireAuth, async (req: AuthRequest, res) => {
    try {
      const { id } = req.params;
      const userId = req.userId!;
      if (!checkVoteRateLimit(userId)) {
        return res.status(429).json({ error: "Too many votes. Please slow down." });
      }
      const [candidate] = await db.select().from(inductionCandidates).where(eq(inductionCandidates.id, id)).limit(1);
      if (!candidate) return res.status(404).json({ error: "Candidate not found" });
      if (!candidate.isActive) return res.status(400).json({ error: "Candidate is not active" });

      const [existing] = await db.select()
        .from(inductionVotes)
        .where(and(eq(inductionVotes.userId, userId), eq(inductionVotes.candidateId, id)));

      if (existing) {
        return res.json({ success: true, alreadyVoted: true });
      }

      await db.transaction(async (tx) => {
        await tx.insert(inductionVotes).values({ candidateId: id, userId }).onConflictDoNothing();
        await tx.update(inductionCandidates)
          .set({ seedVotes: sql`${inductionCandidates.seedVotes} + 1` })
          .where(eq(inductionCandidates.id, id));
        await tx.update(profiles)
          .set({ totalVotes: sql`${profiles.totalVotes} + 1` })
          .where(eq(profiles.id, userId));
      });

      // Phase 3: engagement signal for the candidate's category.
      await upsertEngagement({
        userId,
        categoryId: candidate.category,
        voteDelta: 1,
        source: "induction-vote",
      });

      let xpResult;
      try {
        xpResult = await gamificationService.awardXp(
          userId, 'vote_induction',
          `induction_${id}_${userId}`,
          { candidateId: id }
        );
      } catch (e) { console.error("XP award failed:", e); }

      res.json({ success: true, xp: xpResult ?? null });
    } catch (error: any) {
      console.error("Error voting for induction candidate:", error);
      res.status(500).json({ error: "Failed to vote" });
    }
  });

  // ===========================================
  // ADMIN: INTERESTS DEBUG (Phase 3 observability)
  // ===========================================
  //
  // GET /api/admin/interests/debug/:userId
  //   Returns the target user's current blend state:
  //     - stated interests
  //     - decayed behavioural scores per category
  //     - ramp progress, blend weights, distinct category count
  //     - category-state snapshot (was "last20EngagementEvents" in the
  //       plan — renamed to avoid implying we store per-row history;
  //       v1 only has one aggregate row per (user, category))
  //   Optional ?feed=matchups|trending-polls|opinion-polls|open-markets
  //                  |native-markets|induction
  //   runs a top-20 ordered fetch against that feed using the user's
  //   blended ORDER BY and returns the composition mix (stated %,
  //   behavioural % from decayed score, neither %).
  app.get("/api/admin/interests/debug/:userId", requireAuth, requireAdmin, async (req: AuthRequest, res) => {
    try {
      const { userId: targetUserId } = req.params;
      if (!targetUserId) {
        return res.status(400).json({ error: "userId required" });
      }

      const state = await computeBlendStateForUser(targetUserId);

      // Raw category-state snapshot, ordered by most recently engaged.
      // Not an event log — aggregate row per (user, category). Keeps
      // v1 storage and query cost flat.
      const engagementRows = await db
        .select({
          categoryId: userCategoryEngagement.categoryId,
          voteCount: userCategoryEngagement.voteCount,
          betWeight: userCategoryEngagement.betWeight,
          firstEngagedAt: userCategoryEngagement.firstEngagedAt,
          lastEngagedAt: userCategoryEngagement.lastEngagedAt,
        })
        .from(userCategoryEngagement)
        .where(eq(userCategoryEngagement.userId, targetUserId))
        .orderBy(desc(userCategoryEngagement.lastEngagedAt));

      const topBlendedCategories = Array.from(state.behavioural.values())
        .sort((a, b) => b.decayed - a.decayed)
        .slice(0, 12)
        .map((score) => ({
          id: score.categoryId,
          stated: state.stated.includes(score.categoryId),
          raw: Number(score.raw.toFixed(3)),
          decayedScore: Number(score.decayed.toFixed(3)),
          lastEngagedDaysAgo: Number(score.lastEngagedDaysAgo.toFixed(2)),
        }));

      const statedOnly = state.stated.filter((id) => !state.behavioural.has(id));
      for (const id of statedOnly) {
        topBlendedCategories.push({
          id,
          stated: true,
          raw: 0,
          decayedScore: 0,
          lastEngagedDaysAgo: 0,
        });
      }

      // Optional feed composition. Schema: top-20 category list from
      // the requested feed, using the same blended ORDER BY that the
      // live endpoint would use for this user. We classify each card:
      //   stated       = category in state.stated
      //   behavioural  = category has decayed score > 0.01 (matches
      //                  blendedInterestBucket's epsilon)
      //   neither      = category not in stated AND no behavioural
      const feed = typeof req.query.feed === "string" ? req.query.feed : null;
      let feedComposition: {
        feed: string;
        totalConsidered: number;
        statedPct: number;
        behaviouralPct: number;
        neitherPct: number;
        categoryCounts: Record<string, number>;
      } | null = null;

      if (feed) {
        const topN = 20;
        let categoriesTopN: (string | null)[] = [];
        try {
          if (feed === "trending-polls") {
            const rows = await db
              .select({ category: trendingPolls.category })
              .from(trendingPolls)
              .limit(topN);
            categoriesTopN = rows.map((r) => r.category ?? null);
          } else if (feed === "matchups") {
            const rows = await db
              .select({ category: matchups.category })
              .from(matchups)
              .limit(topN);
            categoriesTopN = rows.map((r) => r.category ?? null);
          } else if (feed === "opinion-polls") {
            const rows = await db
              .select({ category: opinionPolls.category })
              .from(opinionPolls)
              .limit(topN);
            categoriesTopN = rows.map((r) => r.category ?? null);
          } else if (feed === "open-markets") {
            const rows = await db
              .select({ category: predictionMarkets.category })
              .from(predictionMarkets)
              .where(eq(predictionMarkets.marketType, "community"))
              .limit(topN);
            categoriesTopN = rows.map((r) => r.category ?? null);
          } else if (feed === "native-markets") {
            const rows = await db
              .select({ category: predictionMarkets.category })
              .from(predictionMarkets)
              .where(eq(predictionMarkets.marketType, "updown"))
              .limit(topN);
            categoriesTopN = rows.map((r) => r.category ?? null);
          } else if (feed === "induction") {
            const rows = await db
              .select({ category: inductionCandidates.category })
              .from(inductionCandidates)
              .limit(topN);
            categoriesTopN = rows.map((r) => r.category ?? null);
          } else {
            return res.status(400).json({
              error: "feed must be one of: trending-polls, matchups, opinion-polls, open-markets, native-markets, induction",
            });
          }

          const categoryCounts: Record<string, number> = {};
          let stated = 0;
          let behavioural = 0;
          let neither = 0;
          for (const raw of categoriesTopN) {
            const cat = raw ? raw.toLowerCase() : "(uncategorised)";
            categoryCounts[cat] = (categoryCounts[cat] ?? 0) + 1;

            const statedMatch = raw && state.stated.includes(cat);
            const behaviourScore = raw ? state.behavioural.get(cat)?.decayed ?? 0 : 0;
            if (statedMatch) {
              stated += 1;
            } else if (behaviourScore > 0.01) {
              behavioural += 1;
            } else {
              neither += 1;
            }
          }
          const total = categoriesTopN.length;
          feedComposition = {
            feed,
            totalConsidered: total,
            statedPct: total ? Math.round((stated / total) * 100) : 0,
            behaviouralPct: total ? Math.round((behavioural / total) * 100) : 0,
            neitherPct: total ? Math.round((neither / total) * 100) : 0,
            categoryCounts,
          };
        } catch (feedErr) {
          console.warn("[admin-interests-debug] feed analytics failed:", feedErr);
          feedComposition = null;
        }
      }

      return res.json({
        userId: targetUserId,
        stated: state.stated,
        distinctCategoryCount: state.distinctCategoryCount,
        daysSinceFirstEngagement:
          state.daysSinceFirstEngagement === null
            ? null
            : Number(state.daysSinceFirstEngagement.toFixed(2)),
        blendWeights: {
          stated: Number(state.statedEffectiveWeight.toFixed(3)),
          behaviour: Number(state.behaviourEffectiveWeight.toFixed(3)),
        },
        rampProgress: Number(state.rampProgress.toFixed(3)),
        topBlendedCategories,
        categoryState: engagementRows.map((r) => ({
          categoryId: r.categoryId,
          voteCount: r.voteCount,
          betWeight: Number(parseFloat(r.betWeight as unknown as string).toFixed(3)),
          firstEngagedAt: r.firstEngagedAt,
          lastEngagedAt: r.lastEngagedAt,
        })),
        config: {
          halfLifeDays: BEHAVIOUR_HALF_LIFE_DAYS,
          rampMinCategories: BEHAVIOUR_RAMP_MIN_CATEGORIES,
          rampFullCategories: BEHAVIOUR_RAMP_FULL_CATEGORIES,
          blendStatedWeek1: BLEND_STATED_WEEK_1,
          blendStatedWeek4: BLEND_STATED_WEEK_4,
          predictionStakeCap: PREDICTION_STAKE_WEIGHT_CAP,
        },
        feedComposition,
      });
    } catch (error: any) {
      console.error("[admin-interests-debug] failed:", error);
      res.status(500).json({ error: "Failed to resolve interests debug state" });
    }
  });

  // GET /api/admin/induction - Admin: list all induction candidates
  app.get("/api/admin/induction", requireAuth, requireAdmin, async (req: AuthRequest, res) => {
    try {
      const candidates = await db
        .select()
        .from(inductionCandidates)
        .orderBy(desc(inductionCandidates.seedVotes));
      res.json({ data: candidates, totalCount: candidates.length });
    } catch (error: any) {
      console.error("Error fetching admin induction candidates:", error);
      res.status(500).json({ error: "Failed to fetch induction candidates" });
    }
  });

  // POST /api/admin/induction - Admin: create a new induction candidate
  app.post("/api/admin/induction", requireAuth, requireAdmin, async (req: AuthRequest, res) => {
    try {
      const { displayName, category, imageSlug, wikiSlug, seedVotes, xHandle, inductionStatus } = req.body;
      if (!displayName || !category) return res.status(400).json({ error: "displayName and category are required" });

      const autoSlug = (typeof imageSlug === "string" && imageSlug.trim())
        ? imageSlug.trim()
        : generateImageSlug(displayName);
      const statusStr = (typeof inductionStatus === "string" && inductionStatus.trim()) ? inductionStatus.trim() : "Queue";
      const activeFromStatus = !["inducted", "rejected", "inactive", "archived"].includes(statusStr.toLowerCase());
      const xh = (typeof xHandle === "string" && xHandle.trim()) ? xHandle.trim().replace(/^@+/, "") : null;
      const sv = typeof seedVotes === "number" && !Number.isNaN(seedVotes)
        ? Math.max(0, Math.floor(seedVotes))
        : Math.max(0, parseInt(String(seedVotes ?? "0"), 10) || 0);

      const existing = await db.select({ id: inductionCandidates.id }).from(inductionCandidates).where(eq(inductionCandidates.displayName, displayName)).limit(1);
      if (existing.length > 0) return res.status(409).json({ error: "Candidate with this name already exists" });

      const [created] = await db.insert(inductionCandidates).values({
        displayName,
        category,
        imageSlug: autoSlug,
        wikiSlug: wikiSlug || null,
        seedVotes: sv,
        xHandle: xh,
        inductionStatus: statusStr,
        isActive: activeFromStatus,
      }).returning();

      res.json(created);
    } catch (error: any) {
      console.error("Error creating induction candidate:", error);
      res.status(500).json({ error: "Failed to create candidate" });
    }
  });

  // PATCH /api/admin/induction/:id - Admin: update an induction candidate
  app.patch("/api/admin/induction/:id", requireAuth, requireAdmin, async (req: AuthRequest, res) => {
    try {
      const { id } = req.params;
      const { displayName, category, imageSlug, wikiSlug, seedVotes, isActive, xHandle, inductionStatus } = req.body;

      const updates: any = {};
      if (displayName !== undefined) updates.displayName = displayName;
      if (category !== undefined) updates.category = category;
      if (imageSlug !== undefined) updates.imageSlug = imageSlug;
      if (wikiSlug !== undefined) updates.wikiSlug = wikiSlug;
      if (seedVotes !== undefined) updates.seedVotes = seedVotes;
      if (xHandle !== undefined) {
        updates.xHandle = (typeof xHandle === "string" && xHandle.trim()) ? xHandle.trim().replace(/^@+/, "") : null;
      }
      if (inductionStatus !== undefined) {
        const st = (typeof inductionStatus === "string" && inductionStatus.trim()) ? inductionStatus.trim() : "Queue";
        updates.inductionStatus = st;
        if (isActive === undefined) {
          updates.isActive = !["inducted", "rejected", "inactive", "archived"].includes(st.toLowerCase());
        }
      }
      if (isActive !== undefined) updates.isActive = isActive;

      if (Object.keys(updates).length === 0) return res.status(400).json({ error: "No valid fields to update" });

      const [updated] = await db.update(inductionCandidates).set(updates).where(eq(inductionCandidates.id, id)).returning();
      if (!updated) return res.status(404).json({ error: "Candidate not found" });

      res.json(updated);
    } catch (error: any) {
      console.error("Error updating induction candidate:", error);
      res.status(500).json({ error: "Failed to update candidate" });
    }
  });

  // POST /api/admin/induction/:id/approve - Admin: approve and induct to leaderboard
  app.post("/api/admin/induction/:id/approve", requireAuth, requireAdmin, async (req: AuthRequest, res) => {
    try {
      const { id } = req.params;
      const result = await approveInductionCandidate(id);
      res.json({ success: true, personId: result.personId, message: result.message });
    } catch (error: any) {
      console.error("Error approving induction candidate:", error);
      res.status(error.statusCode || 500).json({ error: error.statusCode === 404 ? error.message : "Failed to approve candidate" });
    }
  });

  // POST /api/admin/induction/:id/reject - Admin: deactivate candidate
  app.post("/api/admin/induction/:id/reject", requireAuth, requireAdmin, async (req: AuthRequest, res) => {
    try {
      const { id } = req.params;
      const [updated] = await db.update(inductionCandidates).set({ isActive: false }).where(eq(inductionCandidates.id, id)).returning();
      if (!updated) return res.status(404).json({ error: "Candidate not found" });
      res.json({ success: true });
    } catch (error: any) {
      console.error("Error rejecting induction candidate:", error);
      res.status(500).json({ error: "Failed to reject candidate" });
    }
  });

  // DELETE /api/admin/induction/:id - Admin: delete candidate
  app.delete("/api/admin/induction/:id", requireAuth, requireAdmin, async (req: AuthRequest, res) => {
    try {
      const { id } = req.params;
      const [deleted] = await db.delete(inductionCandidates).where(eq(inductionCandidates.id, id)).returning();
      if (!deleted) return res.status(404).json({ error: "Candidate not found" });
      res.json({ success: true });
    } catch (error: any) {
      console.error("Error deleting induction candidate:", error);
      res.status(500).json({ error: "Failed to delete candidate" });
    }
  });

  // ============================================================================
  // AI AGENT ADMIN ROUTES
  // ============================================================================

  app.post("/api/admin/agents/seed", requireAuth, requireAdmin, async (req: AuthRequest, res) => {
    try {
      const { archiveLegacyAgents, seedAgents } = await import("./agents/agentSeeder");
      const archive = req.body?.archiveLegacy === false
        ? { archived: 0, hiddenProfiles: 0, skippedV2: 0, skippedActions: 0 }
        : await archiveLegacyAgents({ hideProfiles: req.body?.hideLegacyProfiles !== false });
      const result = await seedAgents();

      res.json({ ok: true, archive, ...result });
    } catch (err: any) {
      console.error("[AgentAdmin] Seed failed:", err);
      res.status(500).json({ ok: false, error: err?.message ?? "Unknown error" });
    }
  });

  app.post("/api/admin/agents/archive-legacy", requireAuth, requireAdmin, async (req: AuthRequest, res) => {
    try {
      const { archiveLegacyAgents } = await import("./agents/agentSeeder");
      const result = await archiveLegacyAgents({ hideProfiles: req.body?.hideProfiles !== false });
      res.json({ ok: true, ...result });
    } catch (err: any) {
      console.error("[AgentAdmin] Archive failed:", err);
      res.status(500).json({ ok: false, error: err?.message ?? "Unknown error" });
    }
  });

  // These sweeps can take longer than the 30s edge timeout on Railway, so we
  // dispatch them as fire-and-forget background jobs and ack immediately.
  // The admin UI polls /status afterwards to see the real numbers.
  app.post("/api/admin/agents/run", requireAuth, requireAdmin, async (_req: AuthRequest, res) => {
    res.json({ ok: true, started: true, mode: "background", message: "Prediction batch started — refresh in 1-3 min to see scheduled actions." });
    void (async () => {
      try {
        const { runAgentBatch } = await import("./agents/agentRunner");
        const result = await runAgentBatch();
        console.log("[AgentAdmin] Prediction batch finished:", result);
      } catch (err: any) {
        console.error("[AgentAdmin] Prediction batch failed:", err);
      }
    })();
  });

  app.post("/api/admin/agents/run-comments", requireAuth, requireAdmin, async (_req: AuthRequest, res) => {
    res.json({ ok: true, started: true, mode: "background", message: "Comment sweep started — refresh shortly to see Comments 7d update." });
    void (async () => {
      try {
        const { runCommentSweep } = await import("./agents/commentWorker");
        const result = await runCommentSweep();
        console.log("[AgentAdmin] Comment sweep finished:", result);
      } catch (err: any) {
        console.error("[AgentAdmin] Comment sweep failed:", err);
      }
    })();
  });

  app.post("/api/admin/agents/run-votes", requireAuth, requireAdmin, async (_req: AuthRequest, res) => {
    res.json({ ok: true, started: true, mode: "background", message: "Vote sweep started — refresh shortly to see Ratings 7d / vote counts update." });
    void (async () => {
      try {
        const { runVoteSweep } = await import("./agents/voteWorker");
        const result = await runVoteSweep();
        console.log(`[AgentAdmin] Vote sweep finished: ${result.length} votes cast`);
      } catch (err: any) {
        console.error("[AgentAdmin] Vote sweep failed:", err);
      }
    })();
  });

  app.post("/api/admin/agents/run-likes", requireAuth, requireAdmin, async (_req: AuthRequest, res) => {
    res.json({ ok: true, started: true, mode: "background", message: "Comment-likes sweep started — refresh shortly to see Likes 7d update." });
    void (async () => {
      try {
        const { runCommentVoteSweep } = await import("./agents/commentVoteWorker");
        const result = await runCommentVoteSweep();
        console.log(`[AgentAdmin] Comment-likes sweep finished:`, result);
      } catch (err: any) {
        console.error("[AgentAdmin] Comment-likes sweep failed:", err);
      }
    })();
  });

  // GET /api/admin/agents/sharp-ranker - Returns the latest LLM
  // sharp-ranker snapshot. Used by the admin "Sharp Picks" tile so we
  // can see which markets the LLM is flagging as high-edge each sweep
  // and verify the sharp cohort is actually concentrating on those.
  app.get("/api/admin/agents/sharp-ranker", requireAuth, requireAdmin, async (_req: AuthRequest, res) => {
    try {
      const { getCachedSharpRanking, isSharpRankerEnabled } = await import("./agents/sharpRanker");
      const snapshot = getCachedSharpRanking();
      res.json({
        enabled: isSharpRankerEnabled(),
        snapshot,
      });
    } catch (err: any) {
      console.error("[AgentAdmin] sharp-ranker fetch failed:", err);
      res.status(500).json({ enabled: false, error: err?.message ?? "Unknown error" });
    }
  });

  // POST /api/admin/agents/refresh-simulation-profiles - Re-applies the
  // current seeder's per-persona simulation profile (cap, chance, edge,
  // stake) to all existing V2 agents. Use after tuning seeder values so
  // changes take effect WITHOUT wiping P&L history. Idempotent.
  app.post("/api/admin/agents/refresh-simulation-profiles", requireAuth, requireAdmin, async (_req: AuthRequest, res) => {
    try {
      const { refreshAgentSimulationProfiles } = await import("./agents/agentSeeder");
      const result = await refreshAgentSimulationProfiles();
      res.json({ ok: true, ...result });
    } catch (err: any) {
      console.error("[AgentAdmin] refresh-simulation-profiles failed:", err);
      res.status(500).json({ ok: false, error: err?.message ?? "Unknown error" });
    }
  });

  // GET /api/admin/agents/activity-stream - Chronological union of recent
  // agent activity across comments, votes (face_off/sentiment/opinion/
  // approval), and comment-likes. Used by the admin "Recent Agent
  // Activity" panel so my brother and I can watch the simulation breathe
  // in real time without having to dig through three separate tables.
  // ?limit=N (default 50, max 200), ?since=ISO (optional cutoff).
  app.get("/api/admin/agents/activity-stream", requireAuth, requireAdmin, async (req: AuthRequest, res) => {
    try {
      const limit = Math.min(Math.max(parseInt(String(req.query.limit ?? "50"), 10) || 50, 1), 200);
      const sinceParam = typeof req.query.since === "string" ? req.query.since : null;
      const sinceDate = sinceParam ? new Date(sinceParam) : null;
      // Default cutoff: last 7 days. Keeps the union row-count manageable
      // even on the busiest cohort settings without losing recent history.
      const cutoff = sinceDate && !Number.isNaN(sinceDate.getTime())
        ? sinceDate
        : new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

      // Single SQL union pulls comments + votes (3 tables) + likes + bets
      // for is_agent profiles, then orders by event_at across all sources.
      // CRITICAL: each UNION ALL leg is wrapped in parens. Without them
      // Postgres binds the per-leg ORDER BY/LIMIT to the union as a whole
      // and rejects the trailing UNION ALL clauses. Column names differ
      // per table — comments/poll-votes use created_at, votes/comment_votes
      // use voted_at, market_bets uses created_at.
      const rows = await db.execute(sql`
        WITH recent AS (
          (
            SELECT
              'comment'::text AS kind,
              c.id::text AS event_id,
              c.user_id AS user_id,
              c.created_at AS event_at,
              c.parent_type::text AS surface,
              c.parent_id::text AS target_id,
              c.body AS detail,
              CASE WHEN c.parent_comment_id IS NOT NULL THEN 'reply' ELSE 'top' END AS sub_kind
            FROM comments c
            INNER JOIN profiles p ON p.id = c.user_id
            WHERE p.is_agent = true
              AND c.deleted_at IS NULL
              AND c.created_at >= ${cutoff}
            ORDER BY c.created_at DESC
            LIMIT ${limit}
          )

          UNION ALL

          (
            SELECT
              'vote'::text AS kind,
              v.id::text AS event_id,
              v.user_id AS user_id,
              v.voted_at AS event_at,
              v.vote_type::text AS surface,
              v.target_id::text AS target_id,
              v.value AS detail,
              NULL::text AS sub_kind
            FROM votes v
            INNER JOIN profiles p ON p.id = v.user_id
            WHERE p.is_agent = true
              AND v.voted_at >= ${cutoff}
            ORDER BY v.voted_at DESC
            LIMIT ${limit}
          )

          UNION ALL

          (
            SELECT
              'vote'::text AS kind,
              tpv.id::text AS event_id,
              tpv.user_id AS user_id,
              tpv.created_at AS event_at,
              'sentiment_poll'::text AS surface,
              tpv.poll_id::text AS target_id,
              tpv.choice AS detail,
              NULL::text AS sub_kind
            FROM trending_poll_votes tpv
            INNER JOIN profiles p ON p.id = tpv.user_id
            WHERE p.is_agent = true
              AND tpv.created_at >= ${cutoff}
            ORDER BY tpv.created_at DESC
            LIMIT ${limit}
          )

          UNION ALL

          (
            SELECT
              'vote'::text AS kind,
              opv.id::text AS event_id,
              opv.user_id AS user_id,
              opv.created_at AS event_at,
              'opinion_poll'::text AS surface,
              opv.poll_id::text AS target_id,
              COALESCE(po.name, opv.option_id::text) AS detail,
              NULL::text AS sub_kind
            FROM opinion_poll_votes opv
            INNER JOIN profiles p ON p.id = opv.user_id
            LEFT JOIN opinion_poll_options po ON po.id = opv.option_id
            WHERE p.is_agent = true
              AND opv.created_at >= ${cutoff}
            ORDER BY opv.created_at DESC
            LIMIT ${limit}
          )

          UNION ALL

          (
            SELECT
              'like'::text AS kind,
              cv.id::text AS event_id,
              cv.user_id AS user_id,
              cv.voted_at AS event_at,
              'comment_vote'::text AS surface,
              cv.comment_id::text AS target_id,
              cv.vote_type::text AS detail,
              NULL::text AS sub_kind
            FROM comment_votes cv
            INNER JOIN profiles p ON p.id = cv.user_id
            WHERE p.is_agent = true
              AND cv.voted_at >= ${cutoff}
            ORDER BY cv.voted_at DESC
            LIMIT ${limit}
          )

          UNION ALL

          (
            SELECT
              'bet'::text AS kind,
              mb.id::text AS event_id,
              mb.user_id AS user_id,
              mb.created_at AS event_at,
              COALESCE(pm.market_type::text, 'market') AS surface,
              mb.market_id::text AS target_id,
              CONCAT(mb.direction::text, ' on ', COALESCE(me.label, '?'), ' for ', mb.stake_amount, ' credits') AS detail,
              NULL::text AS sub_kind
            FROM market_bets mb
            INNER JOIN profiles p ON p.id = mb.user_id
            LEFT JOIN prediction_markets pm ON pm.id = mb.market_id
            LEFT JOIN market_entries me ON me.id = mb.entry_id
            WHERE p.is_agent = true
              AND mb.agent_id IS NOT NULL
              AND mb.created_at >= ${cutoff}
            ORDER BY mb.created_at DESC
            LIMIT ${limit}
          )
        )
        SELECT
          r.kind,
          r.event_id,
          r.user_id,
          r.event_at,
          r.surface,
          r.target_id,
          r.detail,
          r.sub_kind,
          p.username AS username,
          p.avatar_url AS avatar_url
        FROM recent r
        LEFT JOIN profiles p ON p.id = r.user_id
        ORDER BY r.event_at DESC
        LIMIT ${limit}
      `);

      const events = (rows.rows as Array<Record<string, any>>).map((row) => ({
        kind: row.kind as "comment" | "vote" | "like" | "bet",
        eventId: String(row.event_id),
        userId: String(row.user_id),
        username: row.username ?? "(unknown)",
        avatarUrl: row.avatar_url ?? null,
        createdAt: row.event_at instanceof Date ? row.event_at.toISOString() : String(row.event_at),
        surface: row.surface ? String(row.surface) : null,
        targetId: row.target_id ? String(row.target_id) : null,
        detail: row.detail ? String(row.detail) : null,
        subKind: row.sub_kind ? String(row.sub_kind) : null,
      }));

      res.json({ ok: true, events, count: events.length });
    } catch (err: any) {
      console.error("[AgentAdmin] activity-stream failed:", err);
      res.status(500).json({ ok: false, error: err?.message ?? "Unknown error" });
    }
  });

  // POST /api/admin/agents/:agentId/toggle-active - Pause or resume a single
  // agent's simulation activity without banning their profile.
  // Body: { active: boolean }. Setting active=false also skips any pending
  // scheduled actions so we don't fire stale bets after a resume.
  app.post("/api/admin/agents/:agentId/toggle-active", requireAuth, requireAdmin, async (req: AuthRequest, res) => {
    try {
      const { agentConfigs, scheduledAgentActions } = await import("@shared/schema");
      const { agentId } = req.params;

      if (typeof req.body?.active !== "boolean") {
        return sendBadRequest(res, "Body must include { active: boolean }");
      }
      const desired: boolean = req.body.active;

      const [existing] = await db
        .select({ id: agentConfigs.id, isActive: agentConfigs.isActive, displayName: agentConfigs.displayName })
        .from(agentConfigs)
        .where(eq(agentConfigs.id, agentId))
        .limit(1);

      if (!existing) {
        return res.status(404).json({ error: "Agent not found" });
      }

      const now = new Date();
      let skippedPending = 0;

      await db.transaction(async (tx) => {
        await tx
          .update(agentConfigs)
          .set({ isActive: desired, updatedAt: now })
          .where(eq(agentConfigs.id, agentId));

        if (!desired) {
          const skipped = await tx
            .update(scheduledAgentActions)
            .set({
              status: "skipped",
              errorMessage: "Agent paused via admin",
              executedAt: now,
            })
            .where(
              and(
                eq(scheduledAgentActions.agentId, agentId),
                sql`${scheduledAgentActions.status} IN ('pending', 'in_progress')`,
              )
            )
            .returning({ id: scheduledAgentActions.id });
          skippedPending = skipped.length;
        }

        await tx.insert(adminAuditLog).values({
          adminId: req.userId!,
          actionType: desired ? "agent_resume" : "agent_pause",
          targetTable: "agent_configs",
          targetId: agentId,
          previousData: { isActive: existing.isActive },
          newData: { isActive: desired },
          metadata: { displayName: existing.displayName, skippedPending },
        });
      });

      res.json({ ok: true, agentId, active: desired, skippedPending });
    } catch (err: any) {
      console.error("[AgentAdmin] Toggle active failed:", err);
      res.status(500).json({ ok: false, error: err?.message ?? "Unknown error" });
    }
  });

  // POST /api/admin/agents/:agentId/clear-pending - Mark a single agent's
  // pending/in_progress scheduled actions as skipped. Useful when one agent
  // gets stuck or queues something we don't want fired.
  app.post("/api/admin/agents/:agentId/clear-pending", requireAuth, requireAdmin, async (req: AuthRequest, res) => {
    try {
      const { agentConfigs, scheduledAgentActions } = await import("@shared/schema");
      const { agentId } = req.params;

      const [existing] = await db
        .select({ id: agentConfigs.id, displayName: agentConfigs.displayName })
        .from(agentConfigs)
        .where(eq(agentConfigs.id, agentId))
        .limit(1);

      if (!existing) {
        return res.status(404).json({ error: "Agent not found" });
      }

      const now = new Date();
      const skipped = await db
        .update(scheduledAgentActions)
        .set({
          status: "skipped",
          errorMessage: "Cleared via admin",
          executedAt: now,
        })
        .where(
          and(
            eq(scheduledAgentActions.agentId, agentId),
            sql`${scheduledAgentActions.status} IN ('pending', 'in_progress')`,
          )
        )
        .returning({ id: scheduledAgentActions.id });

      await db.insert(adminAuditLog).values({
        adminId: req.userId!,
        actionType: "agent_clear_pending",
        targetTable: "scheduled_agent_actions",
        targetId: agentId,
        previousData: null,
        newData: { skipped: skipped.length },
        metadata: { displayName: existing.displayName },
      });

      res.json({ ok: true, agentId, skipped: skipped.length });
    } catch (err: any) {
      console.error("[AgentAdmin] Clear pending failed:", err);
      res.status(500).json({ ok: false, error: err?.message ?? "Unknown error" });
    }
  });

  // POST /api/admin/agents/:agentId/rename - Change an agent's public-facing
  // username (and display name). Updates BOTH agent_configs and profiles in
  // a single transaction so the leaderboard, comments, town square, and
  // admin tools all show the new name immediately. The displayName defaults
  // to the new username unless explicitly provided.
  app.post("/api/admin/agents/:agentId/rename", requireAuth, requireAdmin, async (req: AuthRequest, res) => {
    try {
      const { agentConfigs } = await import("@shared/schema");
      const { agentId } = req.params;
      const rawUsername = typeof req.body?.username === "string" ? req.body.username.trim() : "";
      const rawDisplayName = typeof req.body?.displayName === "string" ? req.body.displayName.trim() : "";

      // Username rules: 3-30 chars, alphanumeric + underscore only. Mirrors
      // what real users can register — keeps agents visually indistinguishable
      // from humans on the public surfaces.
      if (!/^[A-Za-z0-9_]{3,30}$/.test(rawUsername)) {
        return sendBadRequest(
          res,
          "Username must be 3-30 chars, letters/numbers/underscore only.",
        );
      }
      const newUsername = rawUsername;
      const newDisplayName = rawDisplayName.length > 0 ? rawDisplayName : rawUsername;

      const [agent] = await db
        .select({
          id: agentConfigs.id,
          userId: agentConfigs.userId,
          username: agentConfigs.username,
          displayName: agentConfigs.displayName,
        })
        .from(agentConfigs)
        .where(eq(agentConfigs.id, agentId))
        .limit(1);

      if (!agent) {
        return res.status(404).json({ error: "Agent not found" });
      }

      // No-op short-circuit so callers can blindly resubmit without 409s.
      if (agent.username === newUsername && agent.displayName === newDisplayName) {
        return res.json({ ok: true, unchanged: true, agent });
      }

      // Uniqueness pre-check across BOTH tables. The DB unique constraints
      // would catch this on insert/update too, but a clear 409 is friendlier
      // than a generic Postgres error string.
      const conflictingProfile = await db
        .select({ id: profiles.id })
        .from(profiles)
        .where(and(eq(profiles.username, newUsername), sql`${profiles.id} != ${agent.userId}`))
        .limit(1);
      if (conflictingProfile.length > 0) {
        return res.status(409).json({ error: "Username is already taken." });
      }
      const conflictingAgent = await db
        .select({ id: agentConfigs.id })
        .from(agentConfigs)
        .where(and(eq(agentConfigs.username, newUsername), sql`${agentConfigs.id} != ${agentId}`))
        .limit(1);
      if (conflictingAgent.length > 0) {
        return res.status(409).json({ error: "Username is already taken." });
      }

      const now = new Date();
      await db.transaction(async (tx) => {
        await tx
          .update(agentConfigs)
          .set({ username: newUsername, displayName: newDisplayName, updatedAt: now })
          .where(eq(agentConfigs.id, agentId));
        await tx
          .update(profiles)
          .set({ username: newUsername })
          .where(eq(profiles.id, agent.userId));
      });

      res.json({
        ok: true,
        agent: {
          id: agent.id,
          userId: agent.userId,
          previousUsername: agent.username,
          previousDisplayName: agent.displayName,
          username: newUsername,
          displayName: newDisplayName,
        },
      });
    } catch (err: any) {
      console.error("[AgentAdmin] Rename failed:", err);
      res.status(500).json({ ok: false, error: err?.message ?? "Unknown error" });
    }
  });

  app.post("/api/admin/agents/clear-world-abstained", requireAuth, requireAdmin, async (req: AuthRequest, res) => {
    try {
      const { scheduledAgentActions } = await import("@shared/schema");
      const result = await db.delete(scheduledAgentActions)
        .where(eq(scheduledAgentActions.status, "world_abstained"))
        .returning({ id: scheduledAgentActions.id });
      res.json({ ok: true, deleted: result.length });
    } catch (err: any) {
      console.error("[AgentAdmin] Clear world-abstained failed:", err);
      res.status(500).json({ ok: false, error: err?.message ?? "Unknown error" });
    }
  });

  app.get("/api/admin/agents/status", requireAuth, requireAdmin, async (req: AuthRequest, res) => {
    try {
      const { scheduledAgentActions, agentConfigs } = await import("@shared/schema");

      const agents = await db.select({
        id: agentConfigs.id,
        userId: agentConfigs.userId,
        displayName: agentConfigs.displayName,
        username: agentConfigs.username,
        archetype: agentConfigs.archetype,
        isActive: agentConfigs.isActive,
        simulationProfile: agentConfigs.simulationProfile,
      }).from(agentConfigs);

      const activeAgents = agents.filter((agent) => agent.isActive);
      const v2Agents = activeAgents.filter((agent) => {
        const profile = agent.simulationProfile as Record<string, unknown> | null;
        return profile?.cohortId === "v2-2026-prelaunch";
      });

      const pendingActions = await db.select({
        id: scheduledAgentActions.id,
        agentId: scheduledAgentActions.agentId,
        marketId: scheduledAgentActions.marketId,
        actionType: scheduledAgentActions.actionType,
        status: scheduledAgentActions.status,
        executeAfter: scheduledAgentActions.executeAfter,
        stakeAmount: scheduledAgentActions.stakeAmount,
      })
      .from(scheduledAgentActions)
      .where(eq(scheduledAgentActions.status, "pending"))
      .orderBy(asc(scheduledAgentActions.executeAfter))
      .limit(200);

      // True total pending count (the list above is capped for UI display).
      // Without this, the cohort summary tile would always saturate at the
      // limit and look frozen.
      const pendingTotalRow = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(scheduledAgentActions)
        .where(eq(scheduledAgentActions.status, "pending"));
      const pendingTotal = pendingTotalRow[0]?.count ?? 0;

      const executedCount = await db.select({ count: sql<number>`count(*)` })
        .from(scheduledAgentActions)
        .where(eq(scheduledAgentActions.status, "executed"));

      const failedCount = await db.select({ count: sql<number>`count(*)` })
        .from(scheduledAgentActions)
        .where(eq(scheduledAgentActions.status, "failed"));

      const pnlRows = await db.execute(sql`
        SELECT
          ac.id,
          ac.username,
          ac.is_active AS "isActive",
          COALESCE(SUM(CASE
            WHEN mb.status = 'won' THEN COALESCE(mb.payout_amount, 0) - mb.stake_amount
            WHEN mb.status = 'lost' THEN -mb.stake_amount
            ELSE 0
          END), 0)::int AS "profitLoss",
          COUNT(mb.id)::int AS "totalBets",
          COALESCE(SUM(mb.stake_amount), 0)::int AS "volume"
        FROM agent_configs ac
        LEFT JOIN market_bets mb ON mb.agent_id = ac.id
        GROUP BY ac.id, ac.username, ac.is_active
        ORDER BY "profitLoss" DESC
      `);

      const activityRows = await db.execute(sql`
        SELECT
          COUNT(*) FILTER (WHERE c.created_at >= NOW() - INTERVAL '24 hours')::int AS comments_24h,
          COUNT(*) FILTER (WHERE c.created_at >= NOW() - INTERVAL '7 days')::int AS comments_7d,
          COUNT(*) FILTER (WHERE c.created_at >= NOW() - INTERVAL '7 days' AND c.parent_comment_id IS NOT NULL)::int AS replies_7d
        FROM comments c
        JOIN profiles p ON p.id = c.user_id
        WHERE p.is_agent = true
          AND c.deleted_at IS NULL
      `);

      const likeRows = await db.execute(sql`
        SELECT
          COUNT(*) FILTER (WHERE cv.voted_at >= NOW() - INTERVAL '24 hours')::int AS likes_24h,
          COUNT(*) FILTER (WHERE cv.voted_at >= NOW() - INTERVAL '7 days')::int AS likes_7d,
          COUNT(*) FILTER (WHERE cv.voted_at >= NOW() - INTERVAL '7 days' AND cv.vote_type = 'up')::int AS upvotes_7d,
          COUNT(*) FILTER (WHERE cv.voted_at >= NOW() - INTERVAL '7 days' AND cv.vote_type = 'down')::int AS downvotes_7d
        FROM comment_votes cv
        JOIN profiles p ON p.id = cv.user_id
        WHERE p.is_agent = true
      `);

      const ratingRows = await db.execute(sql`
        SELECT
          COUNT(*) FILTER (WHERE uv.voted_at >= NOW() - INTERVAL '24 hours')::int AS ratings_24h,
          COUNT(*) FILTER (WHERE uv.voted_at >= NOW() - INTERVAL '7 days')::int AS ratings_7d,
          COALESCE(AVG(uv.rating) FILTER (WHERE uv.voted_at >= NOW() - INTERVAL '7 days'), 0)::numeric(3,2) AS avg_rating_7d
        FROM user_votes uv
        JOIN profiles p ON p.id = uv.user_id
        WHERE p.is_agent = true
      `);

      const poolRows = await db.execute(sql`
        SELECT
          pm.market_type AS "marketType",
          COUNT(DISTINCT pm.id)::int AS "openMarkets",
          COALESCE(AVG(entry_totals.pool), 0)::int AS "avgPool",
          COALESCE(MIN(entry_totals.pool), 0)::int AS "minPool",
          COALESCE(MAX(entry_totals.pool), 0)::int AS "maxPool"
        FROM prediction_markets pm
        LEFT JOIN (
          SELECT market_id, SUM(COALESCE(total_stake, 0) + COALESCE(no_stake, 0)) AS pool
          FROM market_entries
          GROUP BY market_id
        ) entry_totals ON entry_totals.market_id = pm.id
        WHERE pm.status = 'OPEN'
          AND pm.visibility IN ('live', 'inactive')
          AND pm.market_type IN ('updown', 'h2h', 'gainer', 'jackpot', 'community')
        GROUP BY pm.market_type
        ORDER BY pm.market_type
      `);

      // Cost-safety surface: surface the World Market kill switch + cache hit
      // rate so the admin can see whether they're about to burn money. With
      // the adaptive TTL (final/near/medium/long tiers based on days-to-
      // resolution), each market has its own validity window. We compute
      // the "effective cached" count per-row in SQL so the dashboard isn't
      // misleading.
      const {
        WORLD_MARKETS_LLM_ENABLED,
        WORLD_MARKET_BOOST_ENABLED,
        WORLD_MARKET_ASSESSMENT_TTL_FINAL_MS,
        WORLD_MARKET_ASSESSMENT_TTL_NEAR_MS,
        WORLD_MARKET_ASSESSMENT_TTL_MEDIUM_MS,
        WORLD_MARKET_ASSESSMENT_TTL_LONG_MS,
      } = await import("./agents/constants");
      const ttlFinalSec = WORLD_MARKET_ASSESSMENT_TTL_FINAL_MS / 1000;
      const ttlNearSec = WORLD_MARKET_ASSESSMENT_TTL_NEAR_MS / 1000;
      const ttlMediumSec = WORLD_MARKET_ASSESSMENT_TTL_MEDIUM_MS / 1000;
      const ttlLongSec = WORLD_MARKET_ASSESSMENT_TTL_LONG_MS / 1000;

      const cachedAssessmentRow = await db.execute(sql`
        SELECT COUNT(*)::int AS cached
        FROM prediction_markets pm
        WHERE pm.market_type = 'community'
          AND pm.status = 'OPEN'
          AND pm.visibility = 'live'
          AND pm.metadata ? 'worldAssessment'
          AND (pm.metadata->'worldAssessment'->>'cachedAt')::timestamptz
              > NOW() - (
                CASE
                  WHEN EXTRACT(EPOCH FROM (pm.end_at - NOW())) / 86400 < 3
                    THEN ${ttlFinalSec}
                  WHEN EXTRACT(EPOCH FROM (pm.end_at - NOW())) / 86400 < 14
                    THEN ${ttlNearSec}
                  WHEN EXTRACT(EPOCH FROM (pm.end_at - NOW())) / 86400 < 60
                    THEN ${ttlMediumSec}
                  ELSE ${ttlLongSec}
                END || ' seconds'
              )::interval
      `);
      const cachedAssessments = Number(
        (cachedAssessmentRow.rows[0] as { cached?: number } | undefined)?.cached ?? 0,
      );

      const openWorldMarketsByTierRow = await db.execute(sql`
        SELECT
          COUNT(*)::int AS total,
          COUNT(*) FILTER (WHERE EXTRACT(EPOCH FROM (end_at - NOW())) / 86400 < 3)::int AS final_count,
          COUNT(*) FILTER (WHERE EXTRACT(EPOCH FROM (end_at - NOW())) / 86400 >= 3 AND EXTRACT(EPOCH FROM (end_at - NOW())) / 86400 < 14)::int AS near_count,
          COUNT(*) FILTER (WHERE EXTRACT(EPOCH FROM (end_at - NOW())) / 86400 >= 14 AND EXTRACT(EPOCH FROM (end_at - NOW())) / 86400 < 60)::int AS medium_count,
          COUNT(*) FILTER (WHERE EXTRACT(EPOCH FROM (end_at - NOW())) / 86400 >= 60)::int AS long_count
        FROM prediction_markets
        WHERE market_type = 'community' AND status = 'OPEN' AND visibility = 'live'
      `);
      const openWorldMarketsByTier = (openWorldMarketsByTierRow.rows[0] as
        | { total?: number; final_count?: number; near_count?: number; medium_count?: number; long_count?: number }
        | undefined) ?? {};
      const openWorldMarkets = Number(openWorldMarketsByTier.total ?? 0);

      res.json({
        agents,
        cohort: {
          total_agents: agents.length,
          active_agents: activeAgents.length,
          active_v2_agents: v2Agents.length,
          active_legacy_agents: activeAgents.length - v2Agents.length,
        },
        pending_count: pendingTotal,
        executed_count: executedCount[0]?.count ?? 0,
        failed_count: failedCount[0]?.count ?? 0,
        next_actions: pendingActions,
        pnl: pnlRows.rows,
        comments: activityRows.rows[0] ?? { comments_24h: 0, comments_7d: 0, replies_7d: 0 },
        likes: likeRows.rows[0] ?? { likes_24h: 0, likes_7d: 0, upvotes_7d: 0, downvotes_7d: 0 },
        ratings: ratingRows.rows[0] ?? { ratings_24h: 0, ratings_7d: 0, avg_rating_7d: 0 },
        pool_realism: poolRows.rows,
        cost_safety: {
          world_markets_llm_enabled: WORLD_MARKETS_LLM_ENABLED,
          world_market_boost_enabled: WORLD_MARKET_BOOST_ENABLED,
          cached_world_assessments: cachedAssessments,
          open_world_markets: openWorldMarkets,
          // Adaptive TTL: refresh window depends on days-to-resolution.
          ttl_tiers: {
            final_hours: WORLD_MARKET_ASSESSMENT_TTL_FINAL_MS / (60 * 60 * 1000),
            near_hours: WORLD_MARKET_ASSESSMENT_TTL_NEAR_MS / (60 * 60 * 1000),
            medium_hours: WORLD_MARKET_ASSESSMENT_TTL_MEDIUM_MS / (60 * 60 * 1000),
            long_hours: WORLD_MARKET_ASSESSMENT_TTL_LONG_MS / (60 * 60 * 1000),
          },
          markets_by_tier: {
            final: Number(openWorldMarketsByTier.final_count ?? 0),
            near: Number(openWorldMarketsByTier.near_count ?? 0),
            medium: Number(openWorldMarketsByTier.medium_count ?? 0),
            long: Number(openWorldMarketsByTier.long_count ?? 0),
          },
        },
      });
    } catch (err: any) {
      console.error("[AgentAdmin] Status failed:", err);
      res.status(500).json({ error: err?.message ?? "Unknown error" });
    }
  });

  app.get("/api/admin/agents/dry-run", requireAuth, requireAdmin, async (req: AuthRequest, res) => {
    try {
      const { agentConfigs } = await import("@shared/schema");
      const { getSimulationProfile } = await import("./agents/simulationProfile");
      const limitAgents = Math.max(1, Math.min(Number(req.query.agents ?? 12), 50));
      const limitMarkets = Math.max(1, Math.min(Number(req.query.markets ?? 12), 50));
      const now = new Date();

      const [agents, markets] = await Promise.all([
        db
          .select({
            id: agentConfigs.id,
            username: agentConfigs.username,
            displayName: agentConfigs.displayName,
            archetype: agentConfigs.archetype,
            activityRate: agentConfigs.activityRate,
            simulationProfile: agentConfigs.simulationProfile,
          })
          .from(agentConfigs)
          .where(eq(agentConfigs.isActive, true))
          .limit(limitAgents),
        db
          .select({
            id: predictionMarkets.id,
            title: predictionMarkets.title,
            marketType: predictionMarkets.marketType,
            category: predictionMarkets.category,
            endAt: predictionMarkets.endAt,
          })
          .from(predictionMarkets)
          .where(and(
            eq(predictionMarkets.status, "OPEN"),
            eq(predictionMarkets.visibility, "live"),
            gte(predictionMarkets.endAt, now),
          ))
          .limit(limitMarkets),
      ]);

      const previews = agents.map((agent) => {
        const profile = getSimulationProfile(agent.simulationProfile);
        const activityRate = Number(agent.activityRate ?? 0.6);
        const marketPreview = markets.slice(0, 5).map((market) => {
          const categoryMatch = market.category && profile.favoriteCategories.includes(market.category);
          const actionScore = activityRate * (categoryMatch ? 1.25 : 0.85) * (profile.personaBand === "sharp" ? 0.75 : 1);
          return {
            marketId: market.id,
            marketType: market.marketType,
            title: market.title,
            estimatedAction: actionScore > 0.55 ? "prediction_candidate" : "likely_abstain",
            categoryMatch: Boolean(categoryMatch),
          };
        });
        return {
          agentId: agent.id,
          username: agent.username,
          personaBand: profile.personaBand,
          skillTier: profile.skillTier,
          weeklyVoteCap: profile.weeklyVoteCap,
          weeklyCommentCap: profile.weeklyCommentCap,
          markets: marketPreview,
        };
      });

      res.json({
        ok: true,
        writes: false,
        sampledAgents: agents.length,
        sampledMarkets: markets.length,
        previews,
      });
    } catch (err: any) {
      console.error("[AgentAdmin] Dry run failed:", err);
      res.status(500).json({ ok: false, error: err?.message ?? "Unknown error" });
    }
  });

  // ============================================================================
  // SUGGESTIONS PIPELINE (Phase 0)
  // ============================================================================

  // User image upload for profile-image suggestions (auth required, 2 MB user limit).
  // Separate from /api/admin/upload-image which requires admin role and allows 5 MB.
  const suggestionImageUpload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 2 * 1024 * 1024 },
    fileFilter: (_req, file, cb) => {
      const allowed = ["image/png", "image/jpeg", "image/webp"];
      if (allowed.includes(file.mimetype)) {
        cb(null, true);
      } else {
        cb(new Error("Only PNG, JPG, and WEBP files are allowed"));
      }
    },
  });

  app.post(
    "/api/suggestions/upload-image",
    requireAuth,
    suggestionImageUpload.single("file"),
    async (req: AuthRequest, res) => {
      try {
        const file = req.file;
        if (!file) {
          return res.status(400).json({ error: "No file uploaded" });
        }

        const userId = req.userId!;
        const optimized = await optimizeImage(file.buffer);
        const timestamp = Date.now();
        const filePath = `suggestions/curate/${userId}/${timestamp}${optimized.extension}`;
        const bucketName = "public-images";

        const { data, error } = await supabaseServer.storage
          .from(bucketName)
          .upload(filePath, optimized.buffer, {
            contentType: optimized.contentType,
            upsert: false,
          });

        if (error) {
          console.error("Suggestion image upload error:", error);
          return res.status(500).json({ error: `Failed to upload image: ${error.message}` });
        }

        const { data: urlData } = supabaseServer.storage
          .from(bucketName)
          .getPublicUrl(filePath);

        res.json({ url: urlData.publicUrl, path: filePath });
      } catch (error: any) {
        console.error("Suggestion image upload error:", error);
        if (error.message?.includes("Only PNG")) {
          return res.status(400).json({ error: error.message });
        }
        res.status(500).json({ error: "Upload failed" });
      }
    }
  );

  // GET /api/suggestions/mine — return the authenticated user's own suggestions.
  app.get("/api/suggestions/mine", requireAuth, async (req: AuthRequest, res) => {
    try {
      const userId = req.userId!;
      const rows = await db
        .select()
        .from(suggestions)
        .where(eq(suggestions.submittedBy, userId))
        .orderBy(desc(suggestions.createdAt));

      const shaped = rows.map((row) => ({
        id: row.id,
        type: row.type,
        status: row.status,
        category: (row.payload as Record<string, unknown>)?.category as string | null ?? null,
        createdAt: row.createdAt.toISOString(),
        approvedAsId: row.approvedAsId,
        approvedAsType: row.approvedAsType,
        adminNotes: row.adminNotes,
      }));

      res.json(shaped);
    } catch (error: any) {
      console.error("Error fetching user suggestions:", error.message);
      res.status(500).json({ error: "Failed to fetch suggestions" });
    }
  });

  // GET /api/admin/suggestions — list suggestions for the review queue.
  app.get("/api/admin/suggestions", requireAuth, requireAdmin, async (req: AuthRequest, res) => {
    try {
      const statusParam = typeof req.query.status === "string" ? req.query.status : "pending";
      const typeParam = typeof req.query.type === "string" ? req.query.type : undefined;
      const limitRaw = parseInt(String(req.query.limit ?? "50"), 10);
      const offsetRaw = parseInt(String(req.query.offset ?? "0"), 10);
      const limit = Math.min(Math.max(Number.isFinite(limitRaw) ? limitRaw : 50, 1), 100);
      const offset = Math.max(Number.isFinite(offsetRaw) ? offsetRaw : 0, 0);

      const conditions: SQL[] = [];
      if (statusParam !== "all") {
        conditions.push(eq(suggestions.status, statusParam));
      }
      if (typeParam && SUGGESTION_TYPES.includes(typeParam as any)) {
        conditions.push(eq(suggestions.type, typeParam));
      }
      const whereExpr = conditions.length > 0 ? and(...conditions) : undefined;

      const [totalRow] = await db
        .select({ count: sql<number>`COUNT(*)::int` })
        .from(suggestions)
        .where(whereExpr);
      const totalCount = Number(totalRow?.count ?? 0);

      const rows = await db
        .select({
          id: suggestions.id,
          type: suggestions.type,
          payload: suggestions.payload,
          submittedBy: suggestions.submittedBy,
          status: suggestions.status,
          adminNotes: suggestions.adminNotes,
          approvedAsId: suggestions.approvedAsId,
          approvedAsType: suggestions.approvedAsType,
          reviewedBy: suggestions.reviewedBy,
          reviewedAt: suggestions.reviewedAt,
          createdAt: suggestions.createdAt,
          updatedAt: suggestions.updatedAt,
          submitterUsername: profiles.username,
          submitterAvatar: profiles.avatarUrl,
        })
        .from(suggestions)
        .leftJoin(profiles, eq(suggestions.submittedBy, profiles.id))
        .where(whereExpr)
        .orderBy(desc(suggestions.createdAt))
        .limit(limit)
        .offset(offset);

      res.json({ data: rows, totalCount });
    } catch (error: any) {
      console.error("Error listing admin suggestions:", error);
      res.status(500).json({ error: "Failed to fetch suggestions" });
    }
  });

  // POST /api/admin/suggestions/:id/approve — dispatcher: translate suggestion
  // payload to the appropriate admin-create shape, insert, and mark approved.
  app.post("/api/admin/suggestions/:id/approve", requireAuth, requireAdmin, async (req: AuthRequest, res) => {
    try {
      const adminId = req.userId!;
      const { id } = req.params;
      const adminOverrides = (req.body?.adminOverrides ?? undefined) as Record<string, unknown> | undefined;

      const [suggestion] = await db
        .select()
        .from(suggestions)
        .where(eq(suggestions.id, id))
        .limit(1);

      if (!suggestion) {
        return res.status(404).json({ error: "Suggestion not found" });
      }
      if (suggestion.status !== "pending") {
        return res.status(400).json({ error: `Suggestion is already ${suggestion.status}` });
      }
      if (suggestion.type === "profile_image") {
        return res.status(400).json({
          error: "Profile image approval is not yet supported. Please process manually via the admin curate UI.",
        });
      }

      const { approvedAsId, approvedAsType } = await dispatchApproval(suggestion, adminId, adminOverrides);
      await markSuggestionApproved(suggestion.id, approvedAsId, approvedAsType, adminId);

      // Integrity guard: prevent admins from approving their own suggestions for XP.
      // Admins may still approve their own suggestions (the approval itself is valid),
      // but XP is NOT awarded in that case — otherwise an admin could flood suggestions
      // and self-approve for unlimited XP, corrupting the public leaderboard.
      if (suggestion.submittedBy === adminId) {
        console.log(
          `[suggestion_approved] Skipping XP award: admin ${adminId} approved own suggestion ${suggestion.id}`
        );
      } else {
        // Bonus XP — non-blocking; failure does not fail the approval.
        try {
          await gamificationService.awardXp(
            suggestion.submittedBy,
            "suggestion_approved",
            `suggestion_approved_${suggestion.id}`,
            { suggestionType: suggestion.type, approvedAsId }
          );
        } catch (xpErr) {
          console.error("XP award failed for suggestion approval:", xpErr);
        }
      }

      res.json({ success: true, approvedAsId, approvedAsType });
    } catch (error: any) {
      console.error("Error approving suggestion:", error?.message ?? error);
      res.status(500).json({ error: error?.message ?? "Failed to approve suggestion" });
    }
  });

  // PATCH /api/admin/suggestions/:id/reject — mark rejected with optional reason.
  app.patch("/api/admin/suggestions/:id/reject", requireAuth, requireAdmin, async (req: AuthRequest, res) => {
    try {
      const adminId = req.userId!;
      const { id } = req.params;
      const adminNotes = typeof req.body?.adminNotes === "string" ? req.body.adminNotes : null;

      const [suggestion] = await db
        .select({ id: suggestions.id, status: suggestions.status })
        .from(suggestions)
        .where(eq(suggestions.id, id))
        .limit(1);

      if (!suggestion) {
        return res.status(404).json({ error: "Suggestion not found" });
      }
      if (suggestion.status !== "pending") {
        return res.status(400).json({ error: `Suggestion is already ${suggestion.status}` });
      }

      await markSuggestionRejected(id, adminId, adminNotes);

      res.json({ success: true });
    } catch (error: any) {
      console.error("Error rejecting suggestion:", error?.message ?? error);
      res.status(500).json({ error: "Failed to reject suggestion" });
    }
  });

  // POST /api/suggestions — persist a user content suggestion and award XP.
  // Auth: requireAuth. Rate limiting is covered by the existing layered middleware.
  //
  // Self-approval XP guard is enforced in the approve endpoint — admins cannot earn
  // XP from approving their own suggestions, though they may still approve them.
  app.post("/api/suggestions", requireAuth, async (req: AuthRequest, res) => {
    try {
      const userId = req.userId!;

      // Envelope-level validation. The per-payload validator below is already
      // strong; here we just guarantee `type` is one of the enum values and
      // `payload` is an object before we hand it off.
      const suggestionEnvelopeSchema = z.object({
        type: z.enum(SUGGESTION_TYPES as unknown as [string, ...string[]]),
        payload: z.record(z.string(), z.unknown()),
      });
      let envelope: { type: string; payload: Record<string, unknown> };
      try {
        envelope = suggestionEnvelopeSchema.parse(req.body ?? {});
      } catch (err) {
        if (err instanceof ZodError) return sendZodError(res, err);
        return sendBadRequest(res, "Invalid suggestion body");
      }
      const { type, payload } = envelope;

      const validation = validateSuggestionPayload(type, payload);
      if (!validation.success) {
        return sendError(res, 400, "VALIDATION_ERROR", "Suggestion payload failed validation", { errors: validation.errors });
      }

      const [created] = await db
        .insert(suggestions)
        .values({
          type,
          payload: validation.data,
          submittedBy: userId,
          status: "pending",
        })
        .returning({
          id: suggestions.id,
          status: suggestions.status,
          createdAt: suggestions.createdAt,
        });

      // Award XP — non-blocking, failure does not fail the request.
      // Daily cap of 3 prevents farming. Idempotency key is per-suggestion.
      let xpResult: Awaited<ReturnType<typeof gamificationService.awardXp>> | undefined;
      try {
        xpResult = await gamificationService.awardXp(
          userId,
          "submit_suggestion",
          `suggestion_${created.id}`,
          { suggestionType: type }
        );
      } catch (xpErr) {
        console.error("XP award failed for suggestion:", xpErr);
      }

      res.status(201).json({ ...created, xp: xpResult ?? null });
    } catch (error: any) {
      console.error("Error creating suggestion:", error);
      res.status(500).json({ error: "Failed to submit suggestion" });
    }
  });

  const httpServer = createServer(app);

  return httpServer;
}
