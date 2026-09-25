import { createRoot } from "react-dom/client";
import { Capacitor } from "@capacitor/core";
import { SplashScreen } from "@capacitor/splash-screen";
import { installNativeOriginPatch } from "./lib/nativeOrigin";
import App from "./App";
import { installNativeOAuthListener } from "./lib/nativeOAuth";
import { installNativeBackListener } from "./lib/nativeBackListener";
import { syncAndroidSystemBars } from "./lib/nativeSystemBars";
import "./index.css";

try {
  syncAndroidSystemBars(localStorage.getItem("theme") === "light" ? "light" : "dark");
} catch {
  syncAndroidSystemBars("dark");
}

installNativeOriginPatch();
installNativeOAuthListener();
installNativeBackListener();

const DEV_SW_RESET_KEY = "__voxdex_dev_sw_reset__";

if (import.meta.env.DEV && typeof window !== "undefined" && "serviceWorker" in navigator) {
  void navigator.serviceWorker.getRegistrations().then(async (registrations) => {
    if (!registrations.length) return;

    await Promise.all(registrations.map((registration) => registration.unregister()));

    if ("caches" in window) {
      const cacheKeys = await caches.keys();
      await Promise.all(cacheKeys.map((cacheKey) => caches.delete(cacheKey)));
    }

    if (!sessionStorage.getItem(DEV_SW_RESET_KEY)) {
      sessionStorage.setItem(DEV_SW_RESET_KEY, "1");
      window.location.reload();
    }
  });
}

createRoot(document.getElementById("root")!).render(<App />);

if (Capacitor.isNativePlatform()) {
  requestAnimationFrame(() => {
    void SplashScreen.hide();
  });
}
