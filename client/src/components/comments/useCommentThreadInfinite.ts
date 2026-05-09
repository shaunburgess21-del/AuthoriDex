import { useCallback, useMemo, useState } from "react";
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import type { CommentAdapter, CommentItem, ThreadedComment, VoteType } from "./types";
import type { CommentSort } from "./CommentSortHeader";
import { buildThreadedComments } from "./buildThreadedComments";

export interface UseCommentThreadInfiniteResult {
  comments: CommentItem[];
  visibleCount: number;
  threaded: ThreadedComment[];
  isLoading: boolean;
  isFetchingNextPage: boolean;
  hasNextPage: boolean;
  fetchNextPage: () => void;
  sort: CommentSort;
  setSort: (s: CommentSort) => void;
  composerBody: string;
  setComposerBody: (s: string) => void;
  replyTo: { id: string; username: string } | null;
  startReply: (c: CommentItem) => void;
  cancelReply: () => void;
  isPostPending: boolean;
  isVotePending: boolean;
  isDeletePending: boolean;
  submit: () => void;
  vote: (input: { commentId: string; voteType: VoteType }) => void;
  report: (input: { commentId: string; reason: string }) => void;
  deleteComment: (input: { commentId: string }) => void;
  resetComposer: () => void;
}

/** Paginated comment thread for full-screen focus mode (deduped merge of all pages). */
export function useCommentThreadInfinite(adapter: CommentAdapter): UseCommentThreadInfiniteResult {
  const queryClient = useQueryClient();
  const [composerBody, setComposerBody] = useState("");
  const [sort, setSort] = useState<CommentSort>("top");
  const [replyTo, setReplyTo] = useState<{ id: string; username: string } | null>(null);

  const queryKey = adapter.queryKey;
  const userVotesKey = useMemo(() => [...queryKey, "user-votes"], [queryKey]);

  const fetchPaged = adapter.fetchPaged;
  if (!fetchPaged) {
    throw new Error("useCommentThreadInfinite requires adapter.fetchPaged");
  }

  const infiniteKey = useMemo(() => [...queryKey, "infinite"] as const, [queryKey]);

  const {
    data,
    isLoading,
    isFetchingNextPage,
    hasNextPage,
    fetchNextPage,
  } = useInfiniteQuery({
    queryKey: [...infiniteKey, sort],
    queryFn: async ({ pageParam }) => fetchPaged({ sort, cursor: pageParam as string | null }),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    enabled: !!fetchPaged,
  });

  const rawComments = useMemo(() => {
    const byId = new Map<string, CommentItem>();
    for (const page of data?.pages ?? []) {
      for (const c of page.items) {
        byId.set(c.id, c);
      }
    }
    return [...byId.values()];
  }, [data]);

  const { data: userVotesMap } = useQuery({
    queryKey: userVotesKey,
    queryFn: () => adapter.fetchUserVotes!(),
    enabled: !!adapter.fetchUserVotes,
  });

  const comments = useMemo<CommentItem[]>(() => {
    if (!userVotesMap) return rawComments;
    return rawComments.map((c) => ({
      ...c,
      userVote: c.userVote ?? userVotesMap[c.id] ?? null,
    }));
  }, [rawComments, userVotesMap]);

  const threaded = useMemo<ThreadedComment[]>(() => buildThreadedComments(comments, sort), [comments, sort]);

  const visibleCount = useMemo(() => comments.filter((c) => !c.deletedAt).length, [comments]);

  const invalidateAll = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: adapter.queryKey });
    if (adapter.fetchUserVotes) {
      queryClient.invalidateQueries({ queryKey: userVotesKey });
    }
    if (adapter.invalidateOnMutate) {
      for (const k of adapter.invalidateOnMutate) {
        queryClient.invalidateQueries({ queryKey: k as unknown[] });
      }
    }
  }, [queryClient, queryKey, userVotesKey, adapter]);

  const postMutation = useMutation({
    mutationFn: (input: { body: string; parentId: string | null }) => adapter.postComment(input),
    onSuccess: (data) => {
      setComposerBody("");
      setReplyTo(null);
      invalidateAll();
      adapter.onPostSuccess?.(data);
    },
    onError: () => {
      toast.error("Error", { description: "Failed to post comment. Please sign in." });
    },
  });

  const voteMutation = useMutation({
    mutationFn: (input: { commentId: string; voteType: VoteType }) => adapter.voteComment(input),
    onError: (error) => {
      const isUnauthorized = error instanceof Error && /^401:/.test(error.message);
      toast.error("Error", {
        description: isUnauthorized ? "Failed to vote. Please sign in." : "Failed to vote. Please try again.",
      });
    },
    onSuccess: (data, vars) => {
      adapter.onVoteSuccess?.(data, vars);
    },
    onSettled: () => {
      invalidateAll();
    },
  });

  const reportMutation = useMutation({
    mutationFn: (input: { commentId: string; reason: string }) => {
      if (!adapter.reportComment) {
        return Promise.reject(new Error("Reporting is not supported on this surface"));
      }
      return adapter.reportComment(input);
    },
    onSuccess: (data, vars) => {
      toast("Report submitted", { description: "Thank you. An admin will review this comment." });
      adapter.onReportSuccess?.(data, vars);
    },
    onError: () => {
      toast.error("Error", { description: "Failed to report. Please sign in." });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (input: { commentId: string }) => {
      if (!adapter.deleteComment) {
        return Promise.reject(new Error("Deleting is not supported on this surface"));
      }
      return adapter.deleteComment(input);
    },
    onError: () => {
      toast.error("Error", { description: "Failed to delete. Please sign in." });
    },
    onSuccess: (data, vars) => {
      adapter.onDeleteSuccess?.(data, vars);
    },
    onSettled: () => {
      invalidateAll();
    },
  });

  const submit = useCallback(() => {
    if (!composerBody.trim()) return;
    postMutation.mutate({ body: composerBody.trim(), parentId: replyTo?.id ?? null });
  }, [composerBody, replyTo, postMutation]);

  const startReply = useCallback((comment: CommentItem) => {
    setReplyTo({ id: comment.id, username: comment.username || "Anonymous" });
  }, []);

  const cancelReply = useCallback(() => setReplyTo(null), []);

  const resetComposer = useCallback(() => {
    setComposerBody("");
    setReplyTo(null);
  }, []);

  return {
    comments,
    visibleCount,
    threaded,
    isLoading,
    isFetchingNextPage,
    hasNextPage: !!hasNextPage,
    fetchNextPage,
    sort,
    setSort,
    composerBody,
    setComposerBody,
    replyTo,
    startReply,
    cancelReply,
    isPostPending: postMutation.isPending,
    isVotePending: voteMutation.isPending,
    isDeletePending: deleteMutation.isPending,
    submit,
    vote: (input) => voteMutation.mutate(input),
    report: (input) => reportMutation.mutate(input),
    deleteComment: (input) => deleteMutation.mutate(input),
    resetComposer,
  };
}
