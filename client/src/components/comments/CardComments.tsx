import React, { useMemo, useState, useContext, useEffect, useRef, useCallback } from "react";
import { useQuery } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/contexts/AuthContext";
import { useLocation } from "wouter";
import { navigateToLogin } from "@/lib/authReturn";
import { apiRequest } from "@/lib/queryClient";
import { CommentActionDrawer } from "./CommentActionDrawer";
import { CommentSortHeader } from "./CommentSortHeader";
import { CommentList } from "./CommentList";
import { CommentComposer } from "./CommentComposer";
import { useCommentThread } from "./useCommentThread";
import { useCommentThreadInfinite } from "./useCommentThreadInfinite";
import { DeleteContentDialog } from "./DeleteContentDialog";
import { CommentsFocusShell } from "./CommentsFocusShell";
import type { CommentAdapter, CommentItem, CommentEntityType } from "./types";
import { SnapDismissContext } from "@/components/snap-scroll/VoteSnapScrollView";

export type { CommentEntityType } from "./types";

const API_BASE: Record<CommentEntityType, string> = {
  matchup: "/api/matchups",
  poll: "/api/polls",
  "opinion-poll": "/api/opinion-polls",
  "open-market": "/api/open-markets",
};

const COMMENT_PARENT_TYPE: Record<CommentEntityType, "matchup" | "trending_poll" | "opinion_poll" | "open_market"> = {
  matchup: "matchup",
  poll: "trending_poll",
  "opinion-poll": "opinion_poll",
  "open-market": "open_market",
};

type UnifiedCommentResponse = Omit<CommentItem, "parentId"> & {
  parentCommentId: string | null;
};

function toCommentItem(comment: UnifiedCommentResponse): CommentItem {
  return {
    ...comment,
    parentId: comment.parentCommentId,
  };
}

function createCardCommentsAdapter(args: {
  parentType: "matchup" | "trending_poll" | "opinion_poll" | "open_market";
  slug: string;
  queryKey: readonly ["/api/comments", string, string];
  base: string;
  entityType: CommentEntityType;
  onModalClose: () => void;
  includePaged: boolean;
}): CommentAdapter {
  const { parentType, slug, queryKey, base, entityType, onModalClose, includePaged } = args;
  const adapter: CommentAdapter = {
    queryKey,
    fetchList: async () => {
      const res = await apiRequest(
        "GET",
        `/api/comments?parentType=${parentType}&parentSlug=${encodeURIComponent(slug)}&limit=100`,
      );
      const raw = (await res.json()) as UnifiedCommentResponse[];
      return raw.map(toCommentItem);
    },
    postComment: async ({ body, parentId }) => {
      const res = await apiRequest("POST", "/api/comments", {
        parentType,
        parentSlug: slug,
        parentCommentId: parentId || null,
        body,
      });
      return toCommentItem((await res.json()) as UnifiedCommentResponse);
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
      toast("Comment Posted");
    },
    onReportSuccess: () => {
      onModalClose();
    },
    onDeleteSuccess: () => {
      onModalClose();
    },
    supportsReplies: true,
    invalidateOnMutate: entityType === "opinion-poll" ? [[base, slug]] : undefined,
  };

  if (includePaged) {
    adapter.fetchPaged = async ({ sort, cursor }) => {
      const params = new URLSearchParams({
        parentType,
        parentSlug: slug,
        limit: "50",
        sort,
        paginated: "1",
      });
      if (cursor) params.set("cursor", cursor);
      const res = await apiRequest("GET", `/api/comments?${params}`);
      const json = (await res.json()) as { items: UnifiedCommentResponse[]; nextCursor: string | null };
      return {
        items: json.items.map(toCommentItem),
        nextCursor: json.nextCursor ?? null,
      };
    };
  }

  return adapter;
}

interface CardCommentsProps {
  entityType: CommentEntityType;
  slug: string;
  variant?: "card" | "inline";
  maxHeight?: string;
  placeholder?: string;
  parentExpanded?: boolean;
  onDetail?: () => void;
  onShare?: () => void;
  disableFocusMode?: boolean;
  focusContextTitle?: string | null;
}

