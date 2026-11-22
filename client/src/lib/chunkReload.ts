/** Session flag so a stale chunk 404 reloads once, not in a loop. */
export const CHUNK_RELOAD_KEY = "voxdex:chunk-reload";

const CHUNK_LOAD_ERROR_PATTERNS = [
  /Failed to fetch dynamically imported module/i,
  /Importing a module script failed/i,
  /error loading dynamically imported module/i,
  /ChunkLoadError/i,
  /Loading chunk [\d]+ failed/i,
  /Unable to preload CSS/i,
  // Chrome, when a module URL comes back as HTML (stale shell or SPA fallback).
  /Failed to load module script/i,
  /Expected a JavaScript(?:-or-Wasm)? module script/i,
  /MIME type of ["']text\/html["']/i,
];

type ReloadStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

export type BoundaryRecovery = "reload" | "retry" | "generic";

export function isChunkLoadError(err: unknown): boolean {
  const message =
    err instanceof Error ? `${err.name}: ${err.message}` : String(err ?? "");
  return CHUNK_LOAD_ERROR_PATTERNS.some((pattern) => pattern.test(message));
}

/**
 * Chunk failures get one reload. A second failure in the same session is a
 * retry screen, not the generic crash page. Anything else stays generic.
 */
export function boundaryRecovery(
  error: unknown,
  storage: ReloadStorage,
  reload: () => void,
): BoundaryRecovery {
  if (!isChunkLoadError(error)) return "generic";
  return reloadOnceAfterChunkError(storage, reload) ? "reload" : "retry";
}

export function chunkReloadAlreadyAttempted(storage: Pick<Storage, "getItem">): boolean {
  try {
    return storage.getItem(CHUNK_RELOAD_KEY) === "1";
  } catch {
    return false;
  }
}

/**
 * Reload the document once per session. Returns true when a reload was started.
 * A second failure in the same session (stale worker still serving old HTML)
 * must not reload again.
 */
export function reloadOnceAfterChunkError(
  storage: ReloadStorage,
  reload: () => void,
): boolean {
  try {
    if (storage.getItem(CHUNK_RELOAD_KEY) === "1") return false;
    storage.setItem(CHUNK_RELOAD_KEY, "1");
  } catch {
    return false;
  }
  reload();
  return true;
}

export function clearChunkReloadGuard(storage: Pick<Storage, "removeItem">): void {
  try {
    storage.removeItem(CHUNK_RELOAD_KEY);
  } catch {
    /* private mode */
  }
}

const RECOVERED_CLEAR_MS = 8000;

/**
 * vite:preloadError covers dynamic imports Vite preloads. lazyWithRetry
 * covers React.lazy. Both share the session guard. A healthy page clears
 * the guard after a few seconds so the next deploy can reload once too.
 */
export function installChunkReloadRecovery(): void {
  if (typeof window === "undefined") return;
  window.addEventListener("vite:preloadError", (event) => {
    event.preventDefault();
    reloadOnceAfterChunkError(window.sessionStorage, () => window.location.reload());
  });
  window.setTimeout(() => {
    clearChunkReloadGuard(window.sessionStorage);
  }, RECOVERED_CLEAR_MS);
}
