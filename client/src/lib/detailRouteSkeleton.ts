import { pathnameOnly } from "@/lib/primaryNav";

/**
 * Which layout-matched skeleton a detail URL should show while its
 * route chunk or its data is still loading.
 *
 * Hub paths (`/vote`, `/predict`, `/polls` with no slug) return null so
 * they keep their own list fallbacks.
 */
export type DetailSkeletonKind =
  | "matchup"
  | "opinion"
  | "sentiment"
  | "market"
  | "native-market"
  | "person"
  | "public-profile"
  | "account-profile";

function hasSlug(path: string, prefix: string): boolean {
  return path.startsWith(prefix) && path.length > prefix.length;
}

export function detailSkeletonKind(input: string): DetailSkeletonKind | null {
  const path = pathnameOnly(input);
  if (hasSlug(path, "/vote/matchups/")) return "matchup";
  if (hasSlug(path, "/vote/opinion-polls/")) return "opinion";
  if (hasSlug(path, "/polls/")) return "sentiment";
  if (hasSlug(path, "/markets/")) return "market";
  if (
    hasSlug(path, "/predict/updown/") ||
    hasSlug(path, "/predict/h2h/") ||
    hasSlug(path, "/predict/race/")
  ) {
    return "native-market";
  }
  if (hasSlug(path, "/person/") || hasSlug(path, "/celebrity/")) return "person";
  if (hasSlug(path, "/u/")) return "public-profile";
  if (path === "/profile") return "account-profile";
  return null;
}
