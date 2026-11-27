/**
 * Client-side mix for the Vote hub All view below the md breakpoint.
 *
 * Phones and the Capacitor apps keep this one feed. From `md` (768px) up,
 * All is stacked sections again — see `voteAllUsesMixedFeed`. This module
 * still interleaves the four lists for the narrow feed. It does not fetch,
 * vote, or touch cache.
 */

export const VOTE_FEED_PAGE_SIZE = 12;

/**
 * All uses stacked sections from this width up (Tailwind `md`).
 * Narrower viewports keep the mixed feed, including the Capacitor apps.
 */
export const VOTE_ALL_SECTION_LAYOUT_MIN_PX = 768;
export const VOTE_ALL_SECTION_LAYOUT_QUERY = `(min-width: ${VOTE_ALL_SECTION_LAYOUT_MIN_PX}px)`;

/** True when All should be the single mixed feed (below md). */
export function voteAllUsesMixedFeed(viewportWidth: number): boolean {
  return viewportWidth < VOTE_ALL_SECTION_LAYOUT_MIN_PX;
}

/** Row size for the mixer's unused 2-column math. The All page does not mount that grid. */
export const VOTE_FEED_ROW_HEIGHT = "32rem";
/** Grid gap paired with `VOTE_FEED_ROW_HEIGHT` in the 2-column packer. */
export const VOTE_FEED_ROW_GAP = "1.25rem";

export type VoteFeedKind = "matchup" | "sentiment" | "opinion" | "rating";

export const VOTE_FEED_ROUND: readonly VoteFeedKind[] = [
  "matchup",
  "sentiment",
  "opinion",
  "rating",
];

export const VOTE_FEED_CUE_LABELS = {
  matchup: "Head-to-head",
  sentiment: "Agree?",
  opinion: "Pick one",
  rating: "Rate",
} as const;

/** Chip keys stay the section toggles. Only the visible label changes. */
export const VOTE_SECTION_CUE_LABELS: Record<string, string> = {
  "Sentiment Polls": VOTE_FEED_CUE_LABELS.sentiment,
  Matchups: VOTE_FEED_CUE_LABELS.matchup,
  "Opinion Polls": VOTE_FEED_CUE_LABELS.opinion,
  "Overall Rating": VOTE_FEED_CUE_LABELS.rating,
};

export type VoteFeedSpan = 1 | 2;

export function voteFeedSpan(kind: VoteFeedKind): VoteFeedSpan {
  return kind === "matchup" ? 2 : 1;
}

export interface VoteFeedEntry<T> {
  kind: VoteFeedKind;
  id: string;
  item: T;
}

export interface VoteFeedLists<M, S, O, R> {
  matchup: readonly M[];
  sentiment: readonly S[];
  opinion: readonly O[];
  rating: readonly R[];
}

type FeedCursor = Record<VoteFeedKind, number>;

/**
 * Remaining ratings after the other types run out.
 * Multiple categories are dealt round-robin so the tail alternates.
 * A single category is dealt as every other rank, then the ranks between
 * them, so the tail does not finish on two neighboring source ranks.
 */
export function distributeRatingTail<T>(
  items: readonly T[],
  categoryOf: (item: T) => string | null | undefined,
): T[] {
  if (items.length <= 2) return items.slice();

  const groups = new Map<string, T[]>();
  const order: string[] = [];
  for (const item of items) {
    const key = (categoryOf(item) ?? "").trim();
    let bucket = groups.get(key);
    if (!bucket) {
      bucket = [];
      groups.set(key, bucket);
      order.push(key);
    }
    bucket.push(item);
  }

  if (groups.size <= 1) {
    // Step through every other rank, then the ones left between them.
    // Outside-in weaving left the two middle ranks sitting together at the end.
    const evens: T[] = [];
    const odds: T[] = [];
    for (let i = 0; i < items.length; i += 1) {
      (i % 2 === 0 ? evens : odds).push(items[i]);
    }
    return [...evens, ...odds];
  }

  const out: T[] = [];
  while (out.length < items.length) {
    let progressed = false;
    for (const key of order) {
      const bucket = groups.get(key);
      if (!bucket?.length) continue;
      const next = bucket.shift();
      if (next) {
        out.push(next);
        progressed = true;
      }
    }
    if (!progressed) break;
  }
  return out;
}

