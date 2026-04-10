import { useState, useMemo, useCallback } from "react";
import { useRoute, useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { useMarketCycle } from "@/hooks/useMarketCycle";
import { useAuth } from "@/contexts/AuthContext";
import { StakeModal, type StakeSelection } from "@/components/StakeModal";
import { PersonAvatar } from "@/components/PersonAvatar";
import { CategoryPill } from "@/components/CategoryPill";
import { UserMenu } from "@/components/UserMenu";
import { OutcomePathChart } from "@/components/predict/OutcomePathChart";
import { WhatNeedsToHappen } from "@/components/predict/WhatNeedsToHappen";
import { WeeklyUpDownYourPositionPanel } from "@/components/predict/WeeklyUpDownYourPositionPanel";
import { MarketResolutionInfo } from "@/components/predict/MarketResolutionInfo";
import { ClosedMarketActionTrigger } from "@/components/predict/ClosedMarketActionTrigger";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { normalizeMarketCategory } from "@shared/constants";
import { apiRequest } from "@/lib/queryClient";
import { getClosedMarketMessage } from "@/lib/marketClosedMessaging";
import {
  ArrowLeft,
  TrendingUp,
  TrendingDown,
  Clock,
  Lock,
  HelpCircle,
  Users,
  BarChart3,
  ListChecks,
} from "lucide-react";

export default function UpDownDetailPage() {
  const [, params] = useRoute("/predict/updown/:marketId");
  const [, setLocation] = useLocation();
  const marketId = params?.marketId || "";
  const { user, profile } = useAuth();
  const walletCredits = profile?.predictCredits ?? 0;

  const [stakeModalOpen, setStakeModalOpen] = useState(false);
  const [pendingSelection, setPendingSelection] = useState<StakeSelection | null>(null);

  const goBack = useCallback(() => {
    if (window.history.length > 1) {
      window.history.back();
    } else {
      setLocation("/predict");
    }
  }, [setLocation]);

  const { data: allUpdownMarkets, isLoading } = useQuery<any[]>({
    queryKey: ["/api/native-markets/updown"],
  });

  const serverCutoff = useMemo(() => {
    if (!allUpdownMarkets) return null;
    const found = allUpdownMarkets.find((m: any) => m.id === marketId);
    return found?.bettingCutoff || null;
  }, [allUpdownMarkets, marketId]);

  const serverResolutionDeadline = useMemo(() => {
    if (!allUpdownMarkets) return null;
    const found = allUpdownMarkets.find((m: any) => m.id === marketId);
    return found?.endAt || null;
  }, [allUpdownMarkets, marketId]);

  const marketState = useMarketCycle({ bettingCutoff: serverCutoff, resolutionDeadline: serverResolutionDeadline });
  const isMarketClosed = marketState.status !== "OPEN";
  const closedMarketMessage = useMemo(() => {
    return getClosedMarketMessage({
      bettingCutoff: serverCutoff,
      resolutionDeadline: serverResolutionDeadline,
    });
  }, [serverCutoff, serverResolutionDeadline]);

  const { data: userBetsData } = useQuery<any>({
    queryKey: ["/api/me/predictions"],
    enabled: !!user,
  });

  const market = useMemo(() => {
    if (!allUpdownMarkets) return null;
    return allUpdownMarkets.find((m: any) => m.id === marketId) || null;
  }, [allUpdownMarkets, marketId]);

  const hydrated = useMemo(() => {
    if (!market) return null;
    const person = market.person || {};
    const entries = market.entries || [];
    const upEntry = entries.find((e: any) => e.label?.toLowerCase() === "up");
    const downEntry = entries.find((e: any) => e.label?.toLowerCase() === "down");
    const upStake = Number(upEntry?.totalStake || 0);
    const downStake = Number(downEntry?.totalStake || 0);
    const total = upStake + downStake || 1;
    const upPercent = Math.round((upStake / total) * 100);
    const upMultiplier = upStake > 0 ? +(total / upStake).toFixed(1) : 2.0;
    const downMultiplier = downStake > 0 ? +(total / downStake).toFixed(1) : 2.0;
    const currentScore = Number(person.trendScore || person.fameIndex || 0);
    const storedBaseline = market.metadata?.openingScore?.score;
    const fallbackBaseline =
      currentScore - Math.floor(currentScore * (Number(person.change7d || 0) / 100));
    const baselineScore = storedBaseline ? Number(storedBaseline) : fallbackBaseline;
    const totalPool =
      upStake + downStake + Number(market.seedVolume || 0);
    const totalParticipants =
      (Number(market.activeParticipantCount || 0) || 0) +
      Number(market.seedConfig?.participants || 0);

    return {
      personName: person.name || market.title?.replace(/: Up or Down\?$/, "") || "Unknown",
      personAvatar: person.avatar || "",
      personId: market.personId || "",
      currentScore,
      baselineScore,
      category: normalizeMarketCategory(market.category || person.category || "misc"),
      upEntryId: upEntry?.id,
      downEntryId: downEntry?.id,
      upMultiplier,
      downMultiplier,
      upPercent: upPercent || 50,
      totalPool,
      totalParticipants,
      tieRule: market.tieRule || "refund",
      startAt: market.startAt,
      endAt: market.endAt,
      bettingCutoff: market.bettingCutoff || null,
    };
  }, [market]);

  const userBet = useMemo(() => {
    if (!userBetsData || !marketId) return null;
    const betsArray = Array.isArray(userBetsData)
      ? userBetsData
      : (userBetsData as any)?.predictions ?? [];
    return betsArray.find((b: any) => b.marketId === marketId) || null;
  }, [userBetsData, marketId]);

  const userPick = useMemo((): "up" | "down" | null => {
    if (!userBet) return null;
    const label = (userBet.entryLabel || "").toLowerCase();
    if (label === "up") return "up";
    if (label === "down") return "down";
    return null;
  }, [userBet]);

  const handleSelect = useCallback(
    (choice: "up" | "down") => {
      if (!hydrated || userPick) return;
      if (isMarketClosed) {
        return;
      }
      setPendingSelection({
        type: "updown",
        marketId,
        entryId: choice === "up" ? hydrated.upEntryId : hydrated.downEntryId,
        choice: choice.toUpperCase(),
        marketName: `${hydrated.personName}: Up or Down?`,
        startScore: hydrated.baselineScore,
        currentScore: hydrated.currentScore,
        baselineScore: hydrated.baselineScore,
        baselineTimestamp: hydrated.startAt,
        estimatedPayout: choice === "up" ? hydrated.upMultiplier : hydrated.downMultiplier,
        tieRule: hydrated.tieRule,
        endAt: hydrated.endAt,
        bettingCutoff: hydrated.bettingCutoff,
      });
      setStakeModalOpen(true);
    },
    [hydrated, isMarketClosed, userPick, marketId]
  );

  const handleConfirmStake = useCallback(
    async (amount: number) => {
      if (!pendingSelection?.entryId) return;
      try {
        await apiRequest("POST", `/api/native-markets/${marketId}/bet`, {
          entryId: pendingSelection.entryId,
          amount,
        });
      } catch {
        // StakeModal handles toast
      }
      setStakeModalOpen(false);
      setPendingSelection(null);
    },
    [pendingSelection, marketId]
  );

  const handleDirectionChange = useCallback(
    (dir: "up" | "down") => {
      if (!hydrated) return;
      setPendingSelection((prev) =>
        prev
          ? {
              ...prev,
              entryId: dir === "up" ? hydrated.upEntryId : hydrated.downEntryId,
              choice: dir.toUpperCase(),
              estimatedPayout: dir === "up" ? hydrated.upMultiplier : hydrated.downMultiplier,
            }
          : null
      );
    },
    [hydrated]
  );

  const { timeRemaining } = marketState;
  const pad = (n: number) => String(n).padStart(2, "0");

  if (isLoading) {
    return (
      <div className="min-h-screen bg-background">
        <div className="max-w-3xl mx-auto px-4 py-8 space-y-4">
          <Skeleton className="h-8 w-48" />
          <Skeleton className="h-48 w-full rounded-xl" />
          <Skeleton className="h-64 w-full rounded-xl" />
        </div>
      </div>
    );
  }

  if (!market || !hydrated) {
    return (
      <div className="min-h-screen bg-background flex flex-col items-center justify-center gap-4 px-4">
        <TrendingUp className="h-12 w-12 text-muted-foreground" />
        <h2 className="text-lg font-semibold">Market not found</h2>
        <Button variant="outline" onClick={goBack}>
          <ArrowLeft className="h-4 w-4 mr-2" />
          Back to Predict
        </Button>
      </div>
    );
  }

  const delta = hydrated.currentScore - hydrated.baselineScore;
  const pctDelta =
    hydrated.baselineScore > 0
      ? ((delta / hydrated.baselineScore) * 100).toFixed(1)
      : "0";
  const firstName = hydrated.personName.split(" ")[0];

  return (
    <div className="min-h-screen bg-background pb-24">
      {/* Sticky Header */}
      <header className="sticky top-0 z-50 bg-background/95 backdrop-blur-md border-b border-border/50">
        <div className="max-w-3xl mx-auto px-4 h-14 flex items-center gap-3">
          <button
            type="button"
            onClick={goBack}
            className="p-1.5 rounded-lg hover:bg-muted transition-colors"
            aria-label="Go back"
          >
            <ArrowLeft className="h-5 w-5" />
          </button>
          <div className="flex-1 min-w-0">
            <h1 className="text-sm font-semibold truncate">
              {hydrated.personName}: Up or Down?
            </h1>
          </div>
          <Badge variant="outline" className="text-[10px] shrink-0">
            <Clock className="h-3 w-3 mr-1" />
            {pad(timeRemaining.days)}d {pad(timeRemaining.hours)}h{" "}
            {pad(timeRemaining.minutes)}m
          </Badge>
          <UserMenu />
        </div>
      </header>

      <div className="max-w-3xl mx-auto px-4 pt-4 space-y-4">
        {/* Hero */}
        <Card className="relative overflow-hidden border-green-500/30 dark:border-green-500/20">
          <div className="absolute inset-0 bg-gradient-to-r from-green-500/5 via-transparent to-red-500/5" />
          <div className="relative p-4 md:p-5">
            <div className="flex items-center gap-4 mb-4">
              <PersonAvatar
                name={hydrated.personName}
                avatar={hydrated.personAvatar}
                className="h-20 w-20 md:h-24 md:w-24"
              />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap mb-1">
                  <h2 className="text-lg font-bold">{hydrated.personName}</h2>
                  <CategoryPill category={hydrated.category} />
                </div>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span className="text-xs text-muted-foreground flex items-center gap-1 cursor-help">
                      <HelpCircle className="h-3 w-3" />
                      Will their Trend Score close above or below baseline?
                    </span>
                  </TooltipTrigger>
                  <TooltipContent className="max-w-[260px]">
                    <p className="text-xs">
                      If {firstName}'s Trend Score is above the weekly baseline at
                      close, UP wins. Below, DOWN wins.
                    </p>
                  </TooltipContent>
                </Tooltip>
                <Badge
                  variant="outline"
                  className={`mt-1.5 ${
                    delta >= 0
                      ? "text-green-700 dark:text-green-500 border-green-500/40 dark:border-green-500/30"
                      : "text-red-700 dark:text-red-500 border-red-500/40 dark:border-red-500/30"
                  }`}
                >
                  {delta >= 0 ? "+" : ""}
                  {pctDelta}% from baseline
                </Badge>
              </div>
            </div>

            <div className="grid grid-cols-4 gap-3 text-center">
              <div>
                <p className="text-sm md:text-base font-bold font-mono">
                  {hydrated.baselineScore.toLocaleString("en-US")}
                </p>
                <p className="text-[10px] text-muted-foreground uppercase tracking-wider">
                  Baseline
                </p>
              </div>
              <div>
                <p className="text-sm md:text-base font-bold font-mono">
                  {hydrated.currentScore.toLocaleString("en-US")}
                </p>
                <p className="text-[10px] text-muted-foreground uppercase tracking-wider">
                  Current
                </p>
              </div>
              <div>
                <p className="text-sm md:text-base font-bold text-violet-600 dark:text-violet-400">
                  {hydrated.totalPool.toLocaleString("en-US")}
                </p>
                <p className="text-[10px] text-muted-foreground uppercase tracking-wider">
                  Pool
                </p>
              </div>
              <div>
                <p className="text-sm md:text-base font-bold">
                  {hydrated.totalParticipants}
                </p>
                <p className="text-[10px] text-muted-foreground uppercase tracking-wider">
                  Players
                </p>
              </div>
            </div>
          </div>
        </Card>

        {/* Your Position */}
        {userBet && (
          <WeeklyUpDownYourPositionPanel
            variant="detail"
            pick={userPick}
            personName={hydrated.personName}
            baselineScore={hydrated.baselineScore}
            currentScore={hydrated.currentScore}
            stakeAmount={Number(userBet.stakeAmount || 0)}
          />
        )}

        {/* Trend Score Chart */}
        <Card className="border-border/50">
          <div className="p-4">
            <h2 className="text-sm font-semibold flex items-center gap-1.5 mb-3">
              <BarChart3 className="h-4 w-4 text-violet-600 dark:text-violet-400" />
              Trend Score This Week
            </h2>
            <OutcomePathChart
              marketId={marketId}
              baselineScore={hydrated.baselineScore}
              currentScore={hydrated.currentScore}
              personName={hydrated.personName}
              height={280}
              userPick={userPick}
            />
          </div>
        </Card>

        {/* What Needs to Happen (full) */}
        {userPick && (
          <WhatNeedsToHappen
            pick={userPick}
            baselineScore={hydrated.baselineScore}
            currentScore={hydrated.currentScore}
            personName={hydrated.personName}
            timeRemaining={`${pad(timeRemaining.days)}d ${pad(timeRemaining.hours)}h ${pad(timeRemaining.minutes)}m`}
          />
        )}

        {/* Crowd Sentiment */}
        <Card className="border-border/50">
          <div className="p-4">
            <h2 className="text-sm font-semibold flex items-center gap-1.5 mb-3">
              <Users className="h-4 w-4 text-violet-600 dark:text-violet-400" />
              Crowd Sentiment
            </h2>
            <div className="space-y-3">
              <div className="h-4 rounded-full overflow-hidden flex">
                <div
                  className="h-full bg-gradient-to-r from-green-500 to-green-400 transition-all"
                  style={{ width: `${hydrated.upPercent}%` }}
                />
                <div
                  className="h-full bg-gradient-to-l from-red-500 to-red-400 transition-all"
                  style={{ width: `${100 - hydrated.upPercent}%` }}
                />
              </div>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className="h-8 w-8 rounded-full bg-green-500/25 dark:bg-green-500/20 border border-green-500/50 dark:border-green-500/40 flex items-center justify-center">
                    <TrendingUp className="h-4 w-4 text-green-700 dark:text-green-500" />
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-green-700 dark:text-green-500">
                      UP {hydrated.upPercent}%
                    </p>
                    <p className="text-[10px] text-muted-foreground">
                      {hydrated.upMultiplier}x payout
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <div>
                    <p className="text-sm font-semibold text-red-700 dark:text-red-500 text-right">
                      DOWN {100 - hydrated.upPercent}%
                    </p>
                    <p className="text-[10px] text-muted-foreground text-right">
                      {hydrated.downMultiplier}x payout
                    </p>
                  </div>
                  <div className="h-8 w-8 rounded-full bg-red-500/25 dark:bg-red-500/20 border border-red-500/50 dark:border-red-500/40 flex items-center justify-center">
                    <TrendingDown className="h-4 w-4 text-red-700 dark:text-red-500" />
                  </div>
                </div>
              </div>
              <p className="text-[11px] text-muted-foreground text-center">
                Based on current pool distribution across {hydrated.totalParticipants} participants
              </p>
            </div>
          </div>
        </Card>

        {/* How This Resolves */}
        <MarketResolutionInfo
          baselineScore={hydrated.baselineScore}
          baselineTimestamp={hydrated.startAt}
          closeTime={hydrated.endAt ? new Date(hydrated.endAt).toUTCString().replace(/ GMT$/, " UTC") : "Sun 23:59 UTC"}
          bettingCutoff={hydrated.bettingCutoff}
          tieRule={hydrated.tieRule}
          personName={hydrated.personName}
        />
      </div>

      {/* Sticky Bottom CTA */}
      <div className="fixed bottom-0 left-0 right-0 z-40 border-t border-border/50 bg-background/95 backdrop-blur-md">
        <div className="max-w-3xl mx-auto px-4 py-3">
          {userBet && userPick ? (
            <div className="flex items-center gap-3">
              <div
                className={`h-10 w-10 rounded-full flex items-center justify-center shrink-0 ${
                  userPick === "up"
                    ? "bg-green-500/25 dark:bg-green-500/20 border border-green-500/50 dark:border-green-500/40"
                    : "bg-red-500/25 dark:bg-red-500/20 border border-red-500/50 dark:border-red-500/40"
                }`}
              >
                {userPick === "up" ? (
                  <TrendingUp className="h-5 w-5 text-green-700 dark:text-green-500" />
                ) : (
                  <TrendingDown className="h-5 w-5 text-red-700 dark:text-red-500" />
                )}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-xs text-muted-foreground">Your position</p>
                <p className="text-sm font-semibold">
                  {userPick.toUpperCase()} on {firstName}
                </p>
              </div>
              <Badge
                className={
                  delta >= 0 && userPick === "up"
                    ? "bg-green-600/20 text-green-700 dark:text-green-500 border-green-500/40 dark:border-green-500/30"
                    : delta < 0 && userPick === "down"
                    ? "bg-green-600/20 text-green-700 dark:text-green-500 border-green-500/40 dark:border-green-500/30"
                    : "bg-amber-600/20 text-amber-700 dark:text-amber-500 border-amber-500/40 dark:border-amber-500/30"
                }
              >
                {(delta >= 0 && userPick === "up") || (delta < 0 && userPick === "down")
                  ? "Winning"
                  : "Behind"}
              </Badge>
            </div>
          ) : userBet && !userPick ? (
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-full flex items-center justify-center shrink-0 bg-violet-500/25 dark:bg-violet-500/20 border border-violet-500/50 dark:border-violet-500/40">
                <ListChecks className="h-5 w-5 text-violet-700 dark:text-violet-400" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-xs text-muted-foreground">Your position</p>
                <p className="text-sm font-semibold">Open stake on this market</p>
              </div>
              <p className="text-xs text-muted-foreground tabular-nums">
                {Number(userBet.stakeAmount || 0).toLocaleString("en-US")} cr
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-3">
              <ClosedMarketActionTrigger isClosed={isMarketClosed} message={closedMarketMessage} side="top" align="center">
                <Button
                  className="bg-[#00C853]/10 border border-[#00C853]/50 text-[#00C853] hover:border-[#00C853]/80 hover:bg-[#00C853]/20 py-3 h-auto text-base font-semibold"
                  onClick={() => handleSelect("up")}
                >
                  <TrendingUp className="h-5 w-5 mr-2" />
                  UP
                </Button>
              </ClosedMarketActionTrigger>
              <ClosedMarketActionTrigger isClosed={isMarketClosed} message={closedMarketMessage} side="top" align="center">
                <Button
                  className="bg-[#FF0000]/10 border border-[#FF0000]/50 text-[#FF0000] hover:border-[#FF0000]/80 hover:bg-[#FF0000]/20 py-3 h-auto text-base font-semibold"
                  onClick={() => handleSelect("down")}
                >
                  <TrendingDown className="h-5 w-5 mr-2" />
                  DOWN
                </Button>
              </ClosedMarketActionTrigger>
            </div>
          )}
        </div>
      </div>

      {/* Stake Modal */}
      <StakeModal
        selection={pendingSelection}
        open={stakeModalOpen}
        onClose={() => {
          setStakeModalOpen(false);
          setPendingSelection(null);
        }}
        onConfirm={handleConfirmStake}
        walletBalance={walletCredits}
        onDirectionChange={handleDirectionChange}
      />
    </div>
  );
}
