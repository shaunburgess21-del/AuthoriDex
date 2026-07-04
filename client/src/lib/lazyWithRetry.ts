import { lazy, type ComponentType } from "react";

const CHUNK_RETRY_KEY = "chunk_retry";
/** Prevent reload loops within a single deploy window; allow retry after TTL. */
const CHUNK_RETRY_TTL_MS = 5 * 60 * 1000;

const CHUNK_LOAD_ERROR_PATTERNS = [
  /Failed to fetch dynamically imported module/i,
  /Importing a module script failed/i,
  /error loading dynamically imported module/i,
];

// If we got here the page loaded successfully -- clear any leftover retry
// flag from a previous stale-chunk reload so the mechanism works on the
// next deploy too.
if (typeof window !== "undefined") {
  try {
    sessionStorage.removeItem(CHUNK_RETRY_KEY);
  } catch {
    /* private mode / storage blocked */
  }
}

function isStaleChunkLoadError(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err);
  return CHUNK_LOAD_ERROR_PATTERNS.some((pattern) => pattern.test(message));
}

function shouldAttemptChunkReload(): boolean {
  try {
    const raw = sessionStorage.getItem(CHUNK_RETRY_KEY);
    if (!raw) return true;
    const timestamp = Number(raw);
    if (!Number.isFinite(timestamp)) {
      sessionStorage.removeItem(CHUNK_RETRY_KEY);
      return true;
    }
    if (Date.now() - timestamp > CHUNK_RETRY_TTL_MS) {
      sessionStorage.removeItem(CHUNK_RETRY_KEY);
      return true;
    }
    return false;
  } catch {
    return true;
  }
}

/**
 * Wraps React.lazy with automatic recovery from stale-chunk errors.
 * After a deploy the old HTML may reference chunk filenames that no longer
 * exist. When the dynamic import fails we do a single full-page reload so
 * the browser fetches the new HTML with correct chunk URLs.
 */
export function lazyWithRetry<T extends ComponentType<any>>(
  factory: () => Promise<{ default: T }>
) {
  return lazy(() =>
    factory().catch((err: unknown) => {
      if (!isStaleChunkLoadError(err)) {
        throw err;
      }
      if (shouldAttemptChunkReload()) {
        console.warn("[lazyWithRetry] Stale chunk load failed, reloading once:", err);
        sessionStorage.setItem(CHUNK_RETRY_KEY, String(Date.now()));
        window.location.reload();
        return new Promise<{ default: T }>(() => {});
      }
      sessionStorage.removeItem(CHUNK_RETRY_KEY);
      throw err;
    })
  );
}
