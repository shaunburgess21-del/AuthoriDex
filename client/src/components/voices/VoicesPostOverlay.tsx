import { useCallback, useEffect, useMemo, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { Loader2, MessageCircle, MoreVertical, ThumbsUp, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { UserProfileAvatar } from "@/components/UserProfileAvatar";
import { CommentActionDrawer } from "@/components/comments/CommentActionDrawer";
import { CommentComposer } from "@/components/comments/CommentComposer";
import { CommentList } from "@/components/comments/CommentList";
import { CommentSortHeader } from "@/components/comments/CommentSortHeader";
import { useCommentThread } from "@/components/comments/useCommentThread";
import { DeleteContentDialog } from "@/components/comments/DeleteContentDialog";
import type { CommentAdapter, CommentItem } from "@/components/comments/types";
import { useAuth } from "@/contexts/AuthContext";
import { navigateToLogin } from "@/lib/authReturn";
import { apiRequest } from "@/lib/queryClient";
import { formatTimeAgo } from "@/lib/formatDate";
import { MentionText } from "@/components/comments/MentionText";
import { cn } from "@/lib/utils";
import { VOICES_TIMELINE_ID } from "@shared/constants";
import { toast } from "sonner";
import type { VoicesFeedItem, VoicesReply } from "./types";
import {
  VOICES_COMPOSER_INPUT_CLASS,
  VOICES_PANEL_HEADER_CLASS,
  VOICES_PANEL_SURFACE_CLASS,
} from "./voicesSurface";

interface VoicesPostOverlayProps {
  item: VoicesFeedItem;
  onClose: () => void;
}

interface UnifiedCommentResponse extends Omit<CommentItem, "parentId"> {
  parentCommentId: string | null;
}

// Direct replies to a timeline post are stored with parentCommentId = post id
// (the server thread-walker needs this), but buildThreadedComments treats only
// parentId = null rows as top-level — so normalize the post id away here.
function replyToCommentItem(reply: VoicesReply, postId: string): CommentItem {
  return {
    id: reply.id,
    userId: reply.userId,
    username: reply.username,
    avatarUrl: reply.avatarUrl,
    authorRank: reply.authorRank,
    body: reply.body,
    parentId: reply.parentCommentId === postId ? null : reply.parentCommentId,
    upvotes: reply.upvotes,
    downvotes: reply.downvotes,
    userVote: reply.userVote,
    deletedAt: reply.deletedAt,
    parentVoteLabel: reply.parentVoteLabel,
    createdAt: reply.createdAt,
  };
}

/**
 * Full-screen overlay for a standalone Voices timeline post (parentType
 * `voices_post`). Renders the post header plus a reply thread backed by the
 * unified comments API.
 */
export function VoicesPostOverlay({ item, onClose }: VoicesPostOverlayProps) {
  const { user, isLoggedIn, profile } = useAuth();

  // Lock background scroll while the overlay is open.
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, []);

  const [, setLocation] = useLocation();
  const queryClient = useQueryClient();
  const [drawerComment, setDrawerComment] = useState<CommentItem | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<CommentItem | null>(null);
  const [rootActionsOpen, setRootActionsOpen] = useState(false);
  const [rootDeleteOpen, setRootDeleteOpen] = useState(false);
  const [postDeleted, setPostDeleted] = useState(false);

  const isAuthenticated = isLoggedIn || !!user;

  const adapter = useMemo<CommentAdapter>(
    () => ({
      queryKey: ["/api/voices/post", item.id] as const,
      fetchList: async () => {
        const res = await apiRequest("GET", `/api/voices/post/${item.id}`);
        const json = (await res.json()) as { replies?: VoicesReply[] };
        return (json.replies ?? []).map((reply) => replyToCommentItem(reply, item.id));
      },
      postComment: async ({ body, parentId }) => {
        const res = await apiRequest("POST", "/api/comments", {
          parentType: "voices_post",
          parentId: VOICES_TIMELINE_ID,
          parentCommentId: parentId ?? item.id,
          body,
        });
        const raw = (await res.json()) as UnifiedCommentResponse;
        return {
          ...raw,
          parentId: raw.parentCommentId === item.id ? null : raw.parentCommentId,
        } as CommentItem;
      },
      voteComment: async ({ commentId, voteType }) => {
        const res = await apiRequest("POST", `/api/comments/${commentId}/vote`, { voteType });
        return res.json();
      },
      deleteComment: async ({ commentId }) => {
        const res = await apiRequest("DELETE", `/api/comments/${commentId}`);
        return res.json();
      },
      reportComment: async ({ commentId, reason }) => {
        const res = await apiRequest("POST", `/api/comments/${commentId}/report`, { reason });
        return res.json();
      },
      onPostSuccess: () => {
        toast("Reply posted");
        queryClient.invalidateQueries({ queryKey: ["/api/voices/feed"] });
        queryClient.invalidateQueries({ queryKey: ["/api/me/comments"] });
        queryClient.invalidateQueries({ queryKey: ["/api/profile/me"] });
      },
      onDeleteSuccess: () => {
        setDrawerComment(null);
        setDeleteTarget(null);
      },
      supportsReplies: true,
    }),
    [item.id, queryClient],
  );

  const thread = useCommentThread(adapter);

  const [postUpvotes, setPostUpvotes] = useState(item.upvotes);
  const [postUserVote, setPostUserVote] = useState<"up" | null>(item.userVote ?? null);

  const votePost = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", `/api/comments/${item.id}/vote`, { voteType: "up" });
      return res.json() as Promise<{ upvotes?: number; downvotes?: number; userVote?: "up" | null }>;
    },
    onSuccess: (data) => {
      if (typeof data.upvotes === "number") setPostUpvotes(data.upvotes);
      setPostUserVote(data.userVote ?? null);
      queryClient.invalidateQueries({ queryKey: ["/api/voices/feed"] });
    },
  });

  const deletePost = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("DELETE", `/api/comments/${item.id}`);
      return res.json();
    },
    onSuccess: () => {
      setPostDeleted(true);
      setRootDeleteOpen(false);
      toast("Post deleted");
      queryClient.invalidateQueries({ queryKey: ["/api/voices/feed"] });
      queryClient.invalidateQueries({ queryKey: ["/api/me/comments"] });
      queryClient.invalidateQueries({ queryKey: ["/api/profile/me"] });
    },
  });

  const handleVotePost = useCallback(() => {
    if (!isAuthenticated) {
      navigateToLogin(setLocation);
      return;
    }
    votePost.mutate();
  }, [isAuthenticated, setLocation, votePost]);

  const isOwner = item.author.userId === user?.id;

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/60 backdrop-blur-sm"
      onClick={onClose}
      data-testid="voices-post-overlay"
    >
      <div
        className={cn(
          "relative min-h-dvh w-full bg-background sm:mx-4 sm:my-8 sm:min-h-0 sm:max-w-2xl",
          VOICES_PANEL_SURFACE_CLASS,
        )}
        onClick={(e) => e.stopPropagation()}
      >
        <div
          className={cn(
            "sticky top-0 z-10 flex items-center justify-between p-4 backdrop-blur-sm",
            VOICES_PANEL_HEADER_CLASS,
          )}
        >
          <h2 className="text-lg font-semibold">Post</h2>
          <Button variant="ghost" size="icon" onClick={onClose} className="h-8 w-8" aria-label="Close">
            <X className="h-5 w-5" />
          </Button>
        </div>

        <div className="px-1.5 py-4 sm:p-6">
          <div className="flex items-start gap-3 sm:gap-4">
            {!postDeleted && (
              <UserProfileAvatar
                displayName={item.author.username}
                avatarUrl={item.author.avatarUrl}
                className="h-12 w-12 flex-shrink-0"
                fallbackClassName="text-base"
              />
            )}
            <div className="min-w-0 flex-1">
              <div className="flex items-start justify-between gap-2">
                <div className="flex min-w-0 flex-wrap items-center gap-2">
                  <span className={postDeleted ? "italic text-muted-foreground" : "font-semibold"}>
                    {postDeleted ? "[deleted user]" : item.author.username || "Anonymous"}
                  </span>
                  <span className="text-sm text-muted-foreground">{formatTimeAgo(item.createdAt)}</span>
                </div>
                {isOwner && !postDeleted && (
                  <button
                    onClick={() => setRootActionsOpen(true)}
                    className="shrink-0 p-1 text-muted-foreground/50 transition-colors hover:text-muted-foreground"
                    aria-label="Post actions"
                  >
                    <MoreVertical className="h-4 w-4" />
                  </button>
                )}
              </div>
              <p
                className={`mt-3 whitespace-pre-wrap break-words text-base leading-relaxed ${
                  postDeleted ? "italic text-muted-foreground" : ""
                }`}
              >
                {postDeleted ? "[deleted]" : <MentionText text={item.body} />}
              </p>

              <div className="mt-4 flex items-center gap-3 border-t border-border/40 pt-4">
                {!postDeleted && (
                  <button
                    onClick={handleVotePost}
                    className={`flex items-center gap-1 text-xs transition-colors ${
                      postUserVote === "up"
                        ? "text-amber-600 dark:text-amber-400"
                        : "text-muted-foreground hover:text-amber-600 dark:hover:text-amber-400"
                    }`}
                    aria-label="Upvote"
                  >
                    <ThumbsUp className={`h-3.5 w-3.5 ${postUserVote === "up" ? "fill-current" : ""}`} />
                    {postUpvotes > 0 && <span>{postUpvotes}</span>}
                  </button>
                )}
                <div className="flex items-center gap-1 text-muted-foreground">
                  <MessageCircle className="h-5 w-5" />
                  <span className="text-sm">{thread.visibleCount}</span>
                </div>
              </div>
            </div>
          </div>
        </div>

        <div className="border-t border-border/40">
          <div className="px-1.5 py-4 sm:px-4">
            <CommentSortHeader
              count={thread.visibleCount}
              countLabel="Replies"
              variant="inline"
              sort={thread.sort}
              onSortChange={thread.setSort}
            />

            {isAuthenticated && !postDeleted && (
              <div className="mb-6">
                <CommentComposer
                  value={thread.composerBody}
                  onChange={thread.setComposerBody}
                  onSubmit={thread.submit}
                  placeholder="Add a reply…"
                  isPending={thread.isPostPending}
                  authorAvatarUrl={profile?.avatarUrl ?? null}
                  authorDisplayName={profile?.username || user?.email || ""}
                  replyTo={thread.replyTo}
                  onCancelReply={thread.cancelReply}
                  supportsFullscreen
                  parentExpanded
                  hideTopBorder
                  inputClassName={VOICES_COMPOSER_INPUT_CLASS}
                  variant="card"
                />
              </div>
            )}

            {!isAuthenticated && (
              <div className="mb-4 border-t border-border/20 py-3 text-center">
                <p className="text-sm text-muted-foreground">
                  <button
                    className="text-amber-600 underline hover:text-amber-500 dark:text-amber-400"
                    onClick={() => navigateToLogin(setLocation)}
                  >
                    Sign in
                  </button>{" "}
                  to join the discussion
                </p>
              </div>
            )}

            {thread.isLoading ? (
              <div className="flex items-center justify-center gap-2 py-8">
                <Loader2 className="h-5 w-5 animate-spin" />
                <span className="text-muted-foreground">Loading replies…</span>
              </div>
            ) : (
              <CommentList
                threaded={thread.threaded}
                sort={thread.sort}
                maxHeight="none"
                emptyMessage="No replies yet. Be the first to reply!"
                onVote={thread.vote}
                onReply={thread.startReply}
                onOpenActions={setDrawerComment}
              />
            )}
          </div>
        </div>
      </div>

      <CommentActionDrawer
        open={!!drawerComment}
        onClose={() => setDrawerComment(null)}
        onReport={
          drawerComment && !drawerComment.deletedAt
            ? (reason) => thread.report({ commentId: drawerComment.id, reason })
            : undefined
        }
        onDelete={
          drawerComment && !drawerComment.deletedAt && drawerComment.userId === user?.id
            ? () => {
                setDeleteTarget(drawerComment);
                setDrawerComment(null);
              }
            : undefined
        }
        commentId={drawerComment?.id || null}
        entitySlug={item.id}
      />
      <CommentActionDrawer
        open={rootActionsOpen}
        onClose={() => setRootActionsOpen(false)}
        onDelete={
          isOwner && !postDeleted
            ? () => {
                setRootDeleteOpen(true);
                setRootActionsOpen(false);
              }
            : undefined
        }
        commentId={item.id}
        entitySlug={item.id}
      />
      <DeleteContentDialog
        open={!!deleteTarget}
        onOpenChange={(open) => {
          if (!open) setDeleteTarget(null);
        }}
        description="Delete this reply? This cannot be undone."
        isPending={thread.isDeletePending}
        onConfirm={() => {
          if (deleteTarget) thread.deleteComment({ commentId: deleteTarget.id });
        }}
      />
      <DeleteContentDialog
        open={rootDeleteOpen}
        onOpenChange={setRootDeleteOpen}
        description="Delete this post? This cannot be undone."
        isPending={deletePost.isPending}
        onConfirm={() => deletePost.mutate()}
      />
    </div>
  );
}
