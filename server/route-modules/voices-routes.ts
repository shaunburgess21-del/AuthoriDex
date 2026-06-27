import type { Express } from "express";
import { z, ZodError } from "zod";
import { and, eq, isNull, inArray, asc } from "drizzle-orm";
import { optionalAuth, requireAuth, type AuthRequest } from "../auth-middleware";
import { db } from "../db";
import {
  comments as unifiedComments,
  commentVotes,
  communityInsights,
  insightVotes,
  profiles,
  trackedPeople,
  matchups,
  trendingPolls,
  opinionPolls,
  predictionMarkets,
} from "@shared/schema";
import {
  VOICES_TIMELINE_ID,
  VOICES_SURFACES,
  type VoicesSurface,
} from "@shared/constants";
import { gamificationService } from "../services/gamification";
import { awardInsightCredits, maybeFireReferralCredit } from "../services/credits-earn";
import { checkAndAwardInsightBadges } from "../services/badges";
import {
  rankCandidates,
  type VoicesFeedItem,
  type VoicesFeedMode,
} from "../services/voices/ranking";
import {
  resolveCommentEntities,
  resolveInsightEntities,
  entityKey,
} from "../services/voices/entities";

const VOICES_POST_MAX_LENGTH = 5000;
const DELETED_USER = "[deleted user]";

type CardParentType = "matchup" | "trending_poll" | "opinion_poll" | "open_market";

interface ReplyDTO {
  id: string;
  userId: string;
  username: string | null;
  avatarUrl: string | null;
  authorRank: string | null;
  body: string;
  parentCommentId: string | null;
  upvotes: number;
  downvotes: number;
  userVote: "up" | null;
  deletedAt: string | null;
  createdAt: string;
  parentVoteLabel: null;
}

// ── Short-TTL ranked-list cache for stable cursor pagination ──────────────────
interface CachedFeed {
  items: VoicesFeedItem[];
  expires: number;
}
const FEED_CACHE = new Map<string, CachedFeed>();
const FEED_CACHE_TTL_MS = 60_000;
const FEED_CACHE_MAX_ENTRIES = 200;

function feedSignature(opts: {
  mode: VoicesFeedMode;
  surfaces: VoicesSurface[] | null;
  personIds: string[] | null;
  categories: string[] | null;
  userId: string | null;
}): string {
  return JSON.stringify({
    m: opts.mode,
    s: opts.surfaces ? [...opts.surfaces].sort() : null,
    p: opts.personIds ? [...opts.personIds].sort() : null,
    c: opts.categories ? [...opts.categories].sort() : null,
    u: opts.userId ?? null,
  });
}

async function getRankedList(opts: {
  mode: VoicesFeedMode;
  surfaces: VoicesSurface[] | null;
  personIds: string[] | null;
  categories: string[] | null;
  userId: string | null;
}): Promise<VoicesFeedItem[]> {
  const sig = feedSignature(opts);
  const now = Date.now();
  const cached = FEED_CACHE.get(sig);
  if (cached && cached.expires > now) return cached.items;

  const items = await rankCandidates(opts);
  if (FEED_CACHE.size >= FEED_CACHE_MAX_ENTRIES) {
    // Cheap eviction: drop the oldest-expiring entries.
    const sorted = [...FEED_CACHE.entries()].sort((a, b) => a[1].expires - b[1].expires);
    for (let i = 0; i < Math.ceil(FEED_CACHE_MAX_ENTRIES / 4); i++) {
      const entry = sorted[i];
      if (entry) FEED_CACHE.delete(entry[0]);
    }
  }
  FEED_CACHE.set(sig, { items, expires: now + FEED_CACHE_TTL_MS });
  return items;
}

function encodeCursor(payload: { sig: string; off: number }): string {
  return Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
}
function decodeCursor(raw: string): { sig: string; off: number } | null {
  try {
    const parsed = JSON.parse(Buffer.from(raw, "base64url").toString("utf8"));
    if (typeof parsed?.sig === "string" && Number.isFinite(parsed?.off)) {
      return { sig: parsed.sig, off: parsed.off };
    }
  } catch {
    /* fall through */
  }
  return null;
}

