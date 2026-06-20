export type HubActivityFilter = "all" | "show-mine" | "hide-mine";
export type HubActivityFilterScope = "vote" | "predict";

export const DEFAULT_HUB_ACTIVITY_FILTER: HubActivityFilter = "hide-mine";

const VALID_FILTERS = new Set<HubActivityFilter>(["all", "show-mine", "hide-mine"]);

function storageKey(scope: HubActivityFilterScope, userId: string): string {
  return `voxdex_${scope}_activity_filter_${userId}`;
}

function parseStoredFilter(raw: string | null): HubActivityFilter | null {
  if (raw && VALID_FILTERS.has(raw as HubActivityFilter)) {
    return raw as HubActivityFilter;
  }
  return null;
}

/** Read saved hub activity filter; defaults to Hidden when no preference exists. */
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
