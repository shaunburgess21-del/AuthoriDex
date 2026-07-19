/**
 * Detect open-ended aggregate / leaderboard markets ("most goals", Golden Boot,
 * top scorer, etc.) where a provisional lead is not a final result while the
 * event window is still open.
 *
 * Also hardens premature scout assessments so ops UI does not show
 * "Resolve now" / stage "met" while fixtures can still change standings.
 */

import { isOtherStyleOutcomeLabel } from "./other-outcome";

export interface AggregateLeaderboardMarketInput {
  title?: string | null;
  teaser?: string | null;
  resolutionCriteria?: string[] | null;
}

/**
 * endAt is often the scheduled final kickoff, not full-time. Hold the
 * aggregate window open a few hours past endAt so mid-match "met" calls
 * still get downgraded.
 */
export const AGGREGATE_LEADERBOARD_POST_END_GRACE_MS = 3 * 60 * 60 * 1000;

const AGGREGATE_LEADERBOARD_RE =
  /\b(?:who\s+will\s+score\s+the\s+most|score\s+the\s+most|most\s+goals?|most\s+points?|most\s+assists?|most\s+wins?|most\s+runs?|top\s+scorer|leading\s+scorer|highest\s+scorer|top\s+goal\s*scorer|leading\s+goal\s*scorer|golden\s+boot|ballon\s+d['’]?or|cy\s+young|scoring\s+title|leading\s+the\s+(?:tournament|league)\s+in\s+(?:goals?|points?))\b/i;

export type AggregateScoutStage = "watch" | "likely" | "near_certain" | "met";
export type AggregateScoutAction =
  | "none"
  | "watch"
  | "resolve_soon"
  | "resolve_now";

/** Minimal assessment shape shared by the resolution scout + unit tests. */
export interface AggregateScoutAssessmentLike {
  leaning: string;
  proposedWinnerEntryId: string | null;
  confidence: number;
  stage: AggregateScoutStage;
  recommendedAction: AggregateScoutAction;
  whatChanged: string;
  sources: string[];
  assessedAt: string;
  signature: string;
}

/**
 * True when title/criteria describe a cumulative leaderboard award rather than
 * a single match or binary event.
 */
export function isAggregateLeaderboardMarket(
  input: AggregateLeaderboardMarketInput,
): boolean {
  const parts = [
    input.title ?? "",
    input.teaser ?? "",
    ...(input.resolutionCriteria ?? []),
  ]
    .map((s) => (typeof s === "string" ? s.trim() : ""))
    .filter(Boolean);
  if (parts.length === 0) return false;
  return parts.some((text) => AGGREGATE_LEADERBOARD_RE.test(text));
}

/**
 * True while the market's resolution window is still open — remaining fixtures
 * or official counting can still change the leaderboard. Includes a post-endAt
 * grace so scheduled kickoff times don't unlock "met" mid-match.
 */
export function isAggregateLeaderboardWindowOpen(
  endAt: Date | string | null | undefined,
  now: Date = new Date(),
  graceMs: number = AGGREGATE_LEADERBOARD_POST_END_GRACE_MS,
): boolean {
  if (!endAt) return false;
  const end = endAt instanceof Date ? endAt : new Date(endAt);
  if (Number.isNaN(end.getTime())) return false;
  return now.getTime() < end.getTime() + Math.max(0, graceMs);
}

function assessmentSignature(
  stage: AggregateScoutStage,
  recommendedAction: AggregateScoutAction,
  proposedWinnerEntryId: string | null,
): string {
  return `${stage}|${recommendedAction}|${proposedWinnerEntryId ?? "none"}`;
}

/**
 * Downgrade premature "met" / "resolve_now" on open aggregate leaderboard
 * markets. A provisional lead while fixtures remain is never a locked result —
 * especially not "Other" while listed contenders can still catch the leader.
 */
export function hardenAggregateLeaderboardAssessment<
  T extends AggregateScoutAssessmentLike,
>(
  assessment: T,
  market: AggregateLeaderboardMarketInput & {
    endAt?: Date | string | null;
  },
  entries: Array<{ id: string; label: string }>,
  now: Date = new Date(),
): T {
  if (!isAggregateLeaderboardMarket(market)) {
    return assessment;
  }
  if (!isAggregateLeaderboardWindowOpen(market.endAt ?? null, now)) {
    return assessment;
  }

  const prematureStage =
    assessment.stage === "met" || assessment.stage === "near_certain";
  const prematureAction =
    assessment.recommendedAction === "resolve_now" ||
    assessment.recommendedAction === "resolve_soon";
  if (!prematureStage && !prematureAction) {
    return assessment;
  }

  const proposed = entries.find((e) => e.id === assessment.proposedWinnerEntryId);
  const proposedIsOther = proposed
    ? isOtherStyleOutcomeLabel(proposed.label)
    : isOtherStyleOutcomeLabel(assessment.leaning);

  // Keep a leaning for ops, but never treat it as ready to resolve while the
  // window is open. Clear Other as a proposed winner — it is especially easy
  // to false-positive when an unlisted player currently leads.
  let leaning = assessment.leaning;
  let proposedWinnerEntryId = assessment.proposedWinnerEntryId;
  if (proposedIsOther) {
    proposedWinnerEntryId = null;
    if (!leaning.toLowerCase().includes("provisional")) {
      leaning = `${leaning} (provisional — event still open)`.slice(0, 120);
    }
  }

  const holdNote =
    "Held: aggregate/leaderboard market still open — remaining fixtures can change the leader.";
  const whatChanged = assessment.whatChanged.includes("Held: aggregate/leaderboard")
    ? assessment.whatChanged
    : `${assessment.whatChanged.replace(/\s*$/, "")} (${holdNote})`;

  const stage: AggregateScoutStage = "likely";
  const recommendedAction: AggregateScoutAction = "watch";
  const confidence = Math.min(assessment.confidence, 0.85);

  return {
    ...assessment,
    leaning,
    proposedWinnerEntryId,
    confidence,
    stage,
    recommendedAction,
    whatChanged,
    signature: assessmentSignature(stage, recommendedAction, proposedWinnerEntryId),
  };
}
