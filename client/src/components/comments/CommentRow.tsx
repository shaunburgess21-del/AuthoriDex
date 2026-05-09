import { ThumbsUp, ThumbsDown, Reply, MoreVertical } from "lucide-react";
import { UserProfileAvatar } from "@/components/UserProfileAvatar";
import { VoteLabel } from "@/components/VoteLabel";
import { Badge } from "@/components/ui/badge";
import { formatTimeAgo } from "@/lib/formatDate";
import type { CommentItem, VoteType } from "./types";

const MAX_COMMENT_VISUAL_DEPTH = 5;

export interface CommentRowProps {
  comment: CommentItem;
  /** 0 = top-level thread root; nested replies use 1+. */
  depth: number;
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
  depth,
  isTopComment,
  showReplyButton,
  onVote,
  onReply,
  onOpenActions,
  testIds,
}: CommentRowProps) {
  const isDeleted = Boolean(comment.deletedAt);
  const netVotes = (comment.upvotes || 0) - (comment.downvotes || 0);
  const hasUpvoted = comment.userVote === "up";
  const hasDownvoted = comment.userVote === "down";
  const isNested = depth > 0;
  const visualDepth = Math.min(depth, MAX_COMMENT_VISUAL_DEPTH);
  const indentRem = isNested ? visualDepth * 1.75 : 0;

  return (
    <div
      id={`comment-${comment.id}`}
      className={`flex gap-3 py-3 ${isNested ? "pl-3 border-l-2 border-border/20" : ""}`}
      style={indentRem > 0 ? { marginLeft: `${indentRem}rem` } : undefined}
      data-testid={testIds?.root ?? `comment-${comment.id}`}
    >
      {!isDeleted && (
        <UserProfileAvatar
          displayName={comment.username || ""}
          avatarUrl={comment.avatarUrl}
          size={isNested ? "xs" : "sm"}
          className="shrink-0"
        />
      )}
      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 flex-wrap min-w-0">
            <span
              className={`text-sm truncate ${isDeleted ? "italic text-muted-foreground" : "font-semibold"}`}
              data-testid={`text-comment-user-${comment.id}`}
            >
              {isDeleted ? "[deleted user]" : comment.username || "Anonymous"}
            </span>
            <span className="text-xs text-muted-foreground shrink-0">
              {formatTimeAgo(comment.createdAt)}
            </span>
            {!isDeleted && <VoteLabel label={comment.parentVoteLabel ?? null} />}
            {isTopComment && (
              <Badge variant="outline" className="text-[10px] border-cyan-500/40 dark:border-cyan-500/30 text-cyan-600 dark:text-cyan-400 py-0">
                Top Take
              </Badge>
            )}
          </div>
          <button
            onClick={onOpenActions}
            className="shrink-0 p-1 text-muted-foreground/50 hover:text-muted-foreground transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            data-interactive="true"
          >
            <MoreVertical className="h-4 w-4" />
          </button>
        </div>
        <p
          className={`text-sm text-muted-foreground mt-1 whitespace-pre-wrap ${isDeleted ? "italic" : ""}`}
          data-testid={`text-comment-body-${comment.id}`}
        >
          {isDeleted ? "[deleted]" : comment.body}
        </p>
        <div className="flex items-center gap-4 mt-2">
          {!isDeleted && (
            <>
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
                  className="flex items-center gap-1 text-xs text-muted-foreground hover:text-cyan-600 dark:hover:text-cyan-400 transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                  data-testid={testIds?.reply ?? `button-reply-${comment.id}`}
                >
                  <Reply className="h-3.5 w-3.5" />
                  Reply
                </button>
              )}
            </>
          )}
          {isDeleted && netVotes !== 0 && (
            <span className="text-xs text-muted-foreground">
              {netVotes > 0 ? `+${netVotes}` : netVotes}
            </span>
          )}
          {!isDeleted && netVotes !== 0 && (
            <span className={`text-xs font-mono ${netVotes > 0 ? "text-cyan-600 dark:text-cyan-400" : "text-rose-600 dark:text-rose-400"}`}>
              {netVotes > 0 ? `+${netVotes}` : netVotes}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
