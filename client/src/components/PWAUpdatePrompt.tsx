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
 */
import { useEffect } from "react";
import { useRegisterSW } from "virtual:pwa-register/react";

/** Probe interval for tabs left open across deploys (one HEAD per check). */
const SW_UPDATE_INTERVAL_MS = 60 * 60 * 1000;

export function PWAUpdatePrompt() {
  const {
    needRefresh: [needRefresh],
    updateServiceWorker,
  } = useRegisterSW({
    onRegisteredSW(_swUrl, registration) {
      if (!registration) return;
      const id = window.setInterval(() => {
        registration.update().catch(() => {
          // Network blips during the probe are not user-actionable.
        });
      }, SW_UPDATE_INTERVAL_MS);
      window.addEventListener("beforeunload", () => window.clearInterval(id), {
        once: true,
      });
    },
    onRegisterError(error) {
      console.warn("[pwa] service worker registration failed:", error);
    },
  });

  useEffect(() => {
    if (!needRefresh) return;

    const applyUpdate = () => {
      // Tells the waiting worker to skipWaiting; the register runtime
      // reloads the page when the new worker takes control. Only ever
      // called while the tab is hidden, so the reload is invisible.
      void updateServiceWorker(true);
    };

    if (document.visibilityState === "hidden") {
      applyUpdate();
      return;
    }

    const onVisibilityChange = () => {
      if (document.visibilityState === "hidden") applyUpdate();
    };
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () =>
      document.removeEventListener("visibilitychange", onVisibilityChange);
  }, [needRefresh, updateServiceWorker]);

  return null;
}
