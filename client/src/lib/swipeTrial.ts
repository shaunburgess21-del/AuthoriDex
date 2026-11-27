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
 * Registry match used by the vote hub and RelatedVoteItems: the canonical
 * id hits the primary category or any secondary.
 */
export function matchupMatchesCanonicalCategory(
  item: SwipeTrialMatchup,
  categoryId: string,
  resolveCanonicalId: CategoryIdResolver,
): boolean {
  if (!categoryId) return false;
  if (primaryCanonicalId(item.category, resolveCanonicalId) === categoryId) return true;
  for (const secondary of item.secondaryCategories ?? []) {
    if (secondary == null || String(secondary).trim() === "") continue;
    if (resolveCanonicalId(secondary) === categoryId) return true;
  }
  return false;
}

/**
 * Head-to-head cards that share the anchor's primary canonical category,
 * in the caller's order (the filtered feed order). A card with no primary
 * category is a queue of one. A missing anchor is an empty queue.
 */
export function buildSameCategoryMatchupQueue<T extends SwipeTrialMatchup>(
  items: readonly T[],
  anchorId: string,
  resolveCanonicalId: CategoryIdResolver,
): T[] {
  const anchor = items.find((item) => item.id === anchorId);
  if (!anchor) return [];
  const categoryId = primaryCanonicalId(anchor.category, resolveCanonicalId);
  if (!categoryId) return [anchor];

  const queue: T[] = [];
  const seen = new Set<string>();
  for (const item of items) {
    if (seen.has(item.id)) continue;
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
): string | null {
  for (const item of items) {
    const queue = buildSameCategoryMatchupQueue(items, item.id, resolveCanonicalId);
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
