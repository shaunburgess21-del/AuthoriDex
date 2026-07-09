import React, { useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { CommentsFocusShell } from "@/components/comments/CommentsFocusShell";
import { useLocation } from "wouter";
import { useAuth } from "@/contexts/AuthContext";
import { apiRequest, queryClient } from "@/lib/queryClient";
import {
  communityInsightsQueryKey,
  fetchCommunityInsightThread,
  fetchCommunityInsightUserVotes,
  toPersonThreadCommentItem,
  type InsightCommentResponse,
} from "@/lib/communityInsightsQuery";
import { navigateToLogin } from "@/lib/authReturn";
import { toast } from "sonner";
import { useXpBurst } from "./XpBurstProvider";
import { CommentActionDrawer } from "./comments/CommentActionDrawer";
import { CommentComposer } from "./comments/CommentComposer";
import { CommentList } from "./comments/CommentList";
import { CommentSortHeader } from "./comments/CommentSortHeader";
import { CommentSkeleton } from "./comments/CommentSkeleton";
import { DeleteContentDialog } from "./comments/DeleteContentDialog";
import { useCommentThread } from "./comments/useCommentThread";
import { useCommentDeepLink } from "./comments/useCommentDeepLink";
import { SnapDismissContext } from "@/components/snap-scroll/VoteSnapScrollView";
import type {
  CommentAdapter,
  CommentItem,
  VoteType,
} from "./comments/types";

interface CommunityInsightsProps {
  personId: string;
  personName: string;
  compact?: boolean;
  placeholder?: string;
  parentExpanded?: boolean;
  onDetail?: () => void;
  onShare?: () => void;
  /** Hide full-screen expand (e.g. snap view already expanded). */
  disableFocusMode?: boolean;
  /** Subtitle in focus shell header; defaults to personName. */
  focusContextTitle?: string | null;
  /** When false, defers insight fetch until card is near-visible in snap view. */
  fetchEnabled?: boolean;
  /** Snap scroll toolbar: compact count + centered sort toggles. */
  snapHeader?: boolean;
}

export function CommunityInsights({
  personId,
  personName,
  compact = false,
  placeholder,
  parentExpanded = false,
  onDetail,
  onShare,
  disableFocusMode = false,
  focusContextTitle,
  fetchEnabled = true,
  snapHeader = false,
}: CommunityInsightsProps) {
  const { user, isLoggedIn, profile } = useAuth();
  const [, setLocation] = useLocation();
  const { trigger: triggerXpBurst } = useXpBurst();
  const snapDismiss = useContext(SnapDismissContext);

  const composerPlaceholder = placeholder ?? `Share your thoughts on ${personName}...`;
  const postedHighlightRef = useRef<(id: string) => void>(() => {});

  const [drawerComment, setDrawerComment] = useState<CommentItem | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<CommentItem | null>(null);
  const [focusDiscussionOpen, setFocusDiscussionOpen] = useState(false);
  const discussionExpandRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (snapDismiss > 0) {
      setDrawerComment(null);
      setDeleteTarget(null);
    }
  }, [snapDismiss]);

  useEffect(() => {
    setDrawerComment(null);
    setDeleteTarget(null);
  }, [personId]);

  const adapter = useMemo<CommentAdapter>(() => ({
    queryKey: communityInsightsQueryKey(personId),
    fetchList: async () => {
      const { comments } = await fetchCommunityInsightThread(personId);
      return comments;
    },
    fetchUserVotes: async () => fetchCommunityInsightUserVotes(personId),
    postComment: async ({ body, parentId }) => {
      // Unified model: parentId on the API is always the personId.
      // parentCommentId is null for top-level posts, else the comment being replied to.
      const res = await apiRequest("POST", "/api/comments", {
        parentType: "community_insight",
        parentId: personId,
        parentCommentId: parentId,
        body,
      });
      const raw = (await res.json()) as InsightCommentResponse;
      return { ...toPersonThreadCommentItem(raw), xp: raw.xp };
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
    reportComment: async ({ commentId, reason }) => {
      const res = await apiRequest("POST", `/api/comments/${commentId}/report`, { reason });
      return res.json();
    },
    onPostSuccess: (data: unknown) => {
      const item = data as (CommentItem & { xp?: { xpAwarded?: number; reason?: string } }) | null;
      const isRoot = item?.parentId == null;
      toast(isRoot ? "Success" : "Comment Posted", {
        description: isRoot ? "Your insight has been posted!" : undefined,
      });
      if (item?.xp?.xpAwarded) {
        triggerXpBurst(item.xp.xpAwarded, undefined, item.xp.reason);
      }
      if (item?.id) postedHighlightRef.current(item.id);
      void queryClient.invalidateQueries({ queryKey: ["/api/me/comments"] });
      void queryClient.invalidateQueries({ queryKey: ["/api/profile/me"] });
    },
    onVoteSuccess: (data: unknown) => {
      const xp = (data as { xp?: { xpAwarded?: number; reason?: string } } | null)?.xp;
      if (xp?.xpAwarded) {
        triggerXpBurst(xp.xpAwarded, undefined, xp.reason);
      }
    },
    onReportSuccess: () => {
      setDrawerComment(null);
    },
    onDeleteSuccess: () => {
      setDrawerComment(null);
      setDeleteTarget(null);
      void queryClient.invalidateQueries({ queryKey: ["/api/me/comments"] });
      void queryClient.invalidateQueries({ queryKey: ["/api/profile/me"] });
    },
    supportsReplies: true,
  }), [personId, triggerXpBurst]);

  const thread = useCommentThread(adapter, { fetchEnabled });
  const { highlightedId, highlight } = useCommentDeepLink(
    fetchEnabled && !thread.isLoading && thread.comments.length > 0,
  );
  postedHighlightRef.current = highlight;
  const isAuthenticated = isLoggedIn || !!user;

  const variant = compact ? "inline" : "card";
  const rootClass =
    variant === "inline" ? "flex flex-col h-full min-h-0" : "mb-6 px-1";
  const maxHeight = "none";

  const handleVote = useCallback(
    (input: { commentId: string; voteType: VoteType }) => {
      if (!user) {
        toast.error("Login Required", {
          description: "Please log in to vote on comments",
        });
        return;
      }
      thread.vote(input);
    },
    [user, thread],
  );

  const listSection = thread.isLoading || !fetchEnabled ? (
    <CommentSkeleton />
  ) : (
    <CommentList
      threaded={thread.threaded}
      sort={thread.sort}
      variant={variant}
      maxHeight={maxHeight}
      onVote={handleVote}
      onReply={thread.startReply}
      onOpenActions={setDrawerComment}
      highlightId={highlightedId}
    />
  );

  const composerSection = isAuthenticated ? (
    <CommentComposer
      value={thread.composerBody}
      onChange={thread.setComposerBody}
      onSubmit={thread.submit}
      placeholder={composerPlaceholder}
      isPending={thread.isPostPending}
      authorAvatarUrl={profile?.avatarUrl ?? null}
      authorDisplayName={profile?.username || user?.email || ""}
      replyTo={thread.replyTo}
      onCancelReply={thread.cancelReply}
      supportsFullscreen
      parentExpanded={parentExpanded}
      variant={variant}
      maxLength={2500}
    />
  ) : (
    <SignInToDiscuss onLogin={() => navigateToLogin(setLocation)} />
  );

  return (
    <>
      <div className={rootClass} data-testid="section-community-insights">
        <CommentSortHeader
          count={fetchEnabled ? thread.visibleCount : 0}
          countLabel="Discussion"
          variant={variant}
          snapHeader={snapHeader}
          sort={thread.sort}
          onSortChange={thread.setSort}
          onDetail={onDetail}
          onShare={onShare}
          expandTriggerRef={disableFocusMode ? undefined : discussionExpandRef as React.Ref<HTMLButtonElement>}
          onOpenFocusMode={disableFocusMode ? undefined : () => setFocusDiscussionOpen(true)}
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
        onReport={
          drawerComment && !drawerComment.deletedAt
            ? (reason) => {
              thread.report({ commentId: drawerComment.id, reason });
            }
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
        entitySlug={personId}
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

      {!disableFocusMode && (
        <CommentsFocusShell
          open={focusDiscussionOpen}
          onClose={() => {
            setFocusDiscussionOpen(false);
            window.setTimeout(() => discussionExpandRef.current?.focus(), 0);
          }}
          contextTitle={focusContextTitle ?? personName}
        >
          {focusDiscussionOpen ? (
            <CommunityInsights
              personId={personId}
              personName={personName}
              compact
              disableFocusMode
              focusContextTitle={focusContextTitle ?? personName}
              placeholder={placeholder}
              parentExpanded={false}
              onDetail={onDetail}
              onShare={onShare}
            />
          ) : null}
        </CommentsFocusShell>
      )}
    </>
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