/**
 * Repeating order: matchup, sentiment, opinion, rating.
 * While any non-rating list still has items, each round emits at most one rating.
 * Ratings left over are distributed so the tail is not one unbroken block.
 */
export function interleaveVoteFeed<
  M extends { id: string },
  S extends { id: string },
  O extends { id: string },
  R extends { id: string },
>(
  lists: VoteFeedLists<M, S, O, R>,
  options?: { categoryOf?: (item: R) => string | null | undefined },
): Array<
  | { kind: "matchup"; id: string; item: M }
  | { kind: "sentiment"; id: string; item: S }
  | { kind: "opinion"; id: string; item: O }
  | { kind: "rating"; id: string; item: R }
> {
  const cursor: FeedCursor = { matchup: 0, sentiment: 0, opinion: 0, rating: 0 };
  const out: Array<
    | { kind: "matchup"; id: string; item: M }
    | { kind: "sentiment"; id: string; item: S }
    | { kind: "opinion"; id: string; item: O }
    | { kind: "rating"; id: string; item: R }
  > = [];

  const othersRemain = () =>
    cursor.matchup < lists.matchup.length ||
    cursor.sentiment < lists.sentiment.length ||
    cursor.opinion < lists.opinion.length;

  while (othersRemain()) {
    if (cursor.matchup < lists.matchup.length) {
      const item = lists.matchup[cursor.matchup];
      out.push({ kind: "matchup", id: item.id, item });
      cursor.matchup += 1;
    }
    if (cursor.sentiment < lists.sentiment.length) {
      const item = lists.sentiment[cursor.sentiment];
      out.push({ kind: "sentiment", id: item.id, item });
      cursor.sentiment += 1;
    }
    if (cursor.opinion < lists.opinion.length) {
      const item = lists.opinion[cursor.opinion];
      out.push({ kind: "opinion", id: item.id, item });
      cursor.opinion += 1;
    }
    if (cursor.rating < lists.rating.length) {
      const item = lists.rating[cursor.rating];
      out.push({ kind: "rating", id: item.id, item });
      cursor.rating += 1;
    }
  }

  const categoryOf = options?.categoryOf ?? ((item: R) => (item as { category?: string | null }).category);
  const rest = lists.rating.slice(cursor.rating);
  for (const item of distributeRatingTail(rest, categoryOf)) {
    out.push({ kind: "rating", id: item.id, item });
  }
  return separateShortRatingTail(out);
}

/**
 * A single leftover rating sits against the rating that closed the last round,
 * so the feed ends on two rating cards. Tuck that extra into the first gap
 * between other card types. Longer rating tails stay woven as a block.
 */
export function separateShortRatingTail<T extends { kind: string }>(feed: readonly T[]): T[] {
  const out = feed.slice();
  if (out.length < 3) return out;
  let run = 0;
  for (let i = out.length - 1; i >= 0 && out[i].kind === "rating"; i -= 1) run += 1;
  if (run !== 2) return out;
  let gap = -1;
  for (let i = 0; i < out.length - 1; i += 1) {
    if (out[i].kind !== "rating" && out[i + 1].kind !== "rating") {
      gap = i + 1;
      break;
    }
  }
  if (gap < 0) return out;
  const rating = out.pop();
  if (!rating) return out;
  out.splice(gap, 0, rating);
  return out;
}

export type VoteFeedActivityFilter = "all" | "show-mine" | "hide-mine";

export interface VoteFeedFilterable {
  id: string;
  category?: string | null;
  secondaryCategories?: readonly (string | null | undefined)[] | null;
  searchText: string;
  voted: boolean;
  favorite: boolean;
}

export interface VoteFeedFilter {
  category: string;
  search: string;
  activity: VoteFeedActivityFilter;
  matchesCategory?: (
    primary: string | null | undefined,
    secondary: readonly (string | null | undefined)[] | null | undefined,
    category: string,
  ) => boolean;
}

