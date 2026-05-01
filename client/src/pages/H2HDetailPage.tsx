import { useState, useMemo, useCallback } from "react";
import { useRoute, useLocation } from "wouter";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { hapticSuccess, hapticError } from "@/lib/haptic";
import { useMarketCycle } from "@/hooks/useMarketCycle";
import { useAuth } from "@/contexts/AuthContext";
import { useXpBurst } from "@/components/XpBurstProvider";
import { StakeModal, type StakeSelection } from "@/components/StakeModal";
import { ClosedMarketActionTrigger } from "@/components/predict/ClosedMarketActionTrigger";
import { MarketCycleStrip } from "@/components/predict/MarketCycleStrip";
import { MarketDetailSkeleton } from "@/components/predict/MarketDetailSkeleton";
import { MarketResolutionInfo } from "@/components/predict/MarketResolutionInfo";
import { MyPositionCard } from "@/components/predict/MyPositionCard";
import { ShareIconButton } from "@/components/predict/ShareIconButton";
import { RelatedMarkets } from "@/components/predict/RelatedMarkets";
import { H2HWhatNeedsToHappen } from "@/components/predict/WhatNeedsToHappen";
import { PersonAvatar } from "@/components/PersonAvatar";
import { CategoryPill } from "@/components/CategoryPill";
import { HeaderUserActions } from "@/components/HeaderUserActions";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { h2hUserPickFromBet } from "@/components/predict/HeadToHeadCard";
import { normalizeMarketCategory } from "@shared/constants";
import { apiRequest } from "@/lib/queryClient";
import { getClosedMarketMessage } from "@/lib/marketClosedMessaging";
import { computePayoutMultiplier } from "@/lib/parimutuel";
import { goBack } from "@/lib/goBack";
import { useDocumentMeta } from "@/hooks/useDocumentMeta";
import {
  ArrowLeft,
  Swords,
  Clock,
  HelpCircle,
  Users,
  TrendingUp,
  TrendingDown,
  Shield,
  Crown,
} from "lucide-react";

interface HydratedH2H {
  title: string;
  person1: { name: string; avatar: string; currentScore: number; personId: string };
  person2: { name: string; avatar: string; currentScore: number; personId: string };
  person1EntryId?: string;
  person2EntryId?: string;
  person1EntryLabel?: string;
  person2EntryLabel?: string;
  category: string;
  totalPool: number;
  person1Stake: number;
  person2Stake: number;
  person1Percent: number;
  totalParticipants: number;
  tieRule: string;
  startAt?: string;
  endAt?: string;
  bettingCutoff?: string | null;
}

