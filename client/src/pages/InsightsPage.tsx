import { useEffect, useState } from "react";
import { Link, useLocation } from "wouter";
import { ArrowLeft } from "lucide-react";
import { parseTab } from "@shared/insights/filters";
import type { InsightsTab } from "@shared/insights/filters";
import { InsightsHeader } from "@/components/insights/InsightsHeader";
import { OverviewTab } from "@/components/insights/OverviewTab";
import { RankingsTab } from "@/components/insights/RankingsTab";
import { DiscoverTab } from "@/components/insights/DiscoverTab";
import { YouTab } from "@/components/insights/YouTab";
import { CompareTab } from "@/components/insights/CompareTab";
import { MarketsTab } from "@/components/insights/MarketsTab";
import { ApprovalTab } from "@/components/insights/ApprovalTab";
import { useAuth } from "@/contexts/AuthContext";
import { logInsightsEvent } from "@/lib/insights-telemetry";
import { HeaderUserActions } from "@/components/HeaderUserActions";
import { VoxDexLogo } from "@/components/VoxDexLogo";
import { Button } from "@/components/ui/button";

export default function InsightsPage() {
  const { isLoggedIn } = useAuth();
  const [, setLocation] = useLocation();
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
      <header className="sticky top-0 z-50 border-b bg-background/80 backdrop-blur-xl">
        <div className="container mx-auto px-4 max-w-7xl h-16 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2 min-w-0">
            <Button
              variant="ghost"
              size="icon"
              className="md:hidden shrink-0"
              onClick={() => {
                if (window.history.length > 1) window.history.back();
                else setLocation("/");
              }}
              aria-label="Go back"
            >
              <ArrowLeft className="h-5 w-5" />
            </Button>
            <Link
              href="/"
              className="flex items-center gap-2 hover:opacity-80 transition-opacity shrink-0"
            >
              <VoxDexLogo size={32} variant="default" />
              <span className="font-serif font-bold text-xl hidden sm:block">VoxDex</span>
            </Link>
          </div>
          <nav className="hidden md:flex items-center gap-1 text-sm">
            <Link href="/">
              <Button variant="ghost" size="sm">
                Home
              </Button>
            </Link>
            <Link href="/vote">
              <Button variant="ghost" size="sm">
                Vote
              </Button>
            </Link>
            <Link href="/predict">
              <Button variant="ghost" size="sm">
                Predict
              </Button>
            </Link>
            <Button variant="ghost" size="sm" className="text-blue-600 dark:text-blue-400">
              Insights
            </Button>
          </nav>
          <HeaderUserActions />
        </div>
      </header>

      <div className="border-b border-border/40 bg-muted/20">
        <div className="container mx-auto px-4 max-w-7xl py-5 md:py-6">
          <h1 className="text-2xl md:text-3xl font-serif font-bold tracking-tight">Insights</h1>
          <p className="text-sm text-muted-foreground mt-1.5 max-w-2xl leading-relaxed">
            Explore rankings and movers by news, Wikipedia, search interest, and crowd sentiment.
          </p>
        </div>
      </div>

      <InsightsHeader activeTab={tab} isLoggedIn={isLoggedIn} />

      <main className="container mx-auto px-4 max-w-7xl py-6 md:py-8">
        {tab === "overview" && <OverviewTab />}
        {tab === "rankings" && <RankingsTab />}
        {tab === "discover" && <DiscoverTab />}
        {tab === "you" &&
          (isLoggedIn ? (
            <YouTab />
          ) : (
            <div className="rounded-xl border border-border/50 bg-card/40 p-8 text-center max-w-md mx-auto">
              <p className="text-sm text-muted-foreground mb-4">
                Sign in to see your calibration, ROI by market type, and how you compare to the crowd.
              </p>
              <Link href="/login">
                <Button>Sign in</Button>
              </Link>
            </div>
          ))}
        {tab === "compare" && <CompareTab />}
        {tab === "markets" && <MarketsTab />}
        {tab === "approval" && <ApprovalTab />}
      </main>
    </div>
  );
}
