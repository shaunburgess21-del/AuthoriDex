import { CommentRow } from "./CommentRow";
import type { CommentItem, ThreadedComment, VoteType } from "./types";
import type { CommentSort } from "./CommentSortHeader";

export interface CommentListProps {
  threaded: ThreadedComment[];
  sort: CommentSort;
  variant?: "card" | "inline";
  maxHeight?: string;
  emptyMessage?: string;
  showReplies?: boolean;
  onVote: (input: { commentId: string; voteType: VoteType }) => void;
  onReply?: (comment: CommentItem) => void;
  onOpenActions: (comment: CommentItem) => void;
  getRowTestIds?: (comment: CommentItem) => {
    root?: string;
    upvote?: string;
    downvote?: string;
    reply?: string;
  };
}

export function CommentList({
  threaded,
  sort,
  variant = "card",
  maxHeight = "500px",
  emptyMessage = "No comments yet. Be the first to share your thoughts!",
  showReplies = true,
  onVote,
  onReply,
  onOpenActions,
  getRowTestIds,
}: CommentListProps) {
  if (threaded.length === 0) {
    return (
      <p className="text-sm text-muted-foreground text-center py-6">
        {emptyMessage}
      </p>
    );
  }

  const useScroll = maxHeight !== "none";

  return (
    <div
      className={useScroll ? "overflow-y-auto" : undefined}
      style={useScroll ? { maxHeight } : undefined}
    >
      <div className="divide-y divide-border/10">
        {threaded.map(({ parent, replies: threadReplies }, idx) => {
          const netVotes = (parent.upvotes || 0) - (parent.downvotes || 0);
          const isTopComment = sort === "top" && idx === 0 && netVotes > 0;
          return (
            <div key={parent.id}>
              <CommentRow
                comment={parent}
                isReply={false}
                isTopComment={isTopComment}
                showReplyButton={!!onReply}
                onVote={(voteType) => onVote({ commentId: parent.id, voteType })}
                onReply={onReply ? () => onReply(parent) : undefined}
                onOpenActions={() => onOpenActions(parent)}
                testIds={getRowTestIds?.(parent)}
              />
              {showReplies && threadReplies.length > 0 && (
                <div className="pb-2">
                  {threadReplies.map((r) => (
                    <CommentRow
                      key={r.id}
                      comment={r}
                      isReply
                      isTopComment={false}
                      showReplyButton={false}
                      onVote={(voteType) => onVote({ commentId: r.id, voteType })}
                      onOpenActions={() => onOpenActions(r)}
                      testIds={getRowTestIds?.(r)}
                    />
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