export default function H2HDetailPage() {
  const [, params] = useRoute("/predict/h2h/:marketId");
  const [, setLocation] = useLocation();
  const marketId = params?.marketId || "";
  const { user, profile, refreshProfile } = useAuth();
  const walletCredits = profile?.predictCredits ?? 0;
  const queryClient = useQueryClient();
  const { trigger: triggerXpBurst } = useXpBurst();

  const [stakeModalOpen, setStakeModalOpen] = useState(false);
  const [pendingSelection, setPendingSelection] = useState<StakeSelection | null>(null);

  const { data: allH2hMarkets, isLoading } = useQuery<any[]>({
    queryKey: ["/api/native-markets/h2h"],
    // Keep live trend scores / pool numbers fresh while the user is
    // on the page. 60s matches MyPositionCard + OutcomePathChart.
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
    if (!allH2hMarkets) return null;
    const found = allH2hMarkets.find((m: any) => m.id === marketId);
    return found?.bettingCutoff || null;
  }, [allH2hMarkets, marketId]);

  const serverResolutionDeadline = useMemo(() => {
    if (!allH2hMarkets) return null;
    const found = allH2hMarkets.find((m: any) => m.id === marketId);
    return found?.endAt || null;
  }, [allH2hMarkets, marketId]);

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
    if (!allH2hMarkets) return null;
    return allH2hMarkets.find((m: any) => m.id === marketId) || null;
  }, [allH2hMarkets, marketId]);

  const hydrated = useMemo((): HydratedH2H | null => {
    if (!market) return null;
    const entries = market.entries || [];
    const e1 = entries[0] || {};
    const e2 = entries[1] || {};
    const p1 = e1.person || {};
    const p2 = e2.person || {};
    const s1 = Number(e1.totalStake || 0);
    const s2 = Number(e2.totalStake || 0);
    const total = s1 + s2 || 1;
    const totalPool =
      entries.reduce((sum: number, entry: any) => sum + Number(entry.totalStake || 0), 0) +
      Number(market.seedVolume || 0);
    const totalParticipants =
      (Number(market.activeParticipantCount || 0) || 0) +
      Number(market.seedConfig?.participants || 0);

    return {
      title: market.title || `${p1.name || "?"} vs ${p2.name || "?"}`,
      person1: {
        name: p1.name || e1.label || "?",
        avatar: p1.avatar || "",
        currentScore: Number(p1.trendScore || 0),
        personId: e1.personId || "",
      },
      person2: {
        name: p2.name || e2.label || "?",
        avatar: p2.avatar || "",
        currentScore: Number(p2.trendScore || 0),
        personId: e2.personId || "",
      },
      person1EntryId: e1.id,
      person2EntryId: e2.id,
      person1EntryLabel: typeof e1.label === "string" ? e1.label : undefined,
      person2EntryLabel: typeof e2.label === "string" ? e2.label : undefined,
      category: normalizeMarketCategory(market.category || "misc"),
      totalPool,
      person1Stake: s1,
      person2Stake: s2,
      person1Percent: s1 + s2 === 0 ? 50 : Math.round((s1 / total) * 100),
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

  const userPickSide = useMemo((): 1 | 2 | null => {
    if (!userBet || !hydrated) return null;
    return h2hUserPickFromBet(
      {
        person1: hydrated.person1,
        person2: hydrated.person2,
        person1EntryId: hydrated.person1EntryId,
        person2EntryId: hydrated.person2EntryId,
        person1EntryLabel: hydrated.person1EntryLabel,
        person2EntryLabel: hydrated.person2EntryLabel,
      },
      { entryLabel: userBet.entryLabel, entryId: userBet.entryId }
    );
  }, [userBet, hydrated]);

  const handleSelect = useCallback(
    (person: 1 | 2) => {
      if (!hydrated || userPickSide) return;
      if (isMarketClosed) {
        return;
      }
      const picked = person === 1 ? hydrated.person1 : hydrated.person2;
      const opponent = person === 1 ? hydrated.person2 : hydrated.person1;
      const sentiment = person === 1 ? hydrated.person1Percent : 100 - hydrated.person1Percent;
      // Use raw stakes (not the rounded percent) so extreme splits like
      // 999/1 don't collapse to a 2.0x default in the modal.
      const pickedStake = person === 1 ? hydrated.person1Stake : hydrated.person2Stake;
      const otherStake = person === 1 ? hydrated.person2Stake : hydrated.person1Stake;
      const userStakeTotal = pickedStake + otherStake;
      const pickedPool = userStakeTotal === 0
        ? hydrated.totalPool / 2
        : (pickedStake / userStakeTotal) * hydrated.totalPool;
      const estimatedPayout = computePayoutMultiplier(hydrated.totalPool, pickedPool);
      setPendingSelection({
        type: "h2h",
        marketId,
        entryId: person === 1 ? hydrated.person1EntryId : hydrated.person2EntryId,
        choice: picked.name,
        marketName: hydrated.title,
        currentScore: picked.currentScore,
        opponentScore: opponent.currentScore,
        crowdSentiment: sentiment,
        estimatedPayout,
        endAt: hydrated.endAt,
        bettingCutoff: hydrated.bettingCutoff,
      });
      setStakeModalOpen(true);
    },
    [hydrated, isMarketClosed, userPickSide, marketId]
  );

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
        description: "Your head-to-head prediction has been recorded.",
      });
      setStakeModalOpen(false);
      setPendingSelection(null);
      await Promise.all([
        refreshProfile?.(),
        queryClient.invalidateQueries({ queryKey: ["/api/native-markets/h2h"] }),
        queryClient.invalidateQueries({ queryKey: ["/api/me/predictions"] }),
        queryClient.invalidateQueries({ queryKey: ["/api/profile/me"] }),
        queryClient.invalidateQueries({ queryKey: ["/api/markets", marketId, "my-position"] }),
      ]);
    },
    onError: (err: Error) => {
      hapticError();
      toast.error("Failed to place prediction", { description: err.message });
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

  const { timeRemaining } = marketState;
  const pad = (n: number) => String(n).padStart(2, "0");

  const h2hShareTitle = hydrated
    ? `${hydrated.person1.name} vs ${hydrated.person2.name}`
    : "Head-to-Head";
  useDocumentMeta({
    title: `${h2hShareTitle} • VoxDex`,
    description: hydrated
      ? `Who'll gain more Trend Score points this week — ${hydrated.person1.name} or ${hydrated.person2.name}? Predict on VoxDex.`
      : "Head-to-head Trend Score battle. Predict on VoxDex.",
    image: `/api/og/image/market.png?title=${encodeURIComponent(h2hShareTitle)}&subtitle=${encodeURIComponent("Who'll gain more this week?")}&badge=${encodeURIComponent("Head to head")}`,
  });

  if (isLoading) {
    return <MarketDetailSkeleton variant="weekly" />;
  }

  if (!market || !hydrated) {
    return (
      <div className="min-h-screen bg-background flex flex-col items-center justify-center gap-4 px-4">
        <Swords className="h-12 w-12 text-muted-foreground" />
        <h2 className="text-lg font-semibold">Battle not found</h2>
        <Button variant="outline" onClick={() => setLocation("/predict")}>
          <ArrowLeft className="h-4 w-4 mr-2" />
          Back to Predict
        </Button>
      </div>
    );
  }

  const scoreDiff = hydrated.person1.currentScore - hydrated.person2.currentScore;
  const person1Leading = scoreDiff > 0;
  const person2Leading = scoreDiff < 0;
  const scoreTied = scoreDiff === 0;
  const leadAmount = Math.abs(scoreDiff);
  const leader = person1Leading ? hydrated.person1 : hydrated.person2;
  const smartName = (name: string) => {
    const parts = name.trim().split(/\s+/);
    if (parts.length <= 1) return name;
    if (name.length <= 16) return name;
    return `${parts[0]} ${parts[parts.length - 1][0]}.`;
  };

  return (
    <div className="min-h-screen bg-background pb-[calc(9.5rem+env(safe-area-inset-bottom))] md:pb-24">
      {/* Sticky Header */}
      <header className="sticky top-0 z-50 bg-background/95 backdrop-blur-md border-b border-border/50">
        <div className="max-w-3xl mx-auto px-4 h-14 flex items-center gap-3">
          <button
            onClick={() => goBack(setLocation, "/predict")}
            className="p-1.5 rounded-lg hover:bg-muted transition-colors"
            aria-label="Go back"
          >
            <ArrowLeft className="h-5 w-5" />
          </button>
          <div className="flex-1 min-w-0">
            <h1 className="text-sm font-semibold truncate">{hydrated.title}</h1>
          </div>
          <Badge variant="outline" className="text-[10px] shrink-0">
            <Clock className="h-3 w-3 mr-1" />
            {pad(timeRemaining.days)}d {pad(timeRemaining.hours)}h{" "}
            {pad(timeRemaining.minutes)}m
          </Badge>
          <ShareIconButton title={`${hydrated.title} on VoxDex`} />
          <HeaderUserActions />
        </div>
      </header>

      <div className="max-w-3xl mx-auto px-4 pt-4 space-y-4">
        <MarketCycleStrip
          bettingCutoff={hydrated.bettingCutoff}
          resolveAt={hydrated.endAt}
          variant="full"
        />

        {/* Hero – Side-by-side portraits */}
        <Card className="relative overflow-hidden border-slate-500/30 dark:border-slate-500/20">
          <div className="absolute inset-0 pointer-events-none">
            <div className="absolute left-0 top-0 w-1/2 h-full bg-gradient-to-r from-blue-600/10 to-transparent" />
            <div className="absolute right-0 top-0 w-1/2 h-full bg-gradient-to-l from-purple-600/10 to-transparent" />
          </div>
          <div className="relative p-4 md:p-5">
            <div className="flex items-center gap-2 mb-4">
              <CategoryPill category={hydrated.category} />
              <Tooltip>
                <TooltipTrigger asChild>
                  <span className="text-xs text-muted-foreground flex items-center gap-1 cursor-help">
                    <Swords className="h-3 w-3" />
                    Highest Trend Score Wins
                    <HelpCircle className="h-3 w-3" />
                  </span>
                </TooltipTrigger>
                <TooltipContent className="max-w-[260px]">
                  <p className="text-xs">
                    The person with the higher Trend Score at Sunday close wins.
                    Pick who you think will be on top.
                  </p>
                </TooltipContent>
              </Tooltip>
            </div>

            <div className="relative mb-4" style={{ padding: '0 5px' }}>
              <div className="flex" style={{ gap: '7px' }}>
                {/* Person 1 */}
                <ClosedMarketActionTrigger isClosed={isMarketClosed && !userPickSide} message={closedMarketMessage} side="top" align="center">
                  <div
                    className={`flex-1 relative ${!userPickSide ? "cursor-pointer group/p1" : ""}`}
                    onClick={() => !userPickSide && handleSelect(1)}
                  >
                  <div className="absolute -inset-4 rounded-md bg-blue-500/25 dark:bg-blue-500/20 blur-lg pointer-events-none transition-opacity group-hover/p1:bg-blue-500/40" />
                  <div className="rounded-lg overflow-hidden ring-2 ring-transparent transition-all group-hover/p1:ring-blue-500/60">
                    <PersonAvatar
                      name={hydrated.person1.name}
                      avatar={hydrated.person1.avatar}
                      className="h-auto w-full aspect-[4/5]"
                    />
                  </div>
                  {person1Leading && (
                    <div className="absolute -top-1.5 -right-1.5 z-10 h-6 w-6 rounded-full bg-amber-500/25 dark:bg-amber-500/20 border border-amber-500/60 dark:border-amber-500/50 flex items-center justify-center">
                      <Crown className="h-3.5 w-3.5 text-amber-600 dark:text-amber-400" />
                    </div>
                  )}
                  </div>
                </ClosedMarketActionTrigger>
                {/* Person 2 */}
                <ClosedMarketActionTrigger isClosed={isMarketClosed && !userPickSide} message={closedMarketMessage} side="top" align="center">
                  <div
                    className={`flex-1 relative ${!userPickSide ? "cursor-pointer group/p2" : ""}`}
                    onClick={() => !userPickSide && handleSelect(2)}
                  >
                  <div className="absolute -inset-4 rounded-md bg-purple-500/25 dark:bg-purple-500/20 blur-lg pointer-events-none transition-opacity group-hover/p2:bg-purple-500/40" />
                  <div className="rounded-lg overflow-hidden ring-2 ring-transparent transition-all group-hover/p2:ring-purple-500/60">
                    <PersonAvatar
                      name={hydrated.person2.name}
                      avatar={hydrated.person2.avatar}
                      className="h-auto w-full aspect-[4/5]"
                    />
                  </div>
                  {person2Leading && (
                    <div className="absolute -top-1.5 -right-1.5 z-10 h-6 w-6 rounded-full bg-amber-500/25 dark:bg-amber-500/20 border border-amber-500/60 dark:border-amber-500/50 flex items-center justify-center">
                      <Crown className="h-3.5 w-3.5 text-amber-600 dark:text-amber-400" />
                    </div>
                  )}
                  </div>
                </ClosedMarketActionTrigger>
              </div>
              {/* VS badge */}
              <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-20">
                <div className="h-16 w-16 rounded-full bg-gradient-to-br from-slate-700 to-slate-900 border-2 border-slate-500 flex items-center justify-center shadow-lg">
                  <span className="text-base font-bold text-slate-200">VS</span>
                </div>
              </div>
            </div>

            <div className="flex items-center justify-between px-2 mb-4">
              <div className="flex flex-col items-center flex-1">
                <p className="text-sm font-semibold text-center">{smartName(hydrated.person1.name)}</p>
                <p className="text-xs font-mono text-muted-foreground">
                  {hydrated.person1.currentScore.toLocaleString("en-US")}
                </p>
              </div>
              <div className="flex flex-col items-center flex-1">
                <p className="text-sm font-semibold text-center">{smartName(hydrated.person2.name)}</p>
                <p className="text-xs font-mono text-muted-foreground">
                  {hydrated.person2.currentScore.toLocaleString("en-US")}
                </p>
              </div>
            </div>

            {/* Quick stats */}
            <div className="grid grid-cols-3 gap-3 text-center">
              <div>
                <p className="text-lg md:text-xl font-bold text-violet-600 dark:text-violet-400">
                  {hydrated.totalPool.toLocaleString("en-US")}
                </p>
                <p className="text-[10px] text-muted-foreground uppercase tracking-wider">
                  Pool
                </p>
              </div>
              <div>
                <p className="text-lg md:text-xl font-bold">
                  {hydrated.totalParticipants}
                </p>
                <p className="text-[10px] text-muted-foreground uppercase tracking-wider">
                  Participants
                </p>
              </div>
              <div>
                <p className="text-lg md:text-xl font-bold">
                  {leadAmount.toLocaleString("en-US")}
                </p>
                <p className="text-[10px] text-muted-foreground uppercase tracking-wider">
                  Score Gap
                </p>
              </div>
            </div>
          </div>
        </Card>

        {/* Your Position — unified across all detail pages. The H2H
            sticky bar already shows Winning / Tied / Behind so we hide
            the card's CTA and let the sticky strip drive action; this
            block exists so users always see live "your position" near
            the top of the page (matching the community/jackpot UX). */}
        <MyPositionCard
          marketId={marketId}
          marketType="h2h"
          hideCta
        />

        {/* Path-to-win callout — mirrors the WhatNeedsToHappen pattern
            from Up/Down so users know exactly what gap their pick has
            to close. Only shown when they've picked. */}
        {userPickSide && (
          <H2HWhatNeedsToHappen
            myPickName={userPickSide === 1 ? hydrated.person1.name : hydrated.person2.name}
            myPickScore={userPickSide === 1 ? hydrated.person1.currentScore : hydrated.person2.currentScore}
            opponentName={userPickSide === 1 ? hydrated.person2.name : hydrated.person1.name}
            opponentScore={userPickSide === 1 ? hydrated.person2.currentScore : hydrated.person1.currentScore}
          />
        )}

        {/* Score Comparison */}
        <Card className="border-border/50">
          <div className="p-4">
            <h2 className="text-sm font-semibold flex items-center gap-1.5 mb-4">
              <Swords className="h-4 w-4 text-violet-600 dark:text-violet-400" />
              Score Comparison
            </h2>

            <div className="space-y-4">
              {/* Score bars */}
              {[
                {
                  person: hydrated.person1,
                  color: "blue",
                  isLeading: person1Leading,
                },
                {
                  person: hydrated.person2,
                  color: "purple",
                  isLeading: person2Leading,
                },
              ].map(({ person, color, isLeading }) => {
                const maxScore = Math.max(
                  hydrated.person1.currentScore,
                  hydrated.person2.currentScore,
                  1
                );
                const barPct = (person.currentScore / maxScore) * 100;
                return (
                  <div key={person.name} className="space-y-1.5">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <PersonAvatar
                          name={person.name}
                          avatar={person.avatar}
                          className="h-8 w-8"
                        />
                        <span className="text-sm font-medium">{smartName(person.name)}</span>
                        {isLeading && (
                          <Crown className="h-3.5 w-3.5 text-amber-600 dark:text-amber-400" />
                        )}
                      </div>
                      <span className="text-sm font-mono font-bold">
                        {person.currentScore.toLocaleString("en-US")}
                      </span>
                    </div>
                    <div className="h-3 rounded-full bg-muted overflow-hidden">
                      <div
                        className={`h-full rounded-full transition-all ${
                          color === "blue"
                            ? "bg-gradient-to-r from-blue-500 to-blue-400"
                            : "bg-gradient-to-r from-purple-500 to-purple-400"
                        }`}
                        style={{ width: `${Math.max(barPct, 5)}%` }}
                      />
                    </div>
                  </div>
                );
              })}

              {/* Who's winning narrative */}
              <div className="rounded-lg border border-border/40 bg-muted/20 p-3">
                {scoreTied ? (
                  <p className="text-xs text-amber-600 dark:text-amber-400 flex items-center gap-1.5">
                    <Shield className="h-3.5 w-3.5" />
                    It's a dead heat! Scores are identical.
                  </p>
                ) : (
                  <p className="text-xs text-muted-foreground">
                    <span className="font-semibold text-foreground">{leader.name}</span>{" "}
                    is currently leading by{" "}
                    <span className="font-mono font-semibold text-foreground">
                      {leadAmount.toLocaleString("en-US")}
                    </span>{" "}
                    points.{" "}
                    {person1Leading
                      ? hydrated.person2.name
                      : hydrated.person1.name}{" "}
                    needs to close the gap before Sunday close to win.
                  </p>
                )}
              </div>
            </div>
          </div>
        </Card>

        {/* Crowd Picks */}
        <Card className="border-border/50">
          <div className="p-4">
            <h2 className="text-sm font-semibold flex items-center gap-1.5 mb-3">
              <Users className="h-4 w-4 text-violet-600 dark:text-violet-400" />
              Crowd Picks
            </h2>
            <div className="space-y-3">
              <div className="h-4 rounded-full overflow-hidden flex">
                <div
                  className="h-full bg-gradient-to-r from-blue-500 to-blue-400 transition-all"
                  style={{ width: `${hydrated.person1Percent}%` }}
                />
                <div
                  className="h-full bg-gradient-to-l from-purple-500 to-purple-400 transition-all"
                  style={{ width: `${100 - hydrated.person1Percent}%` }}
                />
              </div>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <PersonAvatar
                    name={hydrated.person1.name}
                    avatar={hydrated.person1.avatar}
                    className="h-8 w-8"
                  />
                  <div>
                    <p className="text-sm font-semibold text-blue-600 dark:text-blue-400">
                      {smartName(hydrated.person1.name)} {hydrated.person1Percent}%
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <div>
                    <p className="text-sm font-semibold text-purple-600 dark:text-purple-400 text-right">
                      {100 - hydrated.person1Percent}% {smartName(hydrated.person2.name)}
                    </p>
                  </div>
                  <PersonAvatar
                    name={hydrated.person2.name}
                    avatar={hydrated.person2.avatar}
                    className="h-8 w-8"
                  />
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
          mode="h2h"
          bettingCutoff={hydrated.bettingCutoff}
          closeTime={hydrated.endAt ? new Date(hydrated.endAt).toUTCString().replace(/ GMT$/, " UTC") : undefined}
          tieRule={hydrated.tieRule}
          person1Name={hydrated.person1.name}
          person2Name={hydrated.person2.name}
        />

        {/* Related markets — bottom-of-page so it's out of the way of
            the betting flow. Reuses the cached `/api/native-markets/h2h`
            list so this costs zero extra requests. */}
        <RelatedMarkets
          type="h2h"
          currentMarketId={marketId}
          category={hydrated.category}
          className="pt-2"
        />
      </div>

      {/* Sticky Bottom CTA — lifted above the global mobile BottomNav
          (h-16, z-50) on phones; back to bottom-0 on md+ where the nav
          isn't rendered. */}
      <div className="fixed bottom-[calc(4rem+env(safe-area-inset-bottom))] md:bottom-0 left-0 right-0 z-40 border-t border-border/50 bg-background/95 backdrop-blur-md">
        <div className="max-w-3xl mx-auto px-4 py-3">
          {userPickSide ? (
            <div className="flex items-center gap-3">
              <PersonAvatar
                name={
                  userPickSide === 1 ? hydrated.person1.name : hydrated.person2.name
                }
                avatar={
                  userPickSide === 1
                    ? hydrated.person1.avatar
                    : hydrated.person2.avatar
                }
                className="h-10 w-10"
              />
              <div className="flex-1 min-w-0">
                <p className="text-xs text-muted-foreground">Your pick</p>
                <p className="text-sm font-semibold truncate">
                  {userPickSide === 1
                    ? hydrated.person1.name
                    : hydrated.person2.name}
                </p>
              </div>
              <Badge
                className={
                  (userPickSide === 1 && person1Leading) ||
                  (userPickSide === 2 && person2Leading)
                    ? "bg-green-600/20 text-green-700 dark:text-green-500 border-green-500/40 dark:border-green-500/30"
                    : scoreTied
                    ? "bg-amber-600/20 text-amber-700 dark:text-amber-500 border-amber-500/40 dark:border-amber-500/30"
                    : "bg-red-600/20 text-red-700 dark:text-red-500 border-red-500/40 dark:border-red-500/30"
                }
              >
                {(userPickSide === 1 && person1Leading) ||
                (userPickSide === 2 && person2Leading)
                  ? "Winning"
                  : scoreTied
                  ? "Tied"
                  : "Behind"}
              </Badge>
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-3">
              <ClosedMarketActionTrigger isClosed={isMarketClosed} message={closedMarketMessage} side="top" align="center">
                <Button
                  className="bg-[#3B82F6]/10 border border-[#3B82F6]/50 text-[#3B82F6] hover:border-[#3B82F6]/80 hover:bg-[#3B82F6]/20 py-3 h-auto text-base font-semibold"
                  onClick={() => handleSelect(1)}
                >
                  {smartName(hydrated.person1.name)}
                </Button>
              </ClosedMarketActionTrigger>
              <ClosedMarketActionTrigger isClosed={isMarketClosed} message={closedMarketMessage} side="top" align="center">
                <Button
                  className="bg-[#7C3AED]/10 border border-[#7C3AED]/50 text-[#7C3AED] hover:border-[#7C3AED]/80 hover:bg-[#7C3AED]/20 py-3 h-auto text-base font-semibold"
                  onClick={() => handleSelect(2)}
                >
                  {smartName(hydrated.person2.name)}
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
      />
    </div>
  );
}
