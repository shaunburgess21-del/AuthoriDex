/**
 * Silent PWA service worker registration (`registerType: "autoUpdate"`).
 *
 * New deploys activate the waiting worker automatically; the next
 * navigation or refresh loads the fresh bundle without a user prompt.
 * This component only registers the SW and periodically probes for
 * updates on long-lived tabs — it renders nothing.
 */
import { useRegisterSW } from "virtual:pwa-register/react";

/** Probe interval for tabs left open across deploys (one HEAD per check). */
const SW_UPDATE_INTERVAL_MS = 60 * 60 * 1000;

export function PWAUpdatePrompt() {
  useRegisterSW({
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

  return null;
}
