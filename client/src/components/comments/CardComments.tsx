import { useMemo, useState } from "react";
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
import type { CommentAdapter, CommentItem, CommentEntityType } from "./types";

export type { CommentEntityType } from "./types";

const API_BASE: Record<CommentEntityType, string> = {
  matchup: "/api/matchups",
  poll: "/api/polls",
  "opinion-poll": "/api/opinion-polls",
  "open-market": "/api/open-markets",
};

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

  const base = API_BASE[entityType];

  const adapter = useMemo<CommentAdapter>(() => {
    const queryKey = [base, slug, "comments"] as const;
    return {
      queryKey,
      fetchList: async () => {
        const res = await apiRequest("GET", `${base}/${slug}/comments`);
        return res.json();
      },
      postComment: async ({ body, parentId }) => {
        const res = await apiRequest("POST", `${base}/${slug}/comments`, { body, parentId: parentId || null });
        return res.json();
      },
      voteComment: async ({ commentId, voteType }) => {
        const res = await apiRequest("POST", `${base}/comments/${commentId}/vote`, { voteType });
        return res.json();
      },
      reportComment: async ({ commentId, reason }) => {
        const res = await apiRequest("POST", `${base}/comments/${commentId}/report`, { reason });
        return res.json();
      },
      onPostSuccess: () => {
        toast("Comment Posted");
      },
      onReportSuccess: () => {
        setDrawerComment(null);
      },
      supportsReplies: true,
      invalidateOnMutate: entityType === "opinion-poll" ? [[base, slug]] : undefined,
    };
  }, [base, slug, entityType]);

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
        onReport={(reason) => {
          if (drawerComment) {
            thread.report({ commentId: drawerComment.id, reason });
          }
        }}
        commentId={drawerComment?.id || null}
        entitySlug={slug}
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
  const base = API_BASE[entityType];
  const { data: comments = [] } = useQuery<CommentItem[]>({
    queryKey: [base, slug, "comments"],
    queryFn: async () => {
      try {
        const res = await apiRequest("GET", `${base}/${slug}/comments`);
        return res.json();
      } catch {
        return [];
      }
    },
    enabled: !!slug,
  });
  return comments.length;
}
