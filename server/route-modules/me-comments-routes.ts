import type { Express } from "express";
import { and, eq, isNull, isNotNull, lt, or, desc, count } from "drizzle-orm";
import { requireAuth, type AuthRequest } from "../auth-middleware";
import { db } from "../db";
import { comments as unifiedComments, communityInsights } from "@shared/schema";
import {
  resolveCommentEntities,
  resolveInsightEntities,
  entityKey,
  type VoicesEntity,
} from "../services/voices/entities";
import type {
  MeCommentFilter,
  MeCommentItem,
  MeCommentsResponse,
} from "@shared/me-comments";

const DEFAULT_LIMIT = 30;
const MAX_LIMIT = 50;

/** Keyset cursor over the merged (createdAt, id) ordering shared by both sources. */
interface MeCommentsCursor {
  createdAt: string;
  id: string;
}

function encodeCursor(cursor: MeCommentsCursor): string {
  return Buffer.from(JSON.stringify(cursor), "utf8").toString("base64url");
}

function decodeCursor(raw: string): MeCommentsCursor | null {
  try {
    const parsed = JSON.parse(Buffer.from(raw, "base64url").toString("utf8"));
    if (typeof parsed?.createdAt === "string" && typeof parsed?.id === "string") {
      return { createdAt: parsed.createdAt, id: parsed.id };
    }
  } catch {
    /* fall through */
  }
  return null;
}

function parseFilter(value: unknown): MeCommentFilter {
  if (value === "timeline" || value === "replies" || value === "insights") return value;
  return "all";
}

/** A row from either source, normalised onto the shared keyset ordering. */
interface MergedRow {
  id: string;
  source: "comment" | "insight";
  body: string;
  parentType: string;
  parentId: string;
  parentCommentId: string | null;
  upvotes: number;
  createdAt: Date;
}

function toEntityDTO(entity: VoicesEntity) {
  return {
    refType: entity.refType,
    title: entity.title,
    subtitle: entity.subtitle,
    href: entity.href,
    imageUrl: entity.imageUrl,
  };
}

/** Fallback context for a message whose source card/person was removed. */
function fallbackEntity(): ReturnType<typeof toEntityDTO> {
  return { refType: "timeline", title: "Removed", subtitle: null, href: "/voices", imageUrl: null };
}

