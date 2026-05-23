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

function bumpOption<P extends MatchupVoteShape>(
  matchup: P,
  option: MatchupVoteOption,
  delta: number,
): P {
  if (option === "option_a") {
    return { ...matchup, optionAVotes: Math.max(0, matchup.optionAVotes + delta) };
  }
  if (option === "option_b") {
    return { ...matchup, optionBVotes: Math.max(0, matchup.optionBVotes + delta) };
  }
  return { ...matchup, neutralVotes: Math.max(0, matchup.neutralVotes + delta) };
}

export function optimisticMatchupVotePatch<P extends MatchupVoteShape>(
  matchup: P,
  option: MatchupVoteOption,
  previousVote: MatchupVoteOption | null | undefined,
): P {
  let m: P = { ...matchup };
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
  return { ...m, ...percents } as P;
}

export function optimisticMatchupRemovePatch<P extends MatchupVoteShape>(
  matchup: P,
  previousVote: MatchupVoteOption,
): P {
  let m: P = bumpOption({ ...matchup }, previousVote, -1);
  m = { ...m, totalVotes: Math.max(0, m.totalVotes - 1) };
  const percents = recomputeMatchupPercents(
    m.optionAVotes,
    m.optionBVotes,
    m.neutralVotes,
    m.totalVotes,
  );
  return { ...m, ...percents } as P;
}
