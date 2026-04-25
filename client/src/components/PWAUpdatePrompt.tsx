/**
 * PWA "new version available" prompt.
 *
 * VoxDex is a PWA (`vite-plugin-pwa`, see vite.config.ts). On every deploy the
 * service worker swaps to a fresh build and `skipWaiting + clientsClaim` lets
 * the new SW take control of open tabs immediately — but the page itself still
 * has the OLD JS chunks loaded in memory until the user navigates or refreshes.
 * Without an explicit affordance, users sit on stale UI for the rest of their
 * session (or longer, since mobile Chrome happily keeps tabs alive for days).
 *
 * This component wires the official vite-plugin-pwa React hook to a Sonner
 * toast: when a new SW is detected we surface a persistent toast with a
 * "Refresh now" action button. Clicking it calls `updateServiceWorker(true)`
 * which activates the waiting worker and reloads the page so users land on the
 * fresh bundle in one tap. Closing the toast just dismisses the prompt — the
 * autoUpdate SW will still apply the new code on the next navigation.
 *
 * Lives globally next to the Toaster in App.tsx so it can observe SW state
 * regardless of which route the user is on. Renders nothing on its own.
 */
import { useEffect, useRef } from "react";
import { useRegisterSW } from "virtual:pwa-register/react";
import { toast } from "sonner";

/**
 * How often we poke the registered SW to check for a fresh build.
 * Default vite-plugin-pwa only checks on initial registration, so a tab left
 * open all day on a phone never picks up new deploys. One hour is a reasonable
 * trade-off between freshness and bandwidth (each check is one HEAD request).
 */
const SW_UPDATE_INTERVAL_MS = 60 * 60 * 1000;

export function PWAUpdatePrompt() {
  const {
    needRefresh: [needRefresh, setNeedRefresh],
    updateServiceWorker,
  } = useRegisterSW({
    onRegisteredSW(_swUrl, registration) {
      if (!registration) return;
      // Periodic update probe — keeps long-lived sessions in sync without
      // requiring the user to refresh just to discover whether a new build
      // exists. registration.update() is a no-op when nothing changed.
      const id = window.setInterval(() => {
        registration.update().catch(() => {
          // Network blips during the probe are not user-actionable; swallow.
        });
      }, SW_UPDATE_INTERVAL_MS);
      // Best-effort cleanup on full page unload (component itself never
      // unmounts in normal flow, but be a good citizen).
      window.addEventListener("beforeunload", () => window.clearInterval(id), {
        once: true,
      });
    },
    onRegisterError(error) {
      // Registration errors usually mean the SW file isn't reachable (CSP,
      // 404, mixed content). Log so devs see it; never toast — would noise up
      // every reload on a misconfigured staging environment.
      console.warn("[pwa] service worker registration failed:", error);
    },
  });

  // Track the active toast id so we can dismiss it if `needRefresh` flips back
  // to false (e.g. after `updateServiceWorker(true)` triggers a reload).
  const toastIdRef = useRef<string | number | null>(null);

  useEffect(() => {
    if (!needRefresh) {
      if (toastIdRef.current !== null) {
        toast.dismiss(toastIdRef.current);
        toastIdRef.current = null;
      }
      return;
    }

    const id = toast("New version available", {
      description: "Refresh to load the latest VoxDex updates.",
      // Persistent — the prompt should stay until the user makes a choice.
      // Sonner's global 6s default would let it slip past unnoticed.
      duration: Infinity,
      action: {
        label: "Refresh now",
        onClick: () => {
          // `true` tells the waiting SW to activate immediately and reloads
          // the current page so the user lands on the fresh bundle.
          updateServiceWorker(true);
        },
      },
      onDismiss: () => setNeedRefresh(false),
      onAutoClose: () => setNeedRefresh(false),
    });

    toastIdRef.current = id;

    return () => {
      toast.dismiss(id);
      toastIdRef.current = null;
    };
  }, [needRefresh, setNeedRefresh, updateServiceWorker]);

  return null;
}
