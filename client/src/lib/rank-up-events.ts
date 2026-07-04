/**
 * Rank-up event plumbing, split from RankUpModal.tsx so the realtime
 * notifications hook (which lives in the entry bundle) can dispatch
 * promotions without statically pulling the modal chunk (Dialog +
 * confetti + rank config) into the entry bundle.
 */

/**
 * Payload shape published by the realtime notifications path
 * (see useNotificationsRealtime.ts → rank_up branch).
 *
 * Mirrors the metadata persisted by gamificationService.awardXp() —
 * keeping these names in lock-step with the server is the contract
 * that lets the modal show the right "new personal best" treatment
 * without a second round-trip to /api/gamification/stats.
 */
export interface RankUpPayload {
  /** New rank name. Resolved against shared/rank-config.ts. */
  newRank: string;
  /** Previous rank name, if any. Used in the subtext only. */
  previousRank: string | null;
  /** Total XP after the promoting award landed. */
  xp: number;
  /** True when this promotion also raised highest_rank. */
  newPersonalBest: boolean;
}

export const RANK_UP_EVENT = "voxdex:rank-up";

/**
 * Imperative entry point — dispatches a custom DOM event that the
 * mounted <RankUpModalHost /> listens for. Using a DOM event (rather
 * than React Context) means the realtime hook in
 * useNotificationsRealtime.ts can stay decoupled from the modal's
 * mount tree, which matters because the realtime hook lives high in
 * the App tree and the modal renders its own portal.
 */
export function dispatchRankUp(payload: RankUpPayload): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent<RankUpPayload>(RANK_UP_EVENT, { detail: payload }),
  );
}