function parseListParam(value: unknown): string[] | null {
  if (typeof value !== "string") return null;
  const parts = value
    .split(",")
    .map((p) => p.trim())
    .filter(Boolean);
  return parts.length > 0 ? parts : null;
}

function parseSurfaces(value: unknown): VoicesSurface[] | null {
  const parts = parseListParam(value);
  if (!parts) return null;
  const allowed = new Set<string>(VOICES_SURFACES);
  const out = parts.filter((p): p is VoicesSurface => allowed.has(p));
  return out.length > 0 ? out : null;
}

/** Annotate a page of feed items with the current user's upvote state. */
async function enrichUserVotes(items: VoicesFeedItem[], userId: string | null): Promise<void> {
  if (!userId || items.length === 0) return;
  const commentIds = items.filter((i) => i.source === "comment").map((i) => i.id);
  const insightIds = items.filter((i) => i.source === "insight").map((i) => i.id);

  const voted = new Set<string>();
  if (commentIds.length > 0) {
    const rows = await db
      .select({ commentId: commentVotes.commentId })
      .from(commentVotes)
      .where(and(eq(commentVotes.userId, userId), inArray(commentVotes.commentId, commentIds)));
    for (const r of rows) voted.add(`c:${r.commentId}`);
  }
  if (insightIds.length > 0) {
    const rows = await db
      .select({ insightId: insightVotes.insightId })
      .from(insightVotes)
      .where(
        and(
          eq(insightVotes.userId, userId),
          eq(insightVotes.voteType, "up"),
          inArray(insightVotes.insightId, insightIds),
        ),
      );
    for (const r of rows) voted.add(`i:${r.insightId}`);
  }

  for (const item of items) {
    const key = item.source === "comment" ? `c:${item.id}` : `i:${item.id}`;
    item.userVote = voted.has(key) ? "up" : null;
  }
}

async function resolveCardParentId(type: CardParentType, idOrSlug: string): Promise<string | null> {
  if (type === "matchup") {
    const [bySlug] = await db.select({ id: matchups.id }).from(matchups).where(eq(matchups.slug, idOrSlug)).limit(1);
    if (bySlug) return bySlug.id;
    const [byId] = await db.select({ id: matchups.id }).from(matchups).where(eq(matchups.id, idOrSlug)).limit(1);
    return byId?.id ?? null;
  }
  if (type === "trending_poll") {
    const [bySlug] = await db.select({ id: trendingPolls.id }).from(trendingPolls).where(eq(trendingPolls.slug, idOrSlug)).limit(1);
    if (bySlug) return bySlug.id;
    const [byId] = await db.select({ id: trendingPolls.id }).from(trendingPolls).where(eq(trendingPolls.id, idOrSlug)).limit(1);
    return byId?.id ?? null;
  }
  if (type === "opinion_poll") {
    const [bySlug] = await db.select({ id: opinionPolls.id }).from(opinionPolls).where(eq(opinionPolls.slug, idOrSlug)).limit(1);
    if (bySlug) return bySlug.id;
    const [byId] = await db.select({ id: opinionPolls.id }).from(opinionPolls).where(eq(opinionPolls.id, idOrSlug)).limit(1);
    return byId?.id ?? null;
  }
  const [market] = await db
    .select({ id: predictionMarkets.id })
    .from(predictionMarkets)
    .where(and(eq(predictionMarkets.slug, idOrSlug), eq(predictionMarkets.marketType, "community")))
    .limit(1);
  return market?.id ?? null;
}

function mapReplyRow(row: {
  id: string;
  userId: string;
  authorUsername: string | null;
  authorAvatarUrl: string | null;
  authorRank: string | null;
  body: string;
  parentCommentId: string | null;
  upvotes: number;
  downvotes: number;
  deletedAt: Date | null;
  createdAt: Date;
}, userVoted: Set<string>): ReplyDTO {
  const isDeleted = Boolean(row.deletedAt);
  return {
    id: row.id,
    userId: row.userId,
    username: isDeleted ? DELETED_USER : row.authorUsername,
    avatarUrl: isDeleted ? null : row.authorAvatarUrl,
    authorRank: isDeleted ? null : row.authorRank,
    body: isDeleted ? "" : row.body,
    parentCommentId: row.parentCommentId,
    upvotes: row.upvotes,
    downvotes: row.downvotes,
    userVote: userVoted.has(row.id) ? "up" : null,
    deletedAt: row.deletedAt ? row.deletedAt.toISOString() : null,
    createdAt: row.createdAt.toISOString(),
    parentVoteLabel: null,
  };
}

