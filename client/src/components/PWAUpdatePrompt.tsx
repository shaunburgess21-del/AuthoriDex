/**
 * Silent-but-safe PWA updates (`registerType: "prompt"`).
 *
 * History of this component, because it has flip-flopped:
 *   1. prompt mode + "Refresh now" toast — no surprise reloads, but the
 *      toast nagged on every deploy.
 *   2. autoUpdate mode, no UI — silent, but the plugin's register runtime
 *      calls `window.location.reload()` the moment a new deploy's worker
 *      activates. Users mid-scroll were yanked back to the top ~10-15s
 *      after opening a stale browser (the delay = the new SW precaching).
 *
 * Current strategy — silent AND no mid-session reload:
 *   - prompt mode: a new service worker installs and then WAITS; the
 *     running page is never hijacked.
 *   - once a new build is waiting, we activate it (which reloads the
 *     page) only while the tab is HIDDEN — the user switched tabs or
 *     apps, so the refresh is invisible and they come back to the fresh
 *     build.
 *   - if the tab never goes hidden, the waiting worker activates on the
 *     next visit after the tab closes (standard browser behaviour), and
 *     the `lazyWithRetry` stale-chunk recovery in App.tsx covers any
 *     old-page/new-assets mismatch in the meantime.
 *
 * Lives globally in App.tsx; renders nothing.
 *
 * The Capacitor build sets `VITE_API_ORIGIN` and does not load VitePWA.
 * The `virtual:pwa-register` import stays in a separate module so that
 * branch is dropped from the native bundle.
 */
import { lazy, Suspense, type ComponentType } from "react";

const WebPrompt: ComponentType | null = import.meta.env.VITE_API_ORIGIN
  ? null
  : lazy(() =>
      import("./PWAUpdatePromptWeb").then((m) => ({
        default: m.PWAUpdatePromptWeb,
      })),
    );

export function PWAUpdatePrompt() {
  if (!WebPrompt) return null;
  return (
    <Suspense fallback={null}>
      <WebPrompt />
    </Suspense>
  );
}
