import { useEffect, useLayoutEffect, useState } from "react";
import { useLocation } from "wouter";
import { canonicalizeInsightsTabUrl, parseTab } from "@shared/insights/filters";
import type { InsightsTab } from "@shared/insights/filters";
import { InsightsHeader } from "@/components/insights/InsightsHeader";
import { OverviewTab } from "@/components/insights/OverviewTab";
import { RankingsTab } from "@/components/insights/RankingsTab";
import { DiscoverTab } from "@/components/insights/DiscoverTab";
import { ApprovalTab } from "@/components/insights/ApprovalTab";
import { logInsightsEvent } from "@/lib/insights-telemetry";
import { SiteHeader } from "@/components/SiteHeader";

function shouldRedirectMarketsTab(search: string): boolean {
  const params = new URLSearchParams(
    search.startsWith("?") ? search.slice(1) : search,
  );
  return params.get("tab") === "markets";
}

function readTabFromLocation(): InsightsTab {
  canonicalizeInsightsTabUrl();
  return parseTab(window.location.search);
}

export default function InsightsPage() {
  const [, setLocation] = useLocation();
  const [tab, setTab] = useState<InsightsTab>(() => readTabFromLocation());

  useLayoutEffect(() => {
    if (shouldRedirectMarketsTab(window.location.search)) {
      setLocation("/predict");
    }
  }, [setLocation]);

  useEffect(() => {
    const syncFromUrl = () => {
      if (shouldRedirectMarketsTab(window.location.search)) {
        setLocation("/predict");
        return;
      }
      setTab(readTabFromLocation());
    };
    syncFromUrl();
    window.addEventListener("popstate", syncFromUrl);
    return () => window.removeEventListener("popstate", syncFromUrl);
  }, [setLocation]);

  useEffect(() => {
    document.title = "Insights | VoxDex";
    return () => {
      document.title = "VoxDex";
    };
  }, []);

  useEffect(() => {
    logInsightsEvent("insights", "tab_view", { tab });
    // Land at the top when switching tabs (e.g. Attention mix → Rankings),
    // otherwise the new tab inherits the previous tab's scroll position.
    window.scrollTo({ top: 0, behavior: "auto" });
  }, [tab]);

  return (
    <div className="min-h-screen pb-20 md:pb-0 bg-background overflow-x-clip">
      <SiteHeader active="insights" />

      <div className="border-b border-border/40 bg-muted/20">
        <div className="container mx-auto px-4 max-w-7xl py-5 md:py-6">
          <h1 className="text-2xl md:text-3xl font-serif font-bold tracking-tight">Insights</h1>
          <p className="text-sm text-muted-foreground mt-1.5 max-w-2xl leading-relaxed">
            A closer look at what&apos;s moving across VoxDex.
          </p>
        </div>
      </div>

      <InsightsHeader activeTab={tab} />

      <main className="container mx-auto px-4 max-w-7xl py-6 md:py-8">
        {tab === "today" && <OverviewTab />}
        {tab === "rankings" && <RankingsTab />}
        {tab === "discover" && <DiscoverTab />}
        {tab === "crowd" && <ApprovalTab />}
      </main>
    </div>
  );
}
