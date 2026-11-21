/**
 * Primary tab bar: Vote, Rankings, Predict, Voices, Insights.
 *
 * `/` and `/vote` are the same vote hub. `/rankings` is the celebrity
 * Trend Score board (the old home page). `/leaderboard` is an alias.
 */

export const PRIMARY_NAV_ITEMS = [
  { key: "vote", label: "Vote", href: "/" },
  { key: "rankings", label: "Rankings", href: "/rankings" },
  { key: "predict", label: "Predict", href: "/predict" },
  { key: "voices", label: "Voices", href: "/voices" },
  { key: "insights", label: "Insights", href: "/insights" },
] as const;

export type PrimaryNavKey = (typeof PRIMARY_NAV_ITEMS)[number]["key"];

export const VOTE_HOME_TITLE = "VoxDex | Vox Populi - Indexed";

export const VOTE_HOME_DESCRIPTION =
  "VoxDex turns the voice of the people into a living, real-time index. Vote, predict, and weigh in on the figures and topics shaping global conversation. — make your voice heard, one vote at a time.";

export const RANKINGS_TITLE = "Rankings | VoxDex";

export const RANKINGS_DESCRIPTION =
  "Live celebrity rankings by Trend Score. Daily movers, risers, and the full board.";

/** Pathname only. Query and hash are ignored. Trailing slashes collapse. */
export function pathnameOnly(input: string): string {
  const withoutHash = input.split("#")[0] ?? "";
  const pathname = (withoutHash.split("?")[0] ?? "").trim();
  if (pathname === "" || pathname === "/") return "/";
  const withSlash = pathname.startsWith("/") ? pathname : `/${pathname}`;
  return withSlash.length > 1 && withSlash.endsWith("/")
    ? withSlash.slice(0, -1)
    : withSlash;
}

/**
 * Which primary tab a path highlights.
 * `/` and every `/vote` URL are Vote. `/rankings` and `/leaderboard` are Rankings.
 */
export function primaryNavKeyForPath(input: string): PrimaryNavKey | null {
  const path = pathnameOnly(input);
  if (path === "/" || path === "/vote" || path.startsWith("/vote/")) return "vote";
  if (path === "/rankings" || path === "/leaderboard" || path.startsWith("/rankings/")) {
    return "rankings";
  }
  if (path === "/predict" || path.startsWith("/predict")) return "predict";
  if (path === "/voices" || path.startsWith("/voices")) return "voices";
  if (path === "/insights" || path.startsWith("/insights")) return "insights";
  return null;
}

export function isPrimaryNavActive(itemHref: string, location: string): boolean {
  const item = PRIMARY_NAV_ITEMS.find((entry) => entry.href === itemHref);
  if (!item) return false;
  return primaryNavKeyForPath(location) === item.key;
}

/**
 * Old leaderboard shares used `/?category=&search=&sortDir=#leaderboard`.
 * The hash is the discriminator so vote-hub query params on `/` stay put.
 * Returns the rankings URL, or null when this is not one of those shares.
 */
export function legacyLeaderboardShareTarget(
  pathname: string,
  search: string,
  hash: string,
): string | null {
  if (pathnameOnly(pathname) !== "/") return null;
  const normalizedHash = hash.startsWith("#") ? hash : hash ? `#${hash}` : "";
  if (normalizedHash !== "#leaderboard") return null;
  const qs = search ? (search.startsWith("?") ? search : `?${search}`) : "";
  return `/rankings${qs}#leaderboard`;
}

export interface RankingsShareState {
  category: string;
  searchQuery: string;
  sortDirection: "asc" | "desc";
}

/** Canonical share path for the celebrity board. */
export function buildRankingsSharePath(state: RankingsShareState): string {
  const params = new URLSearchParams();
  if (state.category && state.category !== "all") {
    params.set("category", state.category);
  }
  const trimmedSearch = state.searchQuery.trim();
  if (trimmedSearch) params.set("search", trimmedSearch);
  if (state.sortDirection !== "desc") params.set("sortDir", state.sortDirection);
  const qs = params.toString();
  return `/rankings${qs ? `?${qs}` : ""}#leaderboard`;
}

/** `/leaderboard` alias, preserving query and hash. */
export function leaderboardAliasTarget(search: string, hash: string): string {
  const qs = search ? (search.startsWith("?") ? search : `?${search}`) : "";
  const normalizedHash = hash.startsWith("#") ? hash : hash ? `#${hash}` : "";
  return `/rankings${qs}${normalizedHash}`;
}
