import { useState, useMemo, useCallback, useRef, useEffect } from "react";
import { useRoute, useLocation } from "wouter";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { dismissVoteToast, showPendingVoteToast, showVoteToast } from "@/lib/vote-toast";
import { hapticSuccess, hapticError } from "@/lib/haptic";
import { useMarketCycle } from "@/hooks/useMarketCycle";
import { useAuth } from "@/contexts/AuthContext";
import { useXpBurst } from "@/components/XpBurstProvider";
import { StakeModal, type StakeSelection } from "@/components/StakeModal";
import { CashOutSheet, type CashOutSelection } from "@/components/CashOutSheet";
import { ClosedMarketActionTrigger } from "@/components/predict/ClosedMarketActionTrigger";
import { MarketCycleStrip } from "@/components/predict/MarketCycleStrip";
import { MarketDetailSkeleton } from "@/components/predict/MarketDetailSkeleton";
import { MarketResolutionInfo } from "@/components/predict/MarketResolutionInfo";
import { ShareIconButton } from "@/components/predict/ShareIconButton";
import { RelatedMarkets } from "@/components/predict/RelatedMarkets";
import { MuteMarketToggle } from "@/components/predict/MuteMarketToggle";
import { RaceWhatNeedsToHappen } from "@/components/predict/WhatNeedsToHappen";
import { PersonAvatar } from "@/components/PersonAvatar";
import { CategoryPill } from "@/components/CategoryPill";
import { VoxDexLogo } from "@/components/VoxDexLogo";
import { HeaderUserActions } from "@/components/HeaderUserActions";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { formatSignedPercent, formatSignedPoints } from "@/lib/predict-display";
import { cn } from "@/lib/utils";
import { getMarketCategoryLabel, normalizeMarketCategory } from "@shared/constants";
import { apiRequest, parseApiError } from "@/lib/queryClient";
import { useIdempotencyKey } from "@/lib/useIdempotencyKey";
import { getClosedMarketMessage } from "@/lib/marketClosedMessaging";
import { goBack } from "@/lib/goBack";
import { formatVox, formatVoxCompact, formatVoxDelta, formatVoxPrice } from "@/lib/currency";
import { useDocumentMeta } from "@/hooks/useDocumentMeta";
import { useNativeMarketDetail } from "@/hooks/useNativeMarketDetail";
import { pricesFor, snapshotFromApi } from "@/lib/ammClient";
import { predictDetailSectionCardClass } from "@/lib/predict-detail-ui";
import { PredictDetailSectionHeader } from "@/components/predict/PredictDetailSectionHeader";
import { AmmPriceHistoryChart } from "@/components/predict/AmmPriceHistoryChart";
import { MarketActivityFeed } from "@/components/predict/MarketActivityFeed";
import { useShareCard } from "@/contexts/ShareCardContext";
import { buildTradeShareData, buildPositionShareData } from "@/lib/share-data";
import {
  ArrowLeft,
  Crown,
  Search,
  Users,
  Trophy,
  Clock,
  ChevronRight,
  ChevronDown,
  Lock,
  BarChart3,
  Zap,
  Activity,
  Banknote,
} from "lucide-react";

type GainerCandidate = {
  name: string;
  avatar: string;
  currentGain: number;
  percentGain: number;
  rank?: number;
  entryId?: string;
  personId?: string;
  totalStake?: number;
  change24h?: number;
};

