/**
 * Canonical URL + cache contract for Insights filters.
 * Server, client, and OG image routes must use these helpers only.
 */

export const INSIGHTS_SOURCE_VALUES = [
  "news_momentum",
  "wiki_momentum",
  "velocity",
  "mass",
  "fame",
  "news",
  "wiki",
  // Absolute monthly Google searches (DataForSEO) — the "Most Searched" ranking.
  // (Google Trends `trends` source was removed; old ?source=trends links fall
  // back to the default ranking via parseSource.)
  "search_volume",
] as const;

export type InsightsSource = (typeof INSIGHTS_SOURCE_VALUES)[number];

export const INSIGHTS_WINDOW_VALUES = ["24h", "7d"] as const;
export type InsightsWindow = (typeof INSIGHTS_WINDOW_VALUES)[number];

export const INSIGHTS_TAB_VALUES = [
  "overview",
  "rankings",
  "discover",
  "you",
  "compare",
  "markets",
] as const satisfies readonly string[];
export type InsightsTab = (typeof INSIGHTS_TAB_VALUES)[number];

export interface InsightsFilters {
  source: InsightsSource;
  category: string | null;
  window: InsightsWindow;
  favouritesOnly: boolean;
  page: number;
  limit: number;
}

export const DEFAULT_INSIGHTS_FILTERS: InsightsFilters = {
  source: "news_momentum",
  category: null,
  window: "24h",
  favouritesOnly: false,
  page: 1,
  limit: 25,
};

const FILTER_PARAM_ORDER = [
  "source",
  "category",
  "window",
  "fav",
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

export function parseTab(search: string | URLSearchParams): InsightsTab {
  const params =
    typeof search === "string"
      ? new URLSearchParams(search.startsWith("?") ? search.slice(1) : search)
      : search;
  const tab = params.get("tab");
  if (tab && (INSIGHTS_TAB_VALUES as readonly string[]).includes(tab)) {
    return tab as InsightsTab;
  }
  // Deep links with filter params should land on Rankings, not Overview.
  if (params.get("source") || params.get("category") || params.get("fav") === "1") {
    return "rankings";
  }
  return "overview";
}

export function writeInsightsQuery(patch: {
  tab?: InsightsTab | null;
  filters?: Partial<InsightsFilters> | null;
}): void {
  const url = new URL(window.location.href);
  if (patch.tab !== undefined) {
    if (patch.tab === null || patch.tab === "overview") {
      url.searchParams.delete("tab");
    } else {
      url.searchParams.set("tab", patch.tab);
    }
  }
  if (patch.filters) {
    const current = parseFilters(url.search);
    const merged = { ...current, ...patch.filters };
    const serialized = serializeFilters(merged);
    for (const key of ["source", "category", "window", "fav", "page", "limit"]) {
      url.searchParams.delete(key);
    }
    serialized.forEach((value, key) => {
      url.searchParams.set(key, value);
    });
  }
  window.history.replaceState({}, "", url.toString());
  window.dispatchEvent(new PopStateEvent("popstate"));
}
