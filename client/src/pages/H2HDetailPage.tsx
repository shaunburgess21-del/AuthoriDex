import { useState, useMemo, useCallback, useEffect } from "react";
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
import { AmmPriceHistoryChart } from "@/components/predict/AmmPriceHistoryChart";
import { MarketActivityFeed } from "@/components/predict/MarketActivityFeed";
import { MarketResolutionInfo } from "@/components/predict/MarketResolutionInfo";
import { ShareIconButton } from "@/components/predict/ShareIconButton";
import { useShareCard } from "@/contexts/ShareCardContext";
import { buildTradeShareData, buildPositionShareData } from "@/lib/share-data";
import { RelatedMarkets } from "@/components/predict/RelatedMarkets";
import { MuteMarketToggle } from "@/components/predict/MuteMarketToggle";
import { H2HWhatNeedsToHappen } from "@/components/predict/WhatNeedsToHappen";
import { PersonAvatar } from "@/components/PersonAvatar";
import { CategoryPill } from "@/components/CategoryPill";
import { HeaderUserActions } from "@/components/HeaderUserActions";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { h2hUserPickFromBet } from "@/components/predict/HeadToHeadCard";
import { normalizeMarketCategory } from "@shared/constants";
import { apiRequest, parseApiError } from "@/lib/queryClient";
import { useIdempotencyKey } from "@/lib/useIdempotencyKey";
import { getClosedMarketMessage } from "@/lib/marketClosedMessaging";
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
  Swords,
  Clock,
  TrendingUp,
  TrendingDown,
  Shield,
  Crown,
  Activity,
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
  person1Percent: number;
  totalParticipants: number;
  tieRule: string;
  startAt?: string;
  endAt?: string;
  bettingCutoff?: string | null;
  engine: "amm";
  ammState: ApiAmmStateBlock | null;
}

interface AmmPositionRow {
  entryId: string;
  entryLabel: string;
  entryResolutionStatus?: string;
  netShares: number;
  netCreditsIn: number;
  avgEntryPrice: number;
  currentPrice: number;
  currentValue: number;
}