export function registerMeCommentsRoutes(app: Express): void {
  // Authored discussion history for the signed-in user: unified comments
  // (timeline posts, card comments, replies) merged with community insights,
  // newest-first, with keyset pagination. Powers /me/comments.
  app.get("/api/me/comments", requireAuth, async (req: AuthRequest, res) => {
    try {
      const userId = req.userId!;
      const filter = parseFilter(req.query.filter);

      const limitRaw = Number(req.query.limit ?? DEFAULT_LIMIT);
      const limit = Number.isFinite(limitRaw)
        ? Math.max(1, Math.min(Math.floor(limitRaw), MAX_LIMIT))
        : DEFAULT_LIMIT;

      const cursorRaw = typeof req.query.cursor === "string" ? req.query.cursor : null;
      const cursor = cursorRaw ? decodeCursor(cursorRaw) : null;
      const cursorDate = cursor ? new Date(cursor.createdAt) : null;

      const includeComments = filter === "all" || filter === "timeline" || filter === "replies";
      const includeInsights = filter === "all" || filter === "insights";

      // Keyset: rows strictly "older" than the cursor in (createdAt DESC, id DESC).
      const commentKeyset =
        cursor && cursorDate
          ? or(
              lt(unifiedComments.createdAt, cursorDate),
              and(eq(unifiedComments.createdAt, cursorDate), lt(unifiedComments.id, cursor.id)),
            )
          : undefined;
      const insightKeyset =
        cursor && cursorDate
          ? or(
              lt(communityInsights.createdAt, cursorDate),
              and(eq(communityInsights.createdAt, cursorDate), lt(communityInsights.id, cursor.id)),
            )
          : undefined;

      // ── Stats (independent of the active filter, excludes soft-deleted) ──────
      const [
        commentStatsRow,
        insightStatsRow,
        timelineStatsRow,
        replyStatsRow,
      ] = await Promise.all([
        db
          .select({ value: count() })
          .from(unifiedComments)
          .where(and(eq(unifiedComments.userId, userId), isNull(unifiedComments.deletedAt))),
        db
          .select({ value: count() })
          .from(communityInsights)
          .where(and(eq(communityInsights.userId, userId), isNull(communityInsights.deletedAt))),
        db
          .select({ value: count() })
          .from(unifiedComments)
          .where(
            and(
              eq(unifiedComments.userId, userId),
              isNull(unifiedComments.deletedAt),
              eq(unifiedComments.parentType, "voices_post"),
              isNull(unifiedComments.parentCommentId),
            ),
          ),
        db
          .select({ value: count() })
          .from(unifiedComments)
          .where(
            and(
              eq(unifiedComments.userId, userId),
              isNull(unifiedComments.deletedAt),
              isNotNull(unifiedComments.parentCommentId),
            ),
          ),
      ]);

      const stats: MeCommentsResponse["stats"] = {
        totalComments: commentStatsRow[0]?.value ?? 0,
        totalInsights: insightStatsRow[0]?.value ?? 0,
        totalTimelinePosts: timelineStatsRow[0]?.value ?? 0,
        totalReplies: replyStatsRow[0]?.value ?? 0,
      };

      // ── Page rows: fetch limit+1 from each enabled source, then merge ────────
      const commentConds = [
        eq(unifiedComments.userId, userId),
        isNull(unifiedComments.deletedAt),
      ];
      if (filter === "timeline") {
        commentConds.push(eq(unifiedComments.parentType, "voices_post"));
        commentConds.push(isNull(unifiedComments.parentCommentId));
      } else if (filter === "replies") {
        commentConds.push(isNotNull(unifiedComments.parentCommentId));
      }
      if (commentKeyset) commentConds.push(commentKeyset);

      const insightConds = [
        eq(communityInsights.userId, userId),
        isNull(communityInsights.deletedAt),
      ];
      if (insightKeyset) insightConds.push(insightKeyset);

      const [commentRows, insightRows] = await Promise.all([
        includeComments
          ? db
              .select({
                id: unifiedComments.id,
                body: unifiedComments.body,
                parentType: unifiedComments.parentType,
                parentId: unifiedComments.parentId,
                parentCommentId: unifiedComments.parentCommentId,
                upvotes: unifiedComments.upvotes,
                createdAt: unifiedComments.createdAt,
              })
              .from(unifiedComments)
              .where(and(...commentConds))
              .orderBy(desc(unifiedComments.createdAt), desc(unifiedComments.id))
              .limit(limit + 1)
          : Promise.resolve([]),
        includeInsights
          ? db
              .select({
                id: communityInsights.id,
                body: communityInsights.content,
                parentId: communityInsights.personId,
                createdAt: communityInsights.createdAt,
              })
              .from(communityInsights)
              .where(and(...insightConds))
              .orderBy(desc(communityInsights.createdAt), desc(communityInsights.id))
              .limit(limit + 1)
          : Promise.resolve([]),
      ]);

      const merged: MergedRow[] = [
        ...commentRows.map((r) => ({
          id: r.id,
          source: "comment" as const,
          body: r.body,
          parentType: r.parentType,
          parentId: r.parentId,
          parentCommentId: r.parentCommentId,
          upvotes: r.upvotes,
          createdAt: r.createdAt,
        })),
        ...insightRows.map((r) => ({
          id: r.id,
          source: "insight" as const,
          body: r.body,
          parentType: "community_insight",
          parentId: r.parentId,
          parentCommentId: null,
          // Insight upvotes live in insight_votes; the history card doesn't
          // surface them, so 0 keeps the query cheap.
          upvotes: 0,
          createdAt: r.createdAt,
        })),
      ];

      // Newest-first by (createdAt, id) — same total order as the keyset.
      merged.sort((a, b) => {
        const diff = b.createdAt.getTime() - a.createdAt.getTime();
        if (diff !== 0) return diff;
        return a.id < b.id ? 1 : a.id > b.id ? -1 : 0;
      });

      const hasMore = merged.length > limit;
      const page = merged.slice(0, limit);

      // ── Resolve entity context in batches ───────────────────────────────────
      const commentParents = page
        .filter((r) => r.source === "comment")
        .map((r) => ({ parentType: r.parentType, parentId: r.parentId }));
      const insightIds = page.filter((r) => r.source === "insight").map((r) => r.id);

      const [commentEntities, insightEntities] = await Promise.all([
        commentParents.length > 0 ? resolveCommentEntities(commentParents) : Promise.resolve(new Map<string, VoicesEntity>()),
        insightIds.length > 0 ? resolveInsightEntities(insightIds) : Promise.resolve(new Map<string, VoicesEntity>()),
      ]);

      const items: MeCommentItem[] = page.map((row) => {
        const entity =
          row.source === "comment"
            ? commentEntities.get(entityKey(row.parentType, row.parentId))
            : insightEntities.get(row.id);
        const entityDTO = entity ? toEntityDTO(entity) : fallbackEntity();
        const anchor = row.source === "comment" ? `#comment-${row.id}` : `#insight-${row.id}`;
        return {
          id: row.id,
          source: row.source,
          body: row.body,
          parentType: row.parentType,
          parentCommentId: row.parentCommentId,
          isReply: row.parentCommentId !== null,
          upvotes: row.upvotes,
          createdAt: row.createdAt.toISOString(),
          entity: entityDTO,
          threadHref: `${entityDTO.href}${anchor}`,
        };
      });

      const last = page[page.length - 1];
      const nextCursor =
        hasMore && last
          ? encodeCursor({ createdAt: last.createdAt.toISOString(), id: last.id })
          : null;

      const response: MeCommentsResponse = { items, stats, nextCursor };
      res.json(response);
    } catch (error) {
      console.error("[me-comments] list error:", error);
      res.status(500).json({ error: "Failed to load your comments" });
    }
  });
}
