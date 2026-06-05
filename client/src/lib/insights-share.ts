import {
  DEFAULT_INSIGHTS_FILTERS,
  serializeFilters,
  type InsightsFilters,
} from "@shared/insights/filters";
import { logInsightsEvent } from "./insights-telemetry";

export async function shareInsightsView(options: {
  tab?: string;
  filters?: Partial<InsightsFilters>;
  extraParams?: Record<string, string>;
  title: string;
  text?: string;
  surface: "rankings" | "discover";
  telemetryParams?: Record<string, unknown>;
}): Promise<"shared" | "copied"> {
  const basePath =
    typeof window !== "undefined" && window.location.pathname.startsWith("/explore")
      ? "/explore"
      : "/insights";
  const url = new URL(window.location.origin + basePath);
  if (options.tab && options.tab !== "today") {
    url.searchParams.set("tab", options.tab);
  }
  if (options.filters) {
    // Fall back to the canonical defaults so we stay in lock-step if the
    // default source / window / limit ever changes (Phase 4 moved the
    // default source from `news_momentum` to `fame`).
    const serialized = serializeFilters({
      ...DEFAULT_INSIGHTS_FILTERS,
      ...options.filters,
    });
    serialized.forEach((value, key) => url.searchParams.set(key, value));
  }
  if (options.extraParams) {
    for (const [key, value] of Object.entries(options.extraParams)) {
      url.searchParams.set(key, value);
    }
  }

  const shareUrl = url.toString();
  logInsightsEvent(options.surface, "share_click", {
    url: shareUrl,
    ...options.telemetryParams,
  });

  if (typeof navigator.share === "function") {
    try {
      await navigator.share({
        title: options.title,
        text: options.text,
        url: shareUrl,
      });
      return "shared";
    } catch (err) {
      if ((err as Error)?.name === "AbortError") {
        throw err;
      }
    }
  }

  try {
    await navigator.clipboard.writeText(shareUrl);
  } catch {
    const textarea = document.createElement("textarea");
    textarea.value = shareUrl;
    textarea.style.position = "fixed";
    textarea.style.opacity = "0";
    document.body.appendChild(textarea);
    textarea.select();
    document.execCommand("copy");
    document.body.removeChild(textarea);
  }
  return "copied";
}
