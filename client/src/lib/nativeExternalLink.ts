/**
 * Android external-link policy. Pure classification — no Capacitor imports.
 *
 * Capacitor 8's WebView (`Bridge.launchIntent`) already sends a main-frame
 * navigation whose host is not the app origin out via `ACTION_VIEW`. It does
 * not implement `onCreateWindow`, and `setSupportMultipleWindows` stays false,
 * so `<a target="_blank">` and `window.open` never become that main-frame
 * navigation. On Android those clicks are dropped.
 *
 * First-party http(s) (the WebView origin, `https://localhost`, and
 * `https://voxdex.com` / `www.voxdex.com`) stay inside the bundled SPA.
 * Signup/auth Terms and Privacy anchors set `data-native-external`. Those
 * open `https://voxdex.com/terms` or `/privacy` in Custom Tabs so the form
 * stays mounted. Other `/terms` and `/privacy` links stay in the SPA.
 * Other http(s) open in `@capacitor/browser` (Chrome Custom Tabs). `mailto:`,
 * `tel:`, `sms:`, and `market:` stay on the OS intent path. `intent:` and
 * `file:` are blocked. `com.voxdex.app://login` is left untouched so Phase 6
 * OAuth is not opened as a web page.
 *
 * Auth hosts (Supabase, accounts.google.com) are not first-party. A clicked
 * link to them opens externally. Phase 6 already calls `Browser.open` itself
 * and does not go through this helper.
 */

export type ExternalLinkDecision =
  | { kind: "passthrough" }
  | { kind: "in_app"; path: string }
  | { kind: "external"; url: string }
  | { kind: "system"; url: string }
  | { kind: "block" };

/** Live site opened in a Custom Tab. The WebView origin is `https://localhost`. */
const PUBLIC_SITE_ORIGIN = "https://voxdex.com";

/**
 * Present on signup/auth Terms and Privacy anchors only. The Android click
 * listener reads it. Web ignores it; `target="_blank"` still opens a new tab.
 */
export const NATIVE_EXTERNAL_ATTR = "data-native-external";

export interface ClassifyExternalLinkOptions {
  /** `window.location.origin`, for example `https://localhost`. */
  currentOrigin: string;
  /**
   * Document URL used to resolve relative and hash-only hrefs.
   * `window.location.href`. Defaults to `currentOrigin`.
   */
  baseHref?: string;
  /** Anchor `target`, or the window name passed to `window.open`. */
  target?: string | null;
  /** `window.open` always asks for a new browsing context. */
  newContext?: boolean;
  /**
   * Auth Terms/Privacy. Open the public page in a Custom Tab instead of
   * pushing the SPA route (which would unmount the signup form).
   */
  forceExternal?: boolean;
}

const SYSTEM_SCHEMES = new Set(["mailto:", "tel:", "sms:", "market:"]);
const BLOCKED_SCHEMES = new Set(["intent:", "file:", "content:"]);

function wantsNewContext(options: ClassifyExternalLinkOptions): boolean {
  if (options.newContext) return true;
  const target = (options.target ?? "").trim().toLowerCase();
  if (target === "" || target === "_self" || target === "_parent" || target === "_top") {
    return false;
  }
  return true;
}

function isSameWebViewDocument(parsed: URL, currentOrigin: string): boolean {
  let current: URL;
  try {
    current = new URL(currentOrigin);
  } catch {
    return false;
  }
  if (parsed.username !== "" || parsed.password !== "") return false;
  if (parsed.port !== current.port) return false;
  if (parsed.protocol === "capacitor:" || current.protocol === "capacitor:") {
    return (
      parsed.protocol === "capacitor:" &&
      current.protocol === "capacitor:" &&
      parsed.hostname === "localhost" &&
      current.hostname === "localhost"
    );
  }
  return parsed.protocol === current.protocol && parsed.hostname === current.hostname;
}

/** Bundled Capacitor origins. A non-default port is not the app. */
function isBundledWebViewUrl(parsed: URL): boolean {
  if (parsed.username !== "" || parsed.password !== "" || parsed.port !== "") return false;
  if (parsed.hostname !== "localhost") return false;
  return (
    parsed.protocol === "https:" ||
    parsed.protocol === "http:" ||
    parsed.protocol === "capacitor:"
  );
}

/** Public site. Apex and www only, https, no credentials, no port. */
function isPublicSiteUrl(parsed: URL): boolean {
  if (parsed.protocol !== "https:") return false;
  if (parsed.username !== "" || parsed.password !== "" || parsed.port !== "") return false;
  const host = parsed.hostname.toLowerCase();
  return host === "voxdex.com" || host === "www.voxdex.com";
}

function inAppPath(parsed: URL): string | null {
  const pathname = parsed.pathname === "" ? "/" : parsed.pathname;
  if (!pathname.startsWith("/") || pathname.startsWith("//")) return null;
  if (pathname.includes("\\") || pathname.includes("?") || pathname.includes("#")) return null;
  return `${pathname}${parsed.search}${parsed.hash}`;
}

function staysInApp(parsed: URL, currentOrigin: string): boolean {
  return (
    isPublicSiteUrl(parsed) ||
    isBundledWebViewUrl(parsed) ||
    isSameWebViewDocument(parsed, currentOrigin)
  );
}

/**
 * Decide what an Android WebView should do with a clicked or `window.open` URL.
 * Web and iOS never call this.
 */
export function classifyExternalLink(
  href: string,
  options: ClassifyExternalLinkOptions,
): ExternalLinkDecision {
  const raw = href.trim();
  if (raw === "") return { kind: "passthrough" };

  const origin = options.currentOrigin || "https://localhost";
  const base = options.baseHref || origin;
  let parsed: URL;
  try {
    parsed = new URL(raw, base);
  } catch {
    if (/^intent:/i.test(raw)) return { kind: "block" };
    return { kind: "passthrough" };
  }

  const scheme = parsed.protocol.toLowerCase();

  if (BLOCKED_SCHEMES.has(scheme)) return { kind: "block" };

  if (SYSTEM_SCHEMES.has(scheme)) {
    if (!wantsNewContext(options)) return { kind: "passthrough" };
    return { kind: "system", url: parsed.href };
  }

  // `capacitor://localhost` is not http(s). Capacitor would ACTION_VIEW it
  // because the app scheme is https. Keep it inside the bundled SPA.
  if (scheme === "capacitor:" && isBundledWebViewUrl(parsed)) {
    const capPath = inAppPath(parsed);
    if (!capPath) return { kind: "block" };
    if (wantsNewContext(options) || !isSameWebViewDocument(parsed, origin)) {
      return { kind: "in_app", path: capPath };
    }
    return { kind: "passthrough" };
  }

  if (scheme !== "http:" && scheme !== "https:") {
    return { kind: "passthrough" };
  }

  if (parsed.username !== "" || parsed.password !== "") return { kind: "block" };

  if (!staysInApp(parsed, origin)) {
    return { kind: "external", url: parsed.href };
  }

  const path = inAppPath(parsed);
  if (!path) return { kind: "block" };

  if (options.forceExternal) {
    return { kind: "external", url: `${PUBLIC_SITE_ORIGIN}${path}` };
  }

  if (wantsNewContext(options) || !isSameWebViewDocument(parsed, origin)) {
    return { kind: "in_app", path };
  }

  return { kind: "passthrough" };
}
