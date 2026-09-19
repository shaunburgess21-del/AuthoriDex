import type { Express } from "express";
import { z, ZodError } from "zod";
import { and, eq, isNull, inArray, asc } from "drizzle-orm";
import { optionalAuth, requireAuth, type AuthRequest } from "../auth-middleware";
import { db } from "../db";
import {
  comments as unifiedComments,
  commentVotes,
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
import { canonicalVoteSlug } from "@shared/vote-slug-redirects";
import { voteSlugIn } from "../lib/vote-slug";
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
  entityKey,
} from "../services/voices/entities";
import { sanitizeMentions, notifyMentionedUsers } from "../services/mentions";
import { mentionsToPlainText } from "@shared/lib/mentions";
import { applyTextModeration } from "../services/moderation";
import {
  getVoteLabelsForItems,
  type CommentParentType,
} from "../services/commentVoteLabels";

const VOICES_POST_MAX_LENGTH = 5000;
const DELETED_USER = "[deleted user]";

async function moderateNewComment(opts: {
  commentId: string;
  userId: string;
  body: string;
  parentType: string;
  parentId: string;
}): Promise<"visible" | "hidden"> {
  try {
    const applied = await applyTextModeration({
      contentType: "comment",
      contentId: opts.commentId,
      authorId: opts.userId,
      text: opts.body,
      metadata: { parentType: opts.parentType, parentId: opts.parentId, source: "voices" },
    });
    return applied.hidden ? "hidden" : "visible";
  } catch (modErr: unknown) {
    console.warn(
      "[moderation] voices comment scan failed (fail-open):",
      modErr instanceof Error ? modErr.message : modErr,
    );
    return "visible";
  }
}

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

/** Annotate a page of feed items with the current user's upvote state.
 *  After the community_insights → comments merge, all feed items (including
 *  top-level profile posts with source="insight") are comments rows, so all
 *  upvote state lives in comment_votes. */
async function enrichUserVotes(items: VoicesFeedItem[], userId: string | null): Promise<void> {
  if (!userId || items.length === 0) return;
  const commentIds = items.map((i) => i.id);

  const voted = new Set<string>();
  if (commentIds.length > 0) {
    const rows = await db
      .select({ commentId: commentVotes.commentId })
      .from(commentVotes)
      .where(and(eq(commentVotes.userId, userId), inArray(commentVotes.commentId, commentIds)));
    for (const r of rows) voted.add(r.commentId);
  }

  for (const item of items) {
    item.userVote = voted.has(item.id) ? "up" : null;
  }
}

/** Annotate a page of feed items with each author's own vote on the parent
 *  card (the "voted" pill). Runs post-cache so a fresh page always reflects
 *  the author's current vote. Timeline posts resolve to null. */
async function enrichParentVoteLabels(items: VoicesFeedItem[]): Promise<void> {
  if (items.length === 0) return;
  const labels = await getVoteLabelsForItems(
    items.map((item) => ({
      id: item.id,
      userId: item.author.userId,
      parentType: item.parentType as CommentParentType,
      parentId: item.parentId,
    })),
  );
  for (const item of items) {
    item.parentVoteLabel = labels.get(item.id) ?? null;
  }
}

