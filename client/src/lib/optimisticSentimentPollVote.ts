import type { SentimentPollChoice } from "@shared/lib/sentiment-poll-choice";

export type SentimentChoice = SentimentPollChoice;

export interface SentimentPollVoteShape {
  userVote: string | null;
  agreeCount: number;
  neutralCount: number;
  disagreeCount: number;
  totalVotes: number;
  agreePercent: number;
  neutralPercent: number;
  disagreePercent: number;
}

function recomputePercents(
  agree: number,
  neutral: number,
  disagree: number,
  total: number,
): Pick<SentimentPollVoteShape, "agreePercent" | "neutralPercent" | "disagreePercent"> {
  if (total <= 0) {
    return { agreePercent: 0, neutralPercent: 0, disagreePercent: 0 };
  }
  return {
    agreePercent: Math.round((agree / total) * 100),
    neutralPercent: Math.round((neutral / total) * 100),
    disagreePercent: Math.round((disagree / total) * 100),
  };
}

function bumpChoice(
  counts: { agree: number; neutral: number; disagree: number },
  choice: SentimentChoice,
  delta: number,
): { agree: number; neutral: number; disagree: number } {
  if (choice === "agree") return { ...counts, agree: Math.max(0, counts.agree + delta) };
  if (choice === "neutral") return { ...counts, neutral: Math.max(0, counts.neutral + delta) };
  return { ...counts, disagree: Math.max(0, counts.disagree + delta) };
}

export function optimisticSentimentVotePatch<P extends SentimentPollVoteShape>(
  poll: P,
  choice: SentimentChoice,
): P {
  const prev = poll.userVote as SentimentChoice | null;
  if (prev === choice) return poll;

  let counts = {
    agree: poll.agreeCount,
    neutral: poll.neutralCount,
    disagree: poll.disagreeCount,
  };
  let total = poll.totalVotes;

  if (prev) {
    counts = bumpChoice(counts, prev, -1);
    counts = bumpChoice(counts, choice, 1);
  } else {
    counts = bumpChoice(counts, choice, 1);
    total += 1;
  }

  const percents = recomputePercents(counts.agree, counts.neutral, counts.disagree, total);
  return {
    ...poll,
    userVote: choice,
    agreeCount: counts.agree,
    neutralCount: counts.neutral,
    disagreeCount: counts.disagree,
    totalVotes: total,
    ...percents,
  };
}
