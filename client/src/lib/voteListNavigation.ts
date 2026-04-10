/** Stored on `window.history.state.voteList` when opening a Vote detail from a list context. */
export type VoteListNavType = "sentiment" | "matchup" | "opinion";

export interface VoteListHistoryState {
  type: VoteListNavType;
  slugs: string[];
  currentSlug: string;
}

export const VOTE_DETAIL_PATH_PREFIX: Record<VoteListNavType, string> = {
  sentiment: "/polls/",
  matchup: "/vote/matchups/",
  opinion: "/vote/opinion-polls/",
};

export function mergeVoteListIntoHistory(voteList: VoteListHistoryState): void {
  window.history.replaceState(
    { ...window.history.state, voteList },
    "",
    window.location.href,
  );
}

export function navigateWithVoteList(
  setLocation: (path: string) => void,
  voteList: VoteListHistoryState,
  targetPath: string,
): void {
  setLocation(targetPath);
  mergeVoteListIntoHistory(voteList);
}
