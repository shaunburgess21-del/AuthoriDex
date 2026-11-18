/**
 * Native builds set `VITE_API_ORIGIN` (https://voxdex.com) so `/api` and
 * `/attached_assets` calls hit Vercel instead of the WebView origin
 * (`https://localhost` / `capacitor://localhost`). The Vercel web build
 * leaves the variable unset, so `fetch` and `EventSource` stay untouched.
 *
 * The WebView does not keep the third-party `fdx_sid` cookie. Native
 * `/api` responses echo the id in `X-Fdx-Sid`; this patch stores it and
 * sends it back on every `/api` request, including `/api/profile/sync`,
 * so pre-signup votes migrate onto the new account.
 */

import { FDX_SID_HEADER, normalizeFdxSid } from "@shared/lib/fdxSid";

const API_ORIGIN = String(import.meta.env?.VITE_API_ORIGIN ?? "").replace(/\/$/, "");

const WEBVIEW_ORIGINS = new Set([
  "https://localhost",
  "http://localhost",
  "capacitor://localhost",
]);

export const FDX_SID_STORAGE_KEY = "voxdex_fdx_sid";

export function rewriteNativeUrl(url: string): string {
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

type SidStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

export function readStoredFdxSid(storage: Pick<Storage, "getItem">): string {
  try {
    return normalizeFdxSid(storage.getItem(FDX_SID_STORAGE_KEY));
  } catch {
    return "";
  }
}

export function rememberFdxSid(storage: Pick<Storage, "setItem">, sid: string | null): void {
  const normalized = normalizeFdxSid(sid);
  if (!normalized) return;
  try {
    storage.setItem(FDX_SID_STORAGE_KEY, normalized);
  } catch {
    /* storage unavailable — the next response can try again */
  }
}

function pathnameOf(url: string): string {
  try {
    return new URL(url, "https://voxdex.com").pathname;
  } catch {
    return "";
  }
}

function isApiPath(pathname: string): boolean {
  return pathname === "/api" || pathname.startsWith("/api/");
}

function mergedHeaders(
  input: RequestInfo | URL,
  init: RequestInit | undefined,
  sid: string,
): Headers {
  const headers = new Headers(
    typeof input === "string" || input instanceof URL ? undefined : input.headers,
  );
  if (init?.headers) {
    new Headers(init.headers).forEach((value, key) => headers.set(key, value));
  }
  if (sid) headers.set(FDX_SID_HEADER, sid);
  return headers;
}

/**
 * Rewrite a native fetch and, for `/api` only, attach the stored anonymous
 * id and capture a fresh one from the response. `rewrite` defaults to the
 * production URL rewrite; tests pass their own.
 */
export async function fetchWithNativeFdxSid(
  originalFetch: typeof fetch,
  input: RequestInfo | URL,
  init: RequestInit | undefined,
  storage: SidStorage,
  rewrite: (url: string) => string = rewriteNativeUrl,
): Promise<Response> {
  const urlString =
    typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
  const rewritten = rewrite(urlString);
  const api = isApiPath(pathnameOf(rewritten));
  const sid = api ? readStoredFdxSid(storage) : "";

  let requestInput: RequestInfo | URL = rewritten;
  let requestInit = init;
  if (typeof input !== "string" && !(input instanceof URL)) {
    requestInput = rewritten === input.url ? input : new Request(rewritten, input);
  }
  if (api && sid) {
    requestInit = { ...init, headers: mergedHeaders(input, init, sid) };
  }

  const response = await originalFetch(requestInput, requestInit);
  if (api) {
    rememberFdxSid(storage, response.headers.get(FDX_SID_HEADER));
    // Signup clears the cookie after migrating anon_<sid> onto the account.
    // Drop the stored copy too, or the header echo would keep the old id.
    if (pathnameOf(rewritten) === "/api/profile/sync") {
      await dropStoredSidAfterSignup(response, storage);
    }
  }
  return response;
}

async function dropStoredSidAfterSignup(response: Response, storage: SidStorage): Promise<void> {
  if (!response.ok) return;
  try {
    const data = (await response.clone().json()) as { created?: unknown };
    if (data?.created === true) storage.removeItem(FDX_SID_STORAGE_KEY);
  } catch {
    /* non-JSON sync response — leave the stored id alone */
  }
}

let originPatchInstalled = false;

export function installNativeOriginPatch(): void {
  if (originPatchInstalled || !API_ORIGIN || typeof window === "undefined") return;
  originPatchInstalled = true;

  const originalFetch = window.fetch.bind(window);
  const storage = window.localStorage;
  window.fetch = (input: RequestInfo | URL, init?: RequestInit) =>
    fetchWithNativeFdxSid(originalFetch, input, init, storage, rewriteNativeUrl);

  const NativeEventSource = window.EventSource;
  window.EventSource = class PatchedEventSource extends NativeEventSource {
    constructor(url: string | URL, eventSourceInitDict?: EventSourceInit) {
      super(rewriteNativeUrl(typeof url === "string" ? url : url.toString()), {
        ...eventSourceInitDict,
        withCredentials: true,
      });
    }
  };
}

installNativeOriginPatch();
