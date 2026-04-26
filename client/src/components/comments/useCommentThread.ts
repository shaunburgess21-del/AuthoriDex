import { useCallback, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import type { CommentAdapter, CommentItem, ThreadedComment, VoteType } from "./types";

export type CommentSort = "top" | "newest";

export interface UseCommentThreadResult {
  comments: CommentItem[];
  threaded: ThreadedComment[];
  isLoading: boolean;
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

/**
 * Adapter-driven hook used by every comment surface (card detail, person-detail
 * insights feed, insight-comments thread).
 *
 * Threading note: this hook mirrors the historical CardComments behaviour where
 * `replyMap` is keyed by every comment's `parentId`, but the final mapping only
 * walks top-level parent ids. As a result, depth-2+ replies (replies whose
 * parent is itself a reply) are dropped from rendering. The C4 commit will add
 * a one-tier flatten on the insight-comments adapter's `fetchList` (rewriting
 * depth-2+ parentIds to point at the nearest depth-1 ancestor) so content is
 * preserved when collapsing PostOverlayModal's depth-3 recursion.
 */
export function useCommentThread(adapter: CommentAdapter): UseCommentThreadResult {
  const queryClient = useQueryClient();
  const [composerBody, setComposerBody] = useState("");
  const [sort, setSort] = useState<CommentSort>("top");
  const [replyTo, setReplyTo] = useState<{ id: string; username: string } | null>(null);

  const queryKey = adapter.queryKey;
  const userVotesKey = useMemo(() => [...queryKey, "user-votes"], [queryKey]);

  const { data: rawComments = [], isLoading } = useQuery<CommentItem[]>({
    queryKey,
    queryFn: () => adapter.fetchList(),
  });

  const { data: userVotesMap } = useQuery<Record<string, VoteType>>({
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

  const threaded = useMemo<ThreadedComment[]>(() => {
    if (!comments.length) return [];
    const topLevel = comments.filter((c) => !c.parentId);
    const replies = comments.filter((c) => !!c.parentId);

    if (sort === "top") {
      topLevel.sort((a, b) => (b.upvotes - b.downvotes) - (a.upvotes - a.downvotes));
    } else {
      topLevel.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    }

    const replyMap = new Map<string, CommentItem[]>();
    for (const r of replies) {
      const pid = r.parentId!;
      if (!replyMap.has(pid)) replyMap.set(pid, []);
      replyMap.get(pid)!.push(r);
    }
    Array.from(replyMap.values()).forEach((arr) => {
      arr.sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
    });

    return topLevel.map((parent) => ({
      parent,
      replies: replyMap.get(parent.id) || [],
    }));
  }, [comments, sort]);

  const invalidateAll = useCallback(() => {
    queryClient.invalidateQueries({ queryKey });
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
    onMutate: async ({ commentId, voteType }) => {
      await queryClient.cancelQueries({ queryKey });
      const previousComments = queryClient.getQueryData<CommentItem[]>(queryKey);

      queryClient.setQueryData<CommentItem[]>(queryKey, (current) => {
        if (!current) return current;
        return current.map((comment) => {
          if (comment.id !== commentId) return comment;
          const previousVote = comment.userVote ?? null;
          const nextVote = previousVote === voteType ? null : voteType;
          let upvotes = comment.upvotes || 0;
          let downvotes = comment.downvotes || 0;
          if (previousVote === "up") upvotes = Math.max(upvotes - 1, 0);
          if (previousVote === "down") downvotes = Math.max(downvotes - 1, 0);
          if (nextVote === "up") upvotes += 1;
          if (nextVote === "down") downvotes += 1;
          return { ...comment, userVote: nextVote, upvotes, downvotes };
        });
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
        return { previousComments, previousVotes };
      }

      return { previousComments };
    },
    onError: (_error, _variables, context) => {
      const ctx = context as { previousComments?: CommentItem[]; previousVotes?: Record<string, VoteType> } | undefined;
      if (ctx?.previousComments) {
        queryClient.setQueryData(queryKey, ctx.previousComments);
      }
      if (adapter.fetchUserVotes && ctx?.previousVotes !== undefined) {
        queryClient.setQueryData(userVotesKey, ctx.previousVotes);
      }
      toast.error("Error", { description: "Failed to vote. Please sign in." });
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
    onMutate: async ({ commentId }) => {
      await queryClient.cancelQueries({ queryKey });
      if (adapter.fetchUserVotes) {
        await queryClient.cancelQueries({ queryKey: userVotesKey });
      }
      const previousComments = queryClient.getQueryData<CommentItem[]>(queryKey);
      const previousVotes = adapter.fetchUserVotes
        ? queryClient.getQueryData<Record<string, VoteType>>(userVotesKey)
        : undefined;
      const optimisticDeletedAt = new Date().toISOString();

      queryClient.setQueryData<CommentItem[]>(queryKey, (current) => {
        if (!current) return current;
        return current.map((comment) => (
          comment.id === commentId
            ? {
              ...comment,
              deletedAt: optimisticDeletedAt,
              body: "",
              username: "[deleted user]",
              avatarUrl: null,
              userVote: null,
            }
            : comment
        ));
      });

      if (adapter.fetchUserVotes) {
        queryClient.setQueryData<Record<string, VoteType>>(userVotesKey, (current) => {
          if (!current) return current;
          const next = { ...current };
          delete next[commentId];
          return next;
        });
      }

      return { previousComments, previousVotes };
    },
    onError: (_error, _variables, context) => {
      const ctx = context as { previousComments?: CommentItem[]; previousVotes?: Record<string, VoteType> } | undefined;
      if (ctx?.previousComments) {
        queryClient.setQueryData(queryKey, ctx.previousComments);
      }
      if (adapter.fetchUserVotes && ctx?.previousVotes !== undefined) {
        queryClient.setQueryData(userVotesKey, ctx.previousVotes);
      }
      toast.error("Error", { description: "Failed to delete. Please sign in." });
    },
    onSuccess: (data, vars) => {
      queryClient.setQueryData<CommentItem[]>(queryKey, (current) => {
        if (!current) return current;
        return current.map((comment) => (
          comment.id === vars.commentId
            ? {
              ...comment,
              deletedAt: data.deletedAt,
              body: "",
              username: "[deleted user]",
              avatarUrl: null,
              userVote: null,
            }
            : comment
        ));
      });
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
    threaded,
    isLoading,
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