function defaultCategoryMatch(item: VoteFeedFilterable, category: string): boolean {
  if ((item.category ?? "") === category) return true;
  return (item.secondaryCategories ?? []).some((value) => value === category);
}

/** Category, search, and my-votes (All / Not voted / Votes only). */
export function matchesVoteFeedFilters(item: VoteFeedFilterable, filter: VoteFeedFilter): boolean {
  const category = filter.category;
  if (category === "favorites") {
    if (!item.favorite) return false;
  } else if (category !== "all" && category !== "trending") {
    const ok = filter.matchesCategory
      ? filter.matchesCategory(item.category, item.secondaryCategories, category)
      : defaultCategoryMatch(item, category);
    if (!ok) return false;
  }

  const query = filter.search.trim().toLowerCase();
  if (query && !item.searchText.toLowerCase().includes(query)) return false;

  if (filter.activity === "show-mine" && !item.voted) return false;
  if (filter.activity === "hide-mine" && item.voted) return false;
  return true;
}

export function applyVoteFeedFilters<T extends VoteFeedFilterable>(
  items: readonly T[],
  filter: VoteFeedFilter,
): T[] {
  return items.filter((item) => matchesVoteFeedFilters(item, filter));
}

export interface FeedRowLayout {
  rowOfIndex: number[];
  rowCount: number;
}

/** Pack cards into rows. Matchups span 2 columns on desktop; mobile is one column. */
export function layoutFeedRows(spans: readonly VoteFeedSpan[], columns: 1 | 2): FeedRowLayout {
  const rowOfIndex: number[] = [];
  let row = 0;
  let col = 0;
  for (const span of spans) {
    const width = columns === 1 ? 1 : span;
    if (col > 0 && col + width > columns) {
      row += 1;
      col = 0;
    }
    rowOfIndex.push(row);
    col += width;
    if (col >= columns) {
      row += 1;
      col = 0;
    }
  }
  const rowCount = spans.length === 0 ? 0 : col === 0 ? row : row + 1;
  return { rowOfIndex, rowCount };
}

/** About `size` cards, snapped so a desktop row is not split across the window. */
export function snapFeedWindow(
  spans: readonly VoteFeedSpan[],
  anchorIndex: number,
  columns: 1 | 2,
  size = VOTE_FEED_PAGE_SIZE,
): { start: number; end: number } {
  const count = spans.length;
  if (count === 0) return { start: 0, end: 0 };
  const { rowOfIndex } = layoutFeedRows(spans, columns);
  const anchor = Math.min(Math.max(anchorIndex, 0), count - 1);
  let start = anchor;
  while (start > 0 && rowOfIndex[start - 1] === rowOfIndex[start]) start -= 1;

  let end = Math.min(count, Math.max(start + size, anchor + 1));
  if (end < count && end > 0) {
    const row = rowOfIndex[end - 1];
    while (end < count && rowOfIndex[end] === row) end += 1;
  }

  if (end - start < size && start > 0) {
    let next = start;
    let pulled = 0;
    const need = size - (end - start);
    while (next > 0 && pulled < need) {
      next -= 1;
      pulled += 1;
    }
    while (next > 0 && rowOfIndex[next - 1] === rowOfIndex[next]) next -= 1;
    start = next;
  }

  return { start, end };
}

/** True when this card is the only one in its desktop row, so it should span the row. */
export function feedItemFillsRow(
  spans: readonly VoteFeedSpan[],
  index: number,
  columns: 1 | 2,
): boolean {
  if (index < 0 || index >= spans.length) return false;
  if (columns !== 2) return false;
  if (spans[index] === 2) return true;
  const { rowOfIndex } = layoutFeedRows(spans, 2);
  const row = rowOfIndex[index];
  let count = 0;
  for (const value of rowOfIndex) {
    if (value === row) count += 1;
  }
  return count === 1;
}

export function feedSpacerRows(
  spans: readonly VoteFeedSpan[],
  start: number,
  end: number,
  columns: 1 | 2,
): { top: number; bottom: number } {
  const { rowOfIndex, rowCount } = layoutFeedRows(spans, columns);
  if (spans.length === 0 || end <= start) return { top: 0, bottom: rowCount };
  const top = rowOfIndex[start] ?? 0;
  const lastRow = rowOfIndex[Math.min(end, spans.length) - 1] ?? 0;
  return { top, bottom: Math.max(0, rowCount - lastRow - 1) };
}

