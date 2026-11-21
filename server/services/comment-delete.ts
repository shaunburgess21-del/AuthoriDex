/**
 * Author delete for a unified comment (Voices timeline posts and profile
 * posts live in this table). Moderators do not use this path — they use
 * DELETE /api/admin/moderation/comments/:id. `actor.role` is accepted so
 * callers can pass the session role without it granting delete.
 */
export type CommentDeleteActor = {
  userId: string;
  role?: string | null;
};

export type CommentDeleteRow = {
  userId: string;
  deletedAt: Date | string | null;
};

export type CommentDeleteHttpResult =
  | { status: 200; body: { success: true; deletedAt: Date | string } }
  | { status: 403; body: { error: "Forbidden" } }
  | { status: 404; body: { error: "Comment not found" } };

export function decideCommentDelete(
  comment: CommentDeleteRow | null | undefined,
  actor: CommentDeleteActor,
): CommentDeleteHttpResult | { action: "soft-delete" } {
  if (!comment) {
    return { status: 404, body: { error: "Comment not found" } };
  }
  // Role is not an override. A non-author, including an admin, is 403.
  if (comment.userId !== actor.userId) {
    return { status: 403, body: { error: "Forbidden" } };
  }
  if (comment.deletedAt) {
    return { status: 200, body: { success: true, deletedAt: comment.deletedAt } };
  }
  return { action: "soft-delete" };
}

/**
 * The UPDATE must return the stamped row. An empty RETURNING used to be
 * reported as success with a timestamp the database never stored.
 */
export function commentDeleteWriteResult(
  updated: { deletedAt: Date | string | null } | null | undefined,
): CommentDeleteHttpResult {
  if (!updated?.deletedAt) {
    return { status: 404, body: { error: "Comment not found" } };
  }
  return { status: 200, body: { success: true, deletedAt: updated.deletedAt } };
}

export async function executeCommentDelete(
  comment: CommentDeleteRow | null | undefined,
  actor: CommentDeleteActor,
  write: () => Promise<{ deletedAt: Date | string | null } | null | undefined>,
): Promise<CommentDeleteHttpResult> {
  const decision = decideCommentDelete(comment, actor);
  if (!("action" in decision)) return decision;
  return commentDeleteWriteResult(await write());
}
