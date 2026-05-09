import { useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import {
  Loader2,
  MoreVertical,
  Reply,
  ThumbsDown,
  ThumbsUp,
} from "lucide-react";
import { useLocation } from "wouter";
import { Badge } from "@/components/ui/badge";
import { UserProfileAvatar } from "@/components/UserProfileAvatar";
import { VoteLabel } from "@/components/VoteLabel";
import { useAuth } from "@/contexts/AuthContext";
import { apiRequest } from "@/lib/queryClient";
import { navigateToLogin } from "@/lib/authReturn";
import { formatTimeAgo } from "@/lib/formatDate";
import { toast } from "sonner";
import { useXpBurst } from "./XpBurstProvider";
import { PostOverlayModal } from "./PostOverlayModal";
import { CommentActionDrawer } from "./comments/CommentActionDrawer";
import { CommentComposer } from "./comments/CommentComposer";
import { CommentSortHeader } from "./comments/CommentSortHeader";
import { DeleteContentDialog } from "./comments/DeleteContentDialog";
import { useCommentThread } from "./comments/useCommentThread";
import { SnapDismissContext } from "@/components/snap-scroll/VoteSnapScrollView";
import type {
  CommentAdapter,
  CommentItem,
  ParentVoteLabel,
  VoteType,
} from "./comments/types";

const PAGE_SIZE = 4;

const EMPTY_DISCUSSION_MESSAGE =
  "No comments yet. Be the first to share your thoughts!";

function getSentimentColor(vote: number): string {
  const colors = [
    "#dc2626", "#e63946", "#f97316", "#fa9c3c", "#fbbf24",
    "#c1d42d", "#84cc16", "#5bca30", "#22c55e", "#22c55e",
  ];
  return colors[vote - 1] || colors[4];
}

function truncateText(text: string, limit: number): { preview: string; isTruncated: boolean } {
  if (text.length <= limit) {
    return { preview: text, isTruncated: false };
  }
  return { preview: text.substring(0, limit), isTruncated: true };
}

/**
 * Server-side insight shape (the raw GET /api/community-insights/:personId
 * response). We keep this in a ref-cache so InsightCard can read insight-only
 * metadata (sentimentVote) without polluting CommentItem with surface-specific
 * fields. The PostOverlayModal also accepts this shape via its `insight` prop
 * (preserved from C3-untouched modal contract).
 */
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

interface CommunityInsightsProps {
  personId: string;
  personName: string;
  compact?: boolean;
  placeholder?: string;
  parentExpanded?: boolean;
  onDetail?: () => void;
  onShare?: () => void;
}

export function CommunityInsights({
  personId,
  personName: _personName,
  compact = false,
  placeholder = "Share your thoughts on this topic...",
  parentExpanded = false,
  onDetail,
  onShare,
}: CommunityInsightsProps) {
  const { user, isLoggedIn, profile } = useAuth();
  const [, setLocation] = useLocation();
  const { trigger: triggerXpBurst } = useXpBurst();
  const snapDismiss = useContext(SnapDismissContext);

  // Insight-only metadata cache. Populated synchronously inside `fetchList`
  // every time the query refetches (initial, post-mutation invalidations).
  // NEVER read upvotes/downvotes/userVote from this ref — those live on the
  // CommentItem in thread.comments and are mutated optimistically by
  // useCommentThread. See InsightCard's render-boundary comment.
  const insightsCacheRef = useRef<Record<string, CommunityInsight>>({});

  const [drawerComment, setDrawerComment] = useState<CommentItem | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<CommentItem | null>(null);
  const [selectedInsightId, setSelectedInsightId] = useState<string | null>(null);
  const [expandedPosts, setExpandedPosts] = useState<Set<string>>(new Set());
  const [displayCount, setDisplayCount] = useState(PAGE_SIZE);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const isLoadingMoreRef = useRef(false);
  const loadMoreRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (snapDismiss > 0) {
      setDrawerComment(null);
      setDeleteTarget(null);
      setSelectedInsightId(null);
    }
  }, [snapDismiss]);

  useEffect(() => {
    setDisplayCount(PAGE_SIZE);
    setExpandedPosts(new Set());
    setSelectedInsightId(null);
    setDrawerComment(null);
    setDeleteTarget(null);
  }, [personId]);

  const adapter = useMemo<CommentAdapter>(() => ({
    queryKey: [`/api/community-insights/${personId}`] as const,
    fetchList: async () => {
      const res = await apiRequest("GET", `/api/community-insights/${personId}`);
      const raw = (await res.json()) as CommunityInsight[];
      insightsCacheRef.current = Object.fromEntries(raw.map((i) => [i.id, i]));
      return raw.map<CommentItem>((i) => ({
        id: i.id,
        userId: i.userId,
        username: i.username,
        avatarUrl: i.avatarUrl,
        body: i.content,
        parentId: null,
        upvotes: i.upvotes ?? 0,
        downvotes: i.downvotes ?? 0,
        userVote: null,
        deletedAt: i.deletedAt,
        parentVoteLabel: i.parentVoteLabel ?? null,
        createdAt: i.createdAt,
      }));
    },
    fetchUserVotes: async () => {
      const res = await apiRequest(
        "GET",
        `/api/community-insights/${personId}/votes`,
      );
      return (await res.json()) as Record<string, VoteType>;
    },
    postComment: async ({ body }) => {
      const res = await apiRequest("POST", "/api/community-insights", {
        personId,
        content: body,
      });
      return res.json();
    },
    voteComment: async ({ commentId, voteType }) => {
      const res = await apiRequest(
        "POST",
        `/api/community-insights/${commentId}/vote`,
        { voteType },
      );
      return res.json();
    },
    deleteComment: async ({ commentId }) => {
      const res = await apiRequest("DELETE", `/api/community-insights/${commentId}`);
      return res.json();
    },
    onPostSuccess: (data: unknown) => {
      const xp = (data as { xp?: { xpAwarded?: number; reason?: string } } | null)?.xp;
      toast("Success", { description: "Your insight has been posted!" });
      if (xp?.xpAwarded) {
        triggerXpBurst(xp.xpAwarded, undefined, xp.reason);
      }
    },
    onVoteSuccess: (data: unknown) => {
      const xp = (data as { xp?: { xpAwarded?: number; reason?: string } } | null)?.xp;
      if (xp?.xpAwarded) {
        triggerXpBurst(xp.xpAwarded, undefined, xp.reason);
      }
    },
    onDeleteSuccess: () => {
      setDrawerComment(null);
      setDeleteTarget(null);
    },
    supportsReplies: false,
  }), [personId, triggerXpBurst]);

  const thread = useCommentThread(adapter);
  const isAuthenticated = isLoggedIn || !!user;

  const variant = compact ? "inline" : "card";
  const rootClass =
    variant === "inline" ? "flex flex-col h-full" : "mb-6 px-1";

  const totalCount = thread.threaded.length;
  const displayedThread = thread.threaded.slice(0, displayCount);
  const hasMore = totalCount > displayCount;

  const loadMore = useCallback(() => {
    if (isLoadingMoreRef.current) return;
    isLoadingMoreRef.current = true;
    setIsLoadingMore(true);
    window.setTimeout(() => {
      setDisplayCount((prev) => Math.min(prev + PAGE_SIZE, totalCount));
      setIsLoadingMore(false);
      isLoadingMoreRef.current = false;
    }, 300);
  }, [totalCount]);

  useEffect(() => {
    const currentRef = loadMoreRef.current;
    if (!currentRef) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (
          entries[0].isIntersecting &&
          !isLoadingMoreRef.current &&
          displayCount < totalCount
        ) {
          loadMore();
        }
      },
      { threshold: 0.1 },
    );
    observer.observe(currentRef);
    return () => observer.disconnect();
  }, [loadMore, displayCount, totalCount]);

  const toggleExpanded = useCallback((id: string) => {
    setExpandedPosts((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }, []);

  const selectedInsight = useMemo<CommunityInsight | null>(() => {
    if (!selectedInsightId) return null;
    const cached = insightsCacheRef.current[selectedInsightId];
    if (!cached) return null;
    const live = thread.comments.find((c) => c.id === selectedInsightId);
    if (!live) return cached;
    return {
      ...cached,
      username: live.username,
      avatarUrl: live.avatarUrl,
      content: live.body,
      deletedAt: live.deletedAt ?? cached.deletedAt ?? null,
      upvotes: live.upvotes,
      downvotes: live.downvotes,
      parentVoteLabel: live.parentVoteLabel ?? cached.parentVoteLabel ?? null,
    };
  }, [selectedInsightId, thread.comments]);

  const selectedInsightUserVote = useMemo<VoteType | undefined>(() => {
    if (!selectedInsightId) return undefined;
    const live = thread.comments.find((c) => c.id === selectedInsightId);
    return live?.userVote ?? undefined;
  }, [selectedInsightId, thread.comments]);

  const handleModalVote = useCallback(
    (insightId: string, voteType: "up" | "down") => {
      if (!user) {
        toast.error("Login Required", {
          description: "Please log in to vote on insights",
        });
        return;
      }
      thread.vote({ commentId: insightId, voteType });
    },
    [user, thread],
  );

  const listSection = (
    <>
      {totalCount === 0 ? (
        <p className="text-sm text-muted-foreground text-center py-6">
          {EMPTY_DISCUSSION_MESSAGE}
        </p>
      ) : (
        <div className="divide-y divide-border/10">
          {displayedThread.map(({ root }, idx) => {
            const netVotes = (root.upvotes || 0) - (root.downvotes || 0);
            const isTopComment =
              thread.sort === "top" && idx === 0 && netVotes > 0;
            return (
              <InsightCard
                key={root.id}
                comment={root}
                insight={insightsCacheRef.current[root.id]}
                isTopComment={isTopComment}
                isExpanded={expandedPosts.has(root.id)}
                onToggleExpanded={() => toggleExpanded(root.id)}
                onOpenOverlay={() => setSelectedInsightId(root.id)}
                onVote={(voteType) => {
                  if (!user) {
                    toast.error("Login Required", {
                      description: "Please log in to vote on insights",
                    });
                    return;
                  }
                  thread.vote({ commentId: root.id, voteType });
                }}
                onOpenActions={() => setDrawerComment(root)}
                disabled={!user}
              />
            );
          })}
        </div>
      )}

      {hasMore && (
        <div
          ref={loadMoreRef}
          className="flex justify-center py-6"
          data-testid="infinite-scroll-trigger"
        >
          {isLoadingMore && (
            <div className="flex items-center gap-2 text-muted-foreground">
              <Loader2 className="h-5 w-5 animate-spin" />
              <span className="text-sm">Loading more...</span>
            </div>
          )}
        </div>
      )}

      {!hasMore && totalCount > 0 && (
        <div className="flex justify-center py-6 text-muted-foreground text-sm">
          You&apos;ve seen all {totalCount}{" "}
          {totalCount === 1 ? "comment" : "comments"}
        </div>
      )}
    </>
  );

  const composerSection = isAuthenticated ? (
    <CommentComposer
      value={thread.composerBody}
      onChange={thread.setComposerBody}
      onSubmit={thread.submit}
      placeholder={placeholder}
      isPending={thread.isPostPending}
      authorAvatarUrl={profile?.avatarUrl ?? null}
      authorDisplayName={profile?.username || user?.email || ""}
      replyTo={null}
      onCancelReply={() => {}}
      supportsFullscreen
      parentExpanded={parentExpanded}
      variant={variant}
    />
  ) : (
    <SignInToDiscuss onLogin={() => navigateToLogin(setLocation)} />
  );

  if (thread.isLoading) {
    return (
      <div
        className={rootClass}
        data-testid="section-community-insights"
      >
        <div
          className={`flex items-center justify-center py-8 ${variant === "inline" ? "flex-1" : ""}`}
        >
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          <span className="ml-2 text-muted-foreground">Loading...</span>
        </div>
      </div>
    );
  }

  return (
    <>
      <div className={rootClass} data-testid="section-community-insights">
        <CommentSortHeader
          count={thread.visibleCount}
          countLabel="Discussion"
          variant={variant}
          sort={thread.sort}
          onSortChange={thread.setSort}
          onDetail={onDetail}
          onShare={onShare}
        />
        {variant === "inline" ? (
          <>
            <div className="flex-1 min-h-0 overflow-y-auto">{listSection}</div>
            {composerSection}
          </>
        ) : (
          <>
            {listSection}
            {composerSection}
          </>
        )}
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
        entitySlug={personId}
      />
      <DeleteContentDialog
        open={!!deleteTarget}
        onOpenChange={(open) => {
          if (!open) setDeleteTarget(null);
        }}
        description="Delete this insight? This cannot be undone."
        isPending={thread.isDeletePending}
        onConfirm={() => {
          if (deleteTarget) {
            thread.deleteComment({ commentId: deleteTarget.id });
          }
        }}
      />

      <PostOverlayModal
        insight={selectedInsight}
        isOpen={!!selectedInsight}
        onClose={() => setSelectedInsightId(null)}
        userVote={selectedInsightUserVote}
        onVote={handleModalVote}
        onDeleteInsight={(insightId) => thread.deleteComment({ commentId: insightId })}
        isDeletingInsight={thread.isDeletePending}
      />
    </>
  );
}

interface InsightCardProps {
  comment: CommentItem;
  insight: CommunityInsight | undefined;
  isTopComment: boolean;
  isExpanded: boolean;
  onToggleExpanded: () => void;
  onOpenOverlay: () => void;
  onVote: (voteType: VoteType) => void;
  onOpenActions: () => void;
  disabled: boolean;
}

function InsightCard({
  comment,
  insight,
  isTopComment,
  isExpanded,
  onToggleExpanded,
  onOpenOverlay,
  onVote,
  onOpenActions,
  disabled,
}: InsightCardProps) {
  const upvotes = comment.upvotes || 0;
  const downvotes = comment.downvotes || 0;
  const netVotes = upvotes - downvotes;
  const hasUpvoted = comment.userVote === "up";
  const hasDownvoted = comment.userVote === "down";
  const isDeleted = Boolean(comment.deletedAt);

  const sentimentVote = isDeleted ? null : insight?.sentimentVote ?? null;
  const { preview, isTruncated } = isDeleted
    ? { preview: "[deleted]", isTruncated: false }
    : truncateText(comment.body, 280);

  return (
    <div
      id={`insight-${comment.id}`}
      className="flex gap-3 py-3"
      data-testid={`card-insight-${comment.id}`}
    >
      {!isDeleted && (
        <UserProfileAvatar
          displayName={comment.username || ""}
          avatarUrl={comment.avatarUrl}
          size="sm"
          className="shrink-0"
        />
      )}
      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 flex-wrap min-w-0">
            <span
              className={`text-sm truncate ${isDeleted ? "italic text-muted-foreground" : "font-semibold"}`}
              data-testid={`text-username-${comment.id}`}
            >
              {isDeleted ? "[deleted user]" : comment.username || "Anonymous"}
            </span>
            <span
              className="text-xs text-muted-foreground shrink-0"
              data-testid={`text-timestamp-${comment.id}`}
            >
              {formatTimeAgo(comment.createdAt)}
            </span>
            {!isDeleted && <VoteLabel label={comment.parentVoteLabel ?? null} />}
            {sentimentVote && (
              <span
                className="text-xs px-2 py-0.5 rounded-full backdrop-blur-sm border"
                style={{
                  backgroundColor: `${getSentimentColor(sentimentVote)}15`,
                  color: getSentimentColor(sentimentVote),
                  borderColor: `${getSentimentColor(sentimentVote)}40`,
                  boxShadow: `0 0 8px ${getSentimentColor(sentimentVote)}20`,
                }}
                data-testid={`badge-sentiment-${comment.id}`}
              >
                Voted {sentimentVote}/10
              </span>
            )}
            {isTopComment && (
              <Badge
                variant="outline"
                className="text-[10px] border-cyan-500/40 dark:border-cyan-500/30 text-cyan-600 dark:text-cyan-400 py-0"
                data-testid={`badge-rank-${comment.id}`}
              >
                Top Take
              </Badge>
            )}
          </div>
          <button
            onClick={onOpenActions}
            className="shrink-0 p-1 text-muted-foreground/50 hover:text-muted-foreground transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            data-interactive="true"
            aria-label="Insight actions"
          >
            <MoreVertical className="h-4 w-4" />
          </button>
        </div>
        <p
          className={`text-sm text-muted-foreground mt-1 whitespace-pre-wrap ${isDeleted ? "italic" : ""}`}
          data-testid={`text-content-${comment.id}`}
        >
          {isDeleted ? preview : isExpanded ? comment.body : preview}
          {isTruncated && !isExpanded && "..."}
        </p>
        {isTruncated && !isDeleted && (
          <button
            onClick={onToggleExpanded}
            className="text-xs text-primary hover:underline mt-1"
            data-testid={`button-toggle-${comment.id}`}
          >
            {isExpanded ? "Show Less" : "Show More"}
          </button>
        )}
        <div className="flex items-center gap-4 mt-2">
          {!isDeleted && (
            <>
              <button
                onClick={() => onVote("up")}
                onPointerUp={(event) => event.currentTarget.blur()}
                disabled={disabled}
                className={`flex items-center gap-1 text-xs transition-colors focus:outline-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-500/30 focus-visible:ring-offset-2 focus-visible:ring-offset-background ${
                  hasUpvoted
                    ? "text-cyan-600 dark:text-cyan-400 hover:text-cyan-500 dark:hover:text-cyan-300"
                    : "text-muted-foreground hover:text-cyan-600 dark:hover:text-cyan-400"
                } ${disabled ? "opacity-50 cursor-not-allowed" : ""}`}
                data-testid={`button-upvote-${comment.id}`}
              >
                <ThumbsUp className="h-3.5 w-3.5" />
                {upvotes > 0 && <span>{upvotes}</span>}
              </button>
              <button
                onClick={() => onVote("down")}
                onPointerUp={(event) => event.currentTarget.blur()}
                disabled={disabled}
                className={`flex items-center gap-1 text-xs transition-colors focus:outline-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-500/30 focus-visible:ring-offset-2 focus-visible:ring-offset-background ${
                  hasDownvoted
                    ? "text-cyan-600 dark:text-cyan-400 hover:text-cyan-500 dark:hover:text-cyan-300"
                    : "text-muted-foreground hover:text-rose-600 dark:hover:text-rose-400"
                } ${disabled ? "opacity-50 cursor-not-allowed" : ""}`}
                data-testid={`button-downvote-${comment.id}`}
              >
                <ThumbsDown className="h-3.5 w-3.5" />
                {downvotes > 0 && <span>{downvotes}</span>}
              </button>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onOpenOverlay();
                }}
                disabled={disabled}
                className={`flex items-center gap-1 text-xs text-muted-foreground hover:text-cyan-600 dark:hover:text-cyan-400 transition-colors focus:outline-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-500/30 focus-visible:ring-offset-2 focus-visible:ring-offset-background ${disabled ? "opacity-50 cursor-not-allowed" : ""}`}
                data-testid={`button-reply-${comment.id}`}
                aria-label="Reply in thread"
              >
                <Reply className="h-3.5 w-3.5" />
                Reply
              </button>
            </>
          )}
          {netVotes !== 0 && (
            <span
              className={isDeleted
                ? "text-xs text-muted-foreground"
                : `text-xs font-mono ${
                  netVotes > 0
                    ? "text-cyan-600 dark:text-cyan-400"
                    : "text-rose-600 dark:text-rose-400"
                }`}
              data-testid={`text-netvotes-${comment.id}`}
            >
              {netVotes > 0 ? `+${netVotes}` : netVotes}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

function SignInToDiscuss({ onLogin }: { onLogin: () => void }) {
  return (
    <div className="text-center py-3 border-t border-border/20">
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
