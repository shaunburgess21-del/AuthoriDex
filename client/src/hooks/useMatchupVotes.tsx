/**
 * Shared, query-cache-first matchup voting.
 *
 * Voted-state lives in the ['/api/matchups/user-votes'] cache (not page
 * state), and results/percentages are patched optimistically into the
 * ['/api/matchups'] list — so every surface rendering VersusCard (Vote hub
 * grid, snap view, Quick Vote overlay) mirrors the same vote instantly.
 *
 * The hook owns: anon-budget gate, optimistic cache writes + rollback,
 * budget cache sync, invalidation, XP burst, and the shared error UX
 * (sign-in toast, budget-exhausted signup redirect, rate-limit countdown).
 * Page-specific presentation (hide-exit animation, click-time toasts,
 * carousel auto-advance) stays with the caller via options/callbacks.
 */
import { useCallback, useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { toast } from "sonner";
import { apiRequest } from "@/lib/queryClient";
import { useXpBurst } from "@/components/XpBurstProvider";
import { CountdownDescription } from "@/components/CountdownDescription";
import {
  applyBudgetFromVoteResponse,
  useAnonBudget,
} from "@/hooks/useAnonBudget";
import { checkVoteGate } from "@/lib/voteGate";
import {
  navigateToLogin,
  type VoteResumePayload,
} from "@/lib/authReturn";
import {
  isUnauthorizedApiError,
  signInToVoteToastOptions,
  signInToVoteTitle,
} from "@/lib/signInToVoteToast";
import { isBudgetExhaustedVoteError, parseVoteError } from "@/lib/voteErrors";
import {
  optimisticMatchupVotePatch,
  optimisticMatchupRemovePatch,
  type MatchupVoteOption,
  type MatchupVoteShape,
} from "@/lib/optimisticMatchupVote";
import { trackVoteCast } from "@/lib/funnelTelemetry";

export const MATCHUPS_LIST_KEY = ["/api/matchups"] as const;
export const MATCHUP_USER_VOTES_KEY = ["/api/matchups/user-votes"] as const;

type MatchupListEntry = MatchupVoteShape & { id: string };

interface VoteVars {
  matchupId: string;
  option: MatchupVoteOption;
  previousVote: MatchupVoteOption | null;
  /** Caller already fired haptic/toast/XP at click time. */
  optimisticFeedbackShown: boolean;
}

interface RemoveVars {
  matchupId: string;
  previousVote: MatchupVoteOption;
}

interface MutationContext {
  previousList: MatchupListEntry[] | undefined;
  previousUserVotes: Record<string, string> | undefined;
}

export interface UseMatchupVotesOptions {
  /** Vote-hub UI snapshot to restore after a login redirect. */
  getVoteUiSnapshot?: () => VoteResumePayload | null;
  /** Runs after an errored vote's cache rollback (e.g. cancel hide-exit). */
  onVoteRolledBack?: (matchupId: string, hadPreviousVote: boolean) => void;
  /** Runs on vote success, after budget sync/XP/invalidation. */
  onVoteSuccess?: (data: any, vars: VoteVars) => void;
}

export type MatchupVoteAttempt =
  | { ok: true; previousVote: MatchupVoteOption | null }
  | { ok: false; reason: "rate_limited" | "redirected_to_signup" };

export function useMatchupVotes(options?: UseMatchupVotesOptions) {
  const queryClient = useQueryClient();
  const [, setLocation] = useLocation();
  const { trigger: triggerXpBurst } = useXpBurst();
  const budget = useAnonBudget();
  const [rateLimitedUntil, setRateLimitedUntil] = useState<number | null>(null);

  useEffect(() => {
    if (!rateLimitedUntil) return;
    const ms = rateLimitedUntil - Date.now();
    if (ms <= 0) {
      setRateLimitedUntil(null);
      return;
    }
    const id = setTimeout(() => setRateLimitedUntil(null), ms);
    return () => clearTimeout(id);
  }, [rateLimitedUntil]);

  const { data: userVotes = {} } = useQuery<Record<string, string>>({
    queryKey: MATCHUP_USER_VOTES_KEY,
    staleTime: 60 * 1000,
  });

  const voteUiSnapshot = useCallback(
    () => options?.getVoteUiSnapshot?.() ?? null,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [options?.getVoteUiSnapshot],
  );

  const snapshotAndPatch = useCallback(
    async (
      matchupId: string,
      patch: (entry: MatchupListEntry) => MatchupListEntry,
      userVoteWrite: (current: Record<string, string>) => Record<string, string>,
    ): Promise<MutationContext> => {
      await queryClient.cancelQueries({ queryKey: MATCHUPS_LIST_KEY });
      await queryClient.cancelQueries({ queryKey: MATCHUP_USER_VOTES_KEY });
      const previousList =
        queryClient.getQueryData<MatchupListEntry[]>(MATCHUPS_LIST_KEY);
      const previousUserVotes = queryClient.getQueryData<Record<string, string>>(
        MATCHUP_USER_VOTES_KEY,
      );
      if (previousList) {
        queryClient.setQueryData<MatchupListEntry[]>(
          MATCHUPS_LIST_KEY,
          previousList.map((m) => (m.id === matchupId ? patch(m) : m)),
        );
      }
      queryClient.setQueryData<Record<string, string>>(
        MATCHUP_USER_VOTES_KEY,
        (current) => userVoteWrite({ ...(current ?? {}) }),
      );
      return { previousList, previousUserVotes };
    },
    [queryClient],
  );

  const rollback = useCallback(
    (context: MutationContext | undefined) => {
      if (context?.previousList) {
        queryClient.setQueryData(MATCHUPS_LIST_KEY, context.previousList);
      }
      if (context?.previousUserVotes !== undefined) {
        queryClient.setQueryData(
          MATCHUP_USER_VOTES_KEY,
          context.previousUserVotes,
        );
      }
    },
    [queryClient],
  );

  const handleSharedError = useCallback(
    (
      error: any,
      resume: { matchupId: string; pendingVote: Record<string, unknown> },
    ) => {
      if (isUnauthorizedApiError(error)) {
        toast(
          signInToVoteTitle,
          signInToVoteToastOptions(() =>
            navigateToLogin(setLocation, { voteUi: voteUiSnapshot() }),
          ),
        );
      } else if (isBudgetExhaustedVoteError(error)) {
        navigateToLogin(setLocation, {
          mode: "signup",
          reason: "vote_limit_reached",
          voteUi: voteUiSnapshot(),
          resumeAction: {
            surfaceType: "matchup_poll",
            targetId: resume.matchupId,
            cardRoute: window.location.pathname,
            pendingVote: resume.pendingVote,
          },
        });
      } else {
        const parsed = parseVoteError(error);
        if (parsed.retryAfter) {
          setRateLimitedUntil(Date.now() + parsed.retryAfter * 1000);
        }
        toast.error("Couldn't record vote", {
          description: parsed.retryAfter ? (
            <CountdownDescription seconds={parsed.retryAfter} text={parsed.message} />
          ) : (
            parsed.message
          ),
        });
      }
    },
    [setLocation, voteUiSnapshot],
  );

  const voteMutation = useMutation<any, any, VoteVars, MutationContext>({
    mutationFn: async ({ matchupId, option }) => {
      const response = await apiRequest("POST", `/api/matchups/${matchupId}/vote`, { option });
      return response.json();
    },
    onMutate: ({ matchupId, option, previousVote }) =>
      snapshotAndPatch(
        matchupId,
        (m) => optimisticMatchupVotePatch(m, option, previousVote),
        (current) => ({ ...current, [matchupId]: option }),
      ),
    onSuccess: (data, variables) => {
      applyBudgetFromVoteResponse(queryClient, data);
      if (!variables.previousVote) {
        trackVoteCast("matchup_poll");
      }
      queryClient.invalidateQueries({ queryKey: MATCHUPS_LIST_KEY });
      queryClient.invalidateQueries({ queryKey: MATCHUP_USER_VOTES_KEY });
      // Voices feed shows the author's matchup vote as a pill — keep it fresh.
      queryClient.invalidateQueries({ queryKey: ["/api/voices/feed"] });
      if (data?.xp?.xpAwarded && !variables.optimisticFeedbackShown) {
        triggerXpBurst(data.xp.xpAwarded, undefined, data.xp.reason);
      }
      options?.onVoteSuccess?.(data, variables);
    },
    onError: (error, variables, context) => {
      rollback(context);
      options?.onVoteRolledBack?.(variables.matchupId, !!variables.previousVote);
      handleSharedError(error, {
        matchupId: variables.matchupId,
        pendingVote: { matchupId: variables.matchupId, option: variables.option },
      });
    },
  });

  const removeMutation = useMutation<any, any, RemoveVars, MutationContext>({
    mutationFn: async ({ matchupId }) => {
      const response = await apiRequest("POST", `/api/matchups/${matchupId}/vote`, { remove: true });
      return response.json();
    },
    onMutate: ({ matchupId, previousVote }) =>
      snapshotAndPatch(
        matchupId,
        (m) => optimisticMatchupRemovePatch(m, previousVote),
        (current) => {
          delete current[matchupId];
          return current;
        },
      ),
    onSuccess: (data) => {
      // Remove paths return budget: null (no budget delta) — helper handles it.
      applyBudgetFromVoteResponse(queryClient, data);
      queryClient.invalidateQueries({ queryKey: MATCHUPS_LIST_KEY });
      queryClient.invalidateQueries({ queryKey: MATCHUP_USER_VOTES_KEY });
      queryClient.invalidateQueries({ queryKey: ["/api/voices/feed"] });
    },
    onError: (error, variables, context) => {
      rollback(context);
      handleSharedError(error, {
        matchupId: variables.matchupId,
        pendingVote: { remove: true },
      });
    },
  });

  const isRateLimited = !!(rateLimitedUntil && Date.now() < rateLimitedUntil);

  /**
   * Gate + optimistically apply + fire the vote. `onProceed` runs
   * synchronously after the gate passes and before the mutation fires — the
   * place for click-time feedback (haptic, toast, hide-exit). Its return
   * value flags whether the caller already played the full optimistic
   * XP/advance flow so onSuccess doesn't double-fire it.
   */
  const voteMatchup = useCallback(
    (
      matchupId: string,
      option: MatchupVoteOption,
      opts?: {
        onProceed?: (
          previousVote: MatchupVoteOption | null,
        ) => { optimisticFeedbackShown?: boolean } | void;
      },
    ): MatchupVoteAttempt => {
      if (isRateLimited) return { ok: false, reason: "rate_limited" };
      const previousVote = (userVotes[matchupId] as MatchupVoteOption | undefined) ?? null;
      const decision = checkVoteGate(budget, "matchup_poll", matchupId, previousVote !== null);
      if (!decision.proceed) {
        navigateToLogin(setLocation, {
          mode: "signup",
          reason: "vote_limit_reached",
          voteUi: voteUiSnapshot(),
          resumeAction: {
            ...decision.resumeAction,
            cardRoute: window.location.pathname,
            pendingVote: { matchupId, option },
          },
        });
        return { ok: false, reason: "redirected_to_signup" };
      }
      const feedback = opts?.onProceed?.(previousVote);
      voteMutation.mutate({
        matchupId,
        option,
        previousVote,
        optimisticFeedbackShown: feedback?.optimisticFeedbackShown ?? false,
      });
      return { ok: true, previousVote };
    },
    [isRateLimited, userVotes, budget, setLocation, voteUiSnapshot, voteMutation],
  );

  /** Optimistically remove the user's vote. No-op when there is none. */
  const removeMatchupVote = useCallback(
    (matchupId: string): boolean => {
      const previousVote = userVotes[matchupId] as MatchupVoteOption | undefined;
      if (!previousVote) return false;
      removeMutation.mutate({ matchupId, previousVote });
      return true;
    },
    [userVotes, removeMutation],
  );

  return {
    /** Server + optimistic voted-state map (matchupId → option). */
    userVotes,
    voteMatchup,
    removeMatchupVote,
    isRateLimited,
  };
}
