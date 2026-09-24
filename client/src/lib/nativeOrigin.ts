/**
 * Native builds set `VITE_API_ORIGIN` (https://voxdex.com) so `/api` and
 * `/attached_assets` calls hit Vercel instead of the WebView origin
 * (`https://localhost` / `capacitor://localhost`). The Vercel web build
 * leaves the variable unset, so `fetch` and `EventSource` stay untouched.
 */

const API_ORIGIN = String(import.meta.env.VITE_API_ORIGIN ?? "").replace(/\/$/, "");

const WEBVIEW_ORIGINS = new Set([
  "https://localhost",
  "http://localhost",
  "capacitor://localhost",
]);

function rewriteUrl(url: string): string {
  if (!API_ORIGIN || typeof window === "undefined") return url;

  let parsed: URL;
  try {
    parsed = new URL(url, window.location.origin);
  } catch {
    return url;
  }

  const path = parsed.pathname;
  const isApi = path === "/api" || path.startsWith("/api/");
  const isAsset = path === "/attached_assets" || path.startsWith("/attached_assets/");
  if (!isApi && !isAsset) return url;

  const isRootRelative = url.startsWith("/") && !url.startsWith("//");
  if (!isRootRelative && !WEBVIEW_ORIGINS.has(parsed.origin)) return url;

  return `${API_ORIGIN}${path}${parsed.search}${parsed.hash}`;
}

let originPatchInstalled = false;

export function installNativeOriginPatch(): void {
  if (originPatchInstalled || !API_ORIGIN || typeof window === "undefined") return;
  originPatchInstalled = true;

  const originalFetch = window.fetch.bind(window);
  window.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
    if (typeof input === "string" || input instanceof URL) {
      return originalFetch(rewriteUrl(input.toString()), init);
    }
    const rewritten = rewriteUrl(input.url);
    if (rewritten !== input.url) {
      return originalFetch(new Request(rewritten, input), init);
    }
    return originalFetch(input, init);
  };

  const NativeEventSource = window.EventSource;
  window.EventSource = class PatchedEventSource extends NativeEventSource {
    constructor(url: string | URL, eventSourceInitDict?: EventSourceInit) {
      super(rewriteUrl(typeof url === "string" ? url : url.toString()), {
        ...eventSourceInitDict,
        withCredentials: true,
      });
    }
  };
}

installNativeOriginPatch();