async function resolveCardParentId(type: CardParentType, idOrSlug: string): Promise<string | null> {
  if (type === "matchup") {
    const [bySlug] = await db.select({ id: matchups.id }).from(matchups).where(voteSlugIn(matchups.slug, idOrSlug)).limit(1);
    if (bySlug) return bySlug.id;
    const [byId] = await db.select({ id: matchups.id }).from(matchups).where(eq(matchups.id, idOrSlug)).limit(1);
    return byId?.id ?? null;
  }
  if (type === "trending_poll") {
    const [bySlug] = await db.select({ id: trendingPolls.id }).from(trendingPolls).where(voteSlugIn(trendingPolls.slug, idOrSlug)).limit(1);
    if (bySlug) return bySlug.id;
    const [byId] = await db.select({ id: trendingPolls.id }).from(trendingPolls).where(eq(trendingPolls.id, idOrSlug)).limit(1);
    return byId?.id ?? null;
  }
  if (type === "opinion_poll") {
    const [bySlug] = await db.select({ id: opinionPolls.id }).from(opinionPolls).where(voteSlugIn(opinionPolls.slug, idOrSlug)).limit(1);
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

async function resolveCardHref(type: CardParentType, idOrSlug: string): Promise<string> {
  if (type === "matchup") {
    const [row] = await db.select({ slug: matchups.slug }).from(matchups).where(voteSlugIn(matchups.slug, idOrSlug)).limit(1);
    if (row?.slug) return `/vote/matchups/${canonicalVoteSlug(row.slug)}`;
    const [byId] = await db.select({ slug: matchups.slug }).from(matchups).where(eq(matchups.id, idOrSlug)).limit(1);
    return byId?.slug ? `/vote/matchups/${byId.slug}` : "/vote";
  }
  if (type === "trending_poll") {
    const [row] = await db.select({ slug: trendingPolls.slug }).from(trendingPolls).where(voteSlugIn(trendingPolls.slug, idOrSlug)).limit(1);
    if (row?.slug) return `/polls/${canonicalVoteSlug(row.slug)}`;
    const [byId] = await db.select({ slug: trendingPolls.slug }).from(trendingPolls).where(eq(trendingPolls.id, idOrSlug)).limit(1);
    return byId?.slug ? `/polls/${byId.slug}` : "/vote";
  }
  if (type === "opinion_poll") {
    const [row] = await db.select({ slug: opinionPolls.slug }).from(opinionPolls).where(voteSlugIn(opinionPolls.slug, idOrSlug)).limit(1);
    if (row?.slug) return `/vote/opinion-polls/${canonicalVoteSlug(row.slug)}`;
    const [byId] = await db.select({ slug: opinionPolls.slug }).from(opinionPolls).where(eq(opinionPolls.id, idOrSlug)).limit(1);
    return byId?.slug ? `/vote/opinion-polls/${byId.slug}` : "/vote";
  }
  const [market] = await db
    .select({ slug: predictionMarkets.slug })
    .from(predictionMarkets)
    .where(and(eq(predictionMarkets.slug, idOrSlug), eq(predictionMarkets.marketType, "community")))
    .limit(1);
  return market?.slug ? `/markets/${market.slug}` : "/predict";
}

async function fanoutVoicePostMentions(input: {
  userMentions: Awaited<ReturnType<typeof sanitizeMentions>>["userMentions"];
  authorId: string;
  authorUsername: string | null;
  contentId: string;
  entityType: "comment" | "community_insight";
  href: string;
  storedBody: string;
}): Promise<void> {
  if (input.userMentions.length === 0) return;
  try {
    await notifyMentionedUsers({
      userMentions: input.userMentions,
      authorId: input.authorId,
      authorUsername: input.authorUsername,
      contentId: input.contentId,
      entityType: input.entityType,
      href: input.href,
      snippet: mentionsToPlainText(input.storedBody).trim().slice(0, 140),
    });
  } catch (err) {
    console.error("[mentions] voices post fanout failed:", err);
  }
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
  moderationStatus?: "visible" | "hidden" | null;
  createdAt: Date;
}, userVoted: Set<string>): ReplyDTO {
  const isDeleted = Boolean(row.deletedAt) || row.moderationStatus === "hidden";
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
        moderationStatus: unifiedComments.moderationStatus,
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

/** Build a single feed item for a freshly created / fetched comment row.
 *  Source derivation after the community_insights → comments merge:
 *  top-level profile posts (parentType='community_insight', parentCommentId=null)
 *  keep source="insight" for backwards compat with the Voices feed client. */
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
    parentCommentId?: string | null;
    deletedAt?: Date | null;
    moderationStatus?: "visible" | "hidden" | null;
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
  const isTopLevelProfilePost =
    row.parentType === "community_insight" && (row.parentCommentId ?? null) === null;
  const isHidden =
    Boolean(row.deletedAt) || row.moderationStatus === "hidden";
  const labels = isHidden
    ? null
    : await getVoteLabelsForItems([{
        id: row.id,
        userId: row.userId,
        parentType: row.parentType as CommentParentType,
        parentId: row.parentId,
      }]);
  return {
    id: row.id,
    source: isTopLevelProfilePost ? "insight" : "comment",
    parentType: row.parentType as VoicesFeedItem["parentType"],
    parentId: row.parentId,
    body: isHidden ? "" : row.body,
    author: {
      userId: row.userId,
      username: isHidden ? DELETED_USER : (author?.username ?? null),
      avatarUrl: isHidden ? null : (author?.avatarUrl ?? null),
      rank: isHidden ? null : (author?.rank ?? null),
    },
    upvotes: row.upvotes,
    downvotes: row.downvotes,
    replyCount: replies.length,
    createdAt: row.createdAt.toISOString(),
    entity,
    badges: { topTake: false, rising: false },
    score: 0,
    userVote: null,
    parentVoteLabel: labels?.get(row.id) ?? null,
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
      await enrichParentVoteLabels(page);

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
      const mentionResult = await sanitizeMentions(parsed.body.trim());
      if (mentionResult.error) {
        return res.status(400).json({ error: mentionResult.error });
      }
      const body = mentionResult.body;
      const attachment = parsed.attachment ?? null;

      // ── Person attachment → top-level profile post (community_insight comment)
      // After the community_insights → comments merge, profile posts are stored
      // as comments rows with parentType='community_insight', parentId=personId,
      // parent_comment_id=null. XP / credits / badges / referral fanout stay
      // identical to the pre-merge insight path (txn types are immutable history).
      if (attachment && attachment.type === "person") {
        const [person] = await db
          .select({ id: trackedPeople.id })
          .from(trackedPeople)
          .where(eq(trackedPeople.id, attachment.idOrSlug))
          .limit(1);
        if (!person) return res.status(404).json({ error: "Person not found" });

        const [newComment] = await db
          .insert(unifiedComments)
          .values({ parentType: "community_insight", parentId: person.id, parentCommentId: null, userId, body })
          .returning();

        const modStatus = await moderateNewComment({
          commentId: newComment.id,
          userId,
          body,
          parentType: "community_insight",
          parentId: person.id,
        });
        const publicBody = modStatus === "hidden" ? "" : body;

        if (modStatus === "visible") {
          try {
            await gamificationService.awardXp(
              userId,
              "post_insight",
              `insight_${newComment.id}_${userId}`,
              { insightId: newComment.id, personId: person.id },
            );
          } catch (e) {
            console.error("[voices] insight XP failed:", e);
          }
          await awardInsightCredits(userId, newComment.id, { personId: person.id });
          await maybeFireReferralCredit(userId);
          await checkAndAwardInsightBadges(userId);
        }

        const entities = await resolveCommentEntities([
          { parentType: "community_insight", parentId: person.id },
        ]);
        const entity = entities.get(entityKey("community_insight", person.id));
        const [author] = await db
          .select({ username: profiles.username, avatarUrl: profiles.avatarUrl, rank: profiles.rank })
          .from(profiles)
          .where(eq(profiles.id, userId))
          .limit(1);

        if (modStatus === "visible") {
          await fanoutVoicePostMentions({
            userMentions: mentionResult.userMentions,
            authorId: userId,
            authorUsername: author?.username ?? null,
            contentId: newComment.id,
            entityType: "community_insight",
            href: `/person/${person.id}#insight-${newComment.id}`,
            storedBody: body,
          });
        }

        const labelMap =
          modStatus === "hidden"
            ? null
            : await getVoteLabelsForItems([{
                id: newComment.id,
                userId,
                parentType: "community_insight",
                parentId: person.id,
              }]);

        return res.status(201).json({
          item: entity
            ? ({
                id: newComment.id,
                source: "insight",
                parentType: "community_insight",
                parentId: person.id,
                body: publicBody,
                author: {
                  userId,
                  username: modStatus === "hidden" ? DELETED_USER : (author?.username ?? null),
                  avatarUrl: modStatus === "hidden" ? null : (author?.avatarUrl ?? null),
                  rank: modStatus === "hidden" ? null : (author?.rank ?? null),
                },
                upvotes: 0,
                downvotes: 0,
                replyCount: 0,
                createdAt: newComment.createdAt.toISOString(),
                entity,
                badges: { topTake: false, rising: false },
                score: 0,
                userVote: null,
                parentVoteLabel: labelMap?.get(newComment.id) ?? null,
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

        const modStatus = await moderateNewComment({
          commentId: created.id,
          userId,
          body,
          parentType: cardType,
          parentId: resolvedParentId,
        });

        const [author] = await db
          .select({ username: profiles.username })
          .from(profiles)
          .where(eq(profiles.id, userId))
          .limit(1);
        const cardHref = await resolveCardHref(cardType, attachment.idOrSlug);
        if (modStatus === "visible") {
          await fanoutVoicePostMentions({
            userMentions: mentionResult.userMentions,
            authorId: userId,
            authorUsername: author?.username ?? null,
            contentId: created.id,
            entityType: "comment",
            href: `${cardHref}#comment-${created.id}`,
            storedBody: body,
          });
        }

        const item = await buildCommentFeedItem(
          { ...created, moderationStatus: modStatus },
          userId,
        );
        return res.status(201).json({ item });
      }

      // ── Standalone timeline post ────────────────────────────────────────────
      const [created] = await db
        .insert(unifiedComments)
        .values({ parentType: "voices_post", parentId: VOICES_TIMELINE_ID, userId, body })
        .returning();

      const modStatus = await moderateNewComment({
        commentId: created.id,
        userId,
        body,
        parentType: "voices_post",
        parentId: VOICES_TIMELINE_ID,
      });

      const [author] = await db
        .select({ username: profiles.username })
        .from(profiles)
        .where(eq(profiles.id, userId))
        .limit(1);
      if (modStatus === "visible") {
        await fanoutVoicePostMentions({
          userMentions: mentionResult.userMentions,
          authorId: userId,
          authorUsername: author?.username ?? null,
          contentId: created.id,
          entityType: "comment",
          href: `/voices#comment-${created.id}`,
          storedBody: body,
        });
      }

      const item = await buildCommentFeedItem(
        { ...created, moderationStatus: modStatus },
        userId,
      );
      return res.status(201).json({ item });
    } catch (error) {
      console.error("[voices] create post error:", error);
      res.status(500).json({ error: "Failed to create post" });
    }
  });

  // Single post + replies for the detail overlay. After the community_insights
  // → comments merge, every deep-link target is a comments row — the old
  // insight fallback branch is gone. Top-level profile posts are comments
  // with parentType='community_insight', parentCommentId=null; buildCommentFeedItem
  // derives source="insight" for them so the client renders identically.
  app.get("/api/voices/post/:id", optionalAuth, async (req: AuthRequest, res) => {
    try {
      const { id } = req.params;
      const userId = req.userId ?? null;

      const [comment] = await db
        .select({
          id: unifiedComments.id,
          parentType: unifiedComments.parentType,
          parentId: unifiedComments.parentId,
          parentCommentId: unifiedComments.parentCommentId,
          body: unifiedComments.body,
          userId: unifiedComments.userId,
          upvotes: unifiedComments.upvotes,
          downvotes: unifiedComments.downvotes,
          deletedAt: unifiedComments.deletedAt,
          moderationStatus: unifiedComments.moderationStatus,
          createdAt: unifiedComments.createdAt,
        })
        .from(unifiedComments)
        .where(eq(unifiedComments.id, id))
        .limit(1);

      if (!comment) return res.status(404).json({ error: "Post not found" });

      const post = await buildCommentFeedItem(comment, userId);
      if (post) {
        const upvoted = await loadCommentUpvotes([comment.id], userId);
        post.userVote = upvoted.has(comment.id) ? "up" : null;
      }
      const replies = await loadThreadReplies(comment.id, userId);
      return res.json({ post, replies });
    } catch (error) {
      console.error("[voices] post detail error:", error);
      res.status(500).json({ error: "Failed to load post" });
    }
  });
}
