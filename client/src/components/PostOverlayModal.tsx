import { useCallback, useEffect, useMemo, useState } from "react";
import { useLocation } from "wouter";
import { UserProfileAvatar } from "@/components/UserProfileAvatar";
import { Button } from "@/components/ui/button";
import { Heart, Loader2, MessageCircle, MoreVertical, X } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import { navigateToLogin } from "@/lib/authReturn";
import { formatTimeAgo } from "@/lib/formatDate";
import { MentionText } from "@/components/comments/MentionText";
import { useAuth } from "@/contexts/AuthContext";
import { VoteLabel } from "./VoteLabel";
import { CommentActionDrawer } from "./comments/CommentActionDrawer";
import { CommentComposer } from "./comments/CommentComposer";
import { CommentList } from "./comments/CommentList";
import { CommentSortHeader } from "./comments/CommentSortHeader";
import { useCommentThread } from "./comments/useCommentThread";
import { DeleteContentDialog } from "./comments/DeleteContentDialog";
import { useXpBurst } from "./XpBurstProvider";
import type { CommentAdapter, CommentItem, ParentVoteLabel, VoteType } from "./comments/types";
import { communityInsightsQueryKey } from "@/lib/communityInsightsQuery";
import {
  toInsightReplyCommentItem,
  type InsightCommentResponse,
} from "@/lib/communityInsightsMappers";
import { toast } from "sonner";

interface CommunityInsight {
  id: string;
  personId: string;
  userId: string;
  username: string | null;
  avatarUrl: string | null;
  content: string;
  sentimentVote?: number | null;
  deletedAt: string | null;
  createdAt: string;
  upvotes: number;
  downvotes: number;
  parentVoteLabel?: ParentVoteLabel | null;
}

function getSentimentColor(vote: number): string {
  const colors = [
    "#dc2626", "#e63946", "#f97316", "#fa9c3c", "#fbbf24",
    "#c1d42d", "#84cc16", "#5bca30", "#22c55e", "#22c55e",
  ];
  return colors[vote - 1] || colors[4];
}

function useInsightCommentsAdapter({
  insightId,
  personId,
  onXp,
  onDeleteSuccess,
}: {
  insightId: string;
  personId: string;
  onXp: (data: unknown) => void;
  onDeleteSuccess: () => void;
}): CommentAdapter {
  return useMemo<CommentAdapter>(() => ({
    queryKey: ["/api/comments", "community_insight", insightId] as const,
    fetchList: async () => {
      // After the community_insights → comments merge, replies to a top-level
      // profile post have parent_comment_id = <topLevelCommentId> and
      // parent_id = <personId>. Query by parentCommentId to fetch the thread.
      // Server defaults to top sort; useCommentThread re-sorts this 100-row
      // page in-memory when the UI switches sort modes.
      const res = await apiRequest("GET", `/api/comments?parentType=community_insight&parentId=${encodeURIComponent(personId)}&parentCommentId=${encodeURIComponent(insightId)}&limit=100`);
      const raw = (await res.json()) as InsightCommentResponse[];
      return raw.map((row) => toInsightReplyCommentItem(row, insightId));
    },
    postComment: async ({ body, parentId }) => {
      // parentId here is the parent COMMENT id (the post being replied to, or
      // a reply being nested-replied to). The route's parentId is the personId.
      const res = await apiRequest("POST", "/api/comments", {
        parentType: "community_insight",
        parentId: personId,
        parentCommentId: parentId ?? insightId,
        body,
      });
      const raw = (await res.json()) as InsightCommentResponse;
      return { ...toInsightReplyCommentItem(raw, insightId), xp: raw.xp };
    },
    voteComment: async ({ commentId, voteType }) => {
      const res = await apiRequest(
        "POST",
        `/api/comments/${commentId}/vote`,
        { voteType },
      );
      return res.json();
    },
    deleteComment: async ({ commentId }) => {
      const res = await apiRequest("DELETE", `/api/comments/${commentId}`);
      return res.json();
    },
    onPostSuccess: (data) => {
      toast("Comment Posted");
      onXp(data);
    },
    onVoteSuccess: (data) => {
      onXp(data);
    },
    onDeleteSuccess: () => {
      onDeleteSuccess();
    },
    supportsReplies: true,
    // Invalidate the main profile view's top-level posts query so reply counts refresh.
    invalidateOnMutate: [communityInsightsQueryKey(personId)],
  }), [insightId, personId, onXp, onDeleteSuccess]);
}

interface PostOverlayModalProps {
  insight: CommunityInsight | null;
  isOpen: boolean;
  onClose: () => void;
  userVote?: VoteType;
  onVote: (insightId: string, voteType: VoteType) => void;
  onDeleteInsight: (insightId: string) => void;
  isDeletingInsight?: boolean;
}

