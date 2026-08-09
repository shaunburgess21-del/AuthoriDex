export type HubActivityFilter = "all" | "show-mine" | "hide-mine";
export type HubActivityFilterScope = "vote" | "predict";

export const DEFAULT_HUB_ACTIVITY_FILTER: HubActivityFilter = "all";

const VALID_FILTERS = new Set<HubActivityFilter>(["all", "show-mine", "hide-mine"]);

export const HUB_ACTIVITY_FILTER_VALUES: HubActivityFilter[] = [
  "all",
  "show-mine",
  "hide-mine",
];

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
