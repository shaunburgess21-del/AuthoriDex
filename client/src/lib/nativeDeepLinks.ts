import { App } from "@capacitor/app";
import { Capacitor } from "@capacitor/core";
import { contentPathFromUrl } from "@/lib/nativeContentLink";

/**
 * HTTPS content deep links. Phase 6 keeps its own `appUrlOpen` listener in
 * `nativeOAuth.ts` for `com.voxdex.app://login`. This module adds a second
 * listener and never calls `exchangeCodeForSession` or `App.removeAllListeners`.
 *
 * Cold start: `getLaunchUrl` (Capacitor 8 does not also emit `appUrlOpen`
 * for the launch intent). The URL is applied with `replaceState` before
 * React renders, so the WebView history has a single entry and Phase 2
 * Back still walks parent → hub → exit.
 *
 * Warm resume: `appUrlOpen` from `onNewIntent`, pushed through wouter so
 * the existing screen stays under the new one.
 */

const SLOT_KEY = "__voxdexNativeContentLinks";

type ContentNavigate = (path: string, mode: "push" | "replace") => void;

interface ContentLinkSlot {
  listenerInstalled: boolean;
  navigate: ContentNavigate | null;
  pending: { path: string; mode: "push" | "replace" } | null;
}

function slot(): ContentLinkSlot {
  const g = globalThis as typeof globalThis & { [SLOT_KEY]?: ContentLinkSlot };
  if (!g[SLOT_KEY]) {
    g[SLOT_KEY] = { listenerInstalled: false, navigate: null, pending: null };
  }
  return g[SLOT_KEY];
}

function deliver(path: string, mode: "push" | "replace"): void {
  const current = slot();
  if (current.navigate) {
    current.navigate(path, mode);
    return;
  }
  current.pending = { path, mode };
}

/** Registered by the React tree so warm links use wouter `setLocation`. */
export function registerNativeContentNavigator(navigate: ContentNavigate): () => void {
  const current = slot();
  current.navigate = navigate;
  if (current.pending) {
    const job = current.pending;
    current.pending = null;
    navigate(job.path, job.mode);
  }
  return () => {
    if (current.navigate === navigate) current.navigate = null;
  };
}

function openContentUrl(url: string, mode: "push" | "replace"): void {
  const decision = contentPathFromUrl(url);
  if (decision.status !== "navigate") return;
  if (mode === "replace") {
    window.history.replaceState(null, "", decision.path);
    return;
  }
  deliver(decision.path, mode);
}

const LAUNCH_URL_TIMEOUT_MS = 2000;

function launchUrlOrTimeout(): Promise<{ url: string } | null> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(null), LAUNCH_URL_TIMEOUT_MS);
    void App.getLaunchUrl()
      .then((launch) => {
        clearTimeout(timer);
        resolve(launch?.url ? { url: launch.url } : null);
      })
      .catch(() => {
        clearTimeout(timer);
        resolve(null);
      });
  });
}

/**
 * Apply the VIEW intent that launched the process, before the SPA renders.
 * No-op on web and when the launch URL is not an allowlisted content link
 * (including the Phase 6 OAuth scheme). A stuck bridge call gives up so
 * startup still reaches React.
 */
export async function applyNativeColdStartContentLink(): Promise<void> {
  if (!Capacitor.isNativePlatform()) return;
  const launch = await launchUrlOrTimeout();
  if (launch?.url) openContentUrl(launch.url, "replace");
}

/** Warm `appUrlOpen` only. Call once at startup; safe to call again. */
export function installNativeContentLinkListener(): void {
  if (!Capacitor.isNativePlatform()) return;

  const current = slot();
  if (current.listenerInstalled) return;
  current.listenerInstalled = true;

  void App.addListener("appUrlOpen", ({ url }) => {
    if (!url) return;
    openContentUrl(url, "push");
  });
}
