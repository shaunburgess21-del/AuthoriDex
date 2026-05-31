import { useEffect, useState } from "react";
import { parseTab } from "@shared/insights/filters";
import type { InsightsTab } from "@shared/insights/filters";
import { InsightsHeader } from "@/components/insights/InsightsHeader";
import { OverviewTab } from "@/components/insights/OverviewTab";
import { RankingsTab } from "@/components/insights/RankingsTab";
import { DiscoverTab } from "@/components/insights/DiscoverTab";
import { CompareTab } from "@/components/insights/CompareTab";
import { MarketsTab } from "@/components/insights/MarketsTab";
import { ApprovalTab } from "@/components/insights/ApprovalTab";
import { logInsightsEvent } from "@/lib/insights-telemetry";
import { SiteHeader } from "@/components/SiteHeader";

export default function InsightsPage() {
  const [tab, setTab] = useState<InsightsTab>(() => parseTab(window.location.search));

  useEffect(() => {
    const onPop = () => setTab(parseTab(window.location.search));
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  useEffect(() => {
    document.title = "Insights | VoxDex";
    return () => {
      document.title = "VoxDex";
    };
  }, []);

  useEffect(() => {
    logInsightsEvent("insights", "tab_view", { tab });
  }, [tab]);

  return (
    <div className="min-h-screen pb-20 md:pb-0 bg-background overflow-x-clip">
      <SiteHeader active="insights" />

      <div className="border-b border-border/40 bg-muted/20">
        <div className="container mx-auto px-4 max-w-7xl py-5 md:py-6">
          <h1 className="text-2xl md:text-3xl font-serif font-bold tracking-tight">Insights</h1>
          <p className="text-sm text-muted-foreground mt-1.5 max-w-2xl leading-relaxed">
            Explore rankings and movers by news, Wikipedia, search interest, and crowd sentiment.
          </p>
        </div>
      </div>

      <InsightsHeader activeTab={tab} />

      <main className="container mx-auto px-4 max-w-7xl py-6 md:py-8">
        {tab === "overview" && <OverviewTab />}
        {tab === "rankings" && <RankingsTab />}
        {tab === "discover" && <DiscoverTab />}
        {tab === "compare" && <CompareTab />}
        {tab === "markets" && <MarketsTab />}
        {tab === "approval" && <ApprovalTab />}
      </main>
    </div>
  );
}
