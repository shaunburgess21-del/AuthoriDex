import type { HubActivityFilter } from "./hub-activity-filter";

/** Persisted only when the visitor collapses Town Square themselves on "Show all". */
export const TOWN_SQUARE_COLLAPSED_KEY = "voxdex-town-square-collapsed";

/**
 * How long the filter-triggered collapse runs before we scroll the
 * results into view. Matches the CSS grid-row transition.
 */
export const PREDICT_FILTER_SCROLL_DELAY_MS = 220;

export type TownSquareSession = {
  collapsed: boolean;
  /**
   * Set when the visitor toggles the header while a positions filter is
   * active. Further filter changes leave the header alone for the session.
   */
  manualOverride: boolean;
  /** Collapse state to put back when the filter returns to "Show all". */
  restoreCollapsed: boolean;
};

type StorageLike = {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
};

export function readTownSquareCollapsed(storage: StorageLike | null | undefined): boolean {
  try {
    return storage?.getItem(TOWN_SQUARE_COLLAPSED_KEY) === "1";
  } catch {
    return false;
  }
}

export function writeTownSquareCollapsed(
  storage: StorageLike | null | undefined,
  collapsed: boolean,
): void {
  try {
    storage?.setItem(TOWN_SQUARE_COLLAPSED_KEY, collapsed ? "1" : "0");
  } catch {
    /* Preference persistence is optional in private browsing. */
  }
}

/**
 * Opening the page with a saved non-all filter starts collapsed so the
 * filtered cards are not hidden under the feed. The saved preference is
 * kept for when they return to Show all.
 */
export function createTownSquareSession(
  persistedCollapsed: boolean,
  filter: HubActivityFilter,
): TownSquareSession {
  if (filter === "all") {
    return {
      collapsed: persistedCollapsed,
      manualOverride: false,
      restoreCollapsed: persistedCollapsed,
    };
  }
  return {
    collapsed: true,
    manualOverride: false,
    restoreCollapsed: persistedCollapsed,
  };
}

export function reduceTownSquareFilterChange(
  session: TownSquareSession,
  nextFilter: HubActivityFilter,
): TownSquareSession {
  if (session.manualOverride) return session;
  if (nextFilter === "all") {
    return { ...session, collapsed: session.restoreCollapsed };
  }
  return { ...session, collapsed: true };
}

export function reduceTownSquareManualToggle(
  session: TownSquareSession,
  filter: HubActivityFilter,
): TownSquareSession {
  const collapsed = !session.collapsed;
  if (filter !== "all") {
    return { ...session, collapsed, manualOverride: true };
  }
  return {
    collapsed,
    manualOverride: false,
    restoreCollapsed: collapsed,
  };
}

/** Auto-collapse from a filter must not overwrite the saved preference. */
export function shouldPersistTownSquareCollapse(filter: HubActivityFilter): boolean {
  return filter === "all";
}

/** Scroll after a visitor applies a filter. Returning to Show all does not scroll. */
export function shouldScrollPredictResults(
  prev: HubActivityFilter,
  next: HubActivityFilter,
): boolean {
  return prev !== next && next !== "all";
}

export function townSquareCollapsedHint(input: {
  pending: boolean;
  failed: boolean;
  count: number;
  latestName?: string | null;
}): string {
  if (input.failed) return "Couldn't load activity";
  if (input.pending) return "Loading recent activity";
  if (input.count <= 0) return "No recent activity";
  const countLabel =
    input.count === 1 ? "1 recent prediction" : `${input.count} recent predictions`;
  const name = input.latestName?.trim();
  if (!name) return countLabel;
  return `${countLabel} · ${name}`;
}

export function prefersReducedMotion(): boolean {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return false;
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

export function scrollElementIntoView(el: Element | null, reducedMotion: boolean): void {
  el?.scrollIntoView({
    behavior: reducedMotion ? "auto" : "smooth",
    block: "start",
  });
}
