import { useCallback, useState } from "react";
import { CommentRow } from "./CommentRow";
import type { CommentItem, CommentTreeNode, ThreadedComment, VoteType } from "./types";
import type { CommentSort } from "./CommentSortHeader";

/** Direct siblings shown before "View more replies" (Instagram-style). */
const REPLY_PREVIEW_COUNT = 2;

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

interface SharedHandlers {
  expandedParents: Set<string>;
  expandReplies: (parentId: string) => void;
  collapseReplies: (parentId: string) => void;
  onVote: (input: { commentId: string; voteType: VoteType }) => void;
  onReply?: (comment: CommentItem) => void;
  onOpenActions: (comment: CommentItem) => void;
  getRowTestIds?: CommentListProps["getRowTestIds"];
}

function NestedChildrenList({
  parentCommentId,
  nodes,
  depth,
  expandedParents,
  expandReplies,
  collapseReplies,
  onVote,
  onReply,
  onOpenActions,
  getRowTestIds,
}: SharedHandlers & {
  parentCommentId: string;
  nodes: CommentTreeNode[];
  depth: number;
}) {
  if (nodes.length === 0) return null;

  const isExpanded = expandedParents.has(parentCommentId);
  const hasMany = nodes.length > REPLY_PREVIEW_COUNT;
  const visibleNodes = !isExpanded && hasMany ? nodes.slice(0, REPLY_PREVIEW_COUNT) : nodes;
  const hiddenCount = !isExpanded && hasMany ? nodes.length - REPLY_PREVIEW_COUNT : 0;
  const showHide = isExpanded && hasMany;

  const toggleMoreClass =
    "block w-fit text-xs text-muted-foreground hover:text-cyan-600 dark:hover:text-cyan-400 mt-1 mb-1 transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring rounded px-1 py-0.5";

  return (
    <div className="pb-2">
      {visibleNodes.map((child) => (
        <CommentBranch
          key={child.comment.id}
          node={child}
          depth={depth}
          expandedParents={expandedParents}
          expandReplies={expandReplies}
          collapseReplies={collapseReplies}
          onVote={onVote}
          onReply={onReply}
          onOpenActions={onOpenActions}
          getRowTestIds={getRowTestIds}
        />
      ))}
      {hiddenCount > 0 && (
        <button type="button" className={toggleMoreClass} onClick={() => expandReplies(parentCommentId)}>
          View {hiddenCount} more {hiddenCount === 1 ? "reply" : "replies"}
        </button>
      )}
      {showHide && (
        <button type="button" className={toggleMoreClass} onClick={() => collapseReplies(parentCommentId)}>
          Hide replies
        </button>
      )}
    </div>
  );
}

function CommentBranch({
  node,
  depth,
  expandedParents,
  expandReplies,
  collapseReplies,
  onVote,
  onReply,
  onOpenActions,
  getRowTestIds,
}: SharedHandlers & {
  node: CommentTreeNode;
  depth: number;
}) {
  const { comment, children } = node;

  return (
    <div>
      <CommentRow
        comment={comment}
        depth={depth}
        isTopComment={false}
        showReplyButton={!!onReply && !comment.deletedAt}
        onVote={(voteType) => onVote({ commentId: comment.id, voteType })}
        onReply={onReply ? () => onReply(comment) : undefined}
        onOpenActions={() => onOpenActions(comment)}
        testIds={getRowTestIds?.(comment)}
      />
      <NestedChildrenList
        parentCommentId={comment.id}
        nodes={children}
        depth={depth + 1}
        expandedParents={expandedParents}
        expandReplies={expandReplies}
        collapseReplies={collapseReplies}
        onVote={onVote}
        onReply={onReply}
        onOpenActions={onOpenActions}
        getRowTestIds={getRowTestIds}
      />
    </div>
  );
}

export function CommentList({
  threaded,
  sort,
  variant: _variant = "card",
  maxHeight = "500px",
  emptyMessage = "No comments yet. Be the first to share your thoughts!",
  showReplies = true,
  onVote,
  onReply,
  onOpenActions,
  getRowTestIds,
}: CommentListProps) {
  const [expandedParents, setExpandedParents] = useState<Set<string>>(() => new Set());

  const expandReplies = useCallback((parentId: string) => {
    setExpandedParents((prev) => new Set(prev).add(parentId));
  }, []);

  const collapseReplies = useCallback((parentId: string) => {
    setExpandedParents((prev) => {
      const next = new Set(prev);
      next.delete(parentId);
      return next;
    });
  }, []);

  if (threaded.length === 0) {
    return (
      <p className="text-sm text-muted-foreground text-center py-6">
        {emptyMessage}
      </p>
    );
  }

  const useScroll = maxHeight !== "none";

  const shared: SharedHandlers = {
    expandedParents,
    expandReplies,
    collapseReplies,
    onVote,
    onReply,
    onOpenActions,
    getRowTestIds,
  };

  return (
    <div
      className={useScroll ? "overflow-y-auto" : undefined}
      style={useScroll ? { maxHeight } : undefined}
    >
      <div className="divide-y divide-border/10">
        {threaded.map(({ root, children }, idx) => {
          const netVotes = (root.upvotes || 0) - (root.downvotes || 0);
          const isTopComment = sort === "top" && idx === 0 && netVotes > 0;
          return (
            <div key={root.id}>
              <CommentRow
                comment={root}
                depth={0}
                isTopComment={isTopComment}
                showReplyButton={!!onReply && !root.deletedAt}
                onVote={(voteType) => onVote({ commentId: root.id, voteType })}
                onReply={onReply ? () => onReply(root) : undefined}
                onOpenActions={() => onOpenActions(root)}
                testIds={getRowTestIds?.(root)}
              />
              {showReplies && (
                <NestedChildrenList
                  parentCommentId={root.id}
                  nodes={children}
                  depth={1}
                  {...shared}
                />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