export default function CategoryRaceDetailPage() {
  const [, params] = useRoute("/predict/race/:marketId");
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

  const [searchQuery, setSearchQuery] = useState("");
  const [leaderboardExpanded, setLeaderboardExpanded] = useState(false);
  const [stakeModalOpen, setStakeModalOpen] = useState(false);
  const [pendingSelection, setPendingSelection] = useState<StakeSelection | null>(null);
  // Idempotency key per modal intent. See `useIdempotencyKey.ts`.
  const tradeIdempotencyKey = useIdempotencyKey(stakeModalOpen, [
    pendingSelection?.entryId,
    pendingSelection?.choice,
  ]);
  // Cash-out flow lives in its own sheet (CashOutSheet), not the
  // StakeModal — buy and sell are fully separate surfaces now.
  const [cashOutOpen, setCashOutOpen] = useState(false);
  const [cashOutSelection, setCashOutSelection] = useState<CashOutSelection | null>(null);
  const cashOutIdempotencyKey = useIdempotencyKey(cashOutOpen, [
    cashOutSelection?.entryId,
  ]);
  // Race trades target one of N candidates — `pendingSelection.choice`
  // is the candidate name, but we also need the avatar for the share
  // card hero. Captured at click-time alongside the pending selection;
  // read once in the buy onSuccess, then dropped on close.
  const pendingShareCandidateRef = useRef<GainerCandidate | null>(null);
  const candidateSearchRef = useRef<HTMLInputElement | null>(null);

  const { market, isLoading, notFound } = useNativeMarketDetail(
    marketId,
    "/api/native-markets/gainer",
    {
      refetchInterval: (query: { state: { data?: unknown } }) => {
        if (typeof document !== "undefined" && document.hidden) return false;
        const list = query.state.data as any[] | undefined;
        const found = list?.find((m: any) => m.id === marketId);
        if (found && found.status && found.status !== "OPEN") return false;
        return 60_000;
      },
    },
  );

  const serverCutoff = useMemo(() => {
    if (!market) return null;
    return (market as { bettingCutoff?: string | null }).bettingCutoff || null;
  }, [market]);

  const serverResolutionDeadline = useMemo(() => {
    if (!market) return null;
    return (market as { endAt?: string | null }).endAt || null;
  }, [market]);

  const marketState = useMarketCycle({ bettingCutoff: serverCutoff, resolutionDeadline: serverResolutionDeadline });
  const isMarketClosed = marketState.status !== "OPEN";
  const closedMarketMessage = useMemo(() => {
    return getClosedMarketMessage({
      bettingCutoff: serverCutoff,
      resolutionDeadline: serverResolutionDeadline,
    });
  }, [serverCutoff, serverResolutionDeadline]);

  // FIXED (2026-05-01): this page used to query /api/me/bets, which is
  // not a real endpoint — the request silently 404'd via getQueryFn so
  // `userBets` was always undefined and the "Your Position" card never
  // rendered for users who actually had a bet on the race. We now
  // query the per-market /my-position endpoint, which returns:
  //   { market, currentScore, totalStake, betCount, bets: [...] }
  // and pluck the first active bet for this market. The shape is
  // mapped below into the same `userBet` contract the existing UI
  // (rank/%-gain card + sticky bottom bar) was already written
  // against, so we don't have to rewrite the panel.
  const { data: myPosition } = useQuery<any>({
    queryKey: ["/api/markets", marketId, "my-position"],
    enabled: !!user && !!marketId,
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/markets/${marketId}/my-position`);
      return res.json();
    },
    staleTime: 30_000,
    retry: false,
  });

  // Parallel AMM position query so the persistent Share button on
  // open positions can build an honest payload (netShares,
  // avgEntryPrice, currentPrice) without re-deriving them from raw
  // bets.
  const { data: ammPositionData } = useQuery<{
    positions: Array<{
      entryId: string;
      entryLabel: string;
      netShares: number;
      netCreditsIn: number;
      avgEntryPrice: number;
      currentPrice: number;
      currentValue: number;
    }>;
  }>({
    queryKey: ["/api/markets", marketId, "amm-position"],
    enabled: !!user && !!marketId,
    staleTime: 30_000,
    retry: false,
  });
  const userBets = useMemo(() => {
    if (!myPosition?.bets) return [] as any[];
    return myPosition.bets.map((b: any) => ({
      marketId,
      entryId: b.entryId,
      amount: b.stakeAmount, // legacy field name expected by the existing panel
      stakeAmount: b.stakeAmount,
      potentialPayout: b.potentialPayout,
      placedAt: b.placedAt,
    }));
  }, [myPosition, marketId]);

  const ammSnapshot = useMemo(
    () => snapshotFromApi((market as any)?.ammState ?? null),
    [market],
  );
  const ammPriceMap = useMemo(
    () => (ammSnapshot ? pricesFor(ammSnapshot) : null),
    [ammSnapshot],
  );

  const candidates = useMemo((): GainerCandidate[] => {
    if (!market) return [];
    const entries = market.entries || [];

    const openingScoresMap = new Map<string, number>();
    const rawOpeningScores = (market.metadata as any)?.openingScores;
    if (Array.isArray(rawOpeningScores)) {
      for (const os of rawOpeningScores) {
        if (os.personId && os.score > 0) openingScoresMap.set(os.personId, os.score);
      }
    }

    return entries
      .map((e: any) => {
        const p = e.person || {};
        const currentScore = Number(p.trendScore || 0);
        const openScore = openingScoresMap.get(e.personId || "");
        const pctGain =
          openScore && openScore > 0
            ? ((currentScore - openScore) / openScore) * 100
            : Number(p.change7d || 0);
        const ptsAdded =
          openScore && openScore > 0
            ? currentScore - openScore
            : (pctGain * currentScore) / 100;
        return {
          name: p.name || e.label || "?",
          avatar: p.avatar || "",
          currentGain: ptsAdded,
          percentGain: Math.round(pctGain * 10) / 10,
          rank: Number(p.rank || 0),
          entryId: e.id,
          personId: e.personId || "",
          totalStake: Number(e.totalStake || 0),
          change24h: p.change24h != null ? Number(p.change24h) : undefined,
        };
      })
      .sort((a: GainerCandidate, b: GainerCandidate) => b.percentGain - a.percentGain);
  }, [market]);

  const totalParticipants = useMemo(() => {
    if (!market) return 0;
    return Number(market.activeParticipantCount || 0) || 0;
  }, [market]);

  const userMarketBets = useMemo(() => {
    if (!userBets || !marketId) return [] as any[];
    return userBets.filter((b: any) => b.marketId === marketId);
  }, [userBets, marketId]);

  const userBet = useMemo(() => userMarketBets[0] || null, [userMarketBets]);

  // Race lets users back multiple candidates, so "userPick" here just means
  // the *first* candidate the user backed (used by existing path-to-win
  // copy and the position card's drift). For per-candidate top-up checks
  // we look up `existingStakeFor(candidate)` directly.
  const userPick = useMemo(() => {
    if (!userBet) return null;
    return candidates.find((c) => c.entryId === userBet.entryId) || null;
  }, [userBet, candidates]);

  const existingStakeFor = useCallback(
    (entryId: string | undefined): number => {
      if (!entryId) return 0;
      return userMarketBets
        .filter((b: any) => b.entryId === entryId)
        .reduce((sum: number, b: any) => sum + Number(b.stakeAmount || 0), 0);
    },
    [userMarketBets],
  );

  const userPickRank = useMemo(() => {
    if (!userPick) return null;
    const idx = candidates.findIndex((c) => c.entryId === userPick.entryId);
    return idx >= 0 ? idx + 1 : null;
  }, [userPick, candidates]);

  const categoryLabel = market
    ? getMarketCategoryLabel(normalizeMarketCategory(market.category || "misc"))
    : "";

  const filteredCandidates = useMemo(() => {
    if (!searchQuery) return candidates;
    const q = searchQuery.toLowerCase();
    return candidates.filter((c) => c.name.toLowerCase().includes(q));
  }, [candidates, searchQuery]);

  const LEADERBOARD_PREVIEW = 8;
  const displayedCandidates = useMemo(() => {
    if (searchQuery || leaderboardExpanded) return filteredCandidates;
    return filteredCandidates.slice(0, LEADERBOARD_PREVIEW);
  }, [filteredCandidates, searchQuery, leaderboardExpanded]);

  const showLeaderboardExpand =
    !searchQuery && candidates.length > LEADERBOARD_PREVIEW && !leaderboardExpanded;

  const raceLeader = candidates[0] ?? null;

  const maxGain = useMemo(
    () => Math.max(...candidates.map((c) => Math.abs(c.percentGain)), 1),
    [candidates]
  );

  const handleCandidateSelect = useCallback(
    (candidate: GainerCandidate) => {
      if (isMarketClosed) return;
      // Race natively supports backing multiple candidates — no blanket
      // guard. If the user re-clicks one they've already backed we treat
      // it as a same-side top-up (StakeModal copy adapts).
      const priorStake = existingStakeFor(candidate.entryId);
      const isTopUp = priorStake > 0;
      const crowdSentiment = ammPriceMap && candidate.entryId
        ? Math.round(Number(ammPriceMap[candidate.entryId] ?? 0) * 100)
        : 0;
      pendingShareCandidateRef.current = candidate;
      setPendingSelection({
        type: "gainer",
        marketId,
        entryId: candidate.entryId || "",
        choice: candidate.name,
        marketName: `Category Race: ${categoryLabel}`,
        candidateRank: candidate.rank,
        candidatePercentGain: candidate.percentGain,
        candidatePointsAdded: candidate.currentGain,
        crowdSentiment,
        endAt: serverResolutionDeadline ?? undefined,
        bettingCutoff: market?.bettingCutoff || null,
        isTopUp,
        existingStake: isTopUp ? priorStake : undefined,
        engine: "amm",
        ammState: (market as any)?.ammState ?? null,
      } as StakeSelection);
      setStakeModalOpen(true);
    },
    [isMarketClosed, marketId, categoryLabel, market, serverResolutionDeadline, existingStakeFor, ammPriceMap]
  );

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
    onMutate: () => {
      const toastId = showPendingVoteToast("gainer", "Prediction submitted!");
      return { toastId };
    },
    onSuccess: async (data, _variables, context) => {
      hapticSuccess();
      if (data?.xp?.xpAwarded) {
        triggerXpBurst(data.xp.xpAwarded, undefined, data.xp.reason);
      }
      const candidate = pendingShareCandidateRef.current;
      if (candidate) {
        const shares = Number(data?.sharesPurchased) || 0;
        const chargeCredits = Number(data?.chargeCredits) || 0;
        const pricePerShare = Number(data?.pricePerShareAvg) || 0;
        const tradeData = buildTradeShareData({
          actionType: "buy",
          username: profile?.username || "you",
          personName: candidate.name,
          personAvatar: candidate.avatar || null,
          marketTitle: `Category Race: ${categoryLabel}`,
          category: market ? normalizeMarketCategory(market.category || "misc") : null,
          entryLabel: candidate.name,
          direction: "other",
          shares,
          pricePerShare,
          stakeAmount: chargeCredits,
        });
        const origin = typeof window !== "undefined" ? window.location.origin : "";
        const pathname = typeof window !== "undefined" ? window.location.pathname : "";
        const shareUrl = data?.betId
          ? `${origin}/share/bet/${data.betId}`
          : `${origin}${pathname}`;
        const fallbackText = `I just backed ${candidate.name} in the ${categoryLabel} Race on VoxDex!\n${shareUrl}`;
        showVoteToast("gainer", "Shares purchased", {
          id: context?.toastId,
          description: `${Math.round(shares).toLocaleString()} ${candidate.name} shares · ${formatVox(chargeCredits)}`,
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
        showVoteToast("gainer", "Shares purchased", {
          id: context?.toastId,
          description: Number.isFinite(Number(data?.sharesPurchased))
            ? `You bought ${Number(data.sharesPurchased).toFixed(2)} shares for ${Number.isFinite(Number(data?.chargeCredits)) ? formatVox(Number(data.chargeCredits)) : "—"}.`
            : "Your race prediction has been recorded.",
        });
      }
      pendingShareCandidateRef.current = null;
      setStakeModalOpen(false);
      setPendingSelection(null);
      await Promise.all([
        refreshProfile?.(),
        queryClient.invalidateQueries({ queryKey: ["/api/native-markets/gainer"] }),
        queryClient.invalidateQueries({ queryKey: ["/api/me/predictions"] }),
        queryClient.invalidateQueries({ queryKey: ["/api/profile/me"] }),
        queryClient.invalidateQueries({ queryKey: ["/api/markets", marketId, "my-position"] }),
        queryClient.invalidateQueries({ queryKey: ["/api/markets", marketId, "price-history"] }),
      ]);
    },
    onError: (err: Error, _variables, context) => {
      dismissVoteToast(context?.toastId);
      hapticError();
      const { title, description } = parseApiError(err, "Failed to place prediction");
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

  /**
   * Sprint 5 / Phase 3.4: Race AMM sell flow. Same shape as the
   * Up/Down + H2H pages — POST to `/api/native-markets/:marketId/bet`
   * with `actionType: "sell"`. The cache invalidations mirror the
   * other native pages so the rendered position rows refresh
   * immediately after a sell. We keep the share toast lean (just
   * proceeds) — Race shares are best opened from the position card.
   */
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
        { idempotencyKey: cashOutIdempotencyKey },
      );
      return res.json();
    },
    onMutate: () => {
      const toastId = showPendingVoteToast("gainer", "Cashing out…");
      return { toastId };
    },
    onSuccess: async (data: any, _variables, context) => {
      hapticSuccess();
      if (data?.xp?.xpAwarded) {
        triggerXpBurst(data.xp.xpAwarded, undefined, data.xp.reason);
      }
      const proceeds = Math.round(Number(data?.proceeds ?? 0));
      showVoteToast("gainer", "Cashed out", {
        id: context?.toastId,
        description:
          proceeds > 0
            ? `Proceeds credited: +${formatVox(proceeds)}`
            : "Proceeds have been credited to your wallet.",
      });
      setCashOutOpen(false);
      setCashOutSelection(null);
      await Promise.all([
        refreshProfile?.(),
        queryClient.invalidateQueries({ queryKey: ["/api/native-markets/gainer"] }),
        queryClient.invalidateQueries({ queryKey: ["/api/me/predictions"] }),
        queryClient.invalidateQueries({ queryKey: ["/api/me/amm-positions"] }),
        queryClient.invalidateQueries({ queryKey: ["/api/profile/me"] }),
        queryClient.invalidateQueries({ queryKey: ["/api/markets", marketId, "my-position"] }),
        queryClient.invalidateQueries({ queryKey: ["/api/markets", marketId, "amm-position"] }),
        queryClient.invalidateQueries({ queryKey: ["/api/markets", marketId, "price-history"] }),
      ]);
    },
    onError: (err: Error, _variables, context) => {
      dismissVoteToast(context?.toastId);
      hapticError();
      const { title, description } = parseApiError(err, "Failed to cash out position");
      toast.error(title, { description });
    },
  });

  const handleConfirmCashOut = useCallback(
    async (shares: number, meta?: { minPricePerShare?: number }) => {
      if (!cashOutSelection?.entryId) return;
      await sellMutation.mutateAsync({
        entryId: cashOutSelection.entryId,
        shares,
        minPricePerShare: meta?.minPricePerShare,
      });
    },
    [cashOutSelection, sellMutation]
  );

  const openCashOut = useCallback(
    (
      candidate: GainerCandidate,
      pos: { netShares: number; netCreditsIn: number; avgEntryPrice: number },
    ) => {
      if (!candidate.entryId) return;
      if (pos.netShares <= 1e-6) return;
      setCashOutSelection({
        marketId,
        entryId: candidate.entryId,
        sideLabel: candidate.name,
        sideTone: "neutral",
        marketName: `Category Race: ${categoryLabel}`,
        netShares: pos.netShares,
        netCreditsIn: pos.netCreditsIn,
        avgEntryPrice: pos.avgEntryPrice,
        bettingCutoff: market?.bettingCutoff || null,
        endAt: serverResolutionDeadline ?? undefined,
        ammState: (market as any)?.ammState ?? null,
        statusLabel: candidate.rank === 1 ? "Leading" : candidate.rank ? `Rank #${candidate.rank}` : null,
        statusTone: candidate.rank === 1 ? "positive" : "warning",
      });
      setCashOutOpen(true);
    },
    [marketId, categoryLabel, serverResolutionDeadline, market],
  );

  const { timeRemaining } = marketState;
  const pad = (n: number) => String(n).padStart(2, "0");

  const raceTitle = categoryLabel ? `${categoryLabel} Race` : "Category Race";
  useDocumentMeta({
    title: `${raceTitle} • VoxDex`,
    description: categoryLabel
      ? `Pick the biggest mover in ${categoryLabel} this week. Predict on VoxDex.`
      : "Pick the biggest mover in the category this week. Predict on VoxDex.",
    image: `/api/og/image/market.png?title=${encodeURIComponent(raceTitle)}&subtitle=${encodeURIComponent("Biggest mover this week")}&badge=${encodeURIComponent("Race")}`,
  });

  if (isLoading && !market) {
    return <MarketDetailSkeleton variant="weekly" />;
  }

  if (notFound || !market) {
    return (
      <div className="min-h-screen bg-background flex flex-col items-center justify-center gap-4 px-4">
        <Trophy className="h-12 w-12 text-muted-foreground" />
        <h2 className="text-lg font-semibold">Race not found</h2>
        <Button variant="outline" onClick={() => setLocation("/predict")}>
          <ArrowLeft className="h-4 w-4 mr-2" />
          Back to Predict
        </Button>
      </div>
    );
  }

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
            <h1 className="text-sm font-semibold truncate">Category Race: {categoryLabel}</h1>
          </div>
          <Badge variant="outline" className="text-[10px] shrink-0">
            <Clock className="h-3 w-3 mr-1" />
            {pad(timeRemaining.days)}d {pad(timeRemaining.hours)}h {pad(timeRemaining.minutes)}m
          </Badge>
          <MuteMarketToggle marketId={marketId} />
          <ShareIconButton title={`Category Race: ${categoryLabel} on VoxDex`} />
          <HeaderUserActions />
        </div>
      </header>

      <div className="max-w-3xl mx-auto px-4 pt-4 space-y-5 md:space-y-6 pb-28 md:pb-8">
        <MarketCycleStrip
          bettingCutoff={market?.bettingCutoff ?? null}
          resolveAt={market?.endAt ?? null}
          variant="full"
          engine="amm"
        />

        {/* Hero — category context + current leader snapshot */}
        <Card className="relative overflow-hidden border-violet-500/30 dark:border-violet-500/20 shadow-none">
          <div className="absolute inset-0 bg-gradient-to-r from-violet-500/5 via-transparent to-fuchsia-500/5" />
          <div className="relative p-4 sm:p-5">
            <div className="flex items-center gap-2 flex-wrap mb-2">
              <h1 className="text-lg sm:text-xl font-serif font-bold">Category Race</h1>
              <CategoryPill category={normalizeMarketCategory(market.category || "misc")} />
            </div>
            <p className="text-xs text-muted-foreground mb-4">
              Biggest weekly gain wins — pick who moves the most this week.
            </p>

            {raceLeader && (
              <div className="flex items-center gap-3 p-3 rounded-lg bg-amber-500/8 border border-amber-500/30 dark:border-amber-500/25 mb-4">
                <div className="h-8 w-8 rounded-full bg-amber-500/25 dark:bg-amber-500/20 border border-amber-500/60 dark:border-amber-500/50 flex items-center justify-center shrink-0">
                  <Crown className="h-4 w-4 text-amber-600 dark:text-amber-400" />
                </div>
                <PersonAvatar
                  name={raceLeader.name}
                  avatar={raceLeader.avatar}
                  className="h-11 w-11 shrink-0"
                />
                <div className="min-w-0 flex-1">
                  <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Current leader</p>
                  <p className="text-sm font-semibold truncate">{raceLeader.name}</p>
                </div>
                <p className="text-base font-mono font-bold text-green-700 dark:text-green-500 shrink-0">
                  {formatSignedPercent(raceLeader.percentGain)}
                </p>
              </div>
            )}

            <div className="flex items-center justify-center gap-6">
              <div className="text-center">
                <p className="text-base font-bold tabular-nums">{candidates.length}</p>
                <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Runners</p>
              </div>
              <div className="h-8 w-px bg-border/50" />
              <div className="text-center">
                <p className="text-base font-bold tabular-nums">{totalParticipants}</p>
                <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Traders</p>
              </div>
            </div>
          </div>
        </Card>

        {userPick && candidates.length > 0 && (
          <RaceWhatNeedsToHappen
            myPickName={userPick.name}
            myPickPercentGain={userPick.percentGain}
            leaderName={candidates[0].name}
            leaderPercentGain={candidates[0].percentGain}
          />
        )}

        {/* Race Leaderboard — primary resolution surface */}
        <Card className={predictDetailSectionCardClass("overflow-hidden")} data-testid="section-race-leaderboard">
          <div className="p-4 sm:p-5">
            <PredictDetailSectionHeader
              icon={BarChart3}
              title="Race Leaderboard"
              subtitle="Ranked by weekly % gain — biggest mover wins"
              accent="predict"
              trailing={
                <Badge variant="outline" className="text-[10px] text-muted-foreground border-border/50 ml-auto">
                  {candidates.length} candidates
                </Badge>
              }
              className="mb-4"
            />

            <div className="relative mb-3">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                ref={candidateSearchRef}
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder={`Search ${categoryLabel} candidates...`}
                className="pl-9"
                data-testid="input-race-candidate-search"
              />
            </div>

            <div className="space-y-1.5">
              {displayedCandidates.map((candidate) => {
                const globalIdx = candidates.indexOf(candidate);
                const isLeader = globalIdx === 0;
                const isUserPick = userPick?.entryId === candidate.entryId;
                const canSelect = !isMarketClosed;
                const marketPct =
                  ammPriceMap && candidate.entryId
                    ? Math.max(0, Math.min(100, Math.round(Number(ammPriceMap[candidate.entryId] ?? 0) * 100)))
                    : null;

                return (
                  <ClosedMarketActionTrigger
                    key={candidate.entryId || candidate.name}
                    isClosed={isMarketClosed && canSelect}
                    message={closedMarketMessage}
                    side="top"
                    align="center"
                  >
                    <div
                      className={`flex items-center gap-2.5 sm:gap-3 p-2.5 sm:p-3 rounded-lg transition-colors relative overflow-hidden ${
                        canSelect ? "cursor-pointer" : ""
                      } ${
                        isLeader
                          ? "bg-gradient-to-r from-amber-500/10 to-transparent border border-amber-500/40 dark:border-amber-500/30"
                          : isUserPick
                          ? "border border-green-500/50 dark:border-green-500/40 bg-green-500/8 dark:bg-green-500/5"
                          : canSelect
                          ? "hover:bg-muted/50"
                          : ""
                      }`}
                      onClick={() => canSelect && handleCandidateSelect(candidate)}
                    >
                      <div
                        className="absolute inset-y-0 left-0 bg-green-500/8 transition-all"
                        style={{
                          width: `${Math.max((Math.abs(candidate.percentGain) / maxGain) * 100, 3)}%`,
                        }}
                      />

                      <div className="relative flex items-center gap-2.5 sm:gap-3 flex-1 min-w-0">
                        {isLeader ? (
                          <div className="h-7 w-7 rounded-full bg-amber-500/25 dark:bg-amber-500/20 border border-amber-500/60 dark:border-amber-500/50 flex items-center justify-center shrink-0">
                            <Crown className="h-4 w-4 text-amber-600 dark:text-amber-400" />
                          </div>
                        ) : (
                          <div className="h-7 w-7 rounded-full bg-muted/50 flex items-center justify-center shrink-0">
                            <span className="text-[11px] font-bold text-violet-600 dark:text-violet-400">
                              {globalIdx + 1}
                            </span>
                          </div>
                        )}

                        <PersonAvatar
                          name={candidate.name}
                          avatar={candidate.avatar}
                          className={isLeader ? "h-14 w-14" : "h-10 w-10"}
                        />

                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <span className="text-sm font-medium truncate">{candidate.name}</span>
                            {isUserPick && (
                              <Badge className="bg-green-600/20 text-green-700 dark:text-green-500 border-green-500/40 dark:border-green-500/30 text-[9px] px-1.5 py-0">
                                Your Pick
                              </Badge>
                            )}
                            {marketPct != null && (
                              <Badge variant="outline" className="text-[9px] text-muted-foreground border-border/40 px-1.5 py-0">
                                Market · {marketPct}%
                              </Badge>
                            )}
                          </div>
                          <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
                            {candidate.rank ? (
                              <span className="text-[10px] text-muted-foreground font-mono">
                                #{candidate.rank} on board
                              </span>
                            ) : null}
                            {candidate.rank ? (
                              <span className="text-[10px] text-muted-foreground/40">&middot;</span>
                            ) : null}
                            <span
                              className={`text-[10px] font-mono ${
                                candidate.currentGain >= 0
                                  ? "text-muted-foreground"
                                  : "text-red-600/80 dark:text-red-400/80"
                              }`}
                            >
                              {formatSignedPoints(candidate.currentGain)} pts added
                            </span>
                          </div>
                        </div>
                      </div>

                      <div className="relative text-right shrink-0">
                        <p
                          className={`text-base font-mono font-bold ${
                            candidate.percentGain >= 0
                              ? "text-green-700 dark:text-green-500"
                              : "text-red-700 dark:text-red-500"
                          }`}
                        >
                          {formatSignedPercent(candidate.percentGain)}
                        </p>
                      </div>
                    </div>
                  </ClosedMarketActionTrigger>
                );
              })}

              {filteredCandidates.length === 0 && (
                <div className="text-center py-8 text-muted-foreground text-sm">
                  No candidates match &quot;{searchQuery}&quot;
                </div>
              )}

              {showLeaderboardExpand && (
                <Button
                  variant="ghost"
                  className="w-full mt-2 text-sm text-violet-600 dark:text-violet-400"
                  onClick={() => setLeaderboardExpanded(true)}
                  data-testid="button-show-all-candidates"
                >
                  Show all {candidates.length} candidates
                  <ChevronDown className="h-4 w-4 ml-1" />
                </Button>
              )}
            </div>
          </div>
        </Card>

        {/* Live Market — trading panel (positions only; ranking lives in leaderboard) */}
        {ammPriceMap && candidates.length > 0 && (() => {
          const liveVolume = Number(
            ((market as any)?.ammState?.totalUserCreditsIn ?? (market as any)?.volume ?? 0),
          );
          const liveVolumeLabel = liveVolume > 0 ? formatVoxCompact(liveVolume) : null;
          const openPositions = (ammPositionData?.positions ?? []).filter(
            (p) => p.netShares > 1e-6,
          );
          return (
            <Card className={predictDetailSectionCardClass()}>
              <div className="p-4 sm:p-5">
                <PredictDetailSectionHeader
                  icon={Activity}
                  title="Live Market"
                  subtitle="Your open positions and live LMSR prices"
                  accent="live"
                  trailing={
                    <div className="flex items-center gap-1.5 ml-auto flex-wrap">
                      {liveVolumeLabel && (
                        <Badge
                          variant="outline"
                          className="text-[10px] tabular-nums text-muted-foreground border-border/50"
                          data-testid="race-live-market-volume"
                        >
                          {liveVolumeLabel} vol
                        </Badge>
                      )}
                      {totalParticipants > 0 && (
                        <Badge
                          variant="outline"
                          className="text-[10px] tabular-nums text-muted-foreground border-border/50 flex items-center gap-1"
                        >
                          <Users className="h-2.5 w-2.5" />
                          {totalParticipants}
                        </Badge>
                      )}
                      <Badge variant="outline" className="text-emerald-600 dark:text-emerald-400 border-emerald-500/40 dark:border-emerald-500/30 text-[10px]">
                        LIVE
                      </Badge>
                    </div>
                  }
                  className="mb-3"
                />

                {openPositions.length > 0 ? (
                  <div className="space-y-2">
                    <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">
                      Your positions
                    </p>
                    {openPositions
                      .slice()
                      .sort((a, b) => b.currentValue - a.currentValue)
                      .map((pos) => {
                        const candidate = candidates.find((c) => c.entryId === pos.entryId);
                        const candidateName = candidate?.name ?? pos.entryLabel;
                        const unrealisedPnl = pos.currentValue - pos.netCreditsIn;
                        const maxProfitIfWin = pos.netShares - pos.netCreditsIn;
                        const pnlIsZero = Math.abs(unrealisedPnl) < 0.005;
                        const pnlClass = pnlIsZero
                          ? "text-muted-foreground"
                          : unrealisedPnl >= 0
                            ? "text-green-700 dark:text-green-500"
                            : "text-red-700 dark:text-red-500";
                        return (
                          <div
                            key={pos.entryId}
                            className="rounded-lg bg-muted/30 p-3"
                            data-testid={`race-position-row-${pos.entryId}`}
                          >
                            <div className="flex items-start gap-3">
                              {candidate?.avatar ? (
                                <PersonAvatar
                                  name={candidateName}
                                  avatar={candidate.avatar}
                                  className="h-10 w-10 shrink-0"
                                />
                              ) : null}
                              <div className="min-w-0 flex-1">
                                <p className="text-sm font-semibold truncate">{candidateName}</p>
                                <p className="text-[11px] text-muted-foreground">
                                  {pos.netShares.toFixed(2)} shares · avg {formatVoxPrice(pos.avgEntryPrice, 3)} · cost {formatVoxPrice(pos.netCreditsIn, 0)}
                                </p>
                                <p className="text-[11px] text-muted-foreground">
                                  Cash out now: ~{formatVoxPrice(pos.currentValue)}{" "}
                                  <span className={`font-mono font-medium ${pnlClass}`}>
                                    ({formatVoxDelta(unrealisedPnl)})
                                  </span>
                                </p>
                                <p className="text-[11px] text-muted-foreground">
                                  If {candidateName} wins: {formatVoxPrice(pos.netShares)}{" "}
                                  <span className="font-mono font-medium text-green-700 dark:text-green-500">
                                    ({formatVoxDelta(maxProfitIfWin)})
                                  </span>
                                </p>
                              </div>
                            </div>
                            <div className="mt-2 flex items-center justify-end gap-2">
                              <Button
                                size="sm"
                                disabled={isMarketClosed || !candidate}
                                onClick={() => candidate && openCashOut(candidate, pos)}
                                data-testid={`race-position-sell-${pos.entryId}`}
                                className="gap-1 px-3 bg-gradient-to-r from-violet-600 to-fuchsia-600 text-white"
                              >
                                <Banknote className="h-3.5 w-3.5" />
                                <span>Cash out ~{formatVox(Math.round(pos.currentValue))}</span>
                              </Button>
                              <Button
                                size="sm"
                                variant="outline"
                                disabled={isMarketClosed || !candidate}
                                onClick={() => candidate && handleCandidateSelect(candidate)}
                                data-testid={`race-position-add-${pos.entryId}`}
                              >
                                Add
                              </Button>
                              <Button
                                size="sm"
                                variant="ghost"
                                onClick={() => {
                                  const data = buildPositionShareData({
                                    username: profile?.username || "you",
                                    personName: candidateName,
                                    personAvatar: candidate?.avatar ?? null,
                                    marketTitle: `Category Race: ${categoryLabel}`,
                                    category: categoryLabel,
                                    entryLabel: candidateName,
                                    direction: "other",
                                    netShares: pos.netShares,
                                    avgEntryPrice: pos.avgEntryPrice,
                                    currentPrice: pos.currentPrice,
                                    costBasis: pos.netCreditsIn,
                                    currentValue: pos.currentValue,
                                    endAt: (market as any)?.endAt || "",
                                  });
                                  const origin =
                                    typeof window !== "undefined" ? window.location.origin : "";
                                  const pathname =
                                    typeof window !== "undefined" ? window.location.pathname : "";
                                  openShareCard({
                                    data,
                                    fallbackText: `I'm backing ${candidateName} in the ${categoryLabel} Category Race on VoxDex!\n${origin}${pathname}`,
                                    shareUrl: `${origin}${pathname}`,
                                    filenameBase: `voxdex-position-${marketId.slice(0, 8)}`,
                                  });
                                }}
                                data-testid={`race-position-share-${pos.entryId}`}
                              >
                                Share
                              </Button>
                            </div>
                          </div>
                        );
                      })}
                    <p className="text-[10px] text-muted-foreground text-center pt-1">
                      Live prices — these numbers shift as the market moves.
                    </p>
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground text-center py-4">
                    Pick a candidate from the leaderboard above to open a position.
                  </p>
                )}
              </div>
            </Card>
          );
        })()}

        {candidates.length > 0 && (() => {
          const palette = ["#10b981", "#3b82f6", "#a855f7", "#f59e0b", "#ef4444", "#06b6d4"];
          const series = [...candidates]
            .filter((c) => c.entryId)
            .map((c) => ({
              entryId: c.entryId!,
              label: c.name,
              livePrice: Number(ammPriceMap?.[c.entryId!] ?? 0),
            }))
            .sort((a, b) => b.livePrice - a.livePrice)
            .slice(0, palette.length)
            .map((c, i) => ({ entryId: c.entryId, label: c.label, color: palette[i] }));
          return (
            <Card className={predictDetailSectionCardClass()}>
              <div className="p-4 sm:p-5">
                <PredictDetailSectionHeader
                  icon={Activity}
                  title="Market Price This Week"
                  subtitle="How crowd odds shifted over the past week"
                  accent="live"
                />
                <AmmPriceHistoryChart
                  marketId={marketId}
                  series={series}
                  livePrices={ammPriceMap ?? {}}
                  height={220}
                />
              </div>
            </Card>
          );
        })()}

        <Card className="border-border/50 shadow-none">
          <div className="p-4 sm:p-5">
            <PredictDetailSectionHeader
              icon={Zap}
              title="Race Insights"
              subtitle="24h momentum vs weekly pace"
              accent="insight"
            />
            <div>
              <p className="text-[11px] sm:text-xs text-muted-foreground mb-3 font-medium uppercase tracking-wider">
                Momentum (24h vs Weekly)
              </p>
              <div className="space-y-2.5">
                {candidates
                  .filter((c) => c.change24h != null)
                  .slice(0, 5)
                  .map((c) => {
                    const momentum24h = c.change24h ?? 0;
                    const isAccelerating =
                      c.percentGain > 0 && momentum24h > c.percentGain / 7;
                    return (
                      <div key={c.entryId || c.name} className="flex items-center gap-3">
                        <PersonAvatar name={c.name} avatar={c.avatar} className="h-8 w-8" />
                        <span className="text-sm font-medium truncate flex-1">{c.name}</span>
                        <Badge
                          variant="outline"
                          className={`text-[10px] sm:text-xs px-2 py-0.5 ${
                            isAccelerating
                              ? "text-green-700 dark:text-green-500 border-green-500/40 dark:border-green-500/30"
                              : "text-orange-600 dark:text-orange-400 border-orange-500/40 dark:border-orange-500/30"
                          }`}
                        >
                          {isAccelerating ? "Accelerating" : "Steady"}
                        </Badge>
                        <span className="text-xs font-mono tabular-nums text-muted-foreground shrink-0">
                          {momentum24h >= 0 ? "+" : ""}
                          {momentum24h.toFixed(1)}% 24h
                        </span>
                      </div>
                    );
                  })}
                {candidates.filter((c) => c.change24h != null).length === 0 && (
                  <p className="text-sm text-muted-foreground">
                    Momentum data will appear as the week progresses.
                  </p>
                )}
              </div>
            </div>
          </div>
        </Card>

        <MarketActivityFeed
          marketId={marketId}
          limit={5}
          detailHeader
          className="border-border/50 shadow-none"
        />

        <MarketResolutionInfo
          mode="race"
          bettingCutoff={serverCutoff}
          closeTime={serverResolutionDeadline ? new Date(serverResolutionDeadline).toUTCString().replace(/ GMT$/, " UTC") : undefined}
          categoryLabel={categoryLabel}
          engine="amm"
        />

        <RelatedMarkets
          type="race"
          currentMarketId={marketId}
          category={market?.category ?? null}
          className="pt-2"
        />
      </div>

      {/* Sticky Bottom CTA — lifted above the global mobile BottomNav
          (h-16, z-50) on phones; back to bottom-0 on md+ where the nav
          isn't rendered. */}
      <div className="fixed bottom-[calc(4rem+env(safe-area-inset-bottom))] md:bottom-0 left-0 right-0 z-40 border-t border-border/50 bg-background/95 backdrop-blur-md">
        <div className="max-w-3xl mx-auto px-4 py-3">
          {userPick ? (() => {
            // Race resolves on biggest mover, so the most useful "am I
            // winning?" signal is leader-relative (mirrors H2H's
            // Winning / Tied / Behind sticky badge). We derive the
            // leader from the already-sorted candidates array.
            const leader = candidates[0];
            const isLeader = leader && leader.entryId === userPick.entryId;
            const leaderStatusClass = isLeader
              ? "bg-green-600/20 text-green-700 dark:text-green-500 border-green-500/40 dark:border-green-500/30"
              : "bg-amber-600/20 text-amber-700 dark:text-amber-500 border-amber-500/40 dark:border-amber-500/30";
            const leaderStatusLabel = isLeader ? "Leading" : "Behind leader";
            const stickyPos = (ammPositionData?.positions ?? []).find(
              (p) => p.entryId === userPick.entryId && p.netShares > 1e-6,
            );
            return (
              <div className="flex items-center gap-2">
                <div className="flex-1 min-w-0">
                  <p className="text-xs text-muted-foreground">Your pick</p>
                  <p className="text-sm font-semibold truncate">{userPick.name}</p>
                </div>
                <Badge className={leaderStatusClass}>{leaderStatusLabel}</Badge>
                {/* Secondary badge yields to the Cash out button on
                    phones — the % gain is still visible in the
                    leaderboard rows above. */}
                <Badge
                  variant="outline"
                  className={cn(
                    stickyPos && !isMarketClosed ? "hidden sm:inline-flex" : "",
                    userPick.percentGain >= 0
                      ? "text-green-700 dark:text-green-500 border-green-500/40 dark:border-green-500/30"
                      : "text-red-700 dark:text-red-500 border-red-500/40 dark:border-red-500/30",
                  )}
                >
                  {formatSignedPercent(userPick.percentGain)}
                </Badge>
                <span className="text-xs text-muted-foreground hidden sm:inline">
                  #{userPickRank}/{candidates.length}
                </span>
                {/* Cash-out entry on the always-visible bar — only when
                    the user holds live AMM shares and trading is open. */}
                {!isMarketClosed && stickyPos && (
                  <Button
                    size="sm"
                    onClick={() => openCashOut(userPick, stickyPos)}
                    data-testid="button-sticky-cashout"
                    className="gap-1 bg-gradient-to-r from-violet-600 to-fuchsia-600 text-white"
                  >
                    <Banknote className="h-3.5 w-3.5" />
                    Cash out
                  </Button>
                )}
              </div>
            );
          })() : (
            <ClosedMarketActionTrigger isClosed={isMarketClosed} message={closedMarketMessage} side="top" align="center">
              <Button
                className="w-full bg-gradient-to-r from-violet-600 to-fuchsia-600 text-white py-3 h-auto text-base font-semibold"
                onClick={() => {
                  const input = candidateSearchRef.current;
                  if (input) {
                    input.scrollIntoView({ block: "center", behavior: "smooth" });
                    input.focus({ preventScroll: true });
                  }
                }}
              >
                <Trophy className="h-5 w-5 mr-2" />
                Choose Candidate
              </Button>
            </ClosedMarketActionTrigger>
          )}
        </div>
      </div>

      {/* Stake Modal — buy only; cash-out lives in CashOutSheet below. */}
      <StakeModal
        selection={pendingSelection}
        open={stakeModalOpen}
        onClose={() => {
          setStakeModalOpen(false);
          setPendingSelection(null);
        }}
        onConfirm={handleConfirmStake}
        liveAmmState={(market as any)?.ammState ?? null}
        walletBalance={walletCredits}
        onChangePick={() => {
          setStakeModalOpen(false);
          setPendingSelection(null);
        }}
      />

      <CashOutSheet
        selection={cashOutSelection}
        open={cashOutOpen}
        onClose={() => {
          setCashOutOpen(false);
          setCashOutSelection(null);
        }}
        onConfirmSell={handleConfirmCashOut}
        liveAmmState={(market as any)?.ammState ?? null}
      />
    </div>
  );
}
