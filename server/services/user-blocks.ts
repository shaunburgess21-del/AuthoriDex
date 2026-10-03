import { sql, type SQL } from "drizzle-orm";

/**
 * One-directional block of another user. Persisted by `UserBlockStore`.
 * Comment threads apply `omitBlockedAuthors` for the blocker only.
 */
export interface UserBlockRecord {
  blockerId: string;
  blockedId: string;
  createdAt: Date;
}

export interface UserBlockStore {
  /** Insert the pair. A repeat insert is a no-op and returns `"exists"`. */
  insert(record: UserBlockRecord): Promise<"inserted" | "exists">;
  /** Remove the pair. Returns whether a row was deleted. */
  delete(blockerId: string, blockedId: string): Promise<boolean>;
  list(blockerId: string): Promise<UserBlockRecord[]>;
  profileExists(userId: string): Promise<boolean>;
}

export type BlockUserResult =
  | { ok: true; alreadyBlocked: boolean }
  | { ok: false; reason: "self" | "not_found" };

export type UnblockUserResult =
  | { ok: true; unblocked: boolean }
  | { ok: false; reason: "self" };

export interface BlockFilterComment {
  id: string;
  userId: string;
  parentCommentId: string | null;
}

export async function blockUser(
  store: UserBlockStore,
  blockerId: string,
  blockedId: string,
  now: Date = new Date(),
): Promise<BlockUserResult> {
  if (blockerId === blockedId) return { ok: false, reason: "self" };
  if (!(await store.profileExists(blockedId))) return { ok: false, reason: "not_found" };
  const outcome = await store.insert({ blockerId, blockedId, createdAt: now });
  return { ok: true, alreadyBlocked: outcome === "exists" };
}

export async function unblockUser(
  store: UserBlockStore,
  blockerId: string,
  blockedId: string,
): Promise<UnblockUserResult> {
  if (blockerId === blockedId) return { ok: false, reason: "self" };
  const unblocked = await store.delete(blockerId, blockedId);
  return { ok: true, unblocked };
}

export async function listBlockedUserIds(
  store: UserBlockStore,
  blockerId: string,
): Promise<string[]> {
  const rows = await store.list(blockerId);
  return rows.map((row) => row.blockedId);
}

/**
 * Drop comments authored by blocked users and re-attach any surviving
 * replies to the nearest visible ancestor. Does not mutate `comments`.
 * An empty block set returns the input list unchanged.
 */
export function omitBlockedAuthors<T extends BlockFilterComment>(
  comments: readonly T[],
  blockedUserIds: ReadonlySet<string>,
): T[] {
  if (blockedUserIds.size === 0) return comments as T[];
  if (!comments.some((comment) => blockedUserIds.has(comment.userId))) {
    return comments as T[];
  }

  const byId = new Map(comments.map((comment) => [comment.id, comment]));

  const visibleParentId = (parentId: string | null): string | null => {
    const seen = new Set<string>();
    let current = parentId;
    while (current) {
      if (seen.has(current)) return null;
      seen.add(current);
      const parent = byId.get(current);
      if (!parent) return current;
      if (!blockedUserIds.has(parent.userId)) return current;
      current = parent.parentCommentId;
    }
    return null;
  };

  return comments
    .filter((comment) => !blockedUserIds.has(comment.userId))
    .map((comment) => {
      const nextParent = visibleParentId(comment.parentCommentId);
      if (nextParent === comment.parentCommentId) return comment;
      return { ...comment, parentCommentId: nextParent };
    });
}

/** SQL fragment excluding blocked authors from a comment-count subquery. */
export function blockedAuthorSqlExclusion(
  userIdExpr: SQL,
  blockedUserIds: readonly string[],
): SQL {
  if (blockedUserIds.length === 0) return sql``;
  return sql` AND ${userIdExpr} NOT IN (${sql.join(
    blockedUserIds.map((id) => sql`${id}`),
    sql`, `,
  )})`;
}
