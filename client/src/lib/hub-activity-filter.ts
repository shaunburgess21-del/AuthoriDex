export type HubActivityFilter = "all" | "show-mine" | "hide-mine";
export type HubActivityFilterScope = "vote" | "predict";

export const DEFAULT_HUB_ACTIVITY_FILTER: HubActivityFilter = "all";

const VALID_FILTERS = new Set<HubActivityFilter>(["all", "show-mine", "hide-mine"]);

export const HUB_ACTIVITY_FILTER_VALUES: HubActivityFilter[] = [
  "all",
  "show-mine",
  "hide-mine",
];

/** Tap order for the mobile Vote pill: all → not yet voted → votes only. */
export const VOTE_ACTIVITY_FILTER_CYCLE: HubActivityFilter[] = [
  "all",
  "hide-mine",
  "show-mine",
];

/**
 * Next filter for one tap of the floating pill (Vote and Predict).
 * The "only mine" step is skipped when the visitor has nothing to show —
 * both hubs already snap that mode back to all.
 */
export function nextVoteActivityFilter(
  value: HubActivityFilter,
  ownedCount: number,
): HubActivityFilter {
  if (value === "all") return "hide-mine";
  if (value === "hide-mine") return ownedCount > 0 ? "show-mine" : "all";
  return "all";
}

/** Collapsed-pill label for the floating Vote filter. */
export function voteActivityFilterShortLabel(value: HubActivityFilter): string {
  if (value === "hide-mine") return "Not voted";
  if (value === "show-mine") return "Votes only";
  return "All votes";
}

/** Collapsed-pill label for the floating Predict filter. */
export function predictActivityFilterShortLabel(value: HubActivityFilter): string {
  if (value === "hide-mine") return "Not predicted";
  if (value === "show-mine") return "Positions only";
  return "All positions";
}

export function hubActivityFilterFabLabel(
  scope: HubActivityFilterScope,
  value: HubActivityFilter,
): string {
  return scope === "predict"
    ? predictActivityFilterShortLabel(value)
    : voteActivityFilterShortLabel(value);
}

/** Accessible name for the floating filter pill, including the next tap. */
export function hubActivityFilterFabAriaLabel(
  scope: HubActivityFilterScope,
  value: HubActivityFilter,
  count: number,
): string {
  if (scope === "predict") {
    if (value === "hide-mine") {
      const next = count > 0 ? "Show only positions you've taken." : "Show all positions.";
      return `Not predicted, ${count} hidden. ${next}`;
    }
    if (value === "show-mine") {
      return `Positions only, ${count} shown. Show all positions.`;
    }
    return "All positions. Show markets you haven't predicted on.";
  }
  if (value === "hide-mine") {
    const next = count > 0 ? "Show only votes you've cast." : "Show all votes.";
    return `Not voted, ${count} hidden. ${next}`;
  }
  if (value === "show-mine") {
    return `Votes only, ${count} shown. Show all votes.`;
  }
  return "All votes. Show cards you haven't voted on.";
}

/** Short pill label for the active filter (count shown for mine / hide modes). */
export function hubActivityFilterPillLabel(
  scope: HubActivityFilterScope,
  value: HubActivityFilter,
  count: number,
): string {
  if (scope === "vote") {
    if (value === "show-mine") return `My votes (${count})`;
    if (value === "hide-mine") return `Hide voted (${count})`;
    return "All votes";
  }
  if (value === "show-mine") return `My positions (${count})`;
  if (value === "hide-mine") return `Hide mine (${count})`;
  return "All positions";
}

/** One-line menu option copy for the activity filter picker. */
export function hubActivityFilterMenuLabel(
  scope: HubActivityFilterScope,
  value: HubActivityFilter,
): string {
  if (scope === "vote") {
    if (value === "show-mine") return "Show only votes I've cast";
    if (value === "hide-mine") return "Hide votes I've cast";
    return "Show all — voted and not yet voted";
  }
  if (value === "show-mine") return "Show only my active positions";
  if (value === "hide-mine") return "Hide markets I've predicted on";
  return "Show all — predicted and not yet predicted";
}

export function hubActivityFilterMenuTitle(scope: HubActivityFilterScope): string {
  return scope === "vote" ? "Filter votes" : "Filter positions";
}

function storageKey(scope: HubActivityFilterScope, userId: string): string {
  return `voxdex_${scope}_activity_filter_${userId}`;
}

function parseStoredFilter(raw: string | null): HubActivityFilter | null {
  if (raw && VALID_FILTERS.has(raw as HubActivityFilter)) {
    return raw as HubActivityFilter;
  }
  return null;
}

/** Read saved hub activity filter; defaults to inactive/all when no preference exists. */
export function readHubActivityFilter(
  scope: HubActivityFilterScope,
  userId?: string | null,
): HubActivityFilter {
  if (typeof window === "undefined" || !userId) {
    return DEFAULT_HUB_ACTIVITY_FILTER;
  }

  try {
    const saved = parseStoredFilter(window.localStorage.getItem(storageKey(scope, userId)));
    return saved ?? DEFAULT_HUB_ACTIVITY_FILTER;
  } catch {
    return DEFAULT_HUB_ACTIVITY_FILTER;
  }
}

export function writeHubActivityFilter(
  scope: HubActivityFilterScope,
  userId: string | null | undefined,
  value: HubActivityFilter,
): void {
  if (typeof window === "undefined" || !userId) return;

  try {
    window.localStorage.setItem(storageKey(scope, userId), value);
  } catch {
    /* Preference persistence is optional in private browsing. */
  }
}

/** Direct search should surface matches even when hide-mine is active. */
export function searchBypassesActivityFilter(search: string): boolean {
  return search.trim().length > 0;
}

export function passesSectionActivityFilter(
  marketId: string,
  search: string,
  passesMyPositions: (marketId: string) => boolean,
): boolean {
  return searchBypassesActivityFilter(search) || passesMyPositions(marketId);
}
