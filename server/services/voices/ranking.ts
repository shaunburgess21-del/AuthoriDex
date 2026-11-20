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
import type { ParentVoteLabel } from "../commentVoteLabels";
import { presentPublicAuthor } from "../account-deletion-utils";
import { rankVoiceOrder, voiceVisibleToViewer } from "./rank-order";

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
  /** Raw comments.parent_id — card/poll/market/person id ("" for timeline). */
  parentId: string;
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
  /**
   * True when moderation held this post (`hidden`) and the viewer is the
   * author. Everyone else never receives the row. There is no separate
   * new-account queue.
   */
  pendingReview?: boolean;
  userVote?: "up" | null;
  /** Author's own vote on the parent card (null for timeline posts). */
  parentVoteLabel?: ParentVoteLabel;
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

interface Candidate {
  id: string;
  source: VoicesFeedSource;
  parentType: VoicesFeedItem["parentType"];
  parentId: string;
  entityRefKey: string;
  body: string;
  author: VoicesFeedItem["author"];
  upvotes: number;
  downvotes: number;
  replyCount: number;
  createdAt: Date;
  entity: VoicesEntity;
  pendingReview: boolean;
}

async function loadCommentCandidates(viewerId: string | null): Promise<Candidate[]> {
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
      moderationStatus: unifiedComments.moderationStatus,
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
    const visibility = voiceVisibleToViewer(r.moderationStatus, r.userId, viewerId);
    if (!visibility.include) continue;
    const key = entityKey(r.parentType, r.parentId);
    const entity = entities.get(key);
    if (!entity) continue; // parent deleted / unresolvable — skip silently
    // Source derivation after the community_insights → comments merge:
    // top-level profile posts (parentType='community_insight', parentCommentId
    // =null) keep source="insight" for backwards compat with the Voices feed
    // client (icon styling, filter tabs). Everything else is source="comment".
    const isTopLevelProfilePost = r.parentType === "community_insight";
    const author = presentPublicAuthor({
      username: r.authorUsername,
      avatarUrl: r.authorAvatarUrl,
      rank: r.authorRank,
    });
    candidates.push({
      id: r.id,
      source: isTopLevelProfilePost ? "insight" : "comment",
      parentType: r.parentType as VoicesFeedItem["parentType"],
      parentId: r.parentId,
      entityRefKey: `${entity.refType}:${entity.refId}`,
      body: r.body,
      author: {
        userId: r.userId,
        username: author.username,
        avatarUrl: author.avatarUrl,
        rank: author.rank,
      },
      upvotes: r.upvotes,
      downvotes: r.downvotes,
      replyCount: replyCounts.get(r.id) ?? 0,
      createdAt: r.createdAt,
      entity,
      pendingReview: visibility.pendingReview,
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
    parentId: c.parentId,
    body: c.body,
    author: c.author,
    upvotes: c.upvotes,
    downvotes: c.downvotes,
    replyCount: c.replyCount,
    createdAt: c.createdAt.toISOString(),
    entity: c.entity,
    badges: { topTake, rising },
    score,
    ...(c.pendingReview ? { pendingReview: true } : {}),
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
    loadCommentCandidates(opts.userId),
    loadPersonalization(opts.userId),
  ]);

  const now = Date.now();
  const candidates = commentCandidates.filter((c) => passesFilters(c, opts));
  const order = rankVoiceOrder(
    candidates.map((c) => ({
      id: c.id,
      entityRefKey: c.entityRefKey,
      upvotes: c.upvotes,
      downvotes: c.downvotes,
      replyCount: c.replyCount,
      createdAtMs: c.createdAt.getTime(),
      authorUserId: c.author.userId,
      category: c.entity.category,
      personIds: c.entity.personIds,
    })),
    {
      mode: opts.mode,
      now,
      userId: opts.userId,
      personalization,
    },
  );

  const byId = new Map(candidates.map((c) => [c.id, c]));
  const out: VoicesFeedItem[] = [];
  for (const ranked of order) {
    const candidate = byId.get(ranked.id);
    if (!candidate) continue;
    out.push(toFeedItem(candidate, ranked.score, ranked.topTake, ranked.rising));
  }
  return out;
}
