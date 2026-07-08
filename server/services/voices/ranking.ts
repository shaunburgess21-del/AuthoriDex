import { and, eq, isNull, isNotNull, inArray, gte, desc, count } from "drizzle-orm";
import { db } from "../../db";
import {
  comments as unifiedComments,
  profiles,
  userFavourites,
} from "@shared/schema";
import { normalizeMarketCategory, type VoicesSurface } from "@shared/constants";
import {
  resolveCommentEntities,
  entityKey,
  type VoicesEntity,
} from "./entities";

export type VoicesFeedMode = "for-you" | "latest" | "top";
export type VoicesFeedSource = "comment" | "insight";

export interface VoicesFeedItem {
  id: string;
  source: VoicesFeedSource;
  parentType:
    | "matchup"
    | "trending_poll"
    | "opinion_poll"
    | "open_market"
    | "community_insight"
    | "voices_post";
  body: string;
  author: {
    userId: string;
    username: string | null;
    avatarUrl: string | null;
    rank: string | null;
  };
  upvotes: number;
  downvotes: number;
  replyCount: number;
  createdAt: string;
  entity: VoicesEntity;
  badges: { topTake: boolean; rising: boolean };
  score: number;
  userVote?: "up" | null;
}

export interface RankOptions {
  mode: VoicesFeedMode;
  /** null = every surface */
  surfaces: VoicesSurface[] | null;
  /** null = no celebrity filter; otherwise any-match */
  personIds: string[] | null;
  /** null = no category filter; otherwise any-match (normalized) */
  categories: string[] | null;
  /** Personalizes the for-you score; null when logged out. */
  userId: string | null;
}

// ── Tunables ────────────────────────────────────────────────────────────────
/** How far back compute-on-read scans for candidates. */
const RECENCY_DAYS = 45;
/** Hard cap on candidates gathered per source before ranking. */
const MAX_CANDIDATES = 600;
/** Each reply is worth this many net upvotes when scoring engagement. */
const REPLY_WEIGHT = 1.5;
/** Hacker-News style time-decay exponent. */
const GRAVITY = 1.45;
/** Max items surfaced per parent entity in for-you / top (diversity cap). */
const MAX_PER_ENTITY = 3;
/** Rising = young + already gathering engagement. */
const RISING_MAX_AGE_HOURS = 36;
const RISING_MIN_ENGAGEMENT = 4;
// Personalization boosts (multiplicative on the hot score).
const INTEREST_BOOST = 0.5;
const FAVORITE_BOOST = 0.75;

interface Candidate {
  id: string;
  source: VoicesFeedSource;
  parentType: VoicesFeedItem["parentType"];
  entityRefKey: string;
  body: string;
  author: VoicesFeedItem["author"];
  upvotes: number;
  downvotes: number;
  replyCount: number;
  createdAt: Date;
  entity: VoicesEntity;
}

function ageHoursOf(createdAt: Date, now: number): number {
  return Math.max(0, (now - createdAt.getTime()) / 3_600_000);
}

function engagementOf(c: Candidate): number {
  const net = c.upvotes - c.downvotes;
  return net + c.replyCount * REPLY_WEIGHT;
}

function hotScore(c: Candidate, now: number): number {
  return (engagementOf(c) + 1) / Math.pow(ageHoursOf(c.createdAt, now) + 2, GRAVITY);
}

async function loadCommentCandidates(): Promise<Candidate[]> {
  const since = new Date(Date.now() - RECENCY_DAYS * 86_400_000);

  const rows = await db
    .select({
      id: unifiedComments.id,
      parentType: unifiedComments.parentType,
      parentId: unifiedComments.parentId,
      body: unifiedComments.body,
      userId: unifiedComments.userId,
      upvotes: unifiedComments.upvotes,
      downvotes: unifiedComments.downvotes,
      createdAt: unifiedComments.createdAt,
      authorUsername: profiles.username,
      authorAvatarUrl: profiles.avatarUrl,
      authorRank: profiles.rank,
    })
    .from(unifiedComments)
    .leftJoin(profiles, eq(unifiedComments.userId, profiles.id))
    .where(
      and(
        isNull(unifiedComments.parentCommentId),
        isNull(unifiedComments.deletedAt),
        gte(unifiedComments.createdAt, since),
      ),
    )
    .orderBy(desc(unifiedComments.createdAt))
    .limit(MAX_CANDIDATES);

  if (rows.length === 0) return [];

  const replyCounts = await loadReplyCounts(rows.map((r) => r.id));
  const entities = await resolveCommentEntities(
    rows.map((r) => ({ parentType: r.parentType, parentId: r.parentId })),
  );

  const candidates: Candidate[] = [];
  for (const r of rows) {
    const key = entityKey(r.parentType, r.parentId);
    const entity = entities.get(key);
    if (!entity) continue; // parent deleted / unresolvable — skip silently
    // Source derivation after the community_insights → comments merge:
    // top-level profile posts (parentType='community_insight', parentCommentId
    // =null) keep source="insight" for backwards compat with the Voices feed
    // client (icon styling, filter tabs). Everything else is source="comment".
    const isTopLevelProfilePost = r.parentType === "community_insight";
    candidates.push({
      id: r.id,
      source: isTopLevelProfilePost ? "insight" : "comment",
      parentType: r.parentType as VoicesFeedItem["parentType"],
      entityRefKey: `${entity.refType}:${entity.refId}`,
      body: r.body,
      author: {
        userId: r.userId,
        username: r.authorUsername,
        avatarUrl: r.authorAvatarUrl,
        rank: r.authorRank,
      },
      upvotes: r.upvotes,
      downvotes: r.downvotes,
      replyCount: replyCounts.get(r.id) ?? 0,
      createdAt: r.createdAt,
      entity,
    });
  }
  return candidates;
}

