export type CommentEntityType = "matchup" | "poll" | "opinion-poll" | "open-market";

export type VoteType = "up" | "down";

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
  createdAt: string;
}

export interface CommentAdapter {
  queryKey: readonly unknown[];
  fetchList: () => Promise<CommentItem[]>;
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

export interface ThreadedComment {
  parent: CommentItem;
  replies: CommentItem[];
}
