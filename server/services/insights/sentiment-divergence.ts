// Pure press-vs-crowd divergence helpers (no DB / API deps).

import type { InsightsDivergenceType } from "@shared/insights/types";

/** Minimum point gap between web % and crowd approval % to count as divergent. */
export const SENTIMENT_DIVERGENCE_MIN_GAP = 25;

/** Press reads positive; crowd reads cool. */
export const PRESS_LOVED_WEB_MIN = 55;
export const PRESS_LOVED_APPROVAL_MAX = 50;

/** Crowd reads positive; press reads critical. */
export const CROWD_LOVED_APPROVAL_MIN = 55;
export const CROWD_LOVED_WEB_MAX = 45;

export type PressVsCrowdDivergenceType =
  | "press_loved_crowd_cool"
  | "crowd_loved_press_critical";

export function sentimentApprovalGap(
  webPositivePct: number | null,
  approvalPct: number | null,
): number | null {
  if (
    webPositivePct == null
    || approvalPct == null
    || !Number.isFinite(webPositivePct)
    || !Number.isFinite(approvalPct)
  ) {
    return null;
  }
  return Math.round(webPositivePct - approvalPct);
}

export function classifyPressVsCrowd(
  webPositivePct: number | null,
  approvalPct: number | null,
): PressVsCrowdDivergenceType | null {
  const gap = sentimentApprovalGap(webPositivePct, approvalPct);
  if (gap == null || Math.abs(gap) < SENTIMENT_DIVERGENCE_MIN_GAP) return null;

  if (
    webPositivePct! >= PRESS_LOVED_WEB_MIN
    && approvalPct! <= PRESS_LOVED_APPROVAL_MAX
    && gap >= SENTIMENT_DIVERGENCE_MIN_GAP
  ) {
    return "press_loved_crowd_cool";
  }

  if (
    approvalPct! >= CROWD_LOVED_APPROVAL_MIN
    && webPositivePct! <= CROWD_LOVED_WEB_MAX
    && gap <= -SENTIMENT_DIVERGENCE_MIN_GAP
  ) {
    return "crowd_loved_press_critical";
  }

  return null;
}

export function buildSentimentHighlight(
  type: PressVsCrowdDivergenceType,
  webPositivePct: number,
  approvalPct: number,
): string {
  const gap = sentimentApprovalGap(webPositivePct, approvalPct);
  const gapAbs = gap != null ? Math.abs(gap) : 0;
  if (type === "press_loved_crowd_cool") {
    return `Press ${Math.round(webPositivePct)}% positive vs crowd ${Math.round(approvalPct)}% approval (${gapAbs} pt gap)`;
  }
  return `Crowd ${Math.round(approvalPct)}% approval vs press ${Math.round(webPositivePct)}% positive (${gapAbs} pt gap)`;
}

export function isPressVsCrowdDivergenceType(
  type: InsightsDivergenceType,
): type is PressVsCrowdDivergenceType {
  return type === "press_loved_crowd_cool" || type === "crowd_loved_press_critical";
}
