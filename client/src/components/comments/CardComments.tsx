import { useState, useMemo, useCallback, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/contexts/AuthContext";
import { useLocation } from "wouter";
import { navigateToLogin } from "@/lib/authReturn";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { formatTimeAgo } from "@/lib/formatDate";
import { UserProfileAvatar } from "@/components/UserProfileAvatar";
import { Badge } from "@/components/ui/badge";
import {
  MessageSquare,
  ArrowUpDown,
  Clock,
  Send,
  Loader2,
  ThumbsUp,
  ThumbsDown,
  Reply,
  MoreVertical,
  Maximize2,
  Minimize2,
  X,
  ExternalLink,
  Share2,
} from "lucide-react";
import { CommentActionDrawer } from "./CommentActionDrawer";

export type CommentEntityType = "matchup" | "poll" | "opinion-poll" | "open-market";

interface CardComment {
  id: string;
  userId: string;
  username: string | null;
  avatarUrl: string | null;
  body: string;
  parentId: string | null;
  upvotes: number;
  downvotes: number;
  createdAt: string;
}

type ComposerMode = "auto" | "manual" | "fullscreen";

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
  onDetail?: () => void;
  onShare?: () => void;
}

export function CardComments({
  entityType,
  slug,
  variant = "card",
  maxHeight = "500px",
  placeholder = "Share your thoughts...",
  onDetail,
  onShare,
}: CardCommentsProps) {
  const { user, isLoggedIn, profile } = useAuth();
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [commentBody, setCommentBody] = useState("");
  const [commentSort, setCommentSort] = useState<"top" | "newest">("top");
  const [replyTo, setReplyTo] = useState<{ id: string; username: string } | null>(null);
  const [composerMode, setComposerMode] = useState<ComposerMode>("auto");
  const [drawerComment, setDrawerComment] = useState<CardComment | null>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const base = API_BASE[entityType];
  const queryKey = [base, slug, "comments"];

  const { data: comments = [] } = useQuery<CardComment[]>({
    queryKey,
    queryFn: async () => {
      const res = await fetch(`${base}/${slug}/comments`);
      if (!res.ok) return [];
      return res.json();
    },
    enabled: !!slug,
  });

  const commentMutation = useMutation({
    mutationFn: async ({ body, parentId }: { body: string; parentId?: string | null }) => {
      const res = await apiRequest("POST", `${base}/${slug}/comments`, { body, parentId: parentId || null });
      return res.json();
    },
    onSuccess: () => {
      setCommentBody("");
      setReplyTo(null);
      setComposerMode("auto");
      queryClient.invalidateQueries({ queryKey });
      if (entityType === "opinion-poll") {
        queryClient.invalidateQueries({ queryKey: [base, slug] });
      }
      toast({ title: "Comment Posted" });
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to post comment. Please sign in.", variant: "destructive" });
    },
  });

  const commentVoteMutation = useMutation({
    mutationFn: async ({ commentId, voteType }: { commentId: string; voteType: "up" | "down" }) => {
      const res = await apiRequest("POST", `${base}/comments/${commentId}/vote`, { voteType });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey });
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to vote. Please sign in.", variant: "destructive" });
    },
  });

  const reportMutation = useMutation({
    mutationFn: async ({ commentId, reason }: { commentId: string; reason: string }) => {
      const res = await apiRequest("POST", `${base}/comments/${commentId}/report`, { reason });
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Report submitted", description: "Thank you. An admin will review this comment." });
      setDrawerComment(null);
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to report. Please sign in.", variant: "destructive" });
    },
  });

  const threadedComments = useMemo(() => {
    if (!comments.length) return [];
    const topLevel = comments.filter((c) => !c.parentId);
    const replies = comments.filter((c) => !!c.parentId);

    if (commentSort === "top") {
      topLevel.sort((a, b) => (b.upvotes - b.downvotes) - (a.upvotes - a.downvotes));
    } else {
      topLevel.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    }

    const replyMap = new Map<string, CardComment[]>();
    for (const r of replies) {
      const pid = r.parentId!;
      if (!replyMap.has(pid)) replyMap.set(pid, []);
      replyMap.get(pid)!.push(r);
    }
    Array.from(replyMap.values()).forEach((arr) => {
      arr.sort((a: CardComment, b: CardComment) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
    });

    return topLevel.map((parent) => ({
      parent,
      replies: replyMap.get(parent.id) || [],
    }));
  }, [comments, commentSort]);

  const handlePost = useCallback(() => {
    if (!commentBody.trim()) return;
    commentMutation.mutate({ body: commentBody.trim(), parentId: replyTo?.id });
  }, [commentBody, replyTo, commentMutation]);

  const startReply = useCallback((comment: CardComment) => {
    setReplyTo({ id: comment.id, username: comment.username || "Anonymous" });
    setComposerMode("manual");
    setTimeout(() => inputRef.current?.focus(), 50);
  }, []);

  const isAuthenticated = isLoggedIn || !!user;

  const sortBar = (
    <div className="flex items-center gap-2 mb-3 px-1">
      <div className="flex items-center gap-2">
        <MessageSquare className="h-4 w-4 text-cyan-700 dark:text-cyan-500" />
        <span className="text-sm font-semibold">
          {variant === "card" ? `Discussion (${comments.length})` : `${comments.length} ${comments.length === 1 ? "comment" : "comments"}`}
        </span>
      </div>
      <div className="inline-flex items-center rounded-lg bg-muted/50 p-0.5">
        <button
          onClick={() => setCommentSort("top")}
          className={`relative flex items-center gap-1.5 px-3 py-1 rounded-md text-xs font-medium transition-all ${
            commentSort === "top" ? "bg-background shadow-sm text-foreground" : "text-muted-foreground"
          }`}
          data-testid="button-sort-top"
        >
          <ArrowUpDown className="h-3 w-3" />
          Top
          {commentSort === "top" && (
            <span className="absolute bottom-0 left-1 right-1 h-[2px] rounded-full bg-[#3C83F6]" />
          )}
        </button>
        <button
          onClick={() => setCommentSort("newest")}
          className={`relative flex items-center gap-1.5 px-3 py-1 rounded-md text-xs font-medium transition-all ${
            commentSort === "newest" ? "bg-background shadow-sm text-foreground" : "text-muted-foreground"
          }`}
          data-testid="button-sort-newest"
        >
          <Clock className="h-3 w-3" />
          Newest
          {commentSort === "newest" && (
            <span className="absolute bottom-0 left-1 right-1 h-[2px] rounded-full bg-[#3C83F6]" />
          )}
        </button>
      </div>
      {(onDetail || onShare) && (
        <div className="flex items-center gap-3 ml-auto">
          {onDetail && (
            <button onClick={onDetail} className="text-muted-foreground hover:text-cyan-600 dark:hover:text-cyan-400 transition-colors" data-interactive="true">
              <ExternalLink className="h-4 w-4" />
            </button>
          )}
          {onShare && (
            <button onClick={onShare} className="text-muted-foreground hover:text-cyan-600 dark:hover:text-cyan-400 transition-colors" data-interactive="true">
              <Share2 className="h-4 w-4" />
            </button>
          )}
        </div>
      )}
    </div>
  );

  const renderComment = (comment: CardComment, isTopComment: boolean, isReply: boolean) => {
    const netVotes = (comment.upvotes || 0) - (comment.downvotes || 0);
    return (
      <div
        key={comment.id}
        id={`comment-${comment.id}`}
        className={`flex gap-3 py-3 ${isReply ? "ml-8 pl-3 border-l-2 border-border/20" : ""} ${
          isTopComment ? "bg-cyan-500/8 dark:bg-cyan-500/5 px-3 rounded-lg border border-cyan-500/20" : ""
        }`}
        data-testid={`comment-${comment.id}`}
      >
        <UserProfileAvatar
          displayName={comment.username || ""}
          avatarUrl={comment.avatarUrl}
          size={isReply ? "xs" : "sm"}
          className="shrink-0"
        />
        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 flex-wrap min-w-0">
              <span className="text-sm font-semibold truncate" data-testid={`text-comment-user-${comment.id}`}>
                {comment.username || "Anonymous"}
              </span>
              <span className="text-xs text-muted-foreground shrink-0">
                {formatTimeAgo(comment.createdAt)}
              </span>
              {isTopComment && (
                <Badge variant="outline" className="text-[10px] border-cyan-500/40 dark:border-cyan-500/30 text-cyan-600 dark:text-cyan-400 py-0">
                  Top Take
                </Badge>
              )}
            </div>
            <button
              onClick={() => setDrawerComment(comment)}
              className="shrink-0 p-1 text-muted-foreground/50 hover:text-muted-foreground transition-colors"
              data-interactive="true"
            >
              <MoreVertical className="h-4 w-4" />
            </button>
          </div>
          <p className="text-sm text-muted-foreground mt-1 whitespace-pre-wrap" data-testid={`text-comment-body-${comment.id}`}>
            {comment.body}
          </p>
          <div className="flex items-center gap-4 mt-2">
            <button
              onClick={() => commentVoteMutation.mutate({ commentId: comment.id, voteType: "up" })}
              className="flex items-center gap-1 text-xs text-muted-foreground hover:text-cyan-600 dark:hover:text-cyan-400 transition-colors"
              data-testid={`button-upvote-${comment.id}`}
            >
              <ThumbsUp className="h-3.5 w-3.5" />
              {(comment.upvotes || 0) > 0 && <span>{comment.upvotes}</span>}
            </button>
            <button
              onClick={() => commentVoteMutation.mutate({ commentId: comment.id, voteType: "down" })}
              className="flex items-center gap-1 text-xs text-muted-foreground hover:text-rose-600 dark:hover:text-rose-400 transition-colors"
              data-testid={`button-downvote-${comment.id}`}
            >
              <ThumbsDown className="h-3.5 w-3.5" />
              {(comment.downvotes || 0) > 0 && <span>{comment.downvotes}</span>}
            </button>
            {!isReply && (
              <button
                onClick={() => startReply(comment)}
                className="flex items-center gap-1 text-xs text-muted-foreground hover:text-cyan-600 dark:hover:text-cyan-400 transition-colors"
                data-testid={`button-reply-${comment.id}`}
              >
                <Reply className="h-3.5 w-3.5" />
                Reply
              </button>
            )}
            {netVotes !== 0 && (
              <span className={`text-xs font-mono ${netVotes > 0 ? "text-cyan-600 dark:text-cyan-400" : "text-rose-600 dark:text-rose-400"}`}>
                {netVotes > 0 ? `+${netVotes}` : netVotes}
              </span>
            )}
          </div>
        </div>
      </div>
    );
  };

  const commentsList = threadedComments.length > 0 ? (
    <div
      className={maxHeight !== "none" ? "overflow-y-auto" : undefined}
      style={maxHeight !== "none" ? { maxHeight } : undefined}
    >
      <div className="divide-y divide-border/10">
        {threadedComments.map(({ parent, replies: threadReplies }, idx) => {
          const netVotes = (parent.upvotes || 0) - (parent.downvotes || 0);
          const isTopComment = commentSort === "top" && idx === 0 && netVotes > 0;
          return (
            <div key={parent.id}>
              {renderComment(parent, isTopComment, false)}
              {threadReplies.length > 0 && (
                <div className="pb-2">
                  {threadReplies.map((r) => renderComment(r, false, true))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  ) : (
    <p className="text-sm text-muted-foreground text-center py-6">
      No comments yet. Be the first to share your thoughts!
    </p>
  );

  const isManualComposer = composerMode === "manual";
  const isFullscreenComposer = composerMode === "fullscreen";
  const inlineExpanded = variant === "inline" && isFullscreenComposer;

  const inputArea = isAuthenticated ? (
    <div
      className={`pt-3 border-t border-border/20${inlineExpanded ? " flex-1 flex flex-col" : ""}`}
      style={{ paddingBottom: "env(safe-area-inset-bottom, 4px)" }}
    >
      {replyTo && (
        <div className="flex items-center gap-2 mb-2 px-1">
          <span className="text-xs text-cyan-600 dark:text-cyan-400">
            Replying to @{replyTo.username}
          </span>
          <button
            onClick={() => setReplyTo(null)}
            className="text-muted-foreground hover:text-foreground transition-colors"
          >
            <X className="h-3 w-3" />
          </button>
        </div>
      )}
      <div className={`flex gap-2 items-start${inlineExpanded ? " flex-1" : ""}`}>
        <div className="flex h-[42px] shrink-0 items-center">
          <UserProfileAvatar
            displayName={profile?.username || user?.email || ""}
            avatarUrl={profile?.avatarUrl}
            className="h-7 w-7"
            fallbackClassName="text-[10px]"
          />
        </div>
        <div className={`flex-1 min-w-0 relative${inlineExpanded ? " flex flex-col" : ""}`}>
          <textarea
            ref={inputRef}
            placeholder={replyTo ? `Reply to @${replyTo.username}...` : placeholder}
            value={commentBody}
            onChange={(e) => setCommentBody(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                handlePost();
              }
            }}
            className={`block w-full bg-muted/30 border border-border/30 rounded-xl px-3 py-2 pr-16 text-base resize-none placeholder:text-muted-foreground/50 focus:outline-none focus:ring-1 focus:ring-cyan-500/30${isManualComposer ? " h-40 overflow-y-auto" : ""}${inlineExpanded ? " flex-1 min-h-0" : ""}`}
            rows={1}
            data-testid="input-comment"
          />
          <div className="absolute right-2 bottom-1.5 flex items-center gap-1">
            <button
              onClick={() => setComposerMode((mode) => (mode === "auto" ? "manual" : "auto"))}
              className="p-1 text-muted-foreground/50 hover:text-muted-foreground transition-colors"
              type="button"
              aria-label={composerMode === "auto" ? "Expand comment input" : "Collapse comment input"}
              aria-pressed={composerMode !== "auto"}
            >
              {composerMode === "auto" ? <Maximize2 className="h-3.5 w-3.5" /> : <Minimize2 className="h-3.5 w-3.5" />}
            </button>
            <button
              disabled={!commentBody.trim() || commentMutation.isPending}
              onClick={handlePost}
              className="flex h-8 w-8 items-center justify-center text-cyan-600 dark:text-cyan-400 hover:text-cyan-500 dark:hover:text-cyan-300 disabled:text-muted-foreground/30 transition-colors"
              data-testid="button-submit-comment"
            >
              {commentMutation.isPending ? (
                <Loader2 className="h-6 w-6 animate-spin" />
              ) : (
                <Send className="h-6 w-6" />
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  ) : (
    <div className="text-center py-3 border-t border-border/20">
      <p className="text-sm text-muted-foreground">
        <button
          className="text-cyan-600 dark:text-cyan-400 underline hover:text-cyan-500 dark:hover:text-cyan-300 transition-colors"
          onClick={() => navigateToLogin(setLocation)}
          data-testid="link-login-to-comment"
        >
          Sign in
        </button>{" "}
        to join the discussion
      </p>
    </div>
  );

  return (
    <>
      <div className={`${variant === "inline" ? "flex flex-col h-full" : "mb-6 px-1"}`} data-testid="section-comments">
        {sortBar}
        {variant === "inline" ? (
          <>
            <div className="flex-1 min-h-0 overflow-y-auto">{commentsList}</div>
            {inputArea}
          </>
        ) : (
          <>
            {commentsList}
            {inputArea}
          </>
        )}
      </div>
      <CommentActionDrawer
        open={!!drawerComment}
        onClose={() => setDrawerComment(null)}
        onReport={(reason) => {
          if (drawerComment) {
            reportMutation.mutate({ commentId: drawerComment.id, reason });
          }
        }}
        commentId={drawerComment?.id || null}
        entitySlug={slug}
      />
    </>
  );
}

export function useCommentCount(entityType: CommentEntityType, slug: string): number {
  const base = API_BASE[entityType];
  const { data: comments = [] } = useQuery<CardComment[]>({
    queryKey: [base, slug, "comments"],
    queryFn: async () => {
      const res = await fetch(`${base}/${slug}/comments`);
      if (!res.ok) return [];
      return res.json();
    },
    enabled: !!slug,
  });
  return comments.length;
}
