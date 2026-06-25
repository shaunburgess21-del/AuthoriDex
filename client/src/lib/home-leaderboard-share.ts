export type HomeLeaderboardSortDirection = "asc" | "desc";

export interface HomeLeaderboardShareState {
  category: string;
  searchQuery: string;
  sortDirection: HomeLeaderboardSortDirection;
  categoryLabel?: string;
}

export function buildHomeLeaderboardShareUrl(
  state: HomeLeaderboardShareState,
): string {
  const url = new URL(window.location.origin + "/");

  if (state.category && state.category !== "all") {
    url.searchParams.set("category", state.category);
  }

  const trimmedSearch = state.searchQuery.trim();
  if (trimmedSearch) {
    url.searchParams.set("search", trimmedSearch);
  }

  if (state.sortDirection !== "desc") {
    url.searchParams.set("sortDir", state.sortDirection);
  }

  url.hash = "leaderboard";
  return url.toString();
}

export function buildHomeLeaderboardShareTitle(
  state: HomeLeaderboardShareState,
): string {
  const trimmedSearch = state.searchQuery.trim();
  const parts = ["VoxDex Leaderboard"];

  if (state.category !== "all" && state.categoryLabel) {
    parts.push(state.categoryLabel);
  } else if (state.category === "favorites") {
    parts.push("Favorites");
  }

  if (trimmedSearch) {
    parts.push(trimmedSearch);
  }

  return parts.length === 1 ? parts[0]! : `${parts[0]} — ${parts.slice(1).join(" · ")}`;
}

export async function shareHomeLeaderboardView(
  state: HomeLeaderboardShareState,
): Promise<"shared" | "copied"> {
  const shareUrl = buildHomeLeaderboardShareUrl(state);
  const title = buildHomeLeaderboardShareTitle(state);

  if (typeof navigator.share === "function") {
    try {
      await navigator.share({ title, url: shareUrl });
      return "shared";
    } catch (err) {
      if ((err as Error)?.name === "AbortError") {
        throw err;
      }
    }
  }

  try {
    await navigator.clipboard.writeText(shareUrl);
  } catch {
    const textarea = document.createElement("textarea");
    textarea.value = shareUrl;
    textarea.style.position = "fixed";
    textarea.style.opacity = "0";
    document.body.appendChild(textarea);
    textarea.select();
    document.execCommand("copy");
    document.body.removeChild(textarea);
  }
  return "copied";
}
