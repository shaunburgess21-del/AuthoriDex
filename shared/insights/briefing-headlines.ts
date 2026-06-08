/** Live mover line — recomputed on each overview load from 24h climbers. */
export function formatBriefingMoverHeadline(name: string): string {
  return `${name} leads today's biggest movers`;
}

/** Live board-leader line — recomputed on each overview load from rank #1. */
export function formatBriefingBoardHeadline(name: string): string {
  return `${name} tops the leaderboard`;
}

export interface BriefingHeadlinePerson {
  id: string;
  name: string;
}

/** Build the 1–2 display lines for the Today tab briefing header. */
export function buildBriefingDisplayHeadlines(params: {
  liveMover?: BriefingHeadlinePerson | null;
  boardLeader?: BriefingHeadlinePerson | null;
  /** Used when no live climber is available (e.g. thin movers board). */
  fallbackHeadline?: string;
}): string[] {
  const { liveMover, boardLeader, fallbackHeadline } = params;
  const samePerson =
    liveMover && boardLeader && liveMover.id === boardLeader.id;

  const lines: string[] = [];

  if (liveMover) {
    lines.push(formatBriefingMoverHeadline(liveMover.name));
  } else if (fallbackHeadline) {
    lines.push(fallbackHeadline);
  }

  if (boardLeader && !samePerson) {
    lines.push(formatBriefingBoardHeadline(boardLeader.name));
  }

  return lines;
}