function CardCommentsEmbedded({
  entityType,
  slug,
  variant,
  maxHeight,
  placeholder,
  parentExpanded,
  onDetail,
  onShare,
  expandTriggerRef,
  onOpenFocusMode,
}: {
  entityType: CommentEntityType;
  slug: string;
  variant: "card" | "inline";
  maxHeight: string;
  placeholder: string;
  parentExpanded: boolean;
  onDetail?: () => void;
  onShare?: () => void;
  expandTriggerRef?: React.RefObject<HTMLButtonElement | null>;
  onOpenFocusMode?: () => void;
}) {
  const { user, isLoggedIn, profile } = useAuth();
  const [, setLocation] = useLocation();
  const [drawerComment, setDrawerComment] = useState<CommentItem | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<CommentItem | null>(null);

  const snapDismiss = useContext(SnapDismissContext);
  useEffect(() => {
    if (snapDismiss > 0) {
      setDrawerComment(null);
      setDeleteTarget(null);
    }
  }, [snapDismiss]);

  const base = API_BASE[entityType];
  const parentType = COMMENT_PARENT_TYPE[entityType];
  const queryKey = ["/api/comments", parentType, slug] as const;

  const adapter = useMemo(
    () =>
      createCardCommentsAdapter({
        parentType,
        slug,
        queryKey,
        base,
        entityType,
        onModalClose: () => {
          setDrawerComment(null);
          setDeleteTarget(null);
        },
        includePaged: false,
      }),
    [parentType, slug, queryKey, base, entityType],
  );

  const thread = useCommentThread(adapter);
  const isAuthenticated = isLoggedIn || !!user;

  return (
    <>
      <div className={`${variant === "inline" ? "flex flex-col h-full min-h-0" : "mb-6 px-1"}`} data-testid="section-comments">
        <CommentSortHeader
          count={thread.visibleCount}
          countLabel="Discussion"
          variant={variant}
          sort={thread.sort}
          onSortChange={thread.setSort}
          onDetail={onDetail}
          onShare={onShare}
          expandTriggerRef={expandTriggerRef as React.Ref<HTMLButtonElement>}
          onOpenFocusMode={onOpenFocusMode}
        />
        {variant === "inline" ? (
          <>
            <div className="flex-1 min-h-0 overflow-y-auto">
              {thread.isLoading ? (
                <div className="flex justify-center py-12 text-muted-foreground">
                  <Loader2 className="h-8 w-8 animate-spin" />
                </div>
              ) : (
                <CommentList
                  threaded={thread.threaded}
                  sort={thread.sort}
                  variant={variant}
                  maxHeight={maxHeight}
                  onVote={thread.vote}
                  onReply={thread.startReply}
                  onOpenActions={setDrawerComment}
                />
              )}
            </div>
            {isAuthenticated ? (
              <CommentComposer
                value={thread.composerBody}
                onChange={thread.setComposerBody}
                onSubmit={thread.submit}
                placeholder={placeholder}
                isPending={thread.isPostPending}
                authorAvatarUrl={profile?.avatarUrl ?? null}
                authorDisplayName={profile?.username || user?.email || ""}
                replyTo={thread.replyTo}
                onCancelReply={thread.cancelReply}
                supportsFullscreen
                parentExpanded={parentExpanded}
                variant={variant}
              />
            ) : (
              <SignInToComment onLogin={() => navigateToLogin(setLocation)} />
            )}
          </>
        ) : (
          <>
            <CommentList
              threaded={thread.threaded}
              sort={thread.sort}
              variant={variant}
              maxHeight={maxHeight}
              onVote={thread.vote}
              onReply={thread.startReply}
              onOpenActions={setDrawerComment}
            />
            {isAuthenticated ? (
              <CommentComposer
                value={thread.composerBody}
                onChange={thread.setComposerBody}
                onSubmit={thread.submit}
                placeholder={placeholder}
                isPending={thread.isPostPending}
                authorAvatarUrl={profile?.avatarUrl ?? null}
                authorDisplayName={profile?.username || user?.email || ""}
                replyTo={thread.replyTo}
                onCancelReply={thread.cancelReply}
                supportsFullscreen
                parentExpanded={parentExpanded}
                variant={variant}
              />
            ) : (
              <SignInToComment onLogin={() => navigateToLogin(setLocation)} />
            )}
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
        entitySlug={slug}
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
    </>
  );
}

function CardCommentsFocusInner({
  entityType,
  slug,
  placeholder,
}: {
  entityType: CommentEntityType;
  slug: string;
  placeholder: string;
}) {
  const { user, isLoggedIn, profile } = useAuth();
  const [, setLocation] = useLocation();
  const [drawerComment, setDrawerComment] = useState<CommentItem | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<CommentItem | null>(null);
  const listScrollRef = useRef<HTMLDivElement>(null);
  const sentinelRef = useRef<HTMLDivElement>(null);

  const base = API_BASE[entityType];
  const parentType = COMMENT_PARENT_TYPE[entityType];
  const queryKey = ["/api/comments", parentType, slug] as const;

  const adapter = useMemo(
    () =>
      createCardCommentsAdapter({
        parentType,
        slug,
        queryKey,
        base,
        entityType,
        onModalClose: () => {
          setDrawerComment(null);
          setDeleteTarget(null);
        },
        includePaged: true,
      }),
    [parentType, slug, queryKey, base, entityType],
  );

  const thread = useCommentThreadInfinite(adapter);

  useEffect(() => {
    if (!thread.hasNextPage) return;
    const root = listScrollRef.current;
    const target = sentinelRef.current;
    if (!root || !target) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting && thread.hasNextPage && !thread.isFetchingNextPage) {
          thread.fetchNextPage();
        }
      },
      { root, rootMargin: "120px", threshold: 0 },
    );
    io.observe(target);
    return () => io.disconnect();
  }, [thread.hasNextPage, thread.isFetchingNextPage, thread.fetchNextPage]);

  const isAuthenticated = isLoggedIn || !!user;

  return (
    <>
      <div
        className="flex flex-col h-full min-h-0 px-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] md:px-4"
        data-testid="section-comments-focus"
      >
        <CommentSortHeader
          count={thread.visibleCount}
          countLabel="Discussion"
          variant="inline"
          sort={thread.sort}
          onSortChange={thread.setSort}
        />
        <div ref={listScrollRef} className="flex-1 min-h-0 overflow-y-auto">
          {thread.isLoading ? (
            <div className="flex justify-center py-12 text-muted-foreground">
              <Loader2 className="h-8 w-8 animate-spin" />
            </div>
          ) : (
            <>
              <CommentList
                threaded={thread.threaded}
                sort={thread.sort}
                variant="inline"
                maxHeight="none"
                onVote={thread.vote}
                onReply={thread.startReply}
                onOpenActions={setDrawerComment}
              />
              <div ref={sentinelRef} className="flex min-h-10 justify-center py-3">
                {thread.isFetchingNextPage ? (
                  <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                ) : null}
              </div>
            </>
          )}
        </div>
        {isAuthenticated ? (
          <CommentComposer
            value={thread.composerBody}
            onChange={thread.setComposerBody}
            onSubmit={thread.submit}
            placeholder={placeholder}
            isPending={thread.isPostPending}
            authorAvatarUrl={profile?.avatarUrl ?? null}
            authorDisplayName={profile?.username || user?.email || ""}
            replyTo={thread.replyTo}
            onCancelReply={thread.cancelReply}
            supportsFullscreen
            parentExpanded
            variant="inline"
          />
        ) : (
          <SignInToComment onLogin={() => navigateToLogin(setLocation)} />
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
        entitySlug={slug}
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
    </>
  );
}

export function CardComments({
  entityType,
  slug,
  variant = "card",
  maxHeight = "500px",
  placeholder = "Share your thoughts...",
  parentExpanded = false,
  onDetail,
  onShare,
  disableFocusMode = false,
  focusContextTitle,
}: CardCommentsProps) {
  const [focusOpen, setFocusOpen] = useState(false);
  const expandTriggerRef = useRef<HTMLButtonElement>(null);

  const handleCloseFocus = useCallback(() => {
    setFocusOpen(false);
    window.setTimeout(() => expandTriggerRef.current?.focus(), 0);
  }, []);

  return (
    <>
      <CardCommentsEmbedded
        entityType={entityType}
        slug={slug}
        variant={variant}
        maxHeight={maxHeight}
        placeholder={placeholder}
        parentExpanded={parentExpanded}
        onDetail={onDetail}
        onShare={onShare}
        expandTriggerRef={disableFocusMode ? undefined : expandTriggerRef}
        onOpenFocusMode={disableFocusMode ? undefined : () => setFocusOpen(true)}
      />
      {!disableFocusMode && (
        <CommentsFocusShell open={focusOpen} onClose={handleCloseFocus} contextTitle={focusContextTitle}>
          {focusOpen ? (
            <CardCommentsFocusInner entityType={entityType} slug={slug} placeholder={placeholder} />
          ) : null}
        </CommentsFocusShell>
      )}
    </>
  );
}

function SignInToComment({ onLogin }: { onLogin: () => void }) {
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

export function useCommentCount(entityType: CommentEntityType, slug: string): number {
  const parentType = COMMENT_PARENT_TYPE[entityType];
  const { data: comments = [] } = useQuery<CommentItem[]>({
    queryKey: ["/api/comments", parentType, slug, "count"],
    queryFn: async () => {
      try {
        const res = await apiRequest("GET", `/api/comments?parentType=${parentType}&parentSlug=${encodeURIComponent(slug)}&limit=100`);
        return res.json();
      } catch {
        return [];
      }
    },
    enabled: !!slug,
  });
  return comments.length;
}
