import { useCallback, useMemo, useState } from "react";
import { useLocation } from "wouter";
import { UserProfileAvatar } from "@/components/UserProfileAvatar";
import { Button } from "@/components/ui/button";
import { ThumbsUp, ThumbsDown, MessageCircle, X, Loader2 } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import { navigateToLogin } from "@/lib/authReturn";
import { formatTimeAgo } from "@/lib/formatDate";
import { useAuth } from "@/contexts/AuthContext";
import { CommentActionDrawer } from "./comments/CommentActionDrawer";
import { CommentComposer } from "./comments/CommentComposer";
import { CommentList } from "./comments/CommentList";
import { CommentSortHeader } from "./comments/CommentSortHeader";
import { useCommentThread } from "./comments/useCommentThread";
import { useXpBurst } from "./XpBurstProvider";
import type { CommentAdapter, CommentItem, VoteType } from "./comments/types";
import { toast } from "sonner";

interface InsightCommentResponse {
  id: string;
  parentCommentId: string | null;
  userId: string;
  username: string | null;
  avatarUrl: string | null;
  body: string;
  createdAt: string;
  upvotes: number;
  downvotes: number;
  userVote?: VoteType | null;
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
  createdAt: string;
  upvotes: number;
  downvotes: number;
}

function getSentimentColor(vote: number): string {
  const colors = [
    "#dc2626", "#e63946", "#f97316", "#fa9c3c", "#fbbf24",
    "#c1d42d", "#84cc16", "#5bca30", "#22c55e", "#22c55e",
  ];
  return colors[vote - 1] || colors[4];
}

function flattenInsightComments(comments: InsightCommentResponse[]): InsightCommentResponse[] {
  const byId = new Map(comments.map((comment) => [comment.id, comment]));

  return comments.map((comment) => {
    if (!comment.parentCommentId) return comment;

    let flattenedParentId = comment.parentCommentId;
    let parent = byId.get(flattenedParentId);
    const visited = new Set<string>([comment.id]);

    while (parent?.parentCommentId && !visited.has(parent.id)) {
      visited.add(parent.id);
      flattenedParentId = parent.parentCommentId;
      parent = byId.get(flattenedParentId);
    }

    return {
      ...comment,
      parentCommentId: flattenedParentId,
    };
  });
}

function toCommentItem(comment: InsightCommentResponse): CommentItem {
  return {
    id: comment.id,
    userId: comment.userId,
    username: comment.username,
    avatarUrl: comment.avatarUrl,
    body: comment.body,
    parentId: comment.parentCommentId,
    upvotes: comment.upvotes ?? 0,
    downvotes: comment.downvotes ?? 0,
    userVote: comment.userVote ?? null,
    createdAt: comment.createdAt,
  };
}

