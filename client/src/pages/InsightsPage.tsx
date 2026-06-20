import { useEffect, useState } from "react";
import { canonicalizeInsightsTabUrl, parseTab } from "@shared/insights/filters";
import type { InsightsTab } from "@shared/insights/filters";
import { InsightsHeader } from "@/components/insights/InsightsHeader";
import { OverviewTab } from "@/components/insights/OverviewTab";
import { RankingsTab } from "@/components/insights/RankingsTab";
import { CrowdTab } from "@/components/insights/CrowdTab";
import { VoteTab } from "@/components/insights/VoteTab";
import { PredictTab } from "@/components/insights/PredictTab";
import { logInsightsEvent } from "@/lib/insights-telemetry";
import { SiteHeader } from "@/components/SiteHeader";

function readTabFromLocation(): InsightsTab {
  canonicalizeInsightsTabUrl();
  return parseTab(window.location.search);
}

export default function InsightsPage() {
  const [tab, setTab] = useState<InsightsTab>(() => readTabFromLocation());

  useEffect(() => {
    const syncFromUrl = () => setTab(readTabFromLocation());
    syncFromUrl();
    window.addEventListener("popstate", syncFromUrl);
    return () => window.removeEventListener("popstate", syncFromUrl);
  }, []);

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

      <InsightsHeader activeTab={tab} />

      <main className="container mx-auto px-4 max-w-7xl py-6 md:py-8">
        {tab === "today" && <OverviewTab />}
        {tab === "rankings" && <RankingsTab />}
        {tab === "vote" && <VoteTab />}
        {tab === "predict" && <PredictTab />}
        {tab === "crowd" && <CrowdTab />}
      </main>
    </div>
  );
}
