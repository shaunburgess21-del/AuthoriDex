import React, { useMemo, useState, useContext, useEffect, useRef, useCallback } from "react";
import { useQuery } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { useAuth } from "@/contexts/AuthContext";
import { useLocation } from "wouter";
import { navigateToLogin } from "@/lib/authReturn";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { CommentActionDrawer } from "./CommentActionDrawer";
import { CommentSortHeader } from "./CommentSortHeader";
import { CommentList } from "./CommentList";
import { CommentSkeleton } from "./CommentSkeleton";
import { CommentComposer } from "./CommentComposer";
import { useCommentThread } from "./useCommentThread";
import { useCommentThreadInfinite } from "./useCommentThreadInfinite";
import { useCommentDeepLink } from "./useCommentDeepLink";
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

/** Handles `{ items, nextCursor }` or legacy plain JSON array from GET /api/comments. */
function parseCommentsPagedResponse(json: unknown): { items: CommentItem[]; nextCursor: string | null } {
  if (Array.isArray(json)) {
    return {
      items: (json as UnifiedCommentResponse[]).map(toCommentItem),
      nextCursor: null,
    };
  }
  if (json && typeof json === "object" && "items" in json) {
    const raw = (json as { items: unknown; nextCursor?: unknown }).items;
    const items = Array.isArray(raw)
      ? (raw as UnifiedCommentResponse[]).map(toCommentItem)
      : [];
    const nc = (json as { nextCursor?: unknown }).nextCursor;
    const nextCursor = typeof nc === "string" || nc === null ? nc : null;
    return { items, nextCursor };
  }
  return { items: [], nextCursor: null };
}

function createCardCommentsAdapter(args: {
  parentType: "matchup" | "trending_poll" | "opinion_poll" | "open_market";
  slug: string;
  queryKey: readonly ["/api/comments", string, string];
  base: string;
  entityType: CommentEntityType;
  onModalClose: () => void;
  includePaged: boolean;
  onPosted?: (item: CommentItem) => void;
}): CommentAdapter {
  const { parentType, slug, queryKey, base, entityType, onModalClose, includePaged, onPosted } = args;
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
    onPostSuccess: (data) => {
      toast("Comment Posted");
      const item = data as CommentItem | undefined;
      if (item?.id) onPosted?.(item);
      // Keep the author's /me Comments tile + history in sync.
      void queryClient.invalidateQueries({ queryKey: ["/api/me/comments"] });
      void queryClient.invalidateQueries({ queryKey: ["/api/profile/me"] });
    },
    onReportSuccess: () => {
      onModalClose();
    },
    onDeleteSuccess: () => {
      onModalClose();
      void queryClient.invalidateQueries({ queryKey: ["/api/me/comments"] });
      void queryClient.invalidateQueries({ queryKey: ["/api/profile/me"] });
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
      const json: unknown = await res.json();
      return parseCommentsPagedResponse(json);
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
  /** When false, defers comment fetch until card is near-visible in snap view. */
  fetchEnabled?: boolean;
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
  fetchEnabled = true,
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
  fetchEnabled?: boolean;
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
  const queryKey = useMemo(
    () => ["/api/comments", parentType, slug] as const,
    [parentType, slug],
  );

  const postedHighlightRef = useRef<(id: string) => void>(() => {});
  const handlePosted = useCallback((item: CommentItem) => {
    postedHighlightRef.current(item.id);
  }, []);

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
        onPosted: handlePosted,
      }),
    [parentType, slug, queryKey, base, entityType, handlePosted],
  );

  const thread = useCommentThread(adapter, { fetchEnabled });
  const { highlightedId, highlight } = useCommentDeepLink(
    fetchEnabled && !thread.isLoading && thread.comments.length > 0,
  );
  postedHighlightRef.current = highlight;
  const isAuthenticated = isLoggedIn || !!user;

  return (
    <>
      <div className={`${variant === "inline" ? "flex flex-col h-full min-h-0" : "mb-6 px-1"}`} data-testid="section-comments">
        <CommentSortHeader
          count={fetchEnabled ? thread.visibleCount : 0}
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
              {thread.isLoading || !fetchEnabled ? (
                <CommentSkeleton />
              ) : (
                <CommentList
                  threaded={thread.threaded}
                  sort={thread.sort}
                  variant={variant}
                  maxHeight={maxHeight}
                  onVote={thread.vote}
                  onReply={thread.startReply}
                  onOpenActions={setDrawerComment}
                  highlightId={highlightedId}
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
              highlightId={highlightedId}
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
  const queryKey = useMemo(
    () => ["/api/comments", parentType, slug] as const,
    [parentType, slug],
  );

  const postedHighlightRef = useRef<(id: string) => void>(() => {});
  const handlePosted = useCallback((item: CommentItem) => {
    postedHighlightRef.current(item.id);
  }, []);

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
        onPosted: handlePosted,
      }),
    [parentType, slug, queryKey, base, entityType, handlePosted],
  );

  const thread = useCommentThreadInfinite(adapter);
  const { highlightedId, highlight } = useCommentDeepLink(!thread.isLoading && thread.comments.length > 0);
  postedHighlightRef.current = highlight;

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
        className="flex flex-col h-full min-h-0 pb-[max(0.75rem,env(safe-area-inset-bottom))]"
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
            <CommentSkeleton rows={5} />
          ) : thread.isError ? (
            <div className="flex flex-col items-center justify-center gap-3 py-12 px-4 text-center">
              <p className="text-sm text-muted-foreground">
                Could not load comments. Check your connection and try again.
              </p>
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={() => thread.refetch()}
                disabled={thread.isRefetching}
              >
                {thread.isRefetching ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Retrying…
                  </>
                ) : (
                  "Retry"
                )}
              </Button>
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
                highlightId={highlightedId}
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
  fetchEnabled = true,
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
        fetchEnabled={fetchEnabled}
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

/**
 * Standalone full-screen discussion overlay for the same thread used on detail
 * pages. Reuses CommentsFocusShell + CardCommentsFocusInner (same query key per
 * slug), so comments posted here mirror the detail page and vice versa.
 */
export function CardCommentsFocusOverlay({
  open,
  onClose,
  entityType,
  slug,
  contextTitle,
  placeholder = "Share your thoughts...",
}: {
  open: boolean;
  onClose: () => void;
  entityType: CommentEntityType;
  slug: string;
  contextTitle?: string | null;
  placeholder?: string;
}) {
  return (
    <CommentsFocusShell open={open} onClose={onClose} contextTitle={contextTitle}>
      {open ? (
        <CardCommentsFocusInner entityType={entityType} slug={slug} placeholder={placeholder} />
      ) : null}
    </CommentsFocusShell>
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
