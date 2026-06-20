import { useEffect, useState } from "react";
import { Globe, Users } from "lucide-react";
import { ApprovalTab } from "./ApprovalTab";
import { WebSentimentTab } from "./WebSentimentTab";
import { cn } from "@/lib/utils";
import { logInsightsEvent } from "@/lib/insights-telemetry";

type CrowdSub = "approval" | "web";

const SUB_VALUES: readonly CrowdSub[] = ["approval", "web"] as const;

function readSubFromUrl(): CrowdSub {
  if (typeof window === "undefined") return "approval";
  const raw = new URLSearchParams(window.location.search).get("sub");
  if (raw === "web") return "web";
  return "approval";
}

function writeSubToUrl(sub: CrowdSub) {
  if (typeof window === "undefined") return;
  const url = new URL(window.location.href);
  if (sub === "approval") {
    url.searchParams.delete("sub");
  } else {
    url.searchParams.set("sub", sub);
  }
  window.history.replaceState({}, "", url.toString());
  window.dispatchEvent(new PopStateEvent("popstate"));
}

/**
 * Crowd tab — splits into VoxDex Approval (default) and DataForSEO Web Sentiment.
 *
 * The sub-tab persists in the URL as `?sub=approval|web` so deep links survive
 * (default sub omits the param, matching the rest of the Insights URL contract).
 *
 * Designed reversibly: drop this file and route `crowd` straight to ApprovalTab
 * in InsightsPage.tsx to revert.
 */
export function CrowdTab() {
  const [sub, setSub] = useState<CrowdSub>(() => readSubFromUrl());

  // Keep sub in sync if another component changes the URL (back button, share
  // link, etc.).
  useEffect(() => {
    const onPop = () => setSub(readSubFromUrl());
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  const switchSub = (next: CrowdSub) => {
    if (next === sub) return;
    logInsightsEvent("crowd", "sub_tab_change", { sub: next });
    writeSubToUrl(next);
    setSub(next);
    window.scrollTo({ top: 0, behavior: "auto" });
  };

  return (
    <div className="space-y-4">
      <div
        className="inline-flex rounded-lg border border-border/50 bg-muted/40 p-0.5 text-xs font-medium"
        role="tablist"
        aria-label="Approval subsection"
      >
        {SUB_VALUES.map((value) => {
          const isActive = sub === value;
          const Icon = value === "web" ? Globe : Users;
          const label = value === "web" ? "Web Sentiment" : "VoxDex Approval";
          return (
            <button
              key={value}
              type="button"
              role="tab"
              aria-selected={isActive}
              onClick={() => switchSub(value)}
              className={cn(
                "inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md transition-colors",
                isActive
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground",
              )}
              data-testid={`crowd-sub-${value}`}
            >
              <Icon className="h-3.5 w-3.5" />
              {label}
            </button>
          );
        })}
      </div>

      {sub === "approval" && <ApprovalTab />}
      {sub === "web" && <WebSentimentTab />}
    </div>
  );
}
