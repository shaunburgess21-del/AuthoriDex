import { useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useXpBurst } from "@/components/XpBurstProvider";
import {
  applyBudgetFromVoteResponse,
  type VoteResponseBudget,
} from "@/hooks/useAnonBudget";

const OPINION_POLLS_LIST_KEY = ["/api/opinion-polls"] as const;

export type OpinionPollOptionLike = {
  id: string;
  votes: number;
  percent: number;
  [key: string]: unknown;
};

export type OpinionPollLike = {
  id: string;
  slug: string;
  options: OpinionPollOptionLike[];
  totalVotes: number;
  userVote: string | null;
  [key: string]: unknown;
};

export type OpinionVoteAction =
  | { kind: "vote"; slug: string; optionId: string }
  | { kind: "remove"; slug: string };

type VoteResponse = {
  success: boolean;
  removed?: boolean;
  xp?: { xpAwarded?: number; reason?: string } | null;
  poll?: OpinionPollLike | null;
  /** Phase 4 — anon-budget snapshot from server. null for authed users. */
  budget?: VoteResponseBudget;
};

type MutationContext = { previousPolls: OpinionPollLike[] | undefined };

function recomputePercents<T extends OpinionPollOptionLike>(opts: T[], total: number): T[] {
  return opts.map(o => ({
    ...o,
    percent: total > 0 ? Math.round((o.votes / total) * 100) : 0,
  }));
}

/**
 * Apply an optimistic vote/remove delta to a single poll.
 * Derives the previous option from poll.userVote so callers don't need to
 * pass it explicitly. Recomputes percent for every option to stay consistent
 * with the server's rounding behaviour. Detail-shape fields (realVotes,
 * seedVotes, commentCount) are passed through unchanged via the spread.
 */
export function optimisticVotePatch<P extends OpinionPollLike>(
  poll: P,
  action: OpinionVoteAction,
): P {
  if (action.kind === "remove") {
    if (!poll.userVote) return poll;
    const prevId = poll.userVote;
    const newOptions = poll.options.map(o =>
      o.id === prevId ? { ...o, votes: Math.max(0, o.votes - 1) } : o,
    );
    const newTotal = Math.max(0, poll.totalVotes - 1);
    return {
      ...poll,
      options: recomputePercents(newOptions, newTotal),
      totalVotes: newTotal,
      userVote: null,
    };
  }

  const prevId = poll.userVote;
  if (prevId === action.optionId) return poll;
  const isChange = prevId !== null;
  const newOptions = poll.options.map(o => {
    if (o.id === action.optionId) return { ...o, votes: o.votes + 1 };
    if (isChange && o.id === prevId) return { ...o, votes: Math.max(0, o.votes - 1) };
    return o;
  });
  const newTotal = isChange ? poll.totalVotes : poll.totalVotes + 1;
  return {
    ...poll,
    options: recomputePercents(newOptions, newTotal),
    totalVotes: newTotal,
    userVote: action.optionId,
  };
}

/**
 * Shared opinion-poll vote mutation with optimistic cache patching and
 * server reconciliation. Patches ['/api/opinion-polls'] on mutate, replaces
 * with the server-authoritative poll on success, and rolls back on error.
 *
 * Errors are re-thrown so calling components (OpinionPollCard) can surface
 * them through their existing toast handlers.
 *
 * For OpinionPollDetailPage which uses a different cache shape (with
 * realVotes/seedVotes/commentCount) and its own toast copy, the page
 * extends its own useMutation in place — see OpinionPollDetailPage.tsx.
 */
export function useOpinionPollVoteMutation() {
  const queryClient = useQueryClient();
  const { trigger: triggerXpBurst } = useXpBurst();

  const mutation = useMutation<VoteResponse, Error, OpinionVoteAction, MutationContext>({
    mutationFn: async (action) => {
      const body = action.kind === "remove" ? { remove: true } : { optionId: action.optionId };
      const res = await apiRequest("POST", `/api/opinion-polls/${action.slug}/vote`, body);
      return (await res.json()) as VoteResponse;
    },
    onMutate: async (action) => {
      await queryClient.cancelQueries({ queryKey: OPINION_POLLS_LIST_KEY });
      const previousPolls = queryClient.getQueryData<OpinionPollLike[]>(OPINION_POLLS_LIST_KEY);
      queryClient.setQueryData<OpinionPollLike[] | undefined>(OPINION_POLLS_LIST_KEY, (old) => {
        if (!old) return old;
        return old.map(p => (p.slug === action.slug ? optimisticVotePatch(p, action) : p));
      });
      return { previousPolls };
    },
    onError: (_err, _action, ctx) => {
      if (ctx?.previousPolls !== undefined) {
        queryClient.setQueryData(OPINION_POLLS_LIST_KEY, ctx.previousPolls);
      }
    },
    onSuccess: (data) => {
      // Phase 4 — sync the anon-budget cache from the server-authoritative
      // snapshot in the response. No-op for authed users (response.budget
      // is null), so safe to call unconditionally.
      applyBudgetFromVoteResponse(queryClient, data);
      const serverPoll = data?.poll;
      if (serverPoll) {
        queryClient.setQueryData<OpinionPollLike[] | undefined>(OPINION_POLLS_LIST_KEY, (old) => {
          if (!old) return old;
          return old.map(p => (p.id === serverPoll.id ? serverPoll : p));
        });
        queryClient.invalidateQueries({ queryKey: ["/api/opinion-polls", serverPoll.slug] });
      }
      if (data?.xp?.xpAwarded) {
        triggerXpBurst(data.xp.xpAwarded, undefined, data.xp.reason);
      }
    },
  });

  return {
    vote: async (slug: string, optionId: string) => {
      await mutation.mutateAsync({ kind: "vote", slug, optionId });
    },
    removeVote: async (slug: string) => {
      await mutation.mutateAsync({ kind: "remove", slug });
    },
    /**
     * Explicit change-vote convenience wrapper. previousOptionId is accepted
     * for API symmetry but unused — the optimistic patch derives the
     * previous option from cache.userVote, so a single call site signature
     * (slug, optionId) is sufficient. Provided for callers that prefer to
     * be explicit about the intent.
     */
    changeVote: async (slug: string, optionId: string, _previousOptionId: string) => {
      await mutation.mutateAsync({ kind: "vote", slug, optionId });
    },
  };
}
