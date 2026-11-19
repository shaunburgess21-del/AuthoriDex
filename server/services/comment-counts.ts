import { and, count, eq, inArray, isNull } from "drizzle-orm";
import { comments } from "@shared/schema";
import { db } from "../db";

/**
 * Visible comment totals for a set of parents, matching the card payloads
 * (matchups, sentiment, opinion): every non-deleted row on that parent,
 * including replies. Used so Overall Rating and Induction cards can show the
 * existing profile discussion count without a per-card fetch.
 */
export async function countVisibleCommentsByParent(
  parentType: "community_insight",
  parentIds: string[],
): Promise<Map<string, number>> {
  const unique = [...new Set(parentIds.filter((id) => id.length > 0))];
  const map = new Map<string, number>();
  if (unique.length === 0) return map;

  const rows = await db
    .select({ parentId: comments.parentId, cnt: count() })
    .from(comments)
    .where(and(
      eq(comments.parentType, parentType),
      inArray(comments.parentId, unique),
      isNull(comments.deletedAt),
    ))
    .groupBy(comments.parentId);

  for (const row of rows) {
    map.set(row.parentId, Number(row.cnt) || 0);
  }
  return map;
}
