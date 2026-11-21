/**
 * Head-to-head percentages and the result bar stay hidden until the viewer
 * has voted, or the matchup is closed (inactive) and results are public.
 */
export function matchupResultsVisible(args: {
  userVote: string | null | undefined;
  isActive?: boolean;
  visibility?: string | null;
}): boolean {
  if (args.userVote != null && args.userVote !== "") return true;
  if (args.isActive === false) return true;
  if (args.visibility === "inactive") return true;
  return false;
}
