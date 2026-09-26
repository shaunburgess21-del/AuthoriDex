/**
 * Maps a production https://voxdex.com content URL to an in-app wouter path.
 *
 * Android App Links claim the same allowlist (see AndroidManifest). This
 * function never treats `com.voxdex.app://login` as content, so the HTTPS
 * handler cannot feed a PKCE code into `exchangeCodeForSession`.
 *
 * Host is apex only. www.voxdex.com 308s to https://voxdex.com/ and share
 * URLs are built from `window.location.origin` on that host.
 */

export const CONTENT_LINK_HOST = "voxdex.com";

/** Detail paths share helpers and page share buttons actually emit. */
const CONTENT_PREFIXES = [
  "/person/",
  "/polls/",
  "/vote/matchups/",
  "/vote/opinion-polls/",
  "/predict/updown/",
  "/predict/h2h/",
  "/predict/race/",
  "/markets/",
  "/share/bet/",
  "/u/",
] as const;

/**
 * Exact paths. `/` is referral (`?ref=`) and the home leaderboard share.
 * `/vote` and `/predict` are deck / portfolio shares. Prefixes would also
 * claim `/vote/induction` and `/predict/activity`, which are not share URLs.
 */
const CONTENT_EXACT_PATHS = new Set(["/", "/vote", "/predict"]);

export type ContentLinkPlan =
  | { status: "navigate"; path: string }
  | { status: "ignore" };

function normalizePathname(pathname: string): string {
  if (pathname === "" || pathname === "/") return "/";
  const trimmed = pathname.replace(/\/+$/, "");
  return trimmed === "" ? "/" : trimmed;
}

function isAllowedPath(pathname: string): boolean {
  if (CONTENT_EXACT_PATHS.has(pathname)) return true;
  return CONTENT_PREFIXES.some(
    (prefix) => pathname.startsWith(prefix) && pathname.length > prefix.length,
  );
}

/**
 * Returns the in-app path (pathname + query + hash) or ignore.
 * Query (`ref`, `sharer`, `utm_*`, leaderboard filters) and hash
 * (`#leaderboard`, `#comment-*`) are preserved.
 */
export function contentPathFromUrl(url: string): ContentLinkPlan {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return { status: "ignore" };
  }

  // Custom-scheme OAuth returns are Phase 6. HTTPS /login?code= is the
  // web callback and is also outside this allowlist.
  if (parsed.protocol !== "https:") return { status: "ignore" };
  if (parsed.hostname !== CONTENT_LINK_HOST) return { status: "ignore" };
  if (parsed.username !== "" || parsed.password !== "") return { status: "ignore" };
  if (parsed.port !== "") return { status: "ignore" };

  const pathname = normalizePathname(parsed.pathname);
  if (!isAllowedPath(pathname)) return { status: "ignore" };
  if (pathname.includes("\\") || pathname.includes("?") || pathname.includes("#")) {
    return { status: "ignore" };
  }

  return { status: "navigate", path: `${pathname}${parsed.search}${parsed.hash}` };
}
