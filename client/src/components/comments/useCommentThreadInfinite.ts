import { useCallback, useMemo, useState } from "react";
import type { InfiniteData } from "@tanstack/react-query";
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { parseApiError } from "@/lib/queryClient";
import type { CommentAdapter, CommentItem, ThreadedComment, VoteType } from "./types";
import type { CommentSort } from "./CommentSortHeader";
import { buildThreadedComments } from "./buildThreadedComments";

type CommentsInfinitePage = { items: CommentItem[]; nextCursor: string | null };

function applyVoteToggleToComment(comment: CommentItem, voteType: VoteType): CommentItem {
  const previousVote = comment.userVote ?? null;
  const nextVote = previousVote === voteType ? null : voteType;
  let upvotes = comment.upvotes || 0;
  let downvotes = comment.downvotes || 0;
  if (previousVote === "up") upvotes = Math.max(upvotes - 1, 0);
  if (previousVote === "down") downvotes = Math.max(downvotes - 1, 0);
  if (nextVote === "up") upvotes += 1;
  if (nextVote === "down") downvotes += 1;
  return { ...comment, userVote: nextVote, upvotes, downvotes };
}

function mapInfiniteDataVoteOptimistic(
  data: InfiniteData<CommentsInfinitePage>,
  commentId: string,
  voteType: VoteType,
): InfiniteData<CommentsInfinitePage> {
  return {
    ...data,
    pages: data.pages.map((page) => ({
      ...page,
      items: page.items.map((c) =>
        c.id === commentId ? applyVoteToggleToComment(c, voteType) : c,
      ),
    })),
  };
}

function patchInfiniteDataVoteFromServer(
  data: InfiniteData<CommentsInfinitePage>,
  commentId: string,
  patch: { userVote: VoteType | null; upvotes: number; downvotes: number },
): InfiniteData<CommentsInfinitePage> {
  return {
    ...data,
    pages: data.pages.map((page) => ({
      ...page,
      items: page.items.map((c) =>
        c.id === commentId ? { ...c, ...patch } : c,
      ),
    })),
  };
}

export interface UseCommentThreadInfiniteResult {
  comments: CommentItem[];
  visibleCount: number;
  threaded: ThreadedComment[];
  isLoading: boolean;
  isError: boolean;
  isRefetching: boolean;
  refetch: () => void;
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
    isError,
    isFetching,
    isFetchingNextPage,
    hasNextPage,
    fetchNextPage,
    refetch,
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

  /** Keeps embedded `useCommentThread` in sync without prefix-invalidating the infinite query. */
  const invalidateEmbeddedThreadQueries = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: adapter.queryKey, exact: true });
    if (adapter.fetchUserVotes) {
      queryClient.invalidateQueries({ queryKey: userVotesKey, exact: true });
    }
    if (adapter.invalidateOnMutate) {
      for (const k of adapter.invalidateOnMutate) {
        queryClient.invalidateQueries({ queryKey: k as unknown[], exact: true });
      }
    }
  }, [queryClient, adapter, userVotesKey]);

  const postMutation = useMutation({
    mutationFn: (input: { body: string; parentId: string | null }) => adapter.postComment(input),
    onSuccess: (data) => {
      setComposerBody("");
      setReplyTo(null);
      invalidateAll();
      adapter.onPostSuccess?.(data);
    },
    onError: (error) => {
      const { title, description, status } = parseApiError(error, "Failed to post comment");
      if (status === 401) {
        toast.error("Error", { description: "Failed to post comment. Please sign in." });
      } else if (status === 403) {
        toast.error(title, {
          description: description ?? "Reach Aspirant rank (1,000 XP) to comment on insights.",
        });
      } else {
        toast.error(title, { description: description ?? "Please try again." });
      }
    },
  });

  const voteMutation = useMutation({
    mutationFn: (input: { commentId: string; voteType: VoteType }) => adapter.voteComment(input),
    onMutate: async ({ commentId, voteType }) => {
      const infiniteQueryKey = [...infiniteKey, sort];
      await queryClient.cancelQueries({ queryKey: infiniteQueryKey });
      if (adapter.fetchUserVotes) {
        await queryClient.cancelQueries({ queryKey: userVotesKey });
      }

      const previousInfinite = queryClient.getQueryData<InfiniteData<CommentsInfinitePage>>(infiniteQueryKey);

      queryClient.setQueryData<InfiniteData<CommentsInfinitePage>>(infiniteQueryKey, (old) => {
        if (!old) return old;
        return mapInfiniteDataVoteOptimistic(old, commentId, voteType);
      });

      if (adapter.fetchUserVotes) {
        const previousVotes = queryClient.getQueryData<Record<string, VoteType>>(userVotesKey);
        queryClient.setQueryData<Record<string, VoteType>>(userVotesKey, (current) => {
          const next = { ...(current || {}) };
          const prev = next[commentId] ?? null;
          if (prev === voteType) {
            delete next[commentId];
          } else {
            next[commentId] = voteType;
          }
          return next;
        });
        return { previousInfinite, previousVotes };
      }

      return { previousInfinite };
    },
    onError: (error, _vars, context) => {
      const ctx = context as {
        previousInfinite?: InfiniteData<CommentsInfinitePage>;
        previousVotes?: Record<string, VoteType>;
      } | undefined;
      const infiniteQueryKey = [...infiniteKey, sort];
      if (ctx?.previousInfinite !== undefined) {
        queryClient.setQueryData(infiniteQueryKey, ctx.previousInfinite);
      }
      if (adapter.fetchUserVotes && ctx?.previousVotes !== undefined) {
        queryClient.setQueryData(userVotesKey, ctx.previousVotes);
      }
      const isUnauthorized = error instanceof Error && /^401:/.test(error.message);
      toast.error("Error", {
        description: isUnauthorized ? "Failed to vote. Please sign in." : "Failed to vote. Please try again.",
      });
    },
    onSuccess: (data, vars) => {
      adapter.onVoteSuccess?.(data, vars);
      const body = data as {
        userVote?: VoteType | null;
        vote?: VoteType | null;
        upvotes?: number;
        downvotes?: number;
      };
      const userVote = body.userVote ?? body.vote ?? null;
      const { upvotes, downvotes } = body;
      if (typeof upvotes !== "number" || typeof downvotes !== "number") return;

      const infiniteQueryKey = [...infiniteKey, sort];
      queryClient.setQueryData<InfiniteData<CommentsInfinitePage>>(infiniteQueryKey, (old) => {
        if (!old) return old;
        return patchInfiniteDataVoteFromServer(old, vars.commentId, { userVote, upvotes, downvotes });
      });
    },
    onSettled: () => {
      invalidateEmbeddedThreadQueries();
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

  const isRefetching = isFetching && !isFetchingNextPage;

  return {
    comments,
    visibleCount,
    threaded,
    isLoading,
    isError,
    isRefetching,
    refetch,
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
