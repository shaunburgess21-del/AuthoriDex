import { useState, useMemo, useCallback } from "react";
import { useRoute, useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { useMarketCycle } from "@/hooks/useMarketCycle";
import { useAuth } from "@/contexts/AuthContext";
import { StakeModal, type StakeSelection } from "@/components/StakeModal";
import { ClosedMarketActionTrigger } from "@/components/predict/ClosedMarketActionTrigger";
import { PersonAvatar } from "@/components/PersonAvatar";
import { CategoryPill } from "@/components/CategoryPill";
import { VoxDexLogo } from "@/components/VoxDexLogo";
import { UserMenu } from "@/components/UserMenu";
import { XpPill } from "@/components/XpPill";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { formatSignedPercent, formatSignedPoints } from "@/lib/predict-display";
import { getMarketCategoryLabel, normalizeMarketCategory } from "@shared/constants";
import { apiRequest } from "@/lib/queryClient";
import { getClosedMarketMessage } from "@/lib/marketClosedMessaging";
import {
  ArrowLeft,
  TrendingUp,
  Crown,
  Search,
  Users,
  Trophy,
  Clock,
  ChevronRight,
  Lock,
  HelpCircle,
  BarChart3,
  Zap,
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
  const { user, profile } = useAuth();
  const walletCredits = profile?.predictCredits ?? 0;

  const [searchQuery, setSearchQuery] = useState("");
  const [stakeModalOpen, setStakeModalOpen] = useState(false);
  const [pendingSelection, setPendingSelection] = useState<StakeSelection | null>(null);

  const { data: allGainerMarkets, isLoading } = useQuery<any[]>({
    queryKey: ["/api/native-markets/gainer"],
  });

  const serverCutoff = useMemo(() => {
    if (!allGainerMarkets) return null;
    const found = allGainerMarkets.find((m: any) => m.id === marketId);
    return found?.bettingCutoff || null;
  }, [allGainerMarkets, marketId]);

  const serverResolutionDeadline = useMemo(() => {
    if (!allGainerMarkets) return null;
    const found = allGainerMarkets.find((m: any) => m.id === marketId);
    return found?.endAt || null;
  }, [allGainerMarkets, marketId]);

  const marketState = useMarketCycle({ bettingCutoff: serverCutoff, resolutionDeadline: serverResolutionDeadline });
  const isMarketClosed = marketState.status !== "OPEN";
  const closedMarketMessage = useMemo(() => {
    return getClosedMarketMessage({
      bettingCutoff: serverCutoff,
      resolutionDeadline: serverResolutionDeadline,
    });
  }, [serverCutoff, serverResolutionDeadline]);

  const { data: userBets } = useQuery<any[]>({
    queryKey: ["/api/me/bets"],
    enabled: !!user,
  });

  const market = useMemo(() => {
    if (!allGainerMarkets) return null;
    return allGainerMarkets.find((m: any) => m.id === marketId) || null;
  }, [allGainerMarkets, marketId]);

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

  const totalPool = useMemo(() => {
    if (!market) return 0;
    const entries = market.entries || [];
    return (
      entries.reduce((sum: number, e: any) => sum + Number(e.totalStake || 0), 0) +
      Number(market.seedVolume || 0)
    );
  }, [market]);

  const totalParticipants = useMemo(() => {
    if (!market) return 0;
    return (
      (Number(market.activeParticipantCount || 0) || 0) +
      Number(market.seedConfig?.participants || 0)
    );
  }, [market]);

  const userBet = useMemo(() => {
    if (!userBets || !marketId) return null;
    return userBets.find((b: any) => b.marketId === marketId) || null;
  }, [userBets, marketId]);

  const userPick = useMemo(() => {
    if (!userBet) return null;
    return candidates.find((c) => c.entryId === userBet.entryId) || null;
  }, [userBet, candidates]);

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

  const maxGain = useMemo(
    () => Math.max(...candidates.map((c) => Math.abs(c.percentGain)), 1),
    [candidates]
  );

  const handleCandidateSelect = useCallback(
    (candidate: GainerCandidate) => {
      if (userPick) return;
      if (isMarketClosed) {
        return;
      }
      setPendingSelection({
        type: "gainer",
        marketId,
        entryId: candidate.entryId || "",
        choice: candidate.name,
        marketName: `Category Race: ${categoryLabel}`,
        candidatePercentGain: candidate.percentGain,
        bettingCutoff: market?.bettingCutoff || null,
      } as StakeSelection);
      setStakeModalOpen(true);
    },
    [isMarketClosed, userPick, marketId, categoryLabel]
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

  const { timeRemaining } = marketState;
  const pad = (n: number) => String(n).padStart(2, "0");

  if (isLoading) {
    return (
      <div className="min-h-screen bg-background">
        <div className="max-w-3xl mx-auto px-4 py-8 space-y-4">
          <Skeleton className="h-8 w-48" />
          <Skeleton className="h-32 w-full rounded-xl" />
          <Skeleton className="h-64 w-full rounded-xl" />
        </div>
      </div>
    );
  }

  if (!market) {
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
    <div className="min-h-screen bg-background pb-24">
      {/* Sticky Header */}
      <header className="sticky top-0 z-50 bg-background/95 backdrop-blur-md border-b border-border/50">
        <div className="max-w-3xl mx-auto px-4 h-14 flex items-center gap-3">
          <button
            onClick={() => setLocation("/predict")}
            className="p-1.5 rounded-lg hover:bg-muted transition-colors"
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
          <XpPill size="sm" />
          <UserMenu />
        </div>
      </header>

      <div className="max-w-3xl mx-auto px-4 pt-4 space-y-4">
        {/* Hero Stats */}
        <Card className="relative overflow-hidden border-violet-500/30 dark:border-violet-500/20">
          <div className="absolute inset-0 bg-gradient-to-r from-violet-500/5 via-transparent to-fuchsia-500/5" />
          <div className="relative p-4 md:p-5">
            <div className="flex items-center gap-2 mb-3">
              <CategoryPill category={normalizeMarketCategory(market.category || "misc")} />
              <Tooltip>
                <TooltipTrigger asChild>
                  <span className="text-xs text-muted-foreground flex items-center gap-1 cursor-help">
                    <TrendingUp className="h-3 w-3" />
                    Biggest Mover Wins
                    <HelpCircle className="h-3 w-3" />
                  </span>
                </TooltipTrigger>
                <TooltipContent className="max-w-[260px]">
                  <p className="text-xs">
                    Pick who will have the highest % gain in their Trend Score by
                    Sunday close. The biggest mover wins -- not the highest ranked.
                  </p>
                </TooltipContent>
              </Tooltip>
            </div>

            <div className="grid grid-cols-3 gap-3 text-center">
              <div>
                <p className="text-lg md:text-xl font-bold text-violet-600 dark:text-violet-400">
                  {totalPool.toLocaleString("en-US")}
                </p>
                <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Pool</p>
              </div>
              <div>
                <p className="text-lg md:text-xl font-bold">{candidates.length}</p>
                <p className="text-[10px] text-muted-foreground uppercase tracking-wider">
                  Runners
                </p>
              </div>
              <div>
                <p className="text-lg md:text-xl font-bold">{totalParticipants}</p>
                <p className="text-[10px] text-muted-foreground uppercase tracking-wider">
                  Participants
                </p>
              </div>
            </div>
          </div>
        </Card>

        {/* Your Position */}
        {userPick && userBet && (
          <Card className="border-green-500/40 dark:border-green-500/30 bg-green-500/8 dark:bg-green-500/5">
            <div className="p-4">
              <p className="text-xs font-semibold text-green-700 dark:text-green-500 uppercase tracking-wider mb-2">
                Your Position
              </p>
              <div className="flex items-center gap-3">
                <PersonAvatar
                  name={userPick.name}
                  avatar={userPick.avatar}
                  className="h-14 w-14"
                />
                <div className="flex-1 min-w-0">
                  <p className="font-semibold text-sm">{userPick.name}</p>
                  <div className="flex items-center gap-2 mt-0.5">
                    <Badge
                      variant="outline"
                      className={
                        userPick.percentGain >= 0
                          ? "text-green-700 dark:text-green-500 border-green-500/40 dark:border-green-500/30"
                          : "text-red-700 dark:text-red-500 border-red-500/40 dark:border-red-500/30"
                      }
                    >
                      {formatSignedPercent(userPick.percentGain)}
                    </Badge>
                    {userPickRank && (
                      <span className="text-xs text-muted-foreground">
                        Rank #{userPickRank} of {candidates.length}
                      </span>
                    )}
                  </div>
                </div>
                <div className="text-right">
                  <p className="text-xs text-muted-foreground">Stake</p>
                  <p className="font-semibold text-sm">
                    {Number(userBet.amount || 0).toLocaleString("en-US")}
                  </p>
                </div>
              </div>
            </div>
          </Card>
        )}

        {/* Race Leaderboard */}
        <div>
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-semibold flex items-center gap-1.5">
              <BarChart3 className="h-4 w-4 text-violet-600 dark:text-violet-400" />
              Race Leaderboard
            </h2>
            <span className="text-xs text-muted-foreground">
              {candidates.length} candidates
            </span>
          </div>

          <div className="relative mb-3">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder={`Search ${categoryLabel} candidates...`}
              className="pl-9"
            />
          </div>

          <div className="space-y-1.5">
            {filteredCandidates.map((candidate, i) => {
              const globalIdx = candidates.indexOf(candidate);
              const isLeader = globalIdx === 0;
              const isUserPick = userPick?.entryId === candidate.entryId;
              const canSelect = !userPick;

              return (
                <ClosedMarketActionTrigger
                  key={candidate.entryId || candidate.name}
                  isClosed={isMarketClosed && canSelect}
                  message={closedMarketMessage}
                  side="top"
                  align="center"
                >
                  <div
                    className={`flex items-center gap-3 p-3 rounded-lg transition-colors relative overflow-hidden ${
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
                  {/* Relative gain bar */}
                  <div
                    className="absolute inset-y-0 left-0 bg-green-500/8 transition-all"
                    style={{
                      width: `${Math.max(
                        (Math.abs(candidate.percentGain) / maxGain) * 100,
                        3
                      )}%`,
                    }}
                  />

                  <div className="relative flex items-center gap-3 flex-1 min-w-0">
                    {/* Rank */}
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

                    {/* Avatar */}
                    <PersonAvatar
                      name={candidate.name}
                      avatar={candidate.avatar}
                      className="h-14 w-14"
                    />

                    {/* Name + meta */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5">
                        <span className="text-sm font-medium truncate">{candidate.name}</span>
                        {isUserPick && (
                          <Badge className="bg-green-600/20 text-green-700 dark:text-green-500 border-green-500/40 dark:border-green-500/30 text-[9px] px-1.5 py-0">
                            Your Pick
                          </Badge>
                        )}
                      </div>
                      <div className="flex items-center gap-1.5 mt-0.5">
                        {candidate.rank ? (
                          <span className="text-[10px] text-muted-foreground font-mono">
                            #{candidate.rank} on board
                          </span>
                        ) : null}
                        <span className="text-[10px] text-muted-foreground/40">&middot;</span>
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

                  {/* Gain % */}
                  <div className="relative text-right shrink-0">
                    <p
                      className={`text-base font-mono font-bold ${
                        candidate.percentGain >= 0 ? "text-green-700 dark:text-green-500" : "text-red-700 dark:text-red-500"
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
                No candidates match "{searchQuery}"
              </div>
            )}
          </div>
        </div>

        {/* Race Insights */}
        <Card className="border-border/50">
          <div className="p-4">
            <h2 className="text-sm font-semibold flex items-center gap-1.5 mb-3">
              <Zap className="h-4 w-4 text-amber-600 dark:text-amber-400" />
              Race Insights
            </h2>

            {/* Pool Distribution */}
            <div className="mb-4">
              <p className="text-xs text-muted-foreground mb-2 font-medium uppercase tracking-wider">
                Pool Distribution
              </p>
              <div className="space-y-1.5">
                {candidates.slice(0, 5).map((c) => {
                  const stakeTotal = candidates.reduce(
                    (sum, x) => sum + (x.totalStake || 0),
                    0
                  );
                  const pct =
                    stakeTotal > 0
                      ? Math.round(((c.totalStake || 0) / stakeTotal) * 100)
                      : 0;
                  return (
                    <div key={c.entryId || c.name} className="flex items-center gap-2">
                      <PersonAvatar name={c.name} avatar={c.avatar} className="h-6 w-6" />
                      <span className="text-xs truncate flex-1">{c.name}</span>
                      <div className="w-24 h-2 rounded-full bg-muted overflow-hidden">
                        <div
                          className="h-full bg-violet-500/60 rounded-full transition-all"
                          style={{ width: `${Math.max(pct, 2)}%` }}
                        />
                      </div>
                      <span className="text-[10px] text-muted-foreground font-mono w-8 text-right">
                        {pct}%
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Momentum */}
            <div>
              <p className="text-xs text-muted-foreground mb-2 font-medium uppercase tracking-wider">
                Momentum (24h vs Weekly)
              </p>
              <div className="space-y-1.5">
                {candidates
                  .filter((c) => c.change24h != null)
                  .slice(0, 5)
                  .map((c) => {
                    const momentum24h = c.change24h ?? 0;
                    const isAccelerating =
                      c.percentGain > 0 && momentum24h > c.percentGain / 7;
                    return (
                      <div key={c.entryId || c.name} className="flex items-center gap-2">
                        <PersonAvatar name={c.name} avatar={c.avatar} className="h-6 w-6" />
                        <span className="text-xs truncate flex-1">{c.name}</span>
                        <Badge
                          variant="outline"
                          className={`text-[9px] ${
                            isAccelerating
                              ? "text-green-700 dark:text-green-500 border-green-500/40 dark:border-green-500/30"
                              : "text-orange-600 dark:text-orange-400 border-orange-500/40 dark:border-orange-500/30"
                          }`}
                        >
                          {isAccelerating ? "Accelerating" : "Steady"}
                        </Badge>
                        <span className="text-[10px] font-mono text-muted-foreground">
                          {momentum24h >= 0 ? "+" : ""}
                          {momentum24h.toFixed(1)}% 24h
                        </span>
                      </div>
                    );
                  })}
                {candidates.filter((c) => c.change24h != null).length === 0 && (
                  <p className="text-xs text-muted-foreground">
                    Momentum data will appear as the week progresses.
                  </p>
                )}
              </div>
            </div>
          </div>
        </Card>
      </div>

      {/* Sticky Bottom CTA */}
      <div className="fixed bottom-0 left-0 right-0 z-40 border-t border-border/50 bg-background/95 backdrop-blur-md">
        <div className="max-w-3xl mx-auto px-4 py-3">
          {userPick ? (
            <div className="flex items-center gap-3">
              <div className="flex-1 min-w-0">
                <p className="text-xs text-muted-foreground">Your pick</p>
                <p className="text-sm font-semibold truncate">{userPick.name}</p>
              </div>
              <Badge
                className={
                  userPick.percentGain >= 0
                    ? "bg-green-600/20 text-green-700 dark:text-green-500 border-green-500/40 dark:border-green-500/30"
                    : "bg-red-600/20 text-red-700 dark:text-red-500 border-red-500/40 dark:border-red-500/30"
                }
              >
                {formatSignedPercent(userPick.percentGain)}
              </Badge>
              <span className="text-xs text-muted-foreground">
                #{userPickRank}/{candidates.length}
              </span>
            </div>
          ) : (
            <ClosedMarketActionTrigger isClosed={isMarketClosed} message={closedMarketMessage} side="top" align="center">
              <Button
                className="w-full bg-gradient-to-r from-violet-600 to-fuchsia-600 text-white py-3 h-auto text-base font-semibold"
                onClick={() => {
                  document.querySelector("input")?.focus();
                  window.scrollTo({ top: 300, behavior: "smooth" });
                }}
              >
                <Trophy className="h-5 w-5 mr-2" />
                Choose Candidate
              </Button>
            </ClosedMarketActionTrigger>
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
