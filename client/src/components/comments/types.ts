export type CommentEntityType = "matchup" | "poll" | "opinion-poll" | "open-market";

export type VoteType = "up" | "down";

export type ParentVoteLabel =
  | { type: "trending_poll"; choice: "support" | "neutral" | "oppose" | string }
  | { type: "matchup"; choice: "option_a" | "option_b" | "neutral" | string; optionName: string }
  | { type: "opinion_poll"; optionName: string }
  | { type: "approval_rating"; rating: number }
  | { type: "open_market_binary"; side: "yes" | "no" }
  | { type: "open_market_multi"; optionName: string }
  | { type: "open_market_updown"; side: "above" | "below" };

export interface CommentItem {
  id: string;
  userId: string;
  username: string | null;
  avatarUrl: string | null;
  body: string;
  parentId: string | null;
  upvotes: number;
  downvotes: number;
  userVote: VoteType | null;
  deletedAt?: string | null;
  parentVoteLabel?: ParentVoteLabel | null;
  createdAt: string;
}

export interface CommentAdapter {
  queryKey: readonly unknown[];
  fetchList: () => Promise<CommentItem[]>;
  /** Full-screen / paginated fetch (base64 cursor); omit on embedded surfaces. */
  fetchPaged?: (input: { sort: "top" | "newest"; cursor: string | null }) => Promise<{ items: CommentItem[]; nextCursor: string | null }>;
  postComment: (input: { body: string; parentId: string | null }) => Promise<unknown>;
  voteComment: (input: { commentId: string; voteType: VoteType }) => Promise<unknown>;
  fetchUserVotes?: () => Promise<Record<string, VoteType>>;
  reportComment?: (input: { commentId: string; reason: string }) => Promise<unknown>;
  deleteComment?: (input: { commentId: string }) => Promise<{ success: boolean; deletedAt: string }>;
  onPostSuccess?: (data: unknown) => void;
  onVoteSuccess?: (data: unknown, vars: { commentId: string; voteType: VoteType }) => void;
  onReportSuccess?: (data: unknown, vars: { commentId: string; reason: string }) => void;
  onDeleteSuccess?: (data: unknown, vars: { commentId: string }) => void;
  supportsReplies: boolean;
  invalidateOnMutate?: readonly (readonly unknown[])[];
}

/** One node in a nested reply tree under a top-level comment. */
export interface CommentTreeNode {
  comment: CommentItem;
  children: CommentTreeNode[];
}

/** Top-level comment plus recursively nested replies. */
export interface ThreadedComment {
  root: CommentItem;
  children: CommentTreeNode[];
}
