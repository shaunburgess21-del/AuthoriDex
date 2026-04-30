import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Loader2,
  MessageCircle,
  MoreVertical,
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
import type {
  CommentAdapter,
  CommentItem,
  ParentVoteLabel,
  VoteType,
} from "./comments/types";

const PAGE_SIZE = 4;

function getSentimentColor(vote: number): string {
  const colors = [
    "#dc2626", "#e63946", "#f97316", "#fa9c3c", "#fbbf24",
    "#c1d42d", "#84cc16", "#5bca30", "#22c55e", "#22c55e",
  ];
  return colors[vote - 1] || colors[4];
}

/**
 * Left-border accent colour for the top-3 ranked insights. Returns null for
 * ranks 4+ which render as plain borderless rows. Replaces the previous
 * full bordered-box + glow chrome with a 4 px left-border-only accent —
 * preserves the rank semantic without the "card" chrome that diverged from
 * CardComments. See commit body for the visual decision.
 */
function getRankAccentColor(rank: number): string | null {
  if (rank === 1) return "rgba(245, 158, 11, 0.6)"; // gold
  if (rank === 2) return "rgba(148, 163, 184, 0.6)"; // silver
  if (rank === 3) return "rgba(234, 88, 12, 0.6)"; // bronze
  return null;
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
}

export function CommunityInsights({ personId, personName, compact = false }: CommunityInsightsProps) {
  const { user, isLoggedIn, profile } = useAuth();
  const [, setLocation] = useLocation();
  const { trigger: triggerXpBurst } = useXpBurst();

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

  // Rank-by-net-votes map — computed across the FULL list regardless of which
  // sort tab is active. Preserves the historical "this is the all-time
  // leaderboard top" semantics for the gold/silver/bronze rank borders even
  // when the user is viewing the feed in Newest order.
  const ranksById = useMemo<Record<string, number>>(() => {
    const sorted = [...thread.comments].sort((a, b) => {
      const aNet = (a.upvotes || 0) - (a.downvotes || 0);
      const bNet = (b.upvotes || 0) - (b.downvotes || 0);
      if (aNet !== bNet) return bNet - aNet;
      return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
    });
    const map: Record<string, number> = {};
    sorted.forEach((c, idx) => {
      map[c.id] = idx + 1;
    });
    return map;
  }, [thread.comments]);

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

  // Live-derived insight for the modal: merges the immutable metadata from
  // insightsCacheRef with the live vote counts from thread.comments. This
  // gives the modal optimistic vote feedback without storing a stale snapshot.
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

  if (thread.isLoading) {
    return (
      <div>
        {!compact && (
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-2xl font-serif font-bold">Community Insights</h2>
          </div>
        )}
        <div className="flex items-center justify-center py-8">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          <span className="ml-2 text-muted-foreground">
            Loading insights...
          </span>
        </div>
      </div>
    );
  }

  return (
    <div>
      {!compact && (
        <div className="flex items-center justify-between mb-6">
          <h2
            className="text-2xl font-serif font-bold"
            data-testid="text-community-insights-title"
          >
            Community Insights
          </h2>
        </div>
      )}

      <div className="max-w-2xl mx-auto">
        {/* Composer at top — matches original CommunityInsights placement and
            the "contribute then browse" social-feed convention (Reddit, X
            reply composer, LinkedIn). CardComments puts its composer at the
            bottom because the user reads the entity card above it first;
            different surface, different convention. */}
        {isAuthenticated ? (
          <CommentComposer
            value={thread.composerBody}
            onChange={thread.setComposerBody}
            onSubmit={thread.submit}
            placeholder={`What are your thoughts on ${personName}?`}
            isPending={thread.isPostPending}
            authorAvatarUrl={profile?.avatarUrl ?? null}
            authorDisplayName={profile?.username || user?.email || ""}
            replyTo={null}
            onCancelReply={() => {}}
            supportsFullscreen
            variant="card"
          />
        ) : (
          <SignInToShare onLogin={() => navigateToLogin(setLocation)} />
        )}

        <div className="mt-6">
          <CommentSortHeader
            count={totalCount}
            countLabel="Insights"
            sort={thread.sort}
            onSortChange={thread.setSort}
          />
        </div>

        <div className="space-y-4">
          {totalCount === 0 ? (
            <div className="p-8 text-center border rounded-md border-border">
              <p className="text-muted-foreground">
                No insights yet. Be the first to share your thoughts on{" "}
                {personName}!
              </p>
            </div>
          ) : (
            displayedThread.map(({ parent }) => (
              <InsightCard
                key={parent.id}
                comment={parent}
                insight={insightsCacheRef.current[parent.id]}
                rank={ranksById[parent.id] ?? 0}
                isExpanded={expandedPosts.has(parent.id)}
                onToggleExpanded={() => toggleExpanded(parent.id)}
                onOpenOverlay={() => setSelectedInsightId(parent.id)}
                onVote={(voteType) => {
                  if (!user) {
                    toast.error("Login Required", {
                      description: "Please log in to vote on insights",
                    });
                    return;
                  }
                  thread.vote({ commentId: parent.id, voteType });
                }}
                onOpenActions={() => setDrawerComment(parent)}
                disabled={!user}
              />
            ))
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
                  <span className="text-sm">Loading more insights...</span>
                </div>
              )}
            </div>
          )}

          {!hasMore && totalCount > 0 && (
            <div className="flex justify-center py-6 text-muted-foreground text-sm">
              You've seen all {totalCount} {totalCount === 1 ? "insight" : "insights"}
            </div>
          )}
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
    </div>
  );
}