export function PostOverlayModal({
  insight,
  isOpen,
  onClose,
  userVote,
  onVote,
  onDeleteInsight,
  isDeletingInsight = false,
}: PostOverlayModalProps) {
  if (!isOpen || !insight) return null;

  return (
    <PostOverlayModalContent
      insight={insight}
      onClose={onClose}
      userVote={userVote}
      onVote={onVote}
      onDeleteInsight={onDeleteInsight}
      isDeletingInsight={isDeletingInsight}
    />
  );
}

function PostOverlayModalContent({
  insight,
  onClose,
  userVote,
  onVote,
  onDeleteInsight,
  isDeletingInsight,
}: {
  insight: CommunityInsight;
  onClose: () => void;
  userVote?: VoteType;
  onVote: (insightId: string, voteType: VoteType) => void;
  onDeleteInsight: (insightId: string) => void;
  isDeletingInsight: boolean;
}) {
  const { user, profile } = useAuth();
  const [, setLocation] = useLocation();
  const { trigger: triggerXpBurst } = useXpBurst();

  // Lock background scroll while the overlay is open.
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, []);

  const [drawerComment, setDrawerComment] = useState<CommentItem | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<CommentItem | null>(null);
  const [rootActionsOpen, setRootActionsOpen] = useState(false);
  const [rootDeleteOpen, setRootDeleteOpen] = useState(false);

  const triggerXp = useCallback((data: unknown) => {
    const xp = (data as { xp?: { xpAwarded?: number; reason?: string } | null } | null)?.xp;
    if (xp?.xpAwarded) {
      triggerXpBurst(xp.xpAwarded, undefined, xp.reason);
    }
  }, [triggerXpBurst]);
  const handleDeleteSuccess = useCallback(() => {
    setDrawerComment(null);
    setDeleteTarget(null);
  }, []);

  const adapter = useInsightCommentsAdapter({
    insightId: insight.id,
    personId: insight.personId,
    onXp: triggerXp,
    onDeleteSuccess: handleDeleteSuccess,
  });
  const thread = useCommentThread(adapter);

  const hasUpvoted = userVote === "up";
  const isInsightDeleted = Boolean(insight.deletedAt);

  return (
    <div 
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/60 backdrop-blur-sm overflow-y-auto"
      onClick={onClose}
      data-testid="post-overlay-modal"
    >
      <div
        className="relative min-h-dvh w-full overflow-hidden rounded-none border-0 bg-background shadow-2xl sm:mx-4 sm:my-8 sm:min-h-0 sm:max-w-2xl sm:rounded-xl sm:border sm:border-border"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sticky top-0 z-10 flex items-center justify-between p-4 border-b border-border bg-background/95 backdrop-blur-sm">
          <h2 className="text-lg font-semibold">Post</h2>
          <Button
            variant="ghost"
            size="icon"
            onClick={onClose}
            className="h-8 w-8"
            aria-label="Close"
            data-testid="button-close-overlay"
          >
            <X className="h-5 w-5" />
          </Button>
        </div>

        <div className="px-1.5 py-4 sm:p-6">
          <div className="flex items-start gap-3 sm:gap-4">
            {!isInsightDeleted && (
              <UserProfileAvatar
                displayName={insight.username}
                avatarUrl={insight.avatarUrl}
                className="h-12 w-12 flex-shrink-0"
                fallbackClassName="text-base"
              />
            )}
            <div className="flex-1 min-w-0">
              <div className="flex items-start justify-between gap-2">
                <div className="flex items-center gap-2 flex-wrap min-w-0">
                  <span className={`${isInsightDeleted ? "italic text-muted-foreground" : "font-semibold"}`}>
                    {isInsightDeleted ? "[deleted user]" : insight.username || "Anonymous"}
                  </span>
                  {!isInsightDeleted && insight.sentimentVote && (
                    <span
                      className="text-xs px-2 py-0.5 rounded-full backdrop-blur-sm border"
                      style={{
                        backgroundColor: `${getSentimentColor(insight.sentimentVote)}15`,
                        color: getSentimentColor(insight.sentimentVote),
                        borderColor: `${getSentimentColor(insight.sentimentVote)}40`,
                        boxShadow: `0 0 8px ${getSentimentColor(insight.sentimentVote)}20`,
                      }}
                    >
                      Voted {insight.sentimentVote}/10
                    </span>
                  )}
                  <span className="text-sm text-muted-foreground">
                    {formatTimeAgo(insight.createdAt)}
                  </span>
                  {!isInsightDeleted && <VoteLabel label={insight.parentVoteLabel ?? null} />}
                </div>
                <button
                  onClick={() => setRootActionsOpen(true)}
                  className="shrink-0 p-1 text-muted-foreground/50 hover:text-muted-foreground transition-colors"
                  data-interactive="true"
                  aria-label="Insight actions"
                >
                  <MoreVertical className="h-4 w-4" />
                </button>
              </div>
              <p className={`mt-3 text-base leading-relaxed break-words whitespace-pre-wrap ${isInsightDeleted ? "italic text-muted-foreground" : ""}`}>
                {isInsightDeleted ? "[deleted]" : <MentionText text={insight.content} />}
              </p>

              <div className="flex items-center gap-1 mt-4 pt-4 border-t border-border">
                {!isInsightDeleted && (
                  <>
                    <button
                      onClick={() => onVote(insight.id, "up")}
                      onPointerUp={(event) => event.currentTarget.blur()}
                      disabled={!user}
                      className={`flex items-center gap-1 text-xs transition-colors focus:outline-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#F91880]/30 focus-visible:ring-offset-2 focus-visible:ring-offset-background ${
                        hasUpvoted
                          ? "text-[#F91880] hover:text-[#F91880]/90"
                          : "text-muted-foreground hover:text-[#F91880]"
                      } ${!user ? "opacity-50 cursor-not-allowed" : ""}`}
                      aria-label="Like"
                      data-testid="button-overlay-upvote"
                    >
                      <Heart className={`h-3.5 w-3.5 ${hasUpvoted ? "fill-current" : ""}`} />
                      {(insight.upvotes || 0) > 0 && <span>{insight.upvotes}</span>}
                    </button>
                  </>
                )}

                <div className="flex items-center gap-1 ml-4 text-muted-foreground">
                  <MessageCircle className="h-5 w-5" />
                  <span className="text-sm">{thread.visibleCount}</span>
                </div>
              </div>
            </div>
          </div>
        </div>

        <div className="border-t border-border">
          <div className="px-1.5 py-4 sm:px-4">
            <CommentSortHeader
              count={thread.visibleCount}
              countLabel="Replies"
              variant="inline"
              sort={thread.sort}
              onSortChange={thread.setSort}
            />

            {user && !isInsightDeleted && (
              <div className="mb-6">
                <CommentComposer
                  value={thread.composerBody}
                  onChange={thread.setComposerBody}
                  onSubmit={thread.submit}
                  placeholder="Add a reply..."
                  isPending={thread.isPostPending}
                  authorAvatarUrl={profile?.avatarUrl ?? null}
                  authorDisplayName={profile?.username || user.email || ""}
                  replyTo={thread.replyTo}
                  onCancelReply={thread.cancelReply}
                  supportsFullscreen
                  parentExpanded
                  variant="card"
                  testIds={{
                    input: thread.replyTo ? `textarea-overlay-reply-${thread.replyTo.id}` : "textarea-overlay-new-comment",
                    submit: "button-overlay-submit-comment",
                  }}
                />
              </div>
            )}

            {!user && !isInsightDeleted && (
              <SignInToReply onLogin={() => navigateToLogin(setLocation)} />
            )}

            {thread.isLoading ? (
              <div className="flex items-center justify-center gap-2 py-8">
                <Loader2 className="h-5 w-5 animate-spin" />
                <span className="text-muted-foreground">Loading replies...</span>
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
                getRowTestIds={(comment) => ({
                  root: `overlay-comment-${comment.id}`,
                  upvote: `button-overlay-comment-upvote-${comment.id}`,
                  reply: `button-overlay-comment-reply-${comment.id}`,
                })}
              />
            )}
          </div>
        </div>
      </div>
      <CommentActionDrawer
        open={!!drawerComment}
        onClose={() => setDrawerComment(null)}
        onDelete={
          drawerComment && !drawerComment.deletedAt && drawerComment.userId === user?.id
            ? () => {
              setDeleteTarget(drawerComment);
              setDrawerComment(null);
            }
            : undefined
        }
        commentId={drawerComment?.id || null}
        entitySlug={insight.personId}
      />
      <CommentActionDrawer
        open={rootActionsOpen}
        onClose={() => setRootActionsOpen(false)}
        onDelete={
          !isInsightDeleted && insight.userId === user?.id
            ? () => {
              setRootDeleteOpen(true);
              setRootActionsOpen(false);
            }
            : undefined
        }
        commentId={insight.id}
        entitySlug={insight.personId}
      />
      <DeleteContentDialog
        open={!!deleteTarget}
        onOpenChange={(open) => {
          if (!open) setDeleteTarget(null);
        }}
        description="Delete this comment? This cannot be undone."
        isPending={thread.isDeletePending}
        onConfirm={() => {
          if (deleteTarget) {
            thread.deleteComment({ commentId: deleteTarget.id });
          }
        }}
      />
      <DeleteContentDialog
        open={rootDeleteOpen}
        onOpenChange={setRootDeleteOpen}
        description="Delete this insight? This cannot be undone."
        isPending={isDeletingInsight}
        onConfirm={() => {
          onDeleteInsight(insight.id);
          setRootDeleteOpen(false);
        }}
      />
    </div>
  );
}

function SignInToReply({ onLogin }: { onLogin: () => void }) {
  return (
    <div className="text-center py-3 border-t border-border/20 mb-4">
      <p className="text-sm text-muted-foreground">
        <button
          className="text-cyan-600 dark:text-cyan-400 underline hover:text-cyan-500 dark:hover:text-cyan-300 transition-colors"
          onClick={onLogin}
          data-testid="link-login-to-comment"
        >
          Sign in
        </button>{" "}
        to join the discussion
      </p>
    </div>
  );
}
