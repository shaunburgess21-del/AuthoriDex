import { useEffect, useRef, useState, useCallback, useMemo } from "react";
import { canonicalizeInsightsTabUrl, parseTab, writeInsightsQuery } from "@shared/insights/filters";
import type { InsightsTab } from "@shared/insights/filters";
import { InsightsHeader, INSIGHTS_NAV_TAB_ORDER } from "@/components/insights/InsightsHeader";
import { OverviewTab } from "@/components/insights/OverviewTab";
import { RankingsTab } from "@/components/insights/RankingsTab";
import { CrowdTab } from "@/components/insights/CrowdTab";
import { VoteTab } from "@/components/insights/VoteTab";
import { PredictTab } from "@/components/insights/PredictTab";
import { InsightsTabActiveContext } from "@/components/insights/insightsTabActive";
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

// Legacy "discover" resolves via URL canonicalization before render, so
// only the five nav tabs need components here.
const TAB_COMPONENTS: Partial<Record<InsightsTab, () => JSX.Element>> = {
  today: OverviewTab,
  rankings: RankingsTab,
  vote: VoteTab,
  predict: PredictTab,
  crowd: CrowdTab,
};

export default function InsightsPage() {
  const [tab, setTab] = useState<InsightsTab>(() => readTabFromLocation());
  const prevTabRef = useRef<InsightsTab | null>(null);
  const isFirstMountRef = useRef(true);
  // Tabs mount on first visit and stay mounted (CSS-hidden) afterwards, so
  // returning to a tab restores instantly instead of re-running every tile
  // skeleton. InsightsTabActiveContext lets polling tiles pause while hidden.
  const [visitedTabs, setVisitedTabs] = useState<ReadonlySet<InsightsTab>>(
    () => new Set([tab]),
  );
  useEffect(() => {
    setVisitedTabs((prev) => {
      if (prev.has(tab)) return prev;
      const next = new Set(prev);
      next.add(tab);
      return next;
    });
  }, [tab]);

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
          {INSIGHTS_NAV_TAB_ORDER.map((t) => {
            const TabComponent = TAB_COMPONENTS[t];
            if (!visitedTabs.has(t) || !TabComponent) return null;
            return (
              <div key={t} hidden={tab !== t}>
                <InsightsTabActiveContext.Provider value={tab === t}>
                  <TabComponent />
                </InsightsTabActiveContext.Provider>
              </div>
            );
          })}
        </main>
      </SwipeNavigator>
    </div>
  );
}