interface InsightCardProps {
  comment: CommentItem;
  insight: CommunityInsight | undefined;
  rank: number;
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
  rank,
  isExpanded,
  onToggleExpanded,
  onOpenOverlay,
  onVote,
  onOpenActions,
  disabled,
}: InsightCardProps) {
  // RENDER BOUNDARY (do not move):
  //   Vote-related fields (upvotes / downvotes / userVote) read from `comment`
  //   (the CommentItem in thread.comments). useCommentThread's optimistic
  //   mutations update those values synchronously when the user clicks vote.
  //
  //   Insight-only metadata (sentimentVote, personId) reads from `insight`
  //   (the raw cache populated inside the adapter's fetchList). The cache only
  //   updates on full refetch — never read vote fields from it or you'll
  //   render stale counts after optimistic updates.
  const upvotes = comment.upvotes || 0;
  const downvotes = comment.downvotes || 0;
  const netVotes = upvotes - downvotes;
  const hasUpvoted = comment.userVote === "up";
  const hasDownvoted = comment.userVote === "down";
  const isDeleted = Boolean(comment.deletedAt);

  const sentimentVote = isDeleted ? null : insight?.sentimentVote ?? null;
  const rankAccentColor = getRankAccentColor(rank);
  const isTopThree = !isDeleted && rankAccentColor !== null;
  const { preview, isTruncated } = isDeleted
    ? { preview: "[deleted]", isTruncated: false }
    : truncateText(comment.body, 280);

  return (
    <div
      id={`insight-${comment.id}`}
      className={`flex gap-3 py-3 ${isTopThree ? "border-l-4 pl-3" : ""}`}
      style={isTopThree ? { borderLeftColor: rankAccentColor } : undefined}
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
            {rank === 1 && (
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
            className="shrink-0 p-1 text-muted-foreground/50 hover:text-muted-foreground transition-colors"
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
          {/* Vote-button JSX deliberately mirrors CommentRow.tsx (cyan
              optimistic pattern). C3-locked decision: honest duplication
              instead of extracting a CommentVoteButtons primitive. */}
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
          <button
            onClick={(e) => {
              e.stopPropagation();
              onOpenOverlay();
            }}
            className="flex items-center gap-1.5 p-1.5 ml-auto rounded-md text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-all focus:outline-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-500/30 focus-visible:ring-offset-2 focus-visible:ring-offset-background"
            data-testid={`button-comments-${comment.id}`}
            aria-label="Open comments"
          >
            <MessageCircle className="h-4 w-4" />
          </button>
        </div>
      </div>
    </div>
  );
}

function SignInToShare({ onLogin }: { onLogin: () => void }) {
  return (
    <div className="text-center py-3 border-t border-border/20">
      <p className="text-sm text-muted-foreground">
        <button
          className="text-cyan-600 dark:text-cyan-400 underline hover:text-cyan-500 dark:hover:text-cyan-300 transition-colors"
          onClick={onLogin}
          data-testid="link-login-to-share-insight"
        >
          Sign in
        </button>{" "}
        to share an insight
      </p>
    </div>
  );
}
