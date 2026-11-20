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
  /** Section search text to restore when returning to the Vote hub. */
  listSearchQuery?: string;
  /** Mixed All-feed card (`kind:id`) to put back on screen. */
  feedCardKey?: string;
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
  /** Which vote list `listSearchQuery` belongs to. */
  listType?: VoteListNavType;
  /** Section search text captured when the detail page was opened. */
  listSearchQuery?: string;
  /** Mixed All-feed card (`kind:id`) to put back on screen. */
  feedCardKey?: string;
  /** Written by writeVoteHubReturnState; used to ignore stale restores. */
  ts?: number;
}

/** Expire return state so Vote → profile → elsewhere → Vote doesn't jump scroll. */
const VOTE_HUB_RETURN_TTL_MS = 5 * 60 * 1000;

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
  listSearchQuery?: string;
  feedCardKey?: string;
}): VoteListHistoryState {
  const listSearchQuery = args.listSearchQuery?.trim() ? args.listSearchQuery : undefined;
  return {
    type: args.type,
    slugs: args.slugs,
    currentSlug: args.currentSlug,
    historyDepth: args.historyDepth ?? 1,
    returnHashId: voteHubReturnHashForType(args.type),
    scrollY: args.scrollY ?? (typeof window !== "undefined" ? window.scrollY : 0),
    activeSection: args.activeSection ?? "All",
    ...(listSearchQuery ? { listSearchQuery } : {}),
    ...(args.feedCardKey ? { feedCardKey: args.feedCardKey } : {}),
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
    sessionStorage.setItem(
      VOTE_HUB_RETURN_KEY,
      JSON.stringify({ ...state, ts: Date.now() }),
    );
  } catch {
    /* ignore */
  }
}

export type VoteHubSearchSection =
  | "sentiment"
  | "matchup"
  | "opinion"
  | "rating"
  | "induction"
  | "curate";

const SEARCH_SECTION_BY_ANCHOR: Record<string, VoteHubSearchSection> = {
  "vote-sentiment": "sentiment",
  "vote-matchups": "matchup",
  "vote-opinion": "opinion",
  "vote-rating": "rating",
  "vote-induction": "induction",
  "vote-curate": "curate",
};

/** Which section search box a return payload should refill. */
export function voteHubSearchSection(
  state: Pick<VoteHubReturnState, "listType" | "anchorHashId" | "listSearchQuery"> | null | undefined,
): VoteHubSearchSection | null {
  if (!state?.listSearchQuery) return null;
  if (state.listType === "sentiment" || state.listType === "matchup" || state.listType === "opinion") {
    return state.listType;
  }
  return (state.anchorHashId && SEARCH_SECTION_BY_ANCHOR[state.anchorHashId]) || null;
}

/** Leave Vote hub for a person profile, stashing scroll/section for Back restore. */
export function navigateToPersonFromVoteHub(
  setLocation: (path: string) => void,
  personId: string,
  opts: {
    anchorHashId: string;
    activeSection: string;
    scrollY?: number;
    listSearchQuery?: string;
    feedCardKey?: string;
  },
): void {
  const listSearchQuery = opts.listSearchQuery?.trim() ? opts.listSearchQuery : undefined;
  writeVoteHubReturnState({
    activeSection: opts.activeSection,
    anchorHashId: opts.anchorHashId,
    scrollY:
      opts.scrollY ?? (typeof window !== "undefined" ? window.scrollY : 0),
    ...(listSearchQuery ? { listSearchQuery } : {}),
    ...(opts.feedCardKey ? { feedCardKey: opts.feedCardKey } : {}),
  });
  setLocation(`/person/${personId}`);
}

export function readVoteHubReturnState(): VoteHubReturnState | null {
  try {
    const raw = sessionStorage.getItem(VOTE_HUB_RETURN_KEY);
    if (!raw) return null;
    sessionStorage.removeItem(VOTE_HUB_RETURN_KEY);
    const parsed = JSON.parse(raw) as VoteHubReturnState;
    if (
      typeof parsed.ts === "number" &&
      Date.now() - parsed.ts > VOTE_HUB_RETURN_TTL_MS
    ) {
      return null;
    }
    return parsed;
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
  writeVoteHubReturnState({
    activeSection: voteList.activeSection ?? "All",
    anchorHashId: voteList.returnHashId || voteHubReturnHashForType(voteList.type),
    scrollY: voteList.scrollY ?? 0,
    ...(voteList.listSearchQuery
      ? { listType: voteList.type, listSearchQuery: voteList.listSearchQuery }
      : {}),
    ...(voteList.feedCardKey ? { feedCardKey: voteList.feedCardKey } : {}),
  });
  setLocation("/vote");
}
