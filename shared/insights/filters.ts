/**
 * Canonical URL + cache contract for Insights filters.
 * Server, client, and OG image routes must use these helpers only.
 */

export const INSIGHTS_SOURCE_VALUES = [
  // Movers board (Trend Score % change) — default Rankings view when no
  // ?source= is present.
  "fame",
  "news",
  "wiki",
  "news_momentum",
  "wiki_momentum",
  // Absolute monthly Google searches (DataForSEO) — the "Most Searched" ranking.
  // (Google Trends `trends` source was removed; old ?source=trends links fall
  // back to the default ranking via parseSource.)
  // velocity / mass sources were removed; old ?source=velocity|mass links fall
  // back to the default ranking via parseSource.
  "search_volume",
] as const;

export type InsightsSource = (typeof INSIGHTS_SOURCE_VALUES)[number];

export const INSIGHTS_WINDOW_VALUES = ["24h", "7d"] as const;
export type InsightsWindow = (typeof INSIGHTS_WINDOW_VALUES)[number];

export const INSIGHTS_SORT_DIR_VALUES = ["asc", "desc"] as const;
export type InsightsSortDir = (typeof INSIGHTS_SORT_DIR_VALUES)[number];

export const INSIGHTS_TAB_VALUES = [
  "today",
  "rankings",
  "discover",
  "vote",
  "predict",
  "crowd",
] as const satisfies readonly string[];
export type InsightsTab = (typeof INSIGHTS_TAB_VALUES)[number];

export interface InsightsFilters {
  source: InsightsSource;
  category: string | null;
  window: InsightsWindow;
  favouritesOnly: boolean;
  sortDir: InsightsSortDir;
  page: number;
  limit: number;
}

export const DEFAULT_INSIGHTS_FILTERS: InsightsFilters = {
  // Default Rankings view is the Movers board (24h % change). Old bookmarks
  // with explicit ?source=... still resolve.
  source: "fame",
  category: null,
  window: "24h",
  favouritesOnly: false,
  sortDir: "desc",
  page: 1,
  limit: 25,
};

const FILTER_PARAM_ORDER = [
  "source",
  "category",
  "window",
  "fav",
  "sortDir",
  "page",
  "limit",
] as const;

function parseSource(raw: string | null): InsightsSource {
  if (raw && (INSIGHTS_SOURCE_VALUES as readonly string[]).includes(raw)) {
    return raw as InsightsSource;
  }
  return DEFAULT_INSIGHTS_FILTERS.source;
}

function parseWindow(raw: string | null): InsightsWindow {
  if (raw === "7d") return "7d";
  return "24h";
}

function parseSortDir(raw: string | null): InsightsSortDir {
  if (raw === "asc") return "asc";
  return "desc";
}

export function parseFilters(
  search: string | URLSearchParams,
): InsightsFilters {
  const params =
    typeof search === "string"
      ? new URLSearchParams(search.startsWith("?") ? search.slice(1) : search)
      : search;

  const pageRaw = parseInt(params.get("page") ?? "1", 10);
  const limitRaw = parseInt(params.get("limit") ?? String(DEFAULT_INSIGHTS_FILTERS.limit), 10);

  return {
    source: parseSource(params.get("source")),
    category: params.get("category") || null,
    window: parseWindow(params.get("window")),
    favouritesOnly: params.get("fav") === "1" || params.get("favouritesOnly") === "true",
    sortDir: parseSortDir(params.get("sortDir")),
    page: Number.isFinite(pageRaw) && pageRaw >= 1 ? pageRaw : 1,
    limit: Number.isFinite(limitRaw) && limitRaw >= 1 && limitRaw <= 100 ? limitRaw : DEFAULT_INSIGHTS_FILTERS.limit,
  };
}

export function serializeFilters(filters: InsightsFilters): URLSearchParams {
  const params = new URLSearchParams();
  const f = { ...DEFAULT_INSIGHTS_FILTERS, ...filters };

  if (f.source !== DEFAULT_INSIGHTS_FILTERS.source) {
    params.set("source", f.source);
  }
  if (f.category) {
    params.set("category", f.category);
  }
  if (f.window !== DEFAULT_INSIGHTS_FILTERS.window) {
    params.set("window", f.window);
  }
  if (f.favouritesOnly) {
    params.set("fav", "1");
  }
  if (f.sortDir !== DEFAULT_INSIGHTS_FILTERS.sortDir) {
    params.set("sortDir", f.sortDir);
  }
  if (f.page !== 1) {
    params.set("page", String(f.page));
  }
  if (f.limit !== DEFAULT_INSIGHTS_FILTERS.limit) {
    params.set("limit", String(f.limit));
  }

  return params;
}

