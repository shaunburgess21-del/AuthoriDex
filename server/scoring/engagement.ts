/**
 * VoxDex user-engagement attention signal (Option C).
 * Blended into the one hourly fame_index with a volume-gated weight (~0 pre-launch).
 */

import { clamp } from "./utils";

/** Max blend weight when fleet volume gate is saturated (default 0 = inert). */
export function getEngagementWeightMax(): number {
  if (envOff(process.env.ENGAGEMENT_WEIGHT_DISABLED)) return 0;
  const raw = Number(process.env.ENGAGEMENT_WEIGHT_MAX);
  return Number.isFinite(raw) && raw >= 0 && raw <= 0.25 ? raw : 0;
}

/** Fleet-wide verified engagement events required before weight ramps up. */
export function getEngagementVolumeGate(): number {
  const raw = Number(process.env.ENGAGEMENT_VOLUME_GATE);
  return Number.isFinite(raw) && raw > 0 ? raw : 500;
}

/** Per-person hourly caps (after aggregation, before scoring). */
export const ENGAGEMENT_VOTE_CAP_PER_HOUR = 10;
export const ENGAGEMENT_VIEW_CAP_PER_HOUR = 100;

function envOff(value: string | undefined): boolean {
  if (typeof value !== "string") return false;
  const v = value.trim().toLowerCase();
  return v === "true" || v === "1" || v === "yes" || v === "on";
}

/**
 * Volume/confidence gate: 0 until fleet has enough verified activity, then 0..1.
 * Multiply by ENGAGEMENT_WEIGHT_MAX for the actual blend weight `w`.
 */
export function computeEngagementConfidenceGate(fleetTotalEvents: number): number {
  const gate = getEngagementVolumeGate();
  if (gate <= 0 || fleetTotalEvents <= 0) return 0;
  return clamp(fleetTotalEvents / gate, 0, 1);
}

export function computeEngagementBlendWeight(fleetTotalEvents: number): number {
  const maxW = getEngagementWeightMax();
  if (maxW <= 0) return 0;
  return maxW * computeEngagementConfidenceGate(fleetTotalEvents);
}

/**
 * Map capped hourly votes + profile views to 0..100 (same scale as mass/velocity).
 */
export function normalizeEngagementScore(
  votes: number,
  profileViews: number,
): number {
  const v = Math.min(Math.max(votes, 0), ENGAGEMENT_VOTE_CAP_PER_HOUR);
  const views = Math.min(Math.max(profileViews, 0), ENGAGEMENT_VIEW_CAP_PER_HOUR);
  const combined = v * 3 + views * 0.25;
  if (combined <= 0) return 0;
  return clamp(Math.round(Math.log1p(combined) * 28), 0, 100);
}

export function capEngagementInputs(
  votes: number,
  profileViews: number,
): { votes: number; profileViews: number } {
  return {
    votes: Math.min(Math.max(votes, 0), ENGAGEMENT_VOTE_CAP_PER_HOUR),
    profileViews: Math.min(Math.max(profileViews, 0), ENGAGEMENT_VIEW_CAP_PER_HOUR),
  };
}
