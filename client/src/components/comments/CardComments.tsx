import { useMemo, useState, useContext, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
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
import { DeleteContentDialog } from "./DeleteContentDialog";
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

interface CardCommentsProps {
  entityType: CommentEntityType;
  slug: string;
  variant?: "card" | "inline";
  maxHeight?: string;
  placeholder?: string;
  parentExpanded?: boolean;
  onDetail?: () => void;
  onShare?: () => void;
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
}: CardCommentsProps) {
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

  const adapter = useMemo<CommentAdapter>(() => {
    const queryKey = ["/api/comments", parentType, slug] as const;
    return {
      queryKey,
      fetchList: async () => {
        // Server defaults to top sort; useCommentThread re-sorts this 100-row
        // page in-memory when the UI switches sort modes.
        const res = await apiRequest("GET", `/api/comments?parentType=${parentType}&parentSlug=${encodeURIComponent(slug)}&limit=100`);
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
        setDrawerComment(null);
      },
      onDeleteSuccess: () => {
        setDrawerComment(null);
        setDeleteTarget(null);
      },
      supportsReplies: true,
      invalidateOnMutate: entityType === "opinion-poll" ? [[base, slug]] : undefined,
    };
  }, [base, slug, entityType, parentType]);

  const thread = useCommentThread(adapter);

  const isAuthenticated = isLoggedIn || !!user;

  return (
    <>
      <div className={`${variant === "inline" ? "flex flex-col h-full" : "mb-6 px-1"}`} data-testid="section-comments">
        <CommentSortHeader
          count={thread.comments.length}
          countLabel="Discussion"
          variant={variant}
          sort={thread.sort}
          onSortChange={thread.setSort}
          onDetail={onDetail}
          onShare={onShare}
        />
        {variant === "inline" ? (
          <>
            <div className="flex-1 min-h-0 overflow-y-auto">
              <CommentList
                threaded={thread.threaded}
                sort={thread.sort}
                variant={variant}
                maxHeight={maxHeight}
                onVote={thread.vote}
                onReply={thread.startReply}
                onOpenActions={setDrawerComment}
              />
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
