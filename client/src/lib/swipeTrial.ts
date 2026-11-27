/**
 * Same-category head-to-head paging on the phone All feed.
 *
 * The queue is built from matchups the caller has already filtered
 * (hidden cards and country visibility come from `/api/matchups`; the
 * Not voted / eye filter, search, and category chips are applied by the
 * vote hub before this runs). This module does not fetch or vote.
 *
 * Web and the installed PWA stay on the normal feed. Native shells opt in
 * through the gate. A browser preview opts in only when
 * `voxdex_swipe_trial=1` is set, including via `?swipeTrial=1`.
 */

export const SWIPE_TRIAL_STORAGE_KEY = "voxdex_swipe_trial";
export const SWIPE_TRIAL_QUERY_PARAM = "swipeTrial";
export const SWIPE_TRIAL_NUDGE_SEEN_KEY = "voxdex_swipe_trial_nudge_seen";

export interface SwipeTrialStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export interface SwipeTrialMatchup {
  id: string;
  category?: string | null;
  secondaryCategories?: readonly (string | null | undefined)[] | null;
}

export type CategoryIdResolver = (stored: string | null | undefined) => string;

export interface SwipeTrialGateInput {
  /** Capacitor native shell (iOS or Android). */
  native: boolean;
  /** Explicit preview flag. Never implied by the environment. */
  override: boolean;
  /** Vote hub section chip is All. */
  allSelected: boolean;
  /** Phone mixed feed, below the 768px section layout. */
  mixedFeed: boolean;
  /** Snap view or another vote-hub overlay is open. */
  snapOrOverlayOpen: boolean;
}

/**
 * Read the preview flag. `?swipeTrial=1` persists it; `?swipeTrial=0` clears it.
 * Any other query value leaves storage alone. Absent storage is off, including
 * in production.
 */