export interface FeedRestorePlan {
  /** Wait for the lists, give up, or mount a window that contains the card. */
  action: "wait" | "abandon" | "reveal";
  start: number;
  end: number;
}

/**
 * Which window to mount before scrolling back to a card.
 * An empty list still waits: the first paint can be empty while queries
 * hydrate, and abandoning then would pin the feed at the top.
 */
export function planFeedRestore(args: {
  keys: readonly string[];
  cardKey: string | null | undefined;
  loading: boolean;
  spans: readonly VoteFeedSpan[];
  columns: 1 | 2;
  pageSize?: number;
}): FeedRestorePlan {
  if (!args.cardKey) return { action: "abandon", start: 0, end: 0 };
  const index = args.keys.indexOf(args.cardKey);
  if (index < 0) {
    if (args.loading || args.keys.length === 0) return { action: "wait", start: 0, end: 0 };
    return { action: "abandon", start: 0, end: 0 };
  }
  const window = snapFeedWindow(
    args.spans,
    index,
    args.columns,
    args.pageSize ?? VOTE_FEED_PAGE_SIZE,
  );
  let start = window.start;
  let end = window.end;
  if (index < start) start = index;
  if (end <= index) end = index + 1;
  return { action: "reveal", start, end };
}

/**
 * Sticky chrome the restored card must clear: site header plus the chip bar.
 * Callers pass layout heights (`offsetHeight`), not a transformed rect.
 * The chip bar slides off with `translateY` while you scroll; measuring the
 * visual bottom then lands the card one bar too low once the bar comes back.
 */
export function voteFeedStickyOffset(headerHeight: number, bandHeight: number): number {
  const header = Number.isFinite(headerHeight) && headerHeight > 0 ? headerHeight : 0;
  const band = Number.isFinite(bandHeight) && bandHeight > 0 ? bandHeight : 0;
  return Math.round(header + band);
}

/** Ask the chip bar to show again and forget the hide offset from a restore scroll. */
export const VOTE_STICKY_BAND_REVEAL = "vote-sticky-band-reveal";

/** Ask the windowed All feed to mount the first head-to-head, even from the bottom of the page. */
export const VOTE_FEED_REVEAL_FIRST_MATCHUP = "voxdex-vote-feed-reveal-first-matchup";

/** Let the feed follow scroll again after the welcome tour releases the first card. */
export const VOTE_FEED_RELEASE_MATCHUP = "voxdex-vote-feed-release-matchup";

/** Document scrollY that puts the card just under the sticky chip band. */
export function scrollYForFeedCard(
  cardTop: number,
  scrollY: number,
  stickyBottomPx: number,
  gap = 8,
): number {
  return Math.max(0, Math.round(scrollY + cardTop - stickyBottomPx - gap));
}

const FEED_PLACE_KEY = "voteMixedFeedPlace";
const FEED_PLACE_TTL_MS = 5 * 60 * 1000;

export interface VoteMixedFeedPlace {
  cardKey: string;
  ts: number;
}

export function writeVoteMixedFeedPlace(cardKey: string): void {
  if (typeof sessionStorage === "undefined" || !cardKey) return;
  try {
    const place: VoteMixedFeedPlace = { cardKey, ts: Date.now() };
    sessionStorage.setItem(FEED_PLACE_KEY, JSON.stringify(place));
  } catch {
    /* private mode */
  }
}

export function readVoteMixedFeedPlace(): VoteMixedFeedPlace | null {
  if (typeof sessionStorage === "undefined") return null;
  try {
    const raw = sessionStorage.getItem(FEED_PLACE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as VoteMixedFeedPlace;
    if (!parsed?.cardKey || typeof parsed.ts !== "number") return null;
    if (Date.now() - parsed.ts > FEED_PLACE_TTL_MS) return null;
    return parsed;
  } catch {
    return null;
  }
}
