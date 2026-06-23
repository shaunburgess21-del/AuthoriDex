/** Stored on `window.history.state.voteList` when opening a Vote detail from a list context. */
export type VoteListNavType = "sentiment" | "matchup" | "opinion";

export interface VoteListHistoryState {
  type: VoteListNavType;
  slugs: string[];
  currentSlug: string;
  /** Number of history entries pushed since VotePage (or equivalent list entry). */
  historyDepth: number;
  /** Vote hub section anchor to restore on back (e.g. vote-matchups). */
  returnHashId: string;
  /** Main list scroll position when the detail page was opened. */
  scrollY: number;
  /** Section filter chip active when the detail page was opened (e.g. "All", "Matchups"). */
  activeSection: string;
}

export const VOTE_DETAIL_PATH_PREFIX: Record<VoteListNavType, string> = {
  sentiment: "/polls/",
  matchup: "/vote/matchups/",
  opinion: "/vote/opinion-polls/",
};

const RETURN_HASH_BY_TYPE: Record<VoteListNavType, string> = {
  sentiment: "vote-sentiment",
  matchup: "vote-matchups",
  opinion: "vote-opinion",
};

/** @deprecated Use VOTE_HUB_RETURN_KEY */
export const VOTE_HUB_RETURN_SCROLL_KEY = "voteHubReturnScroll";

export const VOTE_HUB_RETURN_KEY = "voteHubReturn";

export interface VoteHubReturnState {
  activeSection: string;
  anchorHashId: string;
  scrollY?: number;
}

export function voteHubReturnHashForType(type: VoteListNavType): string {
  return RETURN_HASH_BY_TYPE[type];
}

export function buildVoteListState(args: {
  type: VoteListNavType;
  slugs: string[];
  currentSlug: string;
  historyDepth?: number;
  scrollY?: number;
  activeSection?: string;
}): VoteListHistoryState {
  return {
    type: args.type,
    slugs: args.slugs,
    currentSlug: args.currentSlug,
    historyDepth: args.historyDepth ?? 1,
    returnHashId: voteHubReturnHashForType(args.type),
    scrollY: args.scrollY ?? (typeof window !== "undefined" ? window.scrollY : 0),
    activeSection: args.activeSection ?? "All",
  };
}

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

export function writeVoteHubReturnState(state: VoteHubReturnState): void {
  try {
    sessionStorage.setItem(VOTE_HUB_RETURN_KEY, JSON.stringify(state));
  } catch {
    /* ignore */
  }
}

export function readVoteHubReturnState(): VoteHubReturnState | null {
  try {
    const raw = sessionStorage.getItem(VOTE_HUB_RETURN_KEY);
    if (!raw) return null;
    sessionStorage.removeItem(VOTE_HUB_RETURN_KEY);
    return JSON.parse(raw) as VoteHubReturnState;
  } catch {
    return null;
  }
}

const SCROLL_ANCHOR_MAX_ATTEMPTS = 24;

/** Scroll to a Vote hub section anchor without changing the URL hash (avoids filter sync). */
export function scrollToVoteHubAnchor(anchorHashId: string, attempt = 0): void {
  const el = document.getElementById(anchorHashId);
  if (el) {
    el.scrollIntoView({ block: "start" });
    return;
  }
  if (attempt < SCROLL_ANCHOR_MAX_ATTEMPTS) {
    requestAnimationFrame(() => scrollToVoteHubAnchor(anchorHashId, attempt + 1));
  }
}

/** Return to Vote hub: restore filter chip and scroll/anchor, not hash-driven filter. */
export function navigateBackToVoteHub(
  setLocation: (path: string) => void,
  voteList: VoteListHistoryState,
): void {
  const returnState: VoteHubReturnState = {
    activeSection: voteList.activeSection ?? "All",
    anchorHashId: voteList.returnHashId || voteHubReturnHashForType(voteList.type),
    scrollY: voteList.scrollY ?? 0,
  };
  try {
    sessionStorage.setItem(VOTE_HUB_RETURN_KEY, JSON.stringify(returnState));
  } catch {
    /* ignore */
  }
  setLocation("/vote");
}
