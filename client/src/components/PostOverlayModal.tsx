import { useCallback, useMemo, useState } from "react";
import { useLocation } from "wouter";
import { UserProfileAvatar } from "@/components/UserProfileAvatar";
import { Button } from "@/components/ui/button";
import { Loader2, MessageCircle, MoreVertical, ThumbsUp, X } from "lucide-react";
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
import { toast } from "sonner";

interface InsightCommentResponse {
  id: string;
  parentCommentId: string | null;
  userId: string;
  username: string | null;
  avatarUrl: string | null;
  authorRank?: string | null;
  body: string;
  createdAt: string;
  upvotes: number;
  downvotes: number;
  userVote?: VoteType | null;
  deletedAt: string | null;
  parentVoteLabel?: ParentVoteLabel | null;
  xp?: unknown;
}

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

function toCommentItem(comment: InsightCommentResponse): CommentItem {
  return {
    id: comment.id,
    userId: comment.userId,
    username: comment.username,
    avatarUrl: comment.avatarUrl,
    authorRank: comment.authorRank ?? null,
    body: comment.body,
    parentId: comment.parentCommentId,
    upvotes: comment.upvotes ?? 0,
    downvotes: comment.downvotes ?? 0,
    userVote: comment.userVote ?? null,
    deletedAt: comment.deletedAt,
    parentVoteLabel: comment.parentVoteLabel ?? null,
    createdAt: comment.createdAt,
  };
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
      // Server defaults to top sort; useCommentThread re-sorts this 100-row
      // page in-memory when the UI switches sort modes.
      const res = await apiRequest("GET", `/api/comments?parentType=community_insight&parentId=${encodeURIComponent(insightId)}&limit=100`);
      const raw = (await res.json()) as InsightCommentResponse[];
      return raw.map(toCommentItem);
    },
    postComment: async ({ body, parentId }) => {
      const res = await apiRequest("POST", "/api/comments", {
        parentType: "community_insight",
        parentId: insightId,
        parentCommentId: parentId,
        body,
      });
      const raw = (await res.json()) as InsightCommentResponse;
      return { ...toCommentItem(raw), xp: raw.xp };
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
    invalidateOnMutate: [[`/api/community-insights/${personId}`]],
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
        className="relative w-full max-w-2xl my-8 mx-4 bg-background rounded-xl shadow-2xl border border-border overflow-hidden"
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

        <div className="p-6">
          <div className="flex items-start gap-4">
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
                      className={`flex items-center gap-1 text-xs transition-colors focus:outline-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-500/30 focus-visible:ring-offset-2 focus-visible:ring-offset-background ${
                        hasUpvoted
                          ? "text-cyan-600 dark:text-cyan-400 hover:text-cyan-500 dark:hover:text-cyan-300"
                          : "text-muted-foreground hover:text-cyan-600 dark:hover:text-cyan-400"
                      } ${!user ? "opacity-50 cursor-not-allowed" : ""}`}
                      aria-label="Upvote"
                      data-testid="button-overlay-upvote"
                    >
                      <ThumbsUp className="h-3.5 w-3.5" />
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
          <div className="p-4">
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
