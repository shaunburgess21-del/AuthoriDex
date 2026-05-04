import type { ResumeAction } from "@/lib/authReturn";
import type { UseAnonBudgetReturn } from "@/hooks/useAnonBudget";

/**
 * Phase 4 — pre-vote gate for the 5 anon-eligible surfaces.
 *
 * `checkVoteGate` is the single decision point a calling page consults
 * before issuing a vote mutation. It returns a discriminated union that
 * tells the caller either "proceed" or "redirect to signup — here's the
 * skeleton resumeAction to stash". The caller is responsible for filling
 * in `cardRoute` and `pendingVote` (both surface-specific) and handing
 * the enriched `ResumeAction` to `navigateToLogin`.
 *
 * Decision order:
 *   1. Authed (!isAnonymous) → proceed unconditionally. Authed users
 *      have no client gate; useAnonBudget's synthesised defaults also
 *      report `isAnonymous: false` during loading so the pre-fetch
 *      render proceeds and the post-fetch render fires the gate
 *      correctly once data arrives.
 *   2. Upsert (isUpsert) → proceed. Upserts reuse an existing vote slot
 *      and never decrement the server-side budget, so the client gate
 *      mirrors that behaviour and lets them through even when
 *      `exhausted` is true. Without this branch, a user at the cap
 *      could not change a vote they had already cast.
 *   3. Exhausted (budget.exhausted) → redirect. Returns a skeleton
 *      `{ surfaceType, targetId }` for the caller to enrich with
 *      `cardRoute` and `pendingVote` before stashing.
 *   4. Otherwise → proceed. Anon user with remaining budget.
 *
 * Client-side enforcement is UX only — `server/routes.ts` is the
 * authoritative gate and still returns 403 `budget_exhausted` if a
 * vote slips past this hook (cache races, edited request, etc.).
 *
 * `isUpsert` determination is the caller's responsibility. Each
 * surface's page already knows whether the user has an existing vote on
 * this target via its own query data, and the brief deliberately keeps
 * that knowledge out of `useAnonBudget` so the hook stays surface-
 * agnostic. Pass `false` when uncertain — the worst case is a redirect
 * that the server would have blocked anyway.
 */

export type VoteGateDecision =
  | { proceed: true; redirectToSignup: false }
  | {
      proceed: false;
      redirectToSignup: true;
      resumeAction: Pick<ResumeAction, "surfaceType" | "targetId">;
    };

export function checkVoteGate(
  budget: UseAnonBudgetReturn,
  surfaceType: string,
  targetId: string,
  isUpsert: boolean,
): VoteGateDecision {
  if (!budget.isAnonymous) {
    return { proceed: true, redirectToSignup: false };
  }
  if (isUpsert) {
    return { proceed: true, redirectToSignup: false };
  }
  if (budget.exhausted) {
    return {
      proceed: false,
      redirectToSignup: true,
      resumeAction: { surfaceType, targetId },
    };
  }
  return { proceed: true, redirectToSignup: false };
}
