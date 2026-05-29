/**
 * Pure display builders for vote_actions rows (admin activity feed).
 */

import type { LedgerMetadata } from "./credit-history-display";
import { metaString } from "./credit-history-display";

export interface VoteActionDisplayFields {
  displayTitle: string;
  displaySubtitle?: string;
  href?: string;
}

export const VOTE_ACTION_SURFACE_LABELS: Record<string, string> = {
  face_off: "Matchup vote",
  sentiment: "Sentiment vote",
  value_vote: "Value rating",
  trending_poll: "Sentiment poll vote",
  opinion_poll: "Opinion poll vote",
  image_curate: "Image curation vote",
  induction: "Induction vote",
  overall_rating: "Overall rating",
  comment_vote: "Comment vote",
  insight_vote: "Insight vote",
};

export function surfaceLabelForVoteType(voteType: string): string {
  return VOTE_ACTION_SURFACE_LABELS[voteType] ?? "Vote";
}

export function labelForVoteActionKind(actionKind: string): string {
  switch (actionKind) {
    case "create":
      return "New vote";
    case "update":
      return "Changed vote";
    case "remove":
      return "Removed vote";
    default:
      return actionKind;
  }
}

export function formatFaceOffChoice(value: string | null | undefined): string | null {
  if (value == null || value === "") return null;
  switch (value) {
    case "option_a":
      return "Option A";
    case "option_b":
      return "Option B";
    case "neutral":
      return "Neutral";
    default:
      return value.replace(/_/g, " ");
  }
}

export function formatSentimentChoice(value: string | null | undefined): string | null {
  if (value == null || value === "") return null;
  return value.replace(/_/g, " ");
}

export function formatInsightOrCommentVote(value: string | null | undefined): string | null {
  if (value == null || value === "") return null;
  if (value === "up") return "Upvote";
  if (value === "down") return "Downvote";
  return value;
}

export type VoteActionDisplayContext = {
  personName?: string | null;
  personId?: string | null;
  matchupTitle?: string | null;
  matchupSlug?: string | null;
  optionAText?: string | null;
  optionBText?: string | null;
  pollHeadline?: string | null;
  trendingPollSlug?: string | null;
  pollTitle?: string | null;
  opinionPollSlug?: string | null;
  optionName?: string | null;
  candidateName?: string | null;
  commentSnippet?: string | null;
  insightSnippet?: string | null;
  insightPersonName?: string | null;
  insightPersonId?: string | null;
};

function activeVoteValue(
  actionKind: string,
  prevValue: string | null,
  nextValue: string | null,
): string | null {
  if (actionKind === "remove") return prevValue;
  return nextValue ?? prevValue;
}

export function buildVoteActionDisplay(
  params: {
    voteType: string;
    actionKind: string;
    targetId: string;
    prevValue?: string | null;
    nextValue?: string | null;
    metadata?: LedgerMetadata | null;
  },
  context: VoteActionDisplayContext = {},
): VoteActionDisplayFields {
  const { voteType, actionKind, prevValue, nextValue, metadata } = params;
  const surfaceLabel = surfaceLabelForVoteType(voteType);
  const actionLabel = labelForVoteActionKind(actionKind);
  const value = activeVoteValue(actionKind, prevValue ?? null, nextValue ?? null);

  let displayTitle = surfaceLabel;
  let href: string | undefined;

  switch (voteType) {
    case "face_off": {
      const choice = formatFaceOffChoice(value);
      const matchup = context.matchupTitle ?? "Matchup";
      if (choice && context.optionAText && context.optionBText) {
        const picked =
          value === "option_a"
            ? context.optionAText
            : value === "option_b"
              ? context.optionBText
              : choice;
        displayTitle = `Voted ${picked} on ${matchup}`;
      } else if (choice) {
        displayTitle = `Voted ${choice} on ${matchup}`;
      } else {
        displayTitle = matchup;
      }
      href = context.matchupSlug
        ? `/vote/matchups/${context.matchupSlug}`
        : "/vote";
      break;
    }
    case "sentiment": {
      const person = context.personName ?? "Person";
      const choice = formatSentimentChoice(value);
      displayTitle = choice ? `Rated ${person} ${choice}` : person;
      href = context.personId ? `/person/${context.personId}` : "/vote";
      break;
    }
    case "value_vote": {
      const person = context.personName ?? "Person";
      const choice = formatSentimentChoice(value);
      displayTitle = choice ? `${person} (${choice})` : person;
      href = context.personId ? `/person/${context.personId}` : "/vote/value-ratings";
      break;
    }
    case "trending_poll": {
      const headline = context.pollHeadline ?? "Poll";
      const choice = value ? value.charAt(0).toUpperCase() + value.slice(1) : null;
      displayTitle = choice ? `${headline} (${choice})` : headline;
      href = context.trendingPollSlug
        ? `/polls/${context.trendingPollSlug}`
        : "/vote";
      break;
    }
    case "opinion_poll": {
      const title = context.pollTitle ?? "Opinion poll";
      const opt = context.optionName;
      displayTitle = opt ? `${title} — ${opt}` : title;
      href = context.opinionPollSlug
        ? `/vote/opinion-polls/${context.opinionPollSlug}`
        : "/vote";
      break;
    }
    case "image_curate": {
      const person = context.personName ?? "Person";
      displayTitle = `Curated image for ${person}`;
      href = context.personId ? `/person/${context.personId}` : "/vote";
      break;
    }
    case "induction": {
      displayTitle = context.candidateName ?? "Induction candidate";
      href = "/vote/induction";
      break;
    }
    case "overall_rating": {
      const person = context.personName ?? "Person";
      displayTitle = value ? `Rated ${person} ${value}/10` : person;
      href = context.personId ? `/person/${context.personId}` : "/vote";
      break;
    }
    case "comment_vote": {
      const dir = formatInsightOrCommentVote(value);
      const snippet = context.commentSnippet;
      displayTitle = snippet
        ? `${dir ?? "Vote"} on comment: ${snippet}`
        : dir
          ? `${dir} on comment`
          : "Comment vote";
      break;
    }
    case "insight_vote": {
      const dir = formatInsightOrCommentVote(value);
      const person = context.insightPersonName;
      const snippet = context.insightSnippet;
      if (snippet && person) {
        displayTitle = `${dir ?? "Vote"} on ${person}'s insight`;
      } else if (snippet) {
        displayTitle = `${dir ?? "Vote"} on insight`;
      } else if (person) {
        displayTitle = `${dir ?? "Vote"} · ${person}`;
      } else {
        displayTitle = dir ? `${dir} on insight` : "Insight vote";
      }
      href = context.insightPersonId
        ? `/person/${context.insightPersonId}`
        : undefined;
      break;
    }
    default: {
      const metaPerson = metaString(metadata ?? null, "personId");
      if (context.personName) {
        displayTitle = context.personName;
        href = context.personId
          ? `/person/${context.personId}`
          : metaPerson
            ? `/person/${metaPerson}`
            : undefined;
      }
      break;
    }
  }

  return {
    displayTitle,
    displaySubtitle: `${surfaceLabel} · ${actionLabel}`,
    href,
  };
}
