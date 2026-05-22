export type SentimentChoice = "support" | "neutral" | "oppose";

export interface SentimentPollVoteShape {
  userVote: string | null;
  supportCount: number;
  neutralCount: number;
  opposeCount: number;
  totalVotes: number;
  approvePercent: number;
  neutralPercent: number;
  disapprovePercent: number;
}

function recomputePercents(
  support: number,
  neutral: number,
  oppose: number,
  total: number,
): Pick<SentimentPollVoteShape, "approvePercent" | "neutralPercent" | "disapprovePercent"> {
  if (total <= 0) {
    return { approvePercent: 0, neutralPercent: 0, disapprovePercent: 0 };
  }
  return {
    approvePercent: Math.round((support / total) * 100),
    neutralPercent: Math.round((neutral / total) * 100),
    disapprovePercent: Math.round((oppose / total) * 100),
  };
}

function bumpChoice(
  counts: { support: number; neutral: number; oppose: number },
  choice: SentimentChoice,
  delta: number,
): { support: number; neutral: number; oppose: number } {
  if (choice === "support") return { ...counts, support: Math.max(0, counts.support + delta) };
  if (choice === "neutral") return { ...counts, neutral: Math.max(0, counts.neutral + delta) };
  return { ...counts, oppose: Math.max(0, counts.oppose + delta) };
}

export function optimisticSentimentVotePatch<P extends SentimentPollVoteShape>(
  poll: P,
  choice: SentimentChoice,
): P {
  const prev = poll.userVote as SentimentChoice | null;
  if (prev === choice) return poll;

  let counts = {
    support: poll.supportCount,
    neutral: poll.neutralCount,
    oppose: poll.opposeCount,
  };
  let total = poll.totalVotes;

  if (prev) {
    counts = bumpChoice(counts, prev, -1);
    counts = bumpChoice(counts, choice, 1);
  } else {
    counts = bumpChoice(counts, choice, 1);
    total += 1;
  }

  const percents = recomputePercents(counts.support, counts.neutral, counts.oppose, total);
  return {
    ...poll,
    userVote: choice,
    supportCount: counts.support,
    neutralCount: counts.neutral,
    opposeCount: counts.oppose,
    totalVotes: total,
    ...percents,
  };
}
