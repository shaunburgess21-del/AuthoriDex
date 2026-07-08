import type { Express } from "express";
import { and, eq, isNull, isNotNull, lt, or, desc, count } from "drizzle-orm";
import { requireAuth, type AuthRequest } from "../auth-middleware";
import { db } from "../db";
import { comments as unifiedComments } from "@shared/schema";
import {
  resolveCommentEntities,
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

/** Keyset cursor over the (createdAt, id) ordering. */
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

/** A row from the unified comments table, normalised onto the shared keyset ordering. */
interface MergedRow {
  id: string;
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
  // Authored discussion history for the signed-in user. After the
  // community_insights → comments merge, this is a single query against the
  // unified comments table — top-level profile posts (parentType=
  // 'community_insight', parentCommentId=null) sit alongside card comments,
  // replies, and timeline posts. Newest-first with keyset pagination.
  // Powers /me/comments.
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

      // Keyset: rows strictly "older" than the cursor in (createdAt DESC, id DESC).
      const keyset =
        cursor && cursorDate
          ? or(
              lt(unifiedComments.createdAt, cursorDate),
              and(eq(unifiedComments.createdAt, cursorDate), lt(unifiedComments.id, cursor.id)),
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
        // totalInsights: top-level profile posts (parentType='community_insight',
        // parentCommentId=null) authored by this user.
        db
          .select({ value: count() })
          .from(unifiedComments)
          .where(
            and(
              eq(unifiedComments.userId, userId),
              isNull(unifiedComments.deletedAt),
              eq(unifiedComments.parentType, "community_insight"),
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

      // ── Page rows: single query against unified comments ─────────────────────
      const conds = [
        eq(unifiedComments.userId, userId),
        isNull(unifiedComments.deletedAt),
      ];
      if (filter === "timeline") {
        conds.push(eq(unifiedComments.parentType, "voices_post"));
        conds.push(isNull(unifiedComments.parentCommentId));
      } else if (filter === "replies") {
        conds.push(isNotNull(unifiedComments.parentCommentId));
      } else if (filter === "insights") {
        conds.push(eq(unifiedComments.parentType, "community_insight"));
        conds.push(isNull(unifiedComments.parentCommentId));
      }
      if (keyset) conds.push(keyset);

      const rows = await db
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
        .where(and(...conds))
        .orderBy(desc(unifiedComments.createdAt), desc(unifiedComments.id))
        .limit(limit + 1);

      const hasMore = rows.length > limit;
      const page = rows.slice(0, limit);

      // ── Resolve entity context in batch ───────────────────────────────────
      const commentParents = page.map((r) => ({ parentType: r.parentType, parentId: r.parentId }));
      const commentEntities = commentParents.length > 0
        ? await resolveCommentEntities(commentParents)
        : new Map<string, VoicesEntity>();

      const items: MeCommentItem[] = page.map((row) => {
        const entity = commentEntities.get(entityKey(row.parentType, row.parentId));
        const entityDTO = entity ? toEntityDTO(entity) : fallbackEntity();
        // Source derivation: top-level profile posts keep source="insight" for
        // backwards compat with the /me/comments UI (insights filter tab, icon
        // styling). Everything else is source="comment".
        const isTopLevelProfilePost =
          row.parentType === "community_insight" && row.parentCommentId === null;
        const source = isTopLevelProfilePost ? "insight" : "comment";
        const anchor = isTopLevelProfilePost ? `#insight-${row.id}` : `#comment-${row.id}`;
        return {
          id: row.id,
          source,
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