function useInsightCommentsAdapter({
  insightId,
  personId,
  onXp,
}: {
  insightId: string;
  personId: string;
  onXp: (data: unknown) => void;
}): CommentAdapter {
  return useMemo<CommentAdapter>(() => ({
    queryKey: ["/api/comments", "community_insight", insightId] as const,
    fetchList: async () => {
      // Server defaults to top sort; useCommentThread re-sorts this 100-row
      // page in-memory when the UI switches sort modes.
      const res = await apiRequest("GET", `/api/comments?parentType=community_insight&parentId=${encodeURIComponent(insightId)}&limit=100`);
      const raw = (await res.json()) as InsightCommentResponse[];
      return flattenInsightComments(raw).map(toCommentItem);
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
    onPostSuccess: (data) => {
      toast("Comment Posted");
      onXp(data);
    },
    onVoteSuccess: (data) => {
      onXp(data);
    },
    supportsReplies: true,
    invalidateOnMutate: [[`/api/community-insights/${personId}`]],
  }), [insightId, personId, onXp]);
}

interface PostOverlayModalProps {
  insight: CommunityInsight | null;
  isOpen: boolean;
  onClose: () => void;
  userVote?: VoteType;
  onVote: (insightId: string, voteType: VoteType) => void;
}

export function PostOverlayModal({ insight, isOpen, onClose, userVote, onVote }: PostOverlayModalProps) {
  if (!isOpen || !insight) return null;

  return (
    <PostOverlayModalContent
      insight={insight}
      onClose={onClose}
      userVote={userVote}
      onVote={onVote}
    />
  );
}

function PostOverlayModalContent({
  insight,
  onClose,
  userVote,
  onVote,
}: {
  insight: CommunityInsight;
  onClose: () => void;
  userVote?: VoteType;
  onVote: (insightId: string, voteType: VoteType) => void;
}) {
  const { user, profile } = useAuth();
  const [, setLocation] = useLocation();
  const { trigger: triggerXpBurst } = useXpBurst();
  const [drawerComment, setDrawerComment] = useState<CommentItem | null>(null);

  const triggerXp = useCallback((data: unknown) => {
    const xp = (data as { xp?: { xpAwarded?: number; reason?: string } | null } | null)?.xp;
    if (xp?.xpAwarded) {
      triggerXpBurst(xp.xpAwarded, undefined, xp.reason);
    }
  }, [triggerXpBurst]);

  const adapter = useInsightCommentsAdapter({
    insightId: insight.id,
    personId: insight.personId,
    onXp: triggerXp,
  });
  const thread = useCommentThread(adapter);

  const netVotes = insight.upvotes - insight.downvotes;
  const hasUpvoted = userVote === "up";
  const hasDownvoted = userVote === "down";

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
            <UserProfileAvatar
              displayName={insight.username}
              avatarUrl={insight.avatarUrl}
              className="h-12 w-12 flex-shrink-0"
              fallbackClassName="text-base"
            />
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="font-semibold">{insight.username || "Anonymous"}</span>
                {insight.sentimentVote && (
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
              </div>
              <p className="mt-3 text-base leading-relaxed break-words whitespace-pre-wrap">
                {insight.content}
              </p>

              <div className="flex items-center gap-1 mt-4 pt-4 border-t border-border">
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

                <button
                  onClick={() => onVote(insight.id, "down")}
                  onPointerUp={(event) => event.currentTarget.blur()}
                  disabled={!user}
                  className={`flex items-center gap-1 text-xs transition-colors focus:outline-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-500/30 focus-visible:ring-offset-2 focus-visible:ring-offset-background ${
                    hasDownvoted
                      ? "text-cyan-600 dark:text-cyan-400 hover:text-cyan-500 dark:hover:text-cyan-300"
                      : "text-muted-foreground hover:text-rose-600 dark:hover:text-rose-400"
                  } ${!user ? "opacity-50 cursor-not-allowed" : ""}`}
                  aria-label="Downvote"
                  data-testid="button-overlay-downvote"
                >
                  <ThumbsDown className="h-3.5 w-3.5" />
                  {(insight.downvotes || 0) > 0 && <span>{insight.downvotes}</span>}
                </button>

                {netVotes !== 0 && (
                  <span className={`text-xs font-mono ${netVotes > 0 ? "text-cyan-600 dark:text-cyan-400" : "text-rose-600 dark:text-rose-400"}`}>
                    {netVotes > 0 ? `+${netVotes}` : netVotes}
                  </span>
                )}

                <div className="flex items-center gap-1 ml-4 text-muted-foreground">
                  <MessageCircle className="h-5 w-5" />
                  <span className="text-sm">{thread.comments.length}</span>
                </div>
              </div>
            </div>
          </div>
        </div>

        <div className="border-t border-border">
          <div className="p-4">
            <CommentSortHeader
              count={thread.comments.length}
              countLabel="Replies"
              variant="inline"
              sort={thread.sort}
              onSortChange={thread.setSort}
            />

            {user && (
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

            {!user && (
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
                  downvote: `button-overlay-comment-downvote-${comment.id}`,
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
        commentId={drawerComment?.id || null}
        entitySlug={insight.personId}
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
