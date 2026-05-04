import { useQuery, type QueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";

/**
 * Phase 4 — anonymous voting budget hook + cache helpers.
 *
 * The hook reads the per-identity budget from GET /api/anon-budget and
 * exposes a flat shape that voteGate.checkVoteGate consumes directly.
 * Cache writes happen through applyBudgetFromVoteResponse, which every
 * vote mutation should call from its onSuccess (Stage 7 wiring) to keep
 * the budget in sync without a follow-up GET round-trip.
 *
 * Server response shape (server/routes.ts GET /api/anon-budget):
 *   - Authed: { authenticated: true }
 *   - Anon:   { authenticated: false, used, limit, remaining, exhausted }
 *
 * Hook return shape (per brief):
 *   { used, limit, remaining, exhausted, isAnonymous }
 *
 * Authed and loading states synthesise defaults so callers — including
 * checkVoteGate — can read every field unconditionally. The gate's first
 * branch is `!isAnonymous → proceed`, so synthesised defaults never
 * influence the redirect decision.
 *
 * Client-side enforcement is UX only — the server is the authoritative
 * gate. If a vote slips past this hook (e.g. cache races, edited request),
 * the route handler still 403s on budget_exhausted.
 */

/**
 * Fallback when the hook surfaces a `limit` value but the server hasn't
 * been consulted (authed synthesised state, pre-fetch loading state).
 * Never used to enforce the gate — authed users skip via isAnonymous,
 * loading state proceeds and the post-fetch render fires the gate
 * correctly once data arrives.
 *
 * SYNC: keep in sync with server/lib/rankingConfig.ts ANON_VOTE_BUDGET default.
 */
const ANON_VOTE_BUDGET_FALLBACK = 8;

/**
 * Stable queryKey for the budget cache. Exported so vote mutations
 * (Stage 7) and tests (Stage 8) can target the same key without
 * re-deriving it.
 */
export const ANON_BUDGET_QUERY_KEY = ["/api/anon-budget"] as const;

type AnonBudgetServerAuthed = { authenticated: true };
type AnonBudgetServerAnon = {
  authenticated: false;
  used: number;
  limit: number;
  remaining: number;
  exhausted: boolean;
};

export type AnonBudgetServerResponse =
  | AnonBudgetServerAuthed
  | AnonBudgetServerAnon;

/**
 * Snapshot shape returned by vote-mutation endpoints in their `budget`
 * field. Mirrors the anon arm of AnonBudgetServerResponse minus the
 * `authenticated` discriminator. `null` means "no budget info this
 * response" — see applyBudgetFromVoteResponse for handling.
 */
export type VoteResponseBudget = {
  used: number;
  limit: number;
  remaining: number;
  exhausted: boolean;
} | null;

export interface UseAnonBudgetReturn {
  used: number;
  limit: number;
  remaining: number;
  exhausted: boolean;
  isAnonymous: boolean;
}

const SYNTHESISED_DEFAULTS: UseAnonBudgetReturn = {
  used: 0,
  limit: ANON_VOTE_BUDGET_FALLBACK,
  remaining: ANON_VOTE_BUDGET_FALLBACK,
  exhausted: false,
  isAnonymous: false,
};

function projectServerResponse(
  data: AnonBudgetServerResponse,
): UseAnonBudgetReturn {
  if (data.authenticated) {
    return { ...SYNTHESISED_DEFAULTS };
  }
  return {
    used: data.used,
    limit: data.limit,
    remaining: data.remaining,
    exhausted: data.exhausted,
    isAnonymous: true,
  };
}

export function useAnonBudget(): UseAnonBudgetReturn {
  const { data } = useQuery<AnonBudgetServerResponse>({
    queryKey: ANON_BUDGET_QUERY_KEY,
    queryFn: async () => {
      const res = await apiRequest("GET", "/api/anon-budget");
      return (await res.json()) as AnonBudgetServerResponse;
    },
    staleTime: 60 * 1000,
    refetchOnWindowFocus: true,
  });

  if (!data) {
    return { ...SYNTHESISED_DEFAULTS };
  }
  return projectServerResponse(data);
}

/**
 * Sync the budget cache after a vote mutation. Call from onSuccess of
 * every vote mutation (Stage 7 wiring). Three paths:
 *
 *   1. response.budget populated → write to cache as the new authoritative
 *      anon state. No follow-up GET needed.
 *   2. response.budget === null AND cache shows authenticated: false →
 *      anon fail-open sentinel or removal/no-op response. Invalidate to
 *      refetch ground truth via GET /api/anon-budget. TanStack handles
 *      in-flight dedup so concurrent invalidations collapse safely.
 *   3. response.budget === null AND cache shows authenticated: true →
 *      no-op. Authed responses always have budget: null; nothing to sync.
 *      Skipping the invalidate avoids one unnecessary GET per authed vote.
 *
 * `response` is loosely typed so call sites can pass any vote-response
 * shape without first conforming to a union — we only ever read .budget.
 */
export function applyBudgetFromVoteResponse(
  queryClient: QueryClient,
  response: { budget?: VoteResponseBudget } | null | undefined,
): void {
  if (response && response.budget) {
    queryClient.setQueryData<AnonBudgetServerResponse>(ANON_BUDGET_QUERY_KEY, {
      authenticated: false,
      ...response.budget,
    });
    return;
  }
  const cached = queryClient.getQueryData<AnonBudgetServerResponse>(
    ANON_BUDGET_QUERY_KEY,
  );
  if (cached?.authenticated === false) {
    queryClient.invalidateQueries({ queryKey: ANON_BUDGET_QUERY_KEY });
  }
  // else: authed cache (no-op) or no cache yet (next mount will fetch).
}
