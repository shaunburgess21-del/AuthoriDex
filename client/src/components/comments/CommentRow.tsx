import { ThumbsUp, ThumbsDown, Reply, MoreVertical } from "lucide-react";
import { UserProfileAvatar } from "@/components/UserProfileAvatar";
import { Badge } from "@/components/ui/badge";
import { formatTimeAgo } from "@/lib/formatDate";
import type { CommentItem, VoteType } from "./types";

export interface CommentRowProps {
  comment: CommentItem;
  isReply: boolean;
  isTopComment: boolean;
  showReplyButton: boolean;
  onVote: (voteType: VoteType) => void;
  onReply?: () => void;
  onOpenActions: () => void;
  testIds?: {
    root?: string;
    upvote?: string;
    downvote?: string;
    reply?: string;
  };
}

export function CommentRow({
  comment,
  isReply,
  isTopComment,
  showReplyButton,
  onVote,
  onReply,
  onOpenActions,
  testIds,
}: CommentRowProps) {
  const netVotes = (comment.upvotes || 0) - (comment.downvotes || 0);
  const hasUpvoted = comment.userVote === "up";
  const hasDownvoted = comment.userVote === "down";

  return (
    <div
      id={`comment-${comment.id}`}
      className={`flex gap-3 py-3 ${isReply ? "ml-8 pl-3 border-l-2 border-border/20" : ""} ${
        isTopComment ? "bg-cyan-500/8 dark:bg-cyan-500/5 px-3 rounded-lg border border-cyan-500/20" : ""
      }`}
      data-testid={testIds?.root ?? `comment-${comment.id}`}
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
            onClick={onOpenActions}
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
            onClick={() => onVote("up")}
            onPointerUp={(event) => event.currentTarget.blur()}
            className={`flex items-center gap-1 text-xs transition-colors focus:outline-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-500/30 focus-visible:ring-offset-2 focus-visible:ring-offset-background ${
              hasUpvoted
                ? "text-cyan-600 dark:text-cyan-400 hover:text-cyan-500 dark:hover:text-cyan-300"
                : "text-muted-foreground hover:text-cyan-600 dark:hover:text-cyan-400"
            }`}
            data-testid={testIds?.upvote ?? `button-upvote-${comment.id}`}
          >
            <ThumbsUp className="h-3.5 w-3.5" />
            {(comment.upvotes || 0) > 0 && <span>{comment.upvotes}</span>}
          </button>
          <button
            onClick={() => onVote("down")}
            onPointerUp={(event) => event.currentTarget.blur()}
            className={`flex items-center gap-1 text-xs transition-colors focus:outline-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-500/30 focus-visible:ring-offset-2 focus-visible:ring-offset-background ${
              hasDownvoted
                ? "text-cyan-600 dark:text-cyan-400 hover:text-cyan-500 dark:hover:text-cyan-300"
                : "text-muted-foreground hover:text-rose-600 dark:hover:text-rose-400"
            }`}
            data-testid={testIds?.downvote ?? `button-downvote-${comment.id}`}
          >
            <ThumbsDown className="h-3.5 w-3.5" />
            {(comment.downvotes || 0) > 0 && <span>{comment.downvotes}</span>}
          </button>
          {showReplyButton && onReply && (
            <button
              onClick={onReply}
              className="flex items-center gap-1 text-xs text-muted-foreground hover:text-cyan-600 dark:hover:text-cyan-400 transition-colors"
              data-testid={testIds?.reply ?? `button-reply-${comment.id}`}
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
}
