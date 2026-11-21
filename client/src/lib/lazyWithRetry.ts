import { lazy, type ComponentType } from "react";
import { isChunkLoadError, reloadOnceAfterChunkError } from "@/lib/chunkReload";

/**
 * Wraps React.lazy with one-shot recovery from stale chunk URLs.
 * After a deploy the old HTML (or a service worker still serving it) may
 * reference filenames that 404. Reload once so the next document is current.
 * The session flag lives in chunkReload and is shared with vite:preloadError.
 */
export function lazyWithRetry<T extends ComponentType<any>>(
  factory: () => Promise<{ default: T }>,
) {
  return lazy(() =>
    factory().catch((err: unknown) => {
      if (!isChunkLoadError(err) || typeof window === "undefined") {
        throw err;
      }
      const reloading = reloadOnceAfterChunkError(window.sessionStorage, () => {
        window.location.reload();
      });
      if (reloading) {
        console.warn("[lazyWithRetry] Stale chunk load failed, reloading once:", err);
        return new Promise<{ default: T }>(() => {});
      }
      throw err;
    }),
  );
}
