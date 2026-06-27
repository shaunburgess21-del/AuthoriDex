import { useEffect, useRef, useState, useCallback, useMemo } from "react";
import { canonicalizeInsightsTabUrl, parseTab, writeInsightsQuery } from "@shared/insights/filters";
import type { InsightsTab } from "@shared/insights/filters";
import { InsightsHeader, INSIGHTS_NAV_TAB_ORDER } from "@/components/insights/InsightsHeader";
import { OverviewTab } from "@/components/insights/OverviewTab";
import { RankingsTab } from "@/components/insights/RankingsTab";
import { CrowdTab } from "@/components/insights/CrowdTab";
import { VoteTab } from "@/components/insights/VoteTab";
import { PredictTab } from "@/components/insights/PredictTab";
import { logInsightsEvent } from "@/lib/insights-telemetry";
import { SiteHeader } from "@/components/SiteHeader";
import { SwipeNavigator } from "@/components/vote/SwipeNavigator";

function readTabFromLocation(): InsightsTab {
  canonicalizeInsightsTabUrl();
  return parseTab(window.location.search);
}

function insightsScrollKey(tab: InsightsTab): string {
  return `voxdex:insights:scroll:${tab}`;
}

export default function InsightsPage() {
  const [tab, setTab] = useState<InsightsTab>(() => readTabFromLocation());
  const prevTabRef = useRef<InsightsTab | null>(null);
  const isFirstMountRef = useRef(true);

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
    const saveScroll = () => {
      sessionStorage.setItem(insightsScrollKey(tab), String(Math.round(window.scrollY)));
    };
    window.addEventListener("scroll", saveScroll, { passive: true });
    return () => {
      window.removeEventListener("scroll", saveScroll);
      saveScroll();
    };
  }, [tab]);

  useEffect(() => {
    logInsightsEvent("insights", "tab_view", { tab });

    if (isFirstMountRef.current) {
      isFirstMountRef.current = false;
      const saved = sessionStorage.getItem(insightsScrollKey(tab));
      const y = saved ? parseInt(saved, 10) : 0;
      if (!Number.isNaN(y) && y > 0) {
        requestAnimationFrame(() => {
          window.scrollTo({ top: y, behavior: "auto" });
          requestAnimationFrame(() => {
            window.scrollTo({ top: y, behavior: "auto" });
          });
        });
      } else {
        window.scrollTo({ top: 0, behavior: "auto" });
      }
      prevTabRef.current = tab;
      return;
    }

    if (prevTabRef.current !== null && prevTabRef.current !== tab) {
      window.scrollTo({ top: 0, behavior: "auto" });
    }
    prevTabRef.current = tab;
  }, [tab]);

  const tabIndex = useMemo(() => {
    const idx = INSIGHTS_NAV_TAB_ORDER.indexOf(tab);
    return idx >= 0 ? idx : 0;
  }, [tab]);

  const goToTab = useCallback((next: InsightsTab) => {
    writeInsightsQuery({ tab: next, clearFilters: true });
  }, []);

  const onSwipeLeft = useCallback(() => {
    if (tabIndex < INSIGHTS_NAV_TAB_ORDER.length - 1) {
      goToTab(INSIGHTS_NAV_TAB_ORDER[tabIndex + 1]!);
    }
  }, [goToTab, tabIndex]);

  const onSwipeRight = useCallback(() => {
    if (tabIndex > 0) {
      goToTab(INSIGHTS_NAV_TAB_ORDER[tabIndex - 1]!);
    }
  }, [goToTab, tabIndex]);

  return (
    <div className="min-h-screen pb-20 md:pb-0 bg-background overflow-x-clip">
      <SiteHeader active="insights" />

      <InsightsHeader activeTab={tab} />

      <SwipeNavigator
        onSwipeLeft={onSwipeLeft}
        onSwipeRight={onSwipeRight}
        disableLeft={tabIndex >= INSIGHTS_NAV_TAB_ORDER.length - 1}
        disableRight={tabIndex <= 0}
        ignoreSelector="[data-no-tab-swipe]"
        commitOffsetPx={96}
      >
        <main className="container mx-auto px-2 sm:px-4 max-w-7xl py-6 md:py-8">
          {tab === "today" && <OverviewTab />}
          {tab === "rankings" && <RankingsTab />}
          {tab === "vote" && <VoteTab />}
          {tab === "predict" && <PredictTab />}
          {tab === "crowd" && <CrowdTab />}
        </main>
      </SwipeNavigator>
    </div>
  );
}
