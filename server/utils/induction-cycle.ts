import { getWeekContext } from "../native-markets/week-context";

export interface InductionWinnerCandidate {
  id: string;
  displayName: string;
  seedVotes: number;
  postCloseVotes: number;
}

export interface InductionWinnerSnapshot extends InductionWinnerCandidate {
  voteTotalAtClose: number;
}

export function getMostRecentInductionClose(now: Date = new Date()): Date {
  const { sunday } = getWeekContext(now);
  if (now.getTime() > sunday.getTime()) {
    return sunday;
  }

  const previousSunday = new Date(sunday);
  previousSunday.setUTCDate(previousSunday.getUTCDate() - 7);
  return previousSunday;
}

function firstName(value: string): string {
  return value.trim().split(/\s+/)[0]?.toLocaleLowerCase("en-US") ?? "";
}

export function voteTotalAtClose(candidate: InductionWinnerCandidate): number {
  return Math.max(0, Number(candidate.seedVotes || 0) - Number(candidate.postCloseVotes || 0));
}

export function selectInductionWinner(candidates: InductionWinnerCandidate[]): InductionWinnerSnapshot | null {
  if (candidates.length === 0) return null;

  const ranked = candidates
    .map((candidate) => ({
      ...candidate,
      voteTotalAtClose: voteTotalAtClose(candidate),
    }))
    .sort((a, b) => {
      const voteDiff = b.voteTotalAtClose - a.voteTotalAtClose;
      if (voteDiff !== 0) return voteDiff;

      const firstNameDiff = firstName(a.displayName).localeCompare(firstName(b.displayName), "en-US", { sensitivity: "base" });
      if (firstNameDiff !== 0) return firstNameDiff;

      const nameDiff = a.displayName.localeCompare(b.displayName, "en-US", { sensitivity: "base" });
      if (nameDiff !== 0) return nameDiff;

      return a.id.localeCompare(b.id);
    });

  return ranked[0];
}