/** BFS the reply tree under a root comment (bounded depth to keep it cheap). */
async function loadThreadReplies(rootId: string, userId: string | null): Promise<ReplyDTO[]> {
  const collected: Array<Parameters<typeof mapReplyRow>[0]> = [];
  let frontier = [rootId];
  for (let depth = 0; depth < 6 && frontier.length > 0; depth++) {
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
        authorUsername: profiles.username,
        authorAvatarUrl: profiles.avatarUrl,
        authorRank: profiles.rank,
      })
      .from(unifiedComments)
      .leftJoin(profiles, eq(unifiedComments.userId, profiles.id))
      .where(inArray(unifiedComments.parentCommentId, frontier))
      .orderBy(asc(unifiedComments.createdAt));
    if (rows.length === 0) break;
    collected.push(...rows);
    frontier = rows.map((r) => r.id);
  }

  const userVoted = await loadCommentUpvotes(collected.map((r) => r.id), userId);
  return collected.map((r) => mapReplyRow(r, userVoted));
}

/** Direct replies to a community insight (stored as community_insight comments). */
async function loadInsightReplies(insightId: string, userId: string | null): Promise<ReplyDTO[]> {
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
      authorUsername: profiles.username,
      authorAvatarUrl: profiles.avatarUrl,
      authorRank: profiles.rank,
    })
    .from(unifiedComments)
    .leftJoin(profiles, eq(unifiedComments.userId, profiles.id))
    .where(and(eq(unifiedComments.parentType, "community_insight"), eq(unifiedComments.parentId, insightId)))
    .orderBy(asc(unifiedComments.createdAt));
  const userVoted = await loadCommentUpvotes(rows.map((r) => r.id), userId);
  return rows.map((r) => mapReplyRow(r, userVoted));
}

async function loadCommentUpvotes(commentIds: string[], userId: string | null): Promise<Set<string>> {
  const out = new Set<string>();
  if (!userId || commentIds.length === 0) return out;
  const rows = await db
    .select({ commentId: commentVotes.commentId })
    .from(commentVotes)
    .where(and(eq(commentVotes.userId, userId), inArray(commentVotes.commentId, commentIds)));
  for (const r of rows) out.add(r.commentId);
  return out;
}

/** Build a single feed item for a freshly created / fetched comment row. */
async function buildCommentFeedItem(
  row: {
    id: string;
    parentType: string;
    parentId: string;
    body: string;
    userId: string;
    upvotes: number;
    downvotes: number;
    createdAt: Date;
  },
  userId: string | null,
): Promise<VoicesFeedItem | null> {
  const entities = await resolveCommentEntities([{ parentType: row.parentType, parentId: row.parentId }]);
  const entity = entities.get(entityKey(row.parentType, row.parentId));
  if (!entity) return null;
  const [author] = await db
    .select({ username: profiles.username, avatarUrl: profiles.avatarUrl, rank: profiles.rank })
    .from(profiles)
    .where(eq(profiles.id, row.userId))
    .limit(1);
  const replies = await loadThreadReplies(row.id, null);
  return {
    id: row.id,
    source: "comment",
    parentType: row.parentType as VoicesFeedItem["parentType"],
    body: row.body,
    author: {
      userId: row.userId,
      username: author?.username ?? null,
      avatarUrl: author?.avatarUrl ?? null,
      rank: author?.rank ?? null,
    },
    upvotes: row.upvotes,
    downvotes: row.downvotes,
    replyCount: replies.length,
    createdAt: row.createdAt.toISOString(),
    entity,
    badges: { topTake: false, rising: false },
    score: 0,
    userVote: null,
  };
}