// ── loadInsightCandidates + loadInsightReplyCounts REMOVED ──────────────
// After the community_insights → comments merge, top-level profile posts are
// comments rows (parentType='community_insight', parentCommentId=null) and
// are picked up by loadCommentCandidates above. Reply counts for them flow
// through loadReplyCounts (replies have parent_comment_id = <topLevelCommentId>).
// The old separate insight-candidate loader + insight-reply-count loader
// were deleted along with the community_insights/insight_votes dependencies.

/** Direct-reply counts for a set of top-level comment ids. */
async function loadReplyCounts(commentIds: string[]): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  if (commentIds.length === 0) return out;
  const rows = await db
    .select({ parentCommentId: unifiedComments.parentCommentId, n: count() })
    .from(unifiedComments)
    .where(
      and(
        isNotNull(unifiedComments.parentCommentId),
        isNull(unifiedComments.deletedAt),
        inArray(unifiedComments.parentCommentId, commentIds),
      ),
    )
    .groupBy(unifiedComments.parentCommentId);
  for (const r of rows) {
    if (r.parentCommentId) out.set(r.parentCommentId, Number(r.n));
  }
  return out;
}

interface Personalization {
  interests: Set<string>;
  favorites: Set<string>;
}

async function loadPersonalization(userId: string | null): Promise<Personalization> {
  const empty: Personalization = { interests: new Set(), favorites: new Set() };
  if (!userId) return empty;
  try {
    const [prof] = await db
      .select({ statedInterests: profiles.statedInterests })
      .from(profiles)
      .where(eq(profiles.id, userId))
      .limit(1);
    const favRows = await db
      .select({ personId: userFavourites.personId })
      .from(userFavourites)
      .where(eq(userFavourites.userId, userId));
    return {
      interests: new Set((prof?.statedInterests ?? []).map((c) => normalizeMarketCategory(c))),
      favorites: new Set(favRows.map((r) => r.personId)),
    };
  } catch {
    return empty;
  }
}

function personalBoost(entity: VoicesEntity, p: Personalization): number {
  let boost = 0;
  if (entity.category && p.interests.has(normalizeMarketCategory(entity.category))) {
    boost += INTEREST_BOOST;
  }
  if (entity.personIds.some((id) => p.favorites.has(id))) {
    boost += FAVORITE_BOOST;
  }
  return boost;
}

function passesFilters(c: Candidate, opts: RankOptions): boolean {
  if (opts.surfaces && !opts.surfaces.includes(c.entity.surface)) return false;
  if (opts.personIds && opts.personIds.length > 0) {
    if (!c.entity.personIds.some((id) => opts.personIds!.includes(id))) return false;
  }
  if (opts.categories && opts.categories.length > 0) {
    const norm = c.entity.category ? normalizeMarketCategory(c.entity.category) : null;
    if (!norm || !opts.categories.some((cat) => normalizeMarketCategory(cat) === norm)) {
      return false;
    }
  }
  return true;
}

function toFeedItem(c: Candidate, score: number, topTake: boolean, rising: boolean): VoicesFeedItem {
  return {
    id: c.id,
    source: c.source,
    parentType: c.parentType,
    body: c.body,
    author: c.author,
    upvotes: c.upvotes,
    downvotes: c.downvotes,
    replyCount: c.replyCount,
    createdAt: c.createdAt.toISOString(),
    entity: c.entity,
    badges: { topTake, rising },
    score,
  };
}

/**
 * The single boundary the rest of the app depends on. Today it scans live
 * tables; a future phase can swap the candidate source for a precomputed
 * `voices_feed` table without changing the route layer or the client.
 *
 * Returns the full ranked + filtered list; the route layer paginates it.
 */
export async function rankCandidates(opts: RankOptions): Promise<VoicesFeedItem[]> {
  const [commentCandidates, personalization] = await Promise.all([
    loadCommentCandidates(),
    loadPersonalization(opts.userId),
  ]);

  const now = Date.now();
  const candidates = commentCandidates.filter((c) =>
    passesFilters(c, opts),
  );

  // Score per mode.
  const scored = candidates.map((c) => {
    let score: number;
    if (opts.mode === "latest") {
      score = c.createdAt.getTime();
    } else if (opts.mode === "top") {
      score = engagementOf(c);
    } else {
      score = hotScore(c, now) * (1 + personalBoost(c.entity, personalization));
    }
    const age = ageHoursOf(c.createdAt, now);
    const rising = age <= RISING_MAX_AGE_HOURS && engagementOf(c) >= RISING_MIN_ENGAGEMENT;
    return { c, score, rising };
  });

  scored.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return b.c.createdAt.getTime() - a.c.createdAt.getTime();
  });

  // Top Take = best-ranked item per parent entity. Diversity cap applies in
  // ranked modes so one busy card can't dominate the feed.
  const seenTopTake = new Set<string>();
  const perEntityCount = new Map<string, number>();
  const applyCap = opts.mode !== "latest";

  const out: VoicesFeedItem[] = [];
  for (const s of scored) {
    const key = s.c.entityRefKey;
    const isTopTake = key !== "timeline:global" && !seenTopTake.has(key);
    if (isTopTake) seenTopTake.add(key);

    if (applyCap) {
      const cnt = perEntityCount.get(key) ?? 0;
      if (cnt >= MAX_PER_ENTITY) continue;
      perEntityCount.set(key, cnt + 1);
    }

    out.push(toFeedItem(s.c, s.score, isTopTake, s.rising));
  }

  return out;
}
