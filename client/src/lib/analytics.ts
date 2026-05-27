type GtagArgs = [command: string, ...params: any[]];

declare global {
  interface Window {
    dataLayer?: Array<IArguments | GtagArgs>;
    gtag?: (...args: GtagArgs) => void;
  }
}

const GA_SCRIPT_ID = "ga4-gtag-script";
const measurementId = String(import.meta.env.VITE_GA_MEASUREMENT_ID ?? "").trim();

let initialized = false;

export function isGaEnabled(): boolean {
  return Boolean(measurementId);
}

export function initGoogleAnalytics(): void {
  if (!isGaEnabled() || initialized || typeof window === "undefined") return;

  if (!document.getElementById(GA_SCRIPT_ID)) {
    const script = document.createElement("script");
    script.id = GA_SCRIPT_ID;
    script.async = true;
    script.src = `https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(measurementId)}`;
    document.head.appendChild(script);
  }

  window.dataLayer = window.dataLayer || [];
  window.gtag =
    window.gtag ||
    function gtag() {
      // gtag.js reads `arguments` objects from the queue — not plain arrays.
      window.dataLayer?.push(arguments);
    };

  window.gtag("js", new Date() as any);
  // Disable automatic page view so our SPA route watcher is the single source of truth.
  window.gtag("config", measurementId, {
    send_page_view: false,
    anonymize_ip: true,
  } as any);

  initialized = true;
}

export function trackGooglePageView(pathname: string): void {
  if (!isGaEnabled() || typeof window === "undefined" || typeof window.gtag !== "function") {
    return;
  }

  const pagePath = `${pathname}${window.location.search || ""}`;
  window.gtag("event", "page_view", {
    page_path: pagePath,
    page_location: window.location.href,
    page_title: document.title,
  } as any);
}