export function registerVoicesRoutes(app: Express): void {
  // Curated cross-site timeline feed.
  app.get("/api/voices/feed", optionalAuth, async (req: AuthRequest, res) => {
    try {
      const modeRaw = req.query.mode;
      const mode: VoicesFeedMode =
        modeRaw === "latest" || modeRaw === "top" ? modeRaw : "for-you";
      const surfaces = parseSurfaces(req.query.surfaces);
      const personIds = parseListParam(req.query.personIds);
      const categories = parseListParam(req.query.categories);
      const limitRaw = Number(req.query.limit ?? 20);
      const limit = Number.isFinite(limitRaw) ? Math.max(1, Math.min(Math.floor(limitRaw), 50)) : 20;

      const opts = { mode, surfaces, personIds, categories, userId: req.userId ?? null };
      const sig = feedSignature(opts);

      let offset = 0;
      const cursorRaw = typeof req.query.cursor === "string" ? req.query.cursor : null;
      if (cursorRaw) {
        const decoded = decodeCursor(cursorRaw);
        // Ignore a cursor whose filters no longer match (UI changed filters).
        if (decoded && decoded.sig === sig) offset = Math.max(0, decoded.off);
      }

      const ranked = await getRankedList(opts);
      const page = ranked.slice(offset, offset + limit).map((item) => ({ ...item }));
      await enrichUserVotes(page, req.userId ?? null);

      const nextOffset = offset + limit;
      const nextCursor = nextOffset < ranked.length ? encodeCursor({ sig, off: nextOffset }) : null;

      res.json({ items: page, nextCursor, total: ranked.length });
    } catch (error) {
      console.error("[voices] feed error:", error);
      res.status(500).json({ error: "Failed to load Voices feed" });
    }
  });

  // Create a post from the Voices composer. Dispatches by attachment:
  //   none    -> standalone voices_post comment
  //   person  -> community insight (mirrors onto the profile)
  //   card    -> unified comment on that card (mirrors onto the card)
  app.post("/api/voices/posts", requireAuth, async (req: AuthRequest, res) => {
    try {
      if (Object.prototype.hasOwnProperty.call(req.body ?? {}, "username")) {
        return res.status(400).json({ error: "Username is resolved from the authenticated profile" });
      }

      const schema = z.object({
        body: z.string().min(1).max(VOICES_POST_MAX_LENGTH),
        attachment: z
          .object({
            type: z.enum(["person", "matchup", "trending_poll", "opinion_poll", "open_market"]),
            idOrSlug: z.string().min(1).max(256),
          })
          .optional()
          .nullable(),
      });

      let parsed: z.infer<typeof schema>;
      try {
        parsed = schema.parse(req.body ?? {});
      } catch (err) {
        if (err instanceof ZodError) {
          return res.status(400).json({ error: "Invalid request", details: err.flatten() });
        }
        return res.status(400).json({ error: "Invalid request" });
      }

      const userId = req.userId!;
      const body = parsed.body.trim();
      const attachment = parsed.attachment ?? null;

      // ── Person attachment → community insight ───────────────────────────────
      if (attachment && attachment.type === "person") {
        const [person] = await db
          .select({ id: trackedPeople.id })
          .from(trackedPeople)
          .where(eq(trackedPeople.id, attachment.idOrSlug))
          .limit(1);
        if (!person) return res.status(404).json({ error: "Person not found" });

        const [newInsight] = await db
          .insert(communityInsights)
          .values({ personId: person.id, userId, content: body })
          .returning();

        try {
          await gamificationService.awardXp(
            userId,
            "post_insight",
            `insight_${newInsight.id}_${userId}`,
            { insightId: newInsight.id, personId: person.id },
          );
        } catch (e) {
          console.error("[voices] insight XP failed:", e);
        }
        await awardInsightCredits(userId, newInsight.id, { personId: person.id });
        await maybeFireReferralCredit(userId);
        await checkAndAwardInsightBadges(userId);

        const entities = await resolveInsightEntities([newInsight.id]);
        const entity = entities.get(newInsight.id);
        const [author] = await db
          .select({ username: profiles.username, avatarUrl: profiles.avatarUrl, rank: profiles.rank })
          .from(profiles)
          .where(eq(profiles.id, userId))
          .limit(1);

        return res.status(201).json({
          item: entity
            ? ({
                id: newInsight.id,
                source: "insight",
                parentType: "community_insight",
                body,
                author: {
                  userId,
                  username: author?.username ?? null,
                  avatarUrl: author?.avatarUrl ?? null,
                  rank: author?.rank ?? null,
                },
                upvotes: 0,
                downvotes: 0,
                replyCount: 0,
                createdAt: newInsight.createdAt.toISOString(),
                entity,
                badges: { topTake: false, rising: false },
                score: 0,
                userVote: null,
              } satisfies VoicesFeedItem)
            : null,
        });
      }

      // ── Card attachment → unified comment on that card ──────────────────────
      if (attachment && attachment.type !== "person") {
        const cardType = attachment.type;
        const resolvedParentId = await resolveCardParentId(cardType, attachment.idOrSlug);
        if (!resolvedParentId) return res.status(404).json({ error: "Card not found" });

        const [created] = await db
          .insert(unifiedComments)
          .values({ parentType: cardType, parentId: resolvedParentId, userId, body })
          .returning();

        const item = await buildCommentFeedItem(created, userId);
        return res.status(201).json({ item });
      }

      // ── Standalone timeline post ────────────────────────────────────────────
      const [created] = await db
        .insert(unifiedComments)
        .values({ parentType: "voices_post", parentId: VOICES_TIMELINE_ID, userId, body })
        .returning();

      const item = await buildCommentFeedItem(created, userId);
      return res.status(201).json({ item });
    } catch (error) {
      console.error("[voices] create post error:", error);
      res.status(500).json({ error: "Failed to create post" });
    }
  });

  // Single post + replies for the detail overlay (standalone posts & any
  // comment/insight referenced by a deep link).
  app.get("/api/voices/post/:id", optionalAuth, async (req: AuthRequest, res) => {
    try {
      const { id } = req.params;
      const userId = req.userId ?? null;

      const [comment] = await db
        .select({
          id: unifiedComments.id,
          parentType: unifiedComments.parentType,
          parentId: unifiedComments.parentId,
          body: unifiedComments.body,
          userId: unifiedComments.userId,
          upvotes: unifiedComments.upvotes,
          downvotes: unifiedComments.downvotes,
          deletedAt: unifiedComments.deletedAt,
          createdAt: unifiedComments.createdAt,
        })
        .from(unifiedComments)
        .where(eq(unifiedComments.id, id))
        .limit(1);

      if (comment) {
        const post = await buildCommentFeedItem(comment, userId);
        if (post) {
          const upvoted = await loadCommentUpvotes([comment.id], userId);
          post.userVote = upvoted.has(comment.id) ? "up" : null;
        }
        const replies = await loadThreadReplies(comment.id, userId);
        return res.json({ post, replies });
      }

      const [insight] = await db
        .select({
          id: communityInsights.id,
          personId: communityInsights.personId,
          userId: communityInsights.userId,
          content: communityInsights.content,
          sentimentVote: communityInsights.sentimentVote,
          deletedAt: communityInsights.deletedAt,
          createdAt: communityInsights.createdAt,
        })
        .from(communityInsights)
        .where(eq(communityInsights.id, id))
        .limit(1);

      if (!insight) return res.status(404).json({ error: "Post not found" });

      const entities = await resolveInsightEntities([insight.id]);
      const entity = entities.get(insight.id) ?? null;
      const [author] = await db
        .select({ username: profiles.username, avatarUrl: profiles.avatarUrl, rank: profiles.rank })
        .from(profiles)
        .where(eq(profiles.id, insight.userId))
        .limit(1);
      const replies = await loadInsightReplies(insight.id, userId);

      return res.json({
        post: entity
          ? ({
              id: insight.id,
              source: "insight",
              parentType: "community_insight",
              body: insight.content,
              author: {
                userId: insight.userId,
                username: author?.username ?? null,
                avatarUrl: author?.avatarUrl ?? null,
                rank: author?.rank ?? null,
              },
              upvotes: 0,
              downvotes: 0,
              replyCount: replies.length,
              createdAt: insight.createdAt.toISOString(),
              entity,
              badges: { topTake: false, rising: false },
              score: 0,
              userVote: null,
            } satisfies VoicesFeedItem)
          : null,
        replies,
      });
    } catch (error) {
      console.error("[voices] post detail error:", error);
      res.status(500).json({ error: "Failed to load post" });
    }
  });
}