export default function H2HDetailPage() {
  const [, params] = useRoute("/predict/h2h/:marketId");
  const [, setLocation] = useLocation();
  const marketId = params?.marketId || "";

  useEffect(() => {
    window.scrollTo({ top: 0, left: 0, behavior: "auto" });
  }, [marketId]);

  const { user, profile, refreshProfile } = useAuth();
  const walletCredits = profile?.predictCredits ?? 0;
  const queryClient = useQueryClient();
  const { trigger: triggerXpBurst } = useXpBurst();
  const { openShareCard } = useShareCard();

  const [stakeModalOpen, setStakeModalOpen] = useState(false);
  const [pendingSelection, setPendingSelection] = useState<StakeSelection | null>(null);
  // Idempotency key per modal intent. See `useIdempotencyKey.ts`.
  const tradeIdempotencyKey = useIdempotencyKey(stakeModalOpen, [
    pendingSelection?.entryId,
    pendingSelection?.choice,
  ]);
  /**
   * Sprint 5 / Phase 2.3: seed which StakeModal tab opens (buy / sell).
   * Buy-side flows (Add, score-row tiles) set this to "buy"; the
   * per-pick Sell button below sets it to "sell" so the modal lands on
   * the right tab without flicker. Mirrors the Up/Down detail page.
   */
  const [modalIntent, setModalIntent] = useState<"buy" | "sell">("buy");

  const { data: allH2hMarkets, isLoading } = useQuery<any[]>({
    queryKey: ["/api/native-markets/h2h"],
    // Keep live trend scores / pool numbers fresh while the user is
    // on the page. 60s matches OutcomePathChart.
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
    const totalParticipants = Number(market.activeParticipantCount || 0) || 0;

    // Parimutuel sunset: every native H2H is AMM. Probability from
    // the LMSR snapshot.
    const ammState: ApiAmmStateBlock | null = market.ammState ?? null;

    let person1Percent = 50;
    if (ammState) {
      const snap = snapshotFromApi(ammState);
      const prices = snap ? pricesFor(snap) : null;
      const p1Price = prices && e1.id ? Number(prices[e1.id] ?? 0) : 0;
      const p2Price = prices && e2.id ? Number(prices[e2.id] ?? 0) : 0;
      const sumP = p1Price + p2Price;
      person1Percent = sumP > 0 ? Math.round((p1Price / sumP) * 100) : 50;
    }

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
      person1Percent,
      totalParticipants,
      tieRule: market.tieRule || "refund",
      startAt: market.startAt,
      endAt: market.endAt,
      bettingCutoff: market.bettingCutoff || null,
      engine: "amm" as const,
      ammState,
    };
  }, [market]);

  const { data: ammPositionData } = useQuery<{ positions: AmmPositionRow[] }>({
    queryKey: ["/api/markets", marketId, "amm-position"],
    enabled: !!user && !!marketId,
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

  // Sum every prior bet on the side the user already picked, so a top-up
  // shows the cumulative position in the StakeModal subline (not just the
  // most recent ticket).
  const userPickTotalStake = useMemo(() => {
    if (!userPickSide || !hydrated) return 0;
    const myEntryId =
      userPickSide === 1 ? hydrated.person1EntryId : hydrated.person2EntryId;
    return userMarketBets
      .filter((b: any) => b.entryId === myEntryId)
      .reduce((sum: number, b: any) => sum + Number(b.stakeAmount || 0), 0);
  }, [userMarketBets, userPickSide, hydrated]);

  const handleSelect = useCallback(
    (person: 1 | 2) => {
      if (!hydrated) return;
      if (isMarketClosed) return;
      // Same-side top-ups allowed; opposite-side hedges blocked.
      if (userPickSide && person !== userPickSide) {
        const myName =
          userPickSide === 1 ? hydrated.person1.name : hydrated.person2.name;
        hapticError();
        toast("Stick with your pick", {
          description: `You already backed ${myName}. We don't allow backing both sides — top up your existing pick instead.`,
        });
        return;
      }
      const picked = person === 1 ? hydrated.person1 : hydrated.person2;
      const opponent = person === 1 ? hydrated.person2 : hydrated.person1;
      const sentiment = person === 1 ? hydrated.person1Percent : 100 - hydrated.person1Percent;
      const isTopUp = !!userPickSide;
      const entryId = person === 1 ? hydrated.person1EntryId : hydrated.person2EntryId;
      setPendingSelection({
        type: "h2h",
        marketId,
        entryId,
        choice: picked.name,
        marketName: hydrated.title,
        personName: picked.name,
        opponentName: opponent.name,
        currentScore: picked.currentScore,
        opponentScore: opponent.currentScore,
        crowdSentiment: sentiment,
        tieRule: hydrated.tieRule ?? "refund",
        endAt: hydrated.endAt,
        bettingCutoff: hydrated.bettingCutoff,
        isTopUp,
        existingStake: isTopUp ? userPickTotalStake : undefined,
        engine: hydrated.engine,
        ammState: hydrated.ammState,
        ammNetShares: ammNetSharesFor(entryId),
      });
      setModalIntent("buy");
      setStakeModalOpen(true);
    },
    [hydrated, isMarketClosed, userPickSide, marketId, userPickTotalStake, ammNetSharesFor]
  );

  const invalidateAfterTrade = useCallback(async () => {
    await Promise.all([
      refreshProfile?.(),
      queryClient.invalidateQueries({ queryKey: ["/api/native-markets/h2h"] }),
      queryClient.invalidateQueries({ queryKey: ["/api/me/predictions"] }),
      queryClient.invalidateQueries({ queryKey: ["/api/profile/me"] }),
      queryClient.invalidateQueries({ queryKey: ["/api/markets", marketId, "my-position"] }),
      queryClient.invalidateQueries({ queryKey: ["/api/markets", marketId, "amm-position"] }),
    ]);
  }, [queryClient, refreshProfile, marketId]);

  const betMutation = useMutation({
    mutationFn: async ({
      entryId,
      stakeAmount,
      maxPricePerShare,
    }: {
      entryId: string;
      stakeAmount: number;
      maxPricePerShare?: number;
    }) => {
      const res = await apiRequest(
        "POST",
        `/api/native-markets/${marketId}/bet`,
        {
          entryId,
          stakeAmount,
          maxPricePerShare,
        },
        { idempotencyKey: tradeIdempotencyKey },
      );
      return res.json();
    },
    onSuccess: async (data) => {
      hapticSuccess();
      if (data?.xp?.xpAwarded) {
        triggerXpBurst(data.xp.xpAwarded, undefined, data.xp.reason);
      }
      // Every native H2H trade is AMM. Resolve which side via the
      // entryId from `pendingSelection` so the share card hero is the
      // right face.
      if (hydrated && pendingSelection?.entryId) {
        const picked =
          pendingSelection.entryId === hydrated.person1EntryId
            ? hydrated.person1
            : hydrated.person2;
        const shares = Number(data?.sharesPurchased) || 0;
        const chargeCredits = Number(data?.chargeCredits) || 0;
        const pricePerShare = Number(data?.pricePerShareAvg) || 0;
        const tradeData = buildTradeShareData({
          actionType: "buy",
          username: profile?.username || "you",
          personName: picked.name,
          personAvatar: picked.avatar || null,
          marketTitle: hydrated.title,
          category: hydrated.category,
          entryLabel: picked.name,
          // H2H is "candidate A vs candidate B" — neither side is "up"
          // or "down" in the directional sense, so the trade card
          // uses the neutral "other" accent (violet) for both.
          direction: "other",
          shares,
          pricePerShare,
          stakeAmount: chargeCredits,
        });
        const origin = typeof window !== "undefined" ? window.location.origin : "";
        const pathname = typeof window !== "undefined" ? window.location.pathname : "";
        // Sprint 3: per-bet share URL so the H2H preview shows the
        // picked candidate + price chip in chat clients.
        const shareUrl = data?.betId
          ? `${origin}/share/bet/${data.betId}`
          : `${origin}${pathname}`;
        const fallbackText = `I just backed ${picked.name} on "${hydrated.title}" on VoxDex!\n${shareUrl}`;
        toast("Prediction placed!", {
          description: `${Math.round(shares).toLocaleString()} ${picked.name} shares · ${chargeCredits.toLocaleString()} cr`,
          action: {
            label: "Share",
            onClick: () =>
              openShareCard({
                data: tradeData,
                fallbackText,
                shareUrl,
                filenameBase: `voxdex-trade-${(data?.betId ?? "buy").toString().slice(0, 8)}`,
              }),
          },
        });
      } else {
        toast("Prediction placed!", {
          description: "Your head-to-head prediction has been recorded.",
        });
      }
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
    mutationFn: async ({
      entryId,
      shares,
      minPricePerShare,
    }: {
      entryId: string;
      shares: number;
      minPricePerShare?: number;
    }) => {
      const res = await apiRequest(
        "POST",
        `/api/native-markets/${marketId}/bet`,
        {
          entryId,
          actionType: "sell",
          shares,
          minPricePerShare,
        },
        { idempotencyKey: tradeIdempotencyKey },
      );
      return res.json();
    },
    onSuccess: async (data) => {
      hapticSuccess();
      if (hydrated && pendingSelection?.entryId) {
        const picked =
          pendingSelection.entryId === hydrated.person1EntryId
            ? hydrated.person1
            : hydrated.person2;
        const shares = Number(data?.sharesSold) || 0;
        const proceeds = Number(data?.proceeds) || 0;
        const pricePerShare = Number(data?.pricePerShareAvg) || 0;
        const tradeData = buildTradeShareData({
          actionType: "sell",
          username: profile?.username || "you",
          personName: picked.name,
          personAvatar: picked.avatar || null,
          marketTitle: hydrated.title,
          category: hydrated.category,
          entryLabel: picked.name,
          direction: "other",
          shares,
          pricePerShare,
          stakeAmount: proceeds,
        });
        const origin = typeof window !== "undefined" ? window.location.origin : "";
        const pathname = typeof window !== "undefined" ? window.location.pathname : "";
        // Sprint 3: per-bet share URL points at the sell bet row.
        const shareUrl = data?.betId
          ? `${origin}/share/bet/${data.betId}`
          : `${origin}${pathname}`;
        const fallbackText = `Just took ${proceeds} credits off the table on "${hydrated.title}" on VoxDex!\n${shareUrl}`;
        toast("Position sold", {
          description: `Sold ${Math.round(shares).toLocaleString()} ${picked.name} shares · +${proceeds.toLocaleString()} cr`,
          action: {
            label: "Share",
            onClick: () =>
              openShareCard({
                data: tradeData,
                fallbackText,
                shareUrl,
                filenameBase: `voxdex-trade-${(data?.betId ?? "sell").toString().slice(0, 8)}`,
              }),
          },
        });
      } else {
        toast("Position sold", {
          description: "Proceeds have been credited to your wallet.",
        });
      }
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
    async (amount: number, meta?: { maxPricePerShare?: number }) => {
      if (!pendingSelection?.entryId) return;
      await betMutation.mutateAsync({
        entryId: pendingSelection.entryId,
        stakeAmount: amount,
        maxPricePerShare: meta?.maxPricePerShare,
      });
    },
    [pendingSelection, betMutation]
  );

  const handleConfirmAmmSell = useCallback(
    async (shares: number, meta?: { minPricePerShare?: number }) => {
      if (!pendingSelection?.entryId) return;
      await sellMutation.mutateAsync({
        entryId: pendingSelection.entryId,
        shares,
        minPricePerShare: meta?.minPricePerShare,
      });
    },
    [pendingSelection, sellMutation]
  );

  const openSellModal = useCallback(
    (person: 1 | 2) => {
      if (!hydrated) return;
      const picked = person === 1 ? hydrated.person1 : hydrated.person2;
      const opponent = person === 1 ? hydrated.person2 : hydrated.person1;
      const entryId = person === 1 ? hydrated.person1EntryId : hydrated.person2EntryId;
      const sentiment = person === 1 ? hydrated.person1Percent : 100 - hydrated.person1Percent;
      setPendingSelection({
        type: "h2h",
        marketId,
        entryId,
        choice: picked.name,
        marketName: hydrated.title,
        personName: picked.name,
        opponentName: opponent.name,
        currentScore: picked.currentScore,
        opponentScore: opponent.currentScore,
        crowdSentiment: sentiment,
        tieRule: hydrated.tieRule ?? "refund",
        endAt: hydrated.endAt,
        bettingCutoff: hydrated.bettingCutoff,
        engine: hydrated.engine,
        ammState: hydrated.ammState,
        ammNetShares: ammNetSharesFor(entryId),
      });
      setModalIntent("sell");
      setStakeModalOpen(true);
    },
    [hydrated, marketId, ammNetSharesFor],
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
          <MuteMarketToggle marketId={marketId} />
          <ShareIconButton title={`${hydrated.title} on VoxDex`} />
          <HeaderUserActions />
        </div>
      </header>

      <div className="max-w-3xl mx-auto px-4 pt-4 space-y-4">
        <MarketCycleStrip
          bettingCutoff={hydrated.bettingCutoff}
          resolveAt={hydrated.endAt}
          variant="full"
          engine="amm"
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
            </div>

            <div className="relative mb-4" style={{ padding: '0 5px' }}>
              <div className="flex" style={{ gap: '7px' }}>
                {/* Person 1 — clickable when no pick OR user already picked
                    person 1 (same-side top-up). Greyed when user picked
                    person 2 (opposite-side hedge blocked). */}
                {(() => {
                  const p1Active = !userPickSide || userPickSide === 1;
                  const p1Disabled = !!userPickSide && userPickSide !== 1;
                  return (
                    <ClosedMarketActionTrigger isClosed={isMarketClosed && !userPickSide} message={closedMarketMessage} side="top" align="center">
                      <div
                        className={`flex-1 relative ${p1Active ? "cursor-pointer group/p1" : ""} ${p1Disabled ? "opacity-40 grayscale cursor-not-allowed" : ""}`}
                        onClick={() => p1Active && handleSelect(1)}
                        aria-disabled={p1Disabled || undefined}
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
                  );
                })()}
                {/* Person 2 — same logic, mirrored. */}
                {(() => {
                  const p2Active = !userPickSide || userPickSide === 2;
                  const p2Disabled = !!userPickSide && userPickSide !== 2;
                  return (
                    <ClosedMarketActionTrigger isClosed={isMarketClosed && !userPickSide} message={closedMarketMessage} side="top" align="center">
                      <div
                        className={`flex-1 relative ${p2Active ? "cursor-pointer group/p2" : ""} ${p2Disabled ? "opacity-40 grayscale cursor-not-allowed" : ""}`}
                        onClick={() => p2Active && handleSelect(2)}
                        aria-disabled={p2Disabled || undefined}
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
                  );
                })()}
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

            <div className="grid grid-cols-2 gap-3 text-center">
              <div>
                <p className="text-lg md:text-xl font-bold">
                  {hydrated.totalParticipants}
                </p>
                <p className="text-[10px] text-muted-foreground uppercase tracking-wider">
                  Traders
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

        {/* AMM live probability + per-side position card. Surfaces
            netShares + avg entry price + current value, plus an
            inline "Sell" button so users can close out without
            hunting through MyPredictions. */}
        {(() => {
          const ammSnap = snapshotFromApi(hydrated.ammState);
          const ammPriceMap = ammSnap ? pricesFor(ammSnap) : null;
          const p1Price = ammPriceMap && hydrated.person1EntryId ? Number(ammPriceMap[hydrated.person1EntryId] ?? 0) : 0;
          const p2Price = ammPriceMap && hydrated.person2EntryId ? Number(ammPriceMap[hydrated.person2EntryId] ?? 0) : 0;
          const p1Pos = hydrated.person1EntryId ? ammPositionByEntry.get(hydrated.person1EntryId) : undefined;
          const p2Pos = hydrated.person2EntryId ? ammPositionByEntry.get(hydrated.person2EntryId) : undefined;
          const hasAnyPosition = (p1Pos && p1Pos.netShares > 1e-6) || (p2Pos && p2Pos.netShares > 1e-6);

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
                  <div className="rounded-lg border border-blue-500/30 bg-blue-500/5 p-3">
                    <p className="text-[10px] text-muted-foreground uppercase tracking-wider">{smartName(hydrated.person1.name)}</p>
                    <p className="text-2xl font-bold text-blue-600 dark:text-blue-400">
                      {priceToPercent(p1Price, 0)}
                    </p>
                    <p className="text-[10px] text-muted-foreground">
                      {p1Price.toFixed(3)} cr / share
                    </p>
                  </div>
                  <div className="rounded-lg border border-purple-500/30 bg-purple-500/5 p-3">
                    <p className="text-[10px] text-muted-foreground uppercase tracking-wider">{smartName(hydrated.person2.name)}</p>
                    <p className="text-2xl font-bold text-purple-600 dark:text-purple-400">
                      {priceToPercent(p2Price, 0)}
                    </p>
                    <p className="text-[10px] text-muted-foreground">
                      {p2Price.toFixed(3)} cr / share
                    </p>
                  </div>
                </div>

                {hasAnyPosition && (
                  <div className="space-y-2 pt-2 border-t border-border/40">
                    <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Your position</p>
                    {[
                      { person: hydrated.person1, pos: p1Pos, side: 1 as const },
                      { person: hydrated.person2, pos: p2Pos, side: 2 as const },
                    ].map(({ person, pos, side }) => {
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
                            <p className="text-sm font-semibold truncate">{smartName(person.name)}</p>
                            <p className="text-[11px] text-muted-foreground">
                              {pos.netShares.toFixed(2)} shares · avg {pos.avgEntryPrice.toFixed(3)} cr · cost {pos.netCreditsIn.toFixed(0)} cr
                            </p>
                            {/* Sprint 5 / Phase 2.4: conversational position copy.
                                Replaces the dense "≈ X cr now · -Y cr" style
                                with two plain-English lines that read like the
                                Up/Down detail page: what you'd get if you sold
                                now, and what the position pays if it wins. */}
                            <p className="text-[11px] text-muted-foreground">
                              Sell now: ~{pos.currentValue.toFixed(2)} cr{" "}
                              <span className={`font-mono font-medium ${pnlColor}`}>
                                ({unrealisedPnl >= 0 ? "+" : ""}{unrealisedPnl.toFixed(2)} cr)
                              </span>
                            </p>
                            <p className="text-[11px] text-muted-foreground">
                              If {smartName(person.name)} wins: {pos.netShares.toFixed(2)} cr{" "}
                              <span className="font-mono font-medium text-green-700 dark:text-green-500">
                                ({maxProfitIfWin >= 0 ? "+" : ""}{maxProfitIfWin.toFixed(2)} cr)
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
                      Live prices — these numbers shift as the market moves.
                    </p>
                  </div>
                )}
              </div>
            </Card>
          );
        })()}

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

        {/* AMM Price History - week-over-week market consensus. Sits
            above the Score Comparison so users see the market signal
            first, then the underlying trend-score gap. */}
        {hydrated.person1EntryId && hydrated.person2EntryId && (() => {
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
                    { entryId: hydrated.person1EntryId!, label: hydrated.person1.name, color: "#3b82f6" },
                    { entryId: hydrated.person2EntryId!, label: hydrated.person2.name, color: "#a855f7" },
                  ]}
                  livePrices={livePrices}
                  height={220}
                />
              </div>
            </Card>
          );
        })()}

        {/* Live trade feed for this H2H matchup. */}
        <MarketActivityFeed marketId={marketId} />

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

        {/* How This Resolves */}
        <MarketResolutionInfo
          mode="h2h"
          bettingCutoff={hydrated.bettingCutoff}
          closeTime={hydrated.endAt ? new Date(hydrated.endAt).toUTCString().replace(/ GMT$/, " UTC") : undefined}
          tieRule={hydrated.tieRule}
          person1Name={hydrated.person1.name}
          person2Name={hydrated.person2.name}
          engine="amm"
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
            <>
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
              {!isMarketClosed && (
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
        onConfirmAmmSell={handleConfirmAmmSell}
        liveAmmState={hydrated?.ammState ?? null}
        initialAmmMode={modalIntent}
        walletBalance={walletCredits}
      />
    </div>
  );
}
