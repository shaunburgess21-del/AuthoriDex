export type MatchupVoteOption = "option_a" | "option_b" | "neutral";

export interface MatchupVoteShape {
  optionAVotes: number;
  optionBVotes: number;
  neutralVotes: number;
  totalVotes: number;
  optionAPercent: number;
  optionBPercent: number;
  neutralPercent: number;
}

function recomputeMatchupPercents(
  a: number,
  b: number,
  n: number,
  total: number,
): Pick<MatchupVoteShape, "optionAPercent" | "optionBPercent" | "neutralPercent"> {
  if (total <= 0) {
    return { optionAPercent: 0, optionBPercent: 0, neutralPercent: 0 };
  }
  return {
    optionAPercent: Math.round((a / total) * 100),
    optionBPercent: Math.round((b / total) * 100),
    neutralPercent: Math.round((n / total) * 100),
  };
}

function bumpOption(
  matchup: MatchupVoteShape,
  option: MatchupVoteOption,
  delta: number,
): MatchupVoteShape {
  const next = { ...matchup };
  if (option === "option_a") next.optionAVotes = Math.max(0, next.optionAVotes + delta);
  else if (option === "option_b") next.optionBVotes = Math.max(0, next.optionBVotes + delta);
  else next.neutralVotes = Math.max(0, next.neutralVotes + delta);
  return next;
}

export function optimisticMatchupVotePatch<P extends MatchupVoteShape>(
  matchup: P,
  option: MatchupVoteOption,
  previousVote: MatchupVoteOption | null | undefined,
): P {
  let m = { ...matchup };
  if (previousVote) {
    m = bumpOption(m, previousVote, -1);
    m = bumpOption(m, option, 1);
  } else {
    m = bumpOption(m, option, 1);
    m = { ...m, totalVotes: m.totalVotes + 1 };
  }
  const percents = recomputeMatchupPercents(
    m.optionAVotes,
    m.optionBVotes,
    m.neutralVotes,
    m.totalVotes,
  );
  return { ...m, ...percents };
}

export function optimisticMatchupRemovePatch<P extends MatchupVoteShape>(
  matchup: P,
  previousVote: MatchupVoteOption,
): P {
  let m = bumpOption({ ...matchup }, previousVote, -1);
  m = { ...m, totalVotes: Math.max(0, m.totalVotes - 1) };
  const percents = recomputeMatchupPercents(
    m.optionAVotes,
    m.optionBVotes,
    m.neutralVotes,
    m.totalVotes,
  );
  return { ...m, ...percents };
}
