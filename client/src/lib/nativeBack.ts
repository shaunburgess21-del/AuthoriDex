/**
 * Android hardware-Back decision for the Capacitor shell.
 *
 * Registering `@capacitor/app`'s `backButton` listener turns off Capacitor's
 * automatic WebView history walk, so this decision covers every case:
 * pop in-app history, leave a deep link for its parent, or exit from a tab.
 *
 * `canGoBack` is the WebView session-history position Capacitor reports.
 * `history.length` is not used: it stays above 1 after the user returns to
 * the first entry, which would block `exitApp` after any in-app navigation.
 *
 * UI back buttons keep using `goBack` (`client/src/lib/goBack.ts`). That
 * helper pushes a fallback history entry, which would trap a deep-linked
 * screen in a loop, and it cannot exit the app.
 */

/** Primary tabs. Exact paths only — `/vote/matchups/...` is not a root. */
export const ROOT_DESTINATIONS = ["/", "/vote", "/predict", "/voices", "/insights"] as const;

export type RootDestination = (typeof ROOT_DESTINATIONS)[number];

export type NativeBackDecision =
  | { type: "back" }
  | { type: "exit" }
  | { type: "replace"; path: string };

const ROOT_SET: ReadonlySet<string> = new Set(ROOT_DESTINATIONS);

/** Pathname only. Query and hash stay on the current entry when we pop. */
export function normalizeAppPath(input: string): string {
  const withoutHash = input.split("#")[0] ?? "";
  const pathname = (withoutHash.split("?")[0] ?? "").trim();
  if (pathname === "" || pathname === "/") return "/";
  const withSlash = pathname.startsWith("/") ? pathname : `/${pathname}`;
  return withSlash.length > 1 && withSlash.endsWith("/")
    ? withSlash.slice(0, -1)
    : withSlash;
}

export function isRootDestination(input: string): boolean {
  return ROOT_SET.has(normalizeAppPath(input));
}

/**
 * Where a deep-linked screen with an empty WebView history should land.
 * Vote and Predict details return to their hubs. Everything else walks one
 * sensible step toward Home (`/login/verify` → `/login`, `/me/settings` →
 * `/me`) and Home is the fallback.
 */
export function parentRouteFor(input: string): string {
  const path = normalizeAppPath(input);

  if (path.startsWith("/vote/")) return "/vote";
  if (path.startsWith("/polls/")) return "/vote";
  if (path.startsWith("/predict/")) return "/predict";
  if (path.startsWith("/markets/")) return "/predict";
  if (path.startsWith("/predictions/")) return "/predict";
  if (path.startsWith("/share/")) return "/predict";
  if (path.startsWith("/voices/")) return "/voices";
  if (path.startsWith("/insights/")) return "/insights";
  if (path === "/explore" || path.startsWith("/explore/")) return "/insights";
  if (path.startsWith("/login/")) return "/login";
  if (path.startsWith("/me/")) return "/me";
  if (path.startsWith("/admin/")) return "/admin";
  if (
    path.startsWith("/person/") ||
    path.startsWith("/celebrity/") ||
    path.startsWith("/u/") ||
    path === "/profile" ||
    path.startsWith("/profile/")
  ) {
    return "/";
  }

  return "/";
}

export function decideNativeBack(pathname: string, canGoBack: boolean): NativeBackDecision {
  if (canGoBack) return { type: "back" };
  const path = normalizeAppPath(pathname);
  if (isRootDestination(path)) return { type: "exit" };

  const parent = parentRouteFor(path);
  if (parent === path) return { type: "exit" };
  return { type: "replace", path: parent };
}
