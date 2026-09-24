/**
 * Web-only service worker registration. Imported dynamically so the
 * Capacitor build (no VitePWA plugin) never resolves `virtual:pwa-register`.
 */
import { useEffect } from "react";
import { useRegisterSW } from "virtual:pwa-register/react";

/** Probe interval for tabs left open across deploys (one HEAD per check). */
const SW_UPDATE_INTERVAL_MS = 60 * 60 * 1000;

export function PWAUpdatePromptWeb() {
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
