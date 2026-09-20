/**
 * Quick Vote "hide voted cards" preference + per-type voted predicate.
 *
 * The preference is device-level (not per user): Quick Vote is anon-first
 * and the hub's per-user activity filter key requires a userId. The voted
 * predicate mirrors the checks VotePage's hide-mine mode already uses — all
 * of them work for anonymous visitors via the fdx_sid cookie, with the
 * rating card additionally falling back to the localStorage key the rating
 * widgets write (see readSavedRating in OverallRatingCard).
 */
import type { OverallRatingPerson } from "@/components/OverallRatingCard";

const HIDE_VOTED_KEY = "voxdex_quick_vote_hide_voted";
const TIP_SEEN_KEY = "voxdex_qv_hide_voted_tip_seen";

export function readHideVotedPreference(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(HIDE_VOTED_KEY) === "1";
  } catch {
    return false;
  }
}

export function writeHideVotedPreference(enabled: boolean): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(HIDE_VOTED_KEY, enabled ? "1" : "0");
  } catch {
    /* Preference persistence is optional in private browsing. */
  }
}

export function hasSeenHideVotedTip(): boolean {
  if (typeof window === "undefined") return true;
  try {
    return window.localStorage.getItem(TIP_SEEN_KEY) === "1";
  } catch {
    return true;
  }
}

export function markHideVotedTipSeen(): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(TIP_SEEN_KEY, "1");
  } catch {
    /* ignore */
  }
}

/** Anon / pre-refetch fallback written by every rating widget. */
export function readSavedRatingVote(personId: string): boolean {
  if (typeof window === "undefined") return false;
  try {
    const saved = window.localStorage.getItem(`sentiment-vote-${personId}`);
    const n = saved ? parseInt(saved, 10) : NaN;
    return n >= 1 && n <= 5;
  } catch {
    return false;
  }
}

export type QuickVoteCardKind = "matchup" | "sentiment" | "opinion" | "rating";

export interface QuickVoteVotedSources {
  matchupUserVotes: Record<string, string>;
  sentimentPolls: Array<{ id: string; userVote?: unknown }>;
  opinionPolls: Array<{ id: string; userVote?: unknown }>;
  ratingPeople: OverallRatingPerson[];
}

export function isQuickVoteCardVoted(
  type: QuickVoteCardKind | undefined,
  id: string,
  sources: QuickVoteVotedSources,
): boolean {
  switch (type) {
    case "matchup":
      return !!sources.matchupUserVotes[id];
    case "sentiment":
      return !!sources.sentimentPolls.find((t) => t.id === id)?.userVote;
    case "opinion":
      return !!sources.opinionPolls.find((p) => p.id === id)?.userVote;
    case "rating": {
      const person = sources.ratingPeople.find((p) => p.id === id);
      if (person?.userApprovalRating != null) return true;
      return readSavedRatingVote(id);
    }
    default:
      return false;
  }
}
