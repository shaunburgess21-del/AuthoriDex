import { lazy, Suspense, useState, useMemo, useCallback, useEffect } from "react";
import { useRoute, useLocation } from "wouter";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { hapticSuccess, hapticError } from "@/lib/haptic";
import { useMarketCycle } from "@/hooks/useMarketCycle";
import { useAuth } from "@/contexts/AuthContext";
import { useXpBurst } from "@/components/XpBurstProvider";
import { StakeModal, type StakeSelection } from "@/components/StakeModal";
import { PersonAvatar } from "@/components/PersonAvatar";
import { CategoryPill } from "@/components/CategoryPill";
import { HeaderUserActions } from "@/components/HeaderUserActions";
import { OutcomePathChart } from "@/components/predict/OutcomePathChart";
import { WhatNeedsToHappen } from "@/components/predict/WhatNeedsToHappen";
import { MyPositionCard } from "@/components/predict/MyPositionCard";
import { MarketDetailSkeleton } from "@/components/predict/MarketDetailSkeleton";
import { AmmPriceHistoryChart } from "@/components/predict/AmmPriceHistoryChart";
import { MarketActivityFeed } from "@/components/predict/MarketActivityFeed";
import { MarketResolutionInfo } from "@/components/predict/MarketResolutionInfo";
import { MarketCycleStrip } from "@/components/predict/MarketCycleStrip";
import { ClosedMarketActionTrigger } from "@/components/predict/ClosedMarketActionTrigger";
import { ShareIconButton } from "@/components/predict/ShareIconButton";
import { RelatedMarkets } from "@/components/predict/RelatedMarkets";
import { MuteMarketToggle } from "@/components/predict/MuteMarketToggle";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { normalizeMarketCategory } from "@shared/constants";
import { apiRequest, parseApiError } from "@/lib/queryClient";
import { getClosedMarketMessage } from "@/lib/marketClosedMessaging";
import { getMarketBaselineScore } from "@/lib/predict-market-baseline";
import { computePayoutMultiplier, computeEarlyBirdMultiplier } from "@/lib/parimutuel";
import { getUpDownWinningState, UP_DOWN_STATE_LABELS } from "@/lib/updownState";
import { goBack } from "@/lib/goBack";
import { useDocumentMeta } from "@/hooks/useDocumentMeta";
import {
  type ApiAmmStateBlock,
  pricesFor,
  priceToPercent,
  snapshotFromApi,
} from "@/lib/ammClient";
import {
  ArrowLeft,
  TrendingUp,
  TrendingDown,
  Clock,
  Users,
  BarChart3,
  ListChecks,
  Zap,
  Activity,
} from "lucide-react";

interface AmmPositionRow {
  entryId: string;
  entryLabel: string;
  netShares: number;
  netCreditsIn: number;
  avgEntryPrice: number;
  currentPrice: number;
  currentValue: number;
}

const LazyCommunityInsights = lazy(() =>
  import("@/components/CommunityInsights").then((m) => ({ default: m.CommunityInsights })),
);

function InsightsLazyFallback() {
  return (
    <div className="flex items-center justify-center py-12">
      <div className="h-8 w-8 border-2 border-cyan-400 border-t-transparent rounded-full animate-spin" />
    </div>
  );
}