/** Stable string for api_cache / OG — sorted keys, no tab (tab uses ?tab= separately). */
export function canonicalCacheKey(prefix: string, filters: InsightsFilters): string {
  const parts: string[] = [prefix];
  for (const key of FILTER_PARAM_ORDER) {
    switch (key) {
      case "source":
        parts.push(`source=${filters.source}`);
        break;
      case "category":
        parts.push(`category=${filters.category ?? ""}`);
        break;
      case "window":
        parts.push(`window=${filters.window}`);
        break;
      case "fav":
        parts.push(`fav=${filters.favouritesOnly ? "1" : "0"}`);
        break;
      case "sortDir":
        parts.push(`sortDir=${filters.sortDir}`);
        break;
      case "page":
        parts.push(`page=${filters.page}`);
        break;
      case "limit":
        parts.push(`limit=${filters.limit}`);
        break;
      default:
        break;
    }
  }
  return parts.join("|");
}

/**
 * Legacy `?tab=` values mapped to their canonical post-Phase-4 IA equivalent.
 *
 *  - `you` / `overview`    → `today`    (pre-Phase-2 names)
 *  - `approval`            → `crowd`    (pre-Phase-2 names)
 *  - `compare`             → `rankings` (Compare tab was removed in Phase 2)
 *  - `markets`             → `predict`  (Markets moved into the in-Insights
 *                                        Predict tab in Phase 4; previously it
 *                                        redirected out to /predict)
 *  - `discover`            → `today`    (tab hidden from UI; restore by
 *                                        removing from this map + tab bar)
 */
const LEGACY_INSIGHTS_TAB_URL: Record<string, InsightsTab> = {
  you: "today",
  overview: "today",
  approval: "crowd",
  compare: "rankings",
  markets: "predict",
  discover: "today",
};

/** Rewrites legacy `?tab=` values in the address bar to the current IA. */
export function canonicalizeInsightsTabUrl(): boolean {
  if (typeof window === "undefined") return false;

  const url = new URL(window.location.href);
  const raw = url.searchParams.get("tab");
  if (!raw) return false;

  const mapped = LEGACY_INSIGHTS_TAB_URL[raw];
  if (mapped !== undefined) {
    if (mapped === "today") {
      url.searchParams.delete("tab");
    } else {
      url.searchParams.set("tab", mapped);
    }
    window.history.replaceState({}, "", url.toString());
    return true;
  }

  if ((INSIGHTS_TAB_VALUES as readonly string[]).includes(raw)) {
    return false;
  }

  url.searchParams.delete("tab");
  window.history.replaceState({}, "", url.toString());
  return true;
}

export function parseTab(search: string | URLSearchParams): InsightsTab {
  const params =
    typeof search === "string"
      ? new URLSearchParams(search.startsWith("?") ? search.slice(1) : search)
      : search;
  const tab = params.get("tab");

  // Legacy aliases (single source of truth — see LEGACY_INSIGHTS_TAB_URL).
  if (tab && tab in LEGACY_INSIGHTS_TAB_URL) {
    return LEGACY_INSIGHTS_TAB_URL[tab]!;
  }
  if (tab && (INSIGHTS_TAB_VALUES as readonly string[]).includes(tab)) {
    return tab as InsightsTab;
  }
  // Deep links with filter params should land on Rankings, not Today.
  if (
    params.get("source") ||
    params.get("category") ||
    params.get("fav") === "1" ||
    params.get("sortDir") === "asc"
  ) {
    return "rankings";
  }
  return "today";
}

export function writeInsightsQuery(patch: {
  tab?: InsightsTab | null;
  filters?: Partial<InsightsFilters> | null;
  /**
   * Strip all Rankings-only filter params (source/category/window/fav/sortDir/
   * page/limit). Required when navigating between top-level tabs — otherwise stale
   * `?source=…` params make `parseTab` resolve back to Rankings, so e.g.
   * clicking "Today" from a Rankings sub-tab appears to do nothing.
   */
  clearFilters?: boolean;
}): void {
  const url = new URL(window.location.href);
  if (patch.tab !== undefined) {
    if (patch.tab === null || patch.tab === "today") {
      url.searchParams.delete("tab");
    } else {
      url.searchParams.set("tab", patch.tab);
    }
  }
  if (patch.clearFilters) {
    for (const key of ["source", "category", "window", "fav", "sortDir", "page", "limit"]) {
      url.searchParams.delete(key);
    }
  }
  if (patch.filters) {
    const current = parseFilters(url.search);
    const merged = { ...current, ...patch.filters };
    const serialized = serializeFilters(merged);
    for (const key of ["source", "category", "window", "fav", "sortDir", "page", "limit"]) {
      url.searchParams.delete(key);
    }
    serialized.forEach((value, key) => {
      url.searchParams.set(key, value);
    });
  }
  window.history.replaceState({}, "", url.toString());
  window.dispatchEvent(new PopStateEvent("popstate"));
}
