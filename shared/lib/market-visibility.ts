/**
 * World Market visibility helpers.
 *
 * Scout drafts land as `draft` with AMM seed deferred until a founder
 * publishes. Settlement recommendations (AI resolve_now, Settlement Center
 * queue) must only target markets that were actually made available —
 * `live` or temporarily `inactive` — never drafts or archived rows.
 */

export const SETTLEMENT_ELIGIBLE_VISIBILITIES = ["live", "inactive"] as const;

export type SettlementEligibleVisibility =
  (typeof SETTLEMENT_ELIGIBLE_VISIBILITIES)[number];

/** True when a World Market should appear in resolve / AI-resolve queues. */
export function isSettlementEligibleVisibility(
  visibility: string | null | undefined,
): boolean {
  return visibility === "live" || visibility === "inactive";
}