export function readSwipeTrialOverride(
  storage: SwipeTrialStorage | null | undefined,
  search: string,
): boolean {
  const params = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search);
  const query = params.get(SWIPE_TRIAL_QUERY_PARAM);
  if (query === "1") {
    try {
      storage?.setItem(SWIPE_TRIAL_STORAGE_KEY, "1");
    } catch {
      /* private mode */
    }
    return true;
  }
  if (query === "0") {
    try {
      storage?.removeItem(SWIPE_TRIAL_STORAGE_KEY);
    } catch {
      /* private mode */
    }
    return false;
  }
  try {
    return storage?.getItem(SWIPE_TRIAL_STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

export function hasSeenSwipeTrialNudge(storage: SwipeTrialStorage | null | undefined): boolean {
  try {
    return storage?.getItem(SWIPE_TRIAL_NUDGE_SEEN_KEY) === "1";
  } catch {
    return true;
  }
}

export function markSwipeTrialNudgeSeen(storage: SwipeTrialStorage | null | undefined): void {
  try {
    storage?.setItem(SWIPE_TRIAL_NUDGE_SEEN_KEY, "1");
  } catch {
    /* private mode */
  }
}

/**
 * Native app, or an explicit preview override, on the All mixed feed with
 * no snap view or overlay covering it. Web and PWA without the flag stay off.
 */
export function isSwipeTrialGateOpen(input: SwipeTrialGateInput): boolean {
  if (!input.allSelected || !input.mixedFeed || input.snapOrOverlayOpen) return false;
  return input.native || input.override;
}

/** Canonical id of a card's primary category, or null when it has none. */
export function primaryCanonicalId(
  category: string | null | undefined,
  resolveCanonicalId: CategoryIdResolver,
): string | null {
  if (category == null || String(category).trim() === "") return null;
  const id = resolveCanonicalId(category);
  if (!id || String(id).trim() === "") return null;
  return id;
}

/**
 * The category printed on the card: its primary, resolved to a canonical id.
 * Secondaries do not count. A Lifestyle card must not page into Food & Drink
 * just because one of them lists the other as a secondary.
 */
export function matchupMatchesCanonicalCategory(
  item: SwipeTrialMatchup,
  categoryId: string,
  resolveCanonicalId: CategoryIdResolver,
): boolean {
  if (!categoryId) return false;
  return primaryCanonicalId(item.category, resolveCanonicalId) === categoryId;
}

const OPEN_CATEGORY_FILTERS = new Set(["all", "trending", "favorites"]);

/**
 * Canonical id when a real category chip is selected.
 * All, Trending, and Favorites are not a single primary.
 */
export function categoryFilterPrimaryId(
  filter: string | null | undefined,
  resolveCanonicalId: CategoryIdResolver,
): string | null {
  if (filter == null || OPEN_CATEGORY_FILTERS.has(filter)) return null;
  return primaryCanonicalId(filter, resolveCanonicalId);
}

/** Feed entries on either side of a slot whose matchups must not be paged in. */
export const SWIPE_NEARBY_FEED_RADIUS = 8;

export interface MatchupQueueOptions {
  /**
   * Active category chip. Cards whose displayed primary is something else
   * stay a queue of one, even if a secondary put them in the filtered feed.
   */
  restrictToPrimaryId?: string | null;
  /** Other matchups sitting within a few feed slots of this one. */
  excludeIds?: ReadonlySet<string> | null;
}

/**
 * Matchup ids in the feed within `radius` entries of the anchor, not
 * including the anchor. A paged-in card then cannot repeat the one
 * directly above or below.
 */
export function nearbyFeedMatchupIds(
  feed: readonly { kind: string; id: string }[],
  anchorId: string,
  radius = SWIPE_NEARBY_FEED_RADIUS,
): ReadonlySet<string> {
  const index = feed.findIndex((entry) => entry.kind === "matchup" && entry.id === anchorId);
  if (index < 0) return new Set();
  const ids = new Set<string>();
  const start = Math.max(0, index - radius);
  const end = Math.min(feed.length, index + radius + 1);
  for (let i = start; i < end; i += 1) {
    const entry = feed[i];
    if (!entry || entry.kind !== "matchup" || entry.id === anchorId) continue;
    ids.add(entry.id);
  }
  return ids;
}

/**
 * Head-to-head cards that share the anchor's displayed primary category,
 * in the caller's order. Secondaries are ignored. Nearby feed slots and a
 * mismatched category chip are left out. A card with no primary, or whose
 * primary is not the active filter, is a queue of one. A missing anchor is
 * an empty queue.
 */
export function buildSameCategoryMatchupQueue<T extends SwipeTrialMatchup>(
  items: readonly T[],
  anchorId: string,
  resolveCanonicalId: CategoryIdResolver,
  options?: MatchupQueueOptions,
): T[] {
  const anchor = items.find((item) => item.id === anchorId);
  if (!anchor) return [];
  const ownPrimary = primaryCanonicalId(anchor.category, resolveCanonicalId);
  const restrict = options?.restrictToPrimaryId ?? null;
  if (restrict && ownPrimary !== restrict) return [anchor];
  const categoryId = restrict ?? ownPrimary;
  if (!categoryId) return [anchor];

  const exclude = options?.excludeIds;
  const queue: T[] = [];
  const seen = new Set<string>();
  for (const item of items) {
    if (seen.has(item.id)) continue;
    if (item.id !== anchor.id && exclude?.has(item.id)) continue;
    if (!matchupMatchesCanonicalCategory(item, categoryId, resolveCanonicalId)) continue;
    seen.add(item.id);
    queue.push(item);
  }
  if (!seen.has(anchor.id)) queue.unshift(anchor);
  return queue;
}

/** First feed matchup whose category queue can actually page. */
export function firstSwipableMatchupId<T extends SwipeTrialMatchup>(
  items: readonly T[],
  resolveCanonicalId: CategoryIdResolver,
  options?: MatchupQueueOptions & {
    excludeIdsFor?: (anchorId: string) => ReadonlySet<string> | null | undefined;
  },
): string | null {
  for (const item of items) {
    const queue = buildSameCategoryMatchupQueue(items, item.id, resolveCanonicalId, {
      restrictToPrimaryId: options?.restrictToPrimaryId,
      excludeIds: options?.excludeIdsFor?.(item.id) ?? options?.excludeIds,
    });
    if (queue.length >= 2) return item.id;
  }
  return null;
}

/**
 * Keep the card under the finger when the filtered queue rebuilds.
 * If that card left the queue, stay near the previous index instead of
 * jumping back to the start.
 */
export function reconcileSwipeQueueIndex(
  ids: readonly string[],
  displayedId: string,
  previousIndex: number,
): number {
  if (ids.length === 0) return 0;
  const exact = ids.indexOf(displayedId);
  if (exact >= 0) return exact;
  const clamped = Number.isFinite(previousIndex) ? Math.floor(previousIndex) : 0;
  return Math.min(Math.max(clamped, 0), ids.length - 1);
}

export function stepSwipeQueueIndex(
  index: number,
  length: number,
  direction: "left" | "right",
): { type: "page"; index: number } | { type: "edge" } {
  if (length < 2) return { type: "edge" };
  const next = index + (direction === "left" ? 1 : -1);
  if (next < 0 || next >= length) return { type: "edge" };
  return { type: "page", index: next };
}