export default function UpDownDetailPage() {
  const [, params] = useRoute("/predict/updown/:marketId");
  const [, setLocation] = useLocation();
  const marketId = params?.marketId || "";

  useEffect(() => {
    window.scrollTo({ top: 0, left: 0, behavior: "auto" });
  }, [marketId]);

  const { user, profile, refreshProfile } = useAuth();
  const walletCredits = profile?.predictCredits ?? 0;
  const queryClient = useQueryClient();
  const { trigger: triggerXpBurst } = useXpBurst();

  const [stakeModalOpen, setStakeModalOpen] = useState(false);
  const [pendingSelection, setPendingSelection] = useState<StakeSelection | null>(null);

  const handleGoBack = useCallback(() => {
    goBack(setLocation, "/predict");
  }, [setLocation]);

  const { data: allUpdownMarkets, isLoading } = useQuery<any[]>({
    queryKey: ["/api/native-markets/updown"],
    // Keep the live trend score / pool numbers fresh while the user
    // is on the page. 60s matches MyPositionCard + OutcomePathChart;
    // we pause when the market closes since nothing's changing.
    refetchInterval: (query) => {
      if (typeof document !== "undefined" && document.hidden) return false;
      const list = query.state.data as any[] | undefined;
      const found = list?.find((m: any) => m.id === marketId);
      if (found && found.status && found.status !== "OPEN") return false;
      return 60_000;
    },
    refetchOnWindowFocus: true,
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
    const upMultiplier = computePayoutMultiplier(upStake + downStake, upStake);
    const downMultiplier = computePayoutMultiplier(upStake + downStake, downStake);
    const currentScore = Number(person.trendScore || person.fameIndex || 0);
    const baselineScore = getMarketBaselineScore(market, currentScore) ?? currentScore;
    const totalPool = upStake + downStake;
    const totalParticipants = Number(market.activeParticipantCount || 0) || 0;

    const engine: "parimutuel" | "amm" = market.engine === "amm" ? "amm" : "parimutuel";
    const ammState: ApiAmmStateBlock | null = market.ammState ?? null;

    let resolvedUpPercent = upPercent || 50;
    if (engine === "amm" && ammState) {
      const snap = snapshotFromApi(ammState);
      const prices = snap ? pricesFor(snap) : null;
      const upPrice = prices && upEntry?.id ? Number(prices[upEntry.id] ?? 0) : 0;
      const downPrice = prices && downEntry?.id ? Number(prices[downEntry.id] ?? 0) : 0;
      const sumP = upPrice + downPrice;
      resolvedUpPercent = sumP > 0 ? Math.round((upPrice / sumP) * 100) : 50;
    }

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
      upPercent: resolvedUpPercent,
      totalPool,
      totalParticipants,
      tieRule: market.tieRule || "refund",
      startAt: market.startAt,
      endAt: market.endAt,
      bettingCutoff: market.bettingCutoff || null,
      engine,
      ammState,
    };
  }, [market]);

  const isAmm = hydrated?.engine === "amm";

  const { data: ammPositionData } = useQuery<{ positions: AmmPositionRow[]; marketStatus?: string }>({
    queryKey: ["/api/markets", marketId, "amm-position"],
    enabled: !!user && !!marketId && !!isAmm,
    refetchInterval: (query) => {
      if (typeof document !== "undefined" && document.hidden) return false;
      const status = (query.state.data as any)?.marketStatus;
      if (status && status !== "OPEN") return false;
      return 30_000;
    },
  });

  const ammPositionByEntry = useMemo(() => {
    const map = new Map<string, AmmPositionRow>();
    for (const p of ammPositionData?.positions ?? []) {
      map.set(p.entryId, p);
    }
    return map;
  }, [ammPositionData]);

  const ammNetSharesFor = useCallback(
    (entryId: string | undefined) => {
      if (!entryId) return 0;
      return Number(ammPositionByEntry.get(entryId)?.netShares ?? 0);
    },
    [ammPositionByEntry],
  );

  const userMarketBets = useMemo(() => {
    if (!userBetsData || !marketId) return [] as any[];
    const betsArray = Array.isArray(userBetsData)
      ? userBetsData
      : (userBetsData as any)?.predictions ?? [];
    return betsArray.filter((b: any) => b.marketId === marketId);
  }, [userBetsData, marketId]);

  const userBet = useMemo(() => userMarketBets[0] || null, [userMarketBets]);

  const userPick = useMemo((): "up" | "down" | null => {
    if (!userBet) return null;
    const label = (userBet.entryLabel || "").toLowerCase();
    if (label === "up") return "up";
    if (label === "down") return "down";
    return null;
  }, [userBet]);

  // Sum across every prior same-side bet on this market so the StakeModal
  // top-up subline shows the user's actual cumulative position (not just
  // the most recent ticket) when adding more credits to an existing pick.
  const userPickTotalStake = useMemo(() => {
    if (!userPick) return 0;
    return userMarketBets
      .filter((b: any) => (b.entryLabel || "").toLowerCase() === userPick)
      .reduce((sum: number, b: any) => sum + Number(b.stakeAmount || 0), 0);
  }, [userMarketBets, userPick]);

  const handleSelect = useCallback(
    (choice: "up" | "down") => {
      if (!hydrated) return;
      if (isMarketClosed) return;
      // Same-side top-ups allowed. Opposite-side hedges are blocked —
      // we honour the user's first commitment and prompt them to top
      // up rather than create a contradictory ticket on the other side.
      if (userPick && choice !== userPick) {
        hapticError();
        toast("Stick with your pick", {
          description: `You already picked ${userPick.toUpperCase()}. We don't allow switching sides — top up your existing pick instead.`,
        });
        return;
      }
      const isTopUp = !!userPick;
      const entryId = choice === "up" ? hydrated.upEntryId : hydrated.downEntryId;
      setPendingSelection({
        type: "updown",
        marketId,
        entryId,
        choice: choice.toUpperCase(),
        marketName: `${hydrated.personName}: Up or Down?`,
        personName: hydrated.personName,
        startScore: hydrated.baselineScore,
        currentScore: hydrated.currentScore,
        baselineScore: hydrated.baselineScore,
        baselineTimestamp: hydrated.startAt,
        crowdSentiment: choice === "up" ? hydrated.upPercent : 100 - hydrated.upPercent,
        poolTotal: hydrated.totalPool,
        estimatedPayout: choice === "up" ? hydrated.upMultiplier : hydrated.downMultiplier,
        tieRule: hydrated.tieRule,
        endAt: hydrated.endAt,
        bettingCutoff: hydrated.bettingCutoff,
        isTopUp,
        existingStake: isTopUp ? userPickTotalStake : undefined,
        engine: hydrated.engine,
        ammState: hydrated.ammState,
        ammNetShares: hydrated.engine === "amm" ? ammNetSharesFor(entryId) : 0,
      });
      setStakeModalOpen(true);
    },
    [hydrated, isMarketClosed, userPick, marketId, userPickTotalStake, ammNetSharesFor]
  );

  const invalidateAfterTrade = useCallback(async () => {
    await Promise.all([
      refreshProfile?.(),
      queryClient.invalidateQueries({ queryKey: ["/api/native-markets/updown"] }),
      queryClient.invalidateQueries({ queryKey: ["/api/me/predictions"] }),
      queryClient.invalidateQueries({ queryKey: ["/api/profile/me"] }),
      queryClient.invalidateQueries({ queryKey: ["/api/markets", marketId, "my-position"] }),
      queryClient.invalidateQueries({ queryKey: ["/api/markets", marketId, "amm-position"] }),
    ]);
  }, [queryClient, refreshProfile, marketId]);

  const betMutation = useMutation({
    mutationFn: async ({ entryId, stakeAmount }: { entryId: string; stakeAmount: number }) => {
      const res = await apiRequest("POST", `/api/native-markets/${marketId}/bet`, {
        entryId,
        stakeAmount,
      });
      return res.json();
    },
    onSuccess: async (data) => {
      hapticSuccess();
      if (data?.xp?.xpAwarded) {
        triggerXpBurst(data.xp.xpAwarded, undefined, data.xp.reason);
      }
      toast("Prediction placed!", {
        description: "Your Up/Down prediction has been recorded.",
      });
      setStakeModalOpen(false);
      setPendingSelection(null);
      await invalidateAfterTrade();
    },
    onError: (err: Error) => {
      hapticError();
      const { title, description } = parseApiError(err, "Failed to place prediction");
      toast.error(title, { description });
    },
  });

  const sellMutation = useMutation({
    mutationFn: async ({ entryId, shares }: { entryId: string; shares: number }) => {
      const res = await apiRequest("POST", `/api/native-markets/${marketId}/bet`, {
        entryId,
        actionType: "sell",
        shares,
      });
      return res.json();
    },
    onSuccess: async () => {
      hapticSuccess();
      toast("Position sold", {
        description: "Proceeds have been credited to your wallet.",
      });
      setStakeModalOpen(false);
      setPendingSelection(null);
      await invalidateAfterTrade();
    },
    onError: (err: Error) => {
      hapticError();
      const { title, description } = parseApiError(err, "Failed to sell position");
      toast.error(title, { description });
    },
  });

  const handleConfirmStake = useCallback(
    async (amount: number) => {
      if (!pendingSelection?.entryId) return;
      await betMutation.mutateAsync({
        entryId: pendingSelection.entryId,
        stakeAmount: amount,
      });
    },
    [pendingSelection, betMutation]
  );

  const handleConfirmAmmSell = useCallback(
    async (shares: number) => {
      if (!pendingSelection?.entryId) return;
      await sellMutation.mutateAsync({
        entryId: pendingSelection.entryId,
        shares,
      });
    },
    [pendingSelection, sellMutation]
  );

  const openSellModal = useCallback(
    (choice: "up" | "down") => {
      if (!hydrated || !isAmm) return;
      const entryId = choice === "up" ? hydrated.upEntryId : hydrated.downEntryId;
      setPendingSelection({
        type: "updown",
        marketId,
        entryId,
        choice: choice.toUpperCase(),
        marketName: `${hydrated.personName}: Up or Down?`,
        personName: hydrated.personName,
        startScore: hydrated.baselineScore,
        currentScore: hydrated.currentScore,
        baselineScore: hydrated.baselineScore,
        baselineTimestamp: hydrated.startAt,
        crowdSentiment: choice === "up" ? hydrated.upPercent : 100 - hydrated.upPercent,
        poolTotal: hydrated.totalPool,
        tieRule: hydrated.tieRule,
        endAt: hydrated.endAt,
        bettingCutoff: hydrated.bettingCutoff,
        engine: hydrated.engine,
        ammState: hydrated.ammState,
        ammNetShares: ammNetSharesFor(entryId),
      });
      setStakeModalOpen(true);
    },
    [hydrated, isAmm, marketId, ammNetSharesFor],
  );

  const handleDirectionChange = useCallback(
    // Widened to match the StakeModal signature now that community markets
    // can pass "yes" | "no". UpDownDetailPage only ever fires for upDown so
    // we narrow back here.
    (dir: "up" | "down" | "yes" | "no") => {
      if (!hydrated) return;
      if (dir !== "up" && dir !== "down") return;
      setPendingSelection((prev) =>
        prev
          ? {
              ...prev,
              entryId: dir === "up" ? hydrated.upEntryId : hydrated.downEntryId,
              choice: dir.toUpperCase(),
              crowdSentiment: dir === "up" ? hydrated.upPercent : 100 - hydrated.upPercent,
              estimatedPayout: dir === "up" ? hydrated.upMultiplier : hydrated.downMultiplier,
            }
          : null
      );
    },
    [hydrated]
  );

  const { timeRemaining } = marketState;
  const pad = (n: number) => String(n).padStart(2, "0");

  /* Dynamic meta — keeps the browser tab in sync and gives JS-running
   * crawlers (Google, Bing) a real preview, while non-JS crawlers
   * (Slack, iMessage) hit the server-side OG endpoint via the Vercel
   * UA-matched rewrite. */
  useDocumentMeta({
    title: hydrated
      ? `${hydrated.personName}: Up or Down? • VoxDex`
      : "Up / Down • VoxDex",
    description: hydrated
      ? `Will ${hydrated.personName}'s Trend Score close above or below baseline this week? Predict on VoxDex.`
      : "Predict whether a person's weekly Trend Score closes above or below baseline.",
    image: `/api/og/image/market.png?title=${encodeURIComponent(
      hydrated ? `${hydrated.personName}: Up or Down?` : "Up / Down",
    )}&subtitle=${encodeURIComponent("Up or down this week?")}&badge=${encodeURIComponent("Up / Down")}`,
  });

  if (isLoading) {
    return <MarketDetailSkeleton variant="weekly" />;
  }

  if (!market || !hydrated) {
    return (
      <div className="min-h-screen bg-background flex flex-col items-center justify-center gap-4 px-4">
        <TrendingUp className="h-12 w-12 text-muted-foreground" />
        <h2 className="text-lg font-semibold">Market not found</h2>
        <Button variant="outline" onClick={handleGoBack}>
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
    <div className="min-h-screen bg-background pb-[calc(9.5rem+env(safe-area-inset-bottom))] md:pb-24">
      {/* Sticky Header */}
      <header className="sticky top-0 z-50 bg-background/95 backdrop-blur-md border-b border-border/50">
        <div className="max-w-3xl mx-auto px-4 h-14 flex items-center gap-3">
          <button
            type="button"
            onClick={handleGoBack}
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
          <MuteMarketToggle marketId={marketId} />
          <ShareIconButton title={`${hydrated.personName}: Up or Down? on VoxDex`} />
          <HeaderUserActions />
        </div>
      </header>

      <div className="max-w-3xl mx-auto px-4 pt-4 space-y-4">
        <MarketCycleStrip
          bettingCutoff={hydrated.bettingCutoff}
          resolveAt={hydrated.endAt}
          variant="full"
          engine={isAmm ? "amm" : "parimutuel"}
        />

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

            <div className={`grid ${isAmm ? "grid-cols-3" : "grid-cols-4"} gap-3 text-center`}>
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
              {!isAmm && (
                <div>
                  <p className="text-sm md:text-base font-bold text-violet-600 dark:text-violet-400">
                    {hydrated.totalPool.toLocaleString("en-US")}
                  </p>
                  <p className="text-[10px] text-muted-foreground uppercase tracking-wider">
                    Pool
                  </p>
                </div>
              )}
              <div>
                <p className="text-sm md:text-base font-bold">
                  {hydrated.totalParticipants}
                </p>
                <p className="text-[10px] text-muted-foreground uppercase tracking-wider">
                  {isAmm ? "Traders" : "Players"}
                </p>
              </div>
            </div>
          </div>
        </Card>

        {/* AMM live probability + per-side position card. Surfaces
            netShares + avg entry price + current value, plus an
            inline "Sell" button so users can close out without
            hunting through MyPredictions. */}
        {isAmm && (() => {
          const ammSnap = snapshotFromApi(hydrated.ammState);
          const ammPriceMap = ammSnap ? pricesFor(ammSnap) : null;
          const upPrice = ammPriceMap && hydrated.upEntryId ? Number(ammPriceMap[hydrated.upEntryId] ?? 0) : 0;
          const downPrice = ammPriceMap && hydrated.downEntryId ? Number(ammPriceMap[hydrated.downEntryId] ?? 0) : 0;
          const upPos = hydrated.upEntryId ? ammPositionByEntry.get(hydrated.upEntryId) : undefined;
          const downPos = hydrated.downEntryId ? ammPositionByEntry.get(hydrated.downEntryId) : undefined;
          const hasAnyPosition = (upPos && upPos.netShares > 1e-6) || (downPos && downPos.netShares > 1e-6);

          return (
            <Card className="border-emerald-500/30 dark:border-emerald-500/20">
              <div className="p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <h2 className="text-sm font-semibold flex items-center gap-1.5">
                    <Activity className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
                    Live Market
                  </h2>
                  <Badge variant="outline" className="text-emerald-600 dark:text-emerald-400 border-emerald-500/40 dark:border-emerald-500/30 text-[10px]">
                    LIVE
                  </Badge>
                </div>
                <div className="grid grid-cols-2 gap-3 text-center">
                  <div className="rounded-lg border border-green-500/30 bg-green-500/5 p-3">
                    <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Up</p>
                    <p className="text-2xl font-bold text-green-600 dark:text-green-400">
                      {priceToPercent(upPrice, 0)}
                    </p>
                    <p className="text-[10px] text-muted-foreground">
                      {upPrice.toFixed(3)} cr / share
                    </p>
                  </div>
                  <div className="rounded-lg border border-red-500/30 bg-red-500/5 p-3">
                    <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Down</p>
                    <p className="text-2xl font-bold text-red-600 dark:text-red-400">
                      {priceToPercent(downPrice, 0)}
                    </p>
                    <p className="text-[10px] text-muted-foreground">
                      {downPrice.toFixed(3)} cr / share
                    </p>
                  </div>
                </div>

                {hasAnyPosition && (
                  <div className="space-y-2 pt-2 border-t border-border/40">
                    <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Your position</p>
                    {[
                      { label: "UP", pos: upPos, side: "up" as const },
                      { label: "DOWN", pos: downPos, side: "down" as const },
                    ].map(({ label, pos, side }) => {
                      if (!pos || pos.netShares <= 1e-6) return null;
                      // Unrealised PnL = current mark-to-market value minus
                      // net credits paid in. Buy = positive netCreditsIn.
                      // We label both gain/loss explicitly so the user
                      // doesn't have to do the arithmetic in their head.
                      const unrealisedPnl = pos.currentValue - pos.netCreditsIn;
                      const maxProfitIfWin = pos.netShares - pos.netCreditsIn;
                      const pnlColor =
                        unrealisedPnl >= 0
                          ? "text-green-700 dark:text-green-500"
                          : "text-red-700 dark:text-red-500";
                      return (
                        <div key={side} className="flex items-center justify-between gap-2 rounded-lg bg-muted/30 px-3 py-2">
                          <div className="min-w-0 flex-1">
                            <p className="text-sm font-semibold">{label} on {firstName}</p>
                            <p className="text-[11px] text-muted-foreground">
                              {pos.netShares.toFixed(2)} shares · avg {pos.avgEntryPrice.toFixed(3)} cr · cost {pos.netCreditsIn.toFixed(0)} cr
                            </p>
                            <p className="text-[11px] text-muted-foreground">
                              ≈ {pos.currentValue.toFixed(2)} cr now ·{" "}
                              <span className={`font-mono font-medium ${pnlColor}`}>
                                {unrealisedPnl >= 0 ? "+" : ""}
                                {unrealisedPnl.toFixed(2)} cr
                              </span>
                            </p>
                            <p className="text-[11px] text-muted-foreground">
                              Pays {pos.netShares.toFixed(2)} cr if win ·{" "}
                              <span className="text-green-700 dark:text-green-500">
                                {maxProfitIfWin >= 0 ? "+" : ""}
                                {maxProfitIfWin.toFixed(2)} net
                              </span>
                            </p>
                          </div>
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={isMarketClosed}
                            onClick={() => openSellModal(side)}
                          >
                            Sell
                          </Button>
                        </div>
                      );
                    })}
                    <p className="text-[10px] text-muted-foreground text-center">
                      Current value is approximate — actual sell proceeds vary slightly with price impact.
                    </p>
                  </div>
                )}
              </div>
            </Card>
          );
        })()}

        {/* Your Position — unified across all detail pages so the "what
            am I in for" panel feels the same on community, jackpot,
            updown, h2h, and race. We hide the CTA on Up/Down because
            the existing UI doesn't support adding to an open position;
            the bespoke WeeklyUpDownYourPositionPanel previously had no
            CTA either. */}
        <MyPositionCard
          marketId={marketId}
          marketType="updown"
          isAmm={isAmm}
          ctaLabel={
            userPick ? `Add to your ${userPick.toUpperCase()} stake` : undefined
          }
          onAddEntry={userPick ? () => handleSelect(userPick) : undefined}
          livePoolContext={
            userPick && Number.isFinite(hydrated.totalPool) && hydrated.totalPool > 0
              ? {
                  totalPool: hydrated.totalPool,
                  userSidePercent:
                    userPick === "up"
                      ? hydrated.upPercent
                      : 100 - hydrated.upPercent,
                }
              : null
          }
        />

        {/* AMM Price History - the market consensus over time. Shown
            above the underlying Trend Score chart so users see the
            *market's* signal first, then the input data. Parimutuel
            markets skip this card. */}
        {isAmm && hydrated.upEntryId && hydrated.downEntryId && (() => {
          const ammSnap = snapshotFromApi(hydrated.ammState);
          const livePrices = ammSnap ? pricesFor(ammSnap) : {};
          return (
            <Card className="border-border/50">
              <div className="p-4">
                <h2 className="text-sm font-semibold flex items-center gap-1.5 mb-3">
                  <Activity className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
                  Market Price This Week
                </h2>
                <AmmPriceHistoryChart
                  marketId={marketId}
                  series={[
                    { entryId: hydrated.upEntryId!, label: "UP", color: "#10b981" },
                    { entryId: hydrated.downEntryId!, label: "DOWN", color: "#ef4444" },
                  ]}
                  livePrices={livePrices}
                  height={220}
                />
              </div>
            </Card>
          );
        })()}

        {/* Live trade feed — Up/Down trades flow heavily right around
            resolution windows, so seeing the late book matters here. */}
        <MarketActivityFeed marketId={marketId} />

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
            tieRule={hydrated.tieRule}
          />
        )}

        {/* Pool sentiment - parimutuel only. For AMM the live LMSR
            price panel above already conveys the same information
            (and uses the correct underlying signal), so we hide this
            entirely to avoid double-rendering the same %. */}
        {!isAmm && (
          <Card className="border-border/50">
            <div className="p-4">
              <h2 className="text-sm font-semibold flex items-center gap-1.5 mb-3">
                <Users className="h-4 w-4 text-violet-600 dark:text-violet-400" />
                Pool sentiment
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
        )}

        {/* How This Resolves */}
        <MarketResolutionInfo
          baselineScore={hydrated.baselineScore}
          baselineTimestamp={hydrated.startAt}
          closeTime={hydrated.endAt ? new Date(hydrated.endAt).toUTCString().replace(/ GMT$/, " UTC") : "Sun 23:59 UTC"}
          bettingCutoff={hydrated.bettingCutoff}
          tieRule={hydrated.tieRule}
          personName={hydrated.personName}
          engine={isAmm ? "amm" : "parimutuel"}
        />

        {hydrated.personId.trim().length > 0 && (
          <section className="mb-8 pt-2">
            <Suspense fallback={<InsightsLazyFallback />}>
              <LazyCommunityInsights
                personId={hydrated.personId}
                personName={hydrated.personName}
                focusContextTitle={hydrated.personName}
              />
            </Suspense>
          </section>
        )}

        {/* Related markets — bottom of page so it's out of the way of
            the betting flow but discoverable once the user has read the
            resolution rules. Reuses the cached `/api/native-markets/updown`
            list so this costs zero extra requests. */}
        <RelatedMarkets
          type="updown"
          currentMarketId={marketId}
          category={hydrated.category}
          showAllMarkets
          className="pt-2"
        />
      </div>

      {/* Sticky Bottom CTA — lifted above the global mobile BottomNav
          (h-16, z-50) on phones; back to bottom-0 on md+ where the nav
          isn't rendered. */}
      <div className="fixed bottom-[calc(4rem+env(safe-area-inset-bottom))] md:bottom-0 left-0 right-0 z-40 border-t border-border/50 bg-background/95 backdrop-blur-md">
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
              {(() => {
                const state = getUpDownWinningState({
                  pick: userPick,
                  currentScore: hydrated.currentScore,
                  baselineScore: hydrated.baselineScore,
                  tieRule: hydrated.tieRule,
                });
                const className =
                  state === "winning"
                    ? "bg-green-600/20 text-green-700 dark:text-green-500 border-green-500/40 dark:border-green-500/30"
                    : state === "behind"
                    ? "bg-red-600/20 text-red-700 dark:text-red-500 border-red-500/40 dark:border-red-500/30"
                    : "bg-amber-600/20 text-amber-700 dark:text-amber-500 border-amber-500/40 dark:border-amber-500/30";
                return <Badge className={className}>{UP_DOWN_STATE_LABELS[state]}</Badge>;
              })()}
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
            <>
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
              {!isMarketClosed && !isAmm && (() => {
                const boost = computeEarlyBirdMultiplier(new Date(), hydrated?.startAt, hydrated?.bettingCutoff);
                if (boost <= 1.05) return null;
                return (
                  <p className="text-[11px] text-amber-700 dark:text-amber-400 text-center mt-2 flex items-center justify-center gap-1">
                    <Zap className="h-3.5 w-3.5" />
                    Early Bird Boost active: {boost.toFixed(1)}x — predict earlier for bigger payouts
                  </p>
                );
              })()}
              {!isMarketClosed && isAmm && (
                <p className="text-[11px] text-emerald-700 dark:text-emerald-400 text-center mt-2 flex items-center justify-center gap-1">
                  <Activity className="h-3.5 w-3.5" />
                  Live LMSR pricing — trade until 5 minutes before resolution
                </p>
              )}
            </>
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
        onConfirmAmmSell={isAmm ? handleConfirmAmmSell : undefined}
        walletBalance={walletCredits}
        onDirectionChange={handleDirectionChange}
      />
    </div>
  );
}
