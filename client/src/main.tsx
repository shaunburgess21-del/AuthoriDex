import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";

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
