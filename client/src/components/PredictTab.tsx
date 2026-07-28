import { useState, useMemo, useCallback, type ReactNode } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { StakeModal, type StakeSelection } from "@/components/StakeModal";
import { JackpotEntryModal } from "@/components/JackpotEntryModal";
import { useMarketCycle } from "@/hooks/useMarketCycle";
import { MarketCycleHero } from "@/components/MarketCycleHero";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { pricesFor, snapshotFromApi } from "@/lib/ammClient";
import { useAuth } from "@/contexts/AuthContext";
import { useXpBurst } from "@/components/XpBurstProvider";
import { useLocation, Link } from "wouter";
import { navigateToLogin } from "@/lib/authReturn";
import { toast } from "sonner";
import { dismissVoteToast, showPendingVoteToast, showVoteToast } from "@/lib/vote-toast";
import { apiRequest, parseApiError } from "@/lib/queryClient";
import { useIdempotencyKey } from "@/lib/useIdempotencyKey";
import { getClosedMarketMessage, isCommunityTradingClosed } from "@/lib/marketClosedMessaging";
import { getMarketBaselineScore } from "@/lib/predict-market-baseline";
import { getCanonicalNativeCycle } from "@/lib/nativeMarketLifecycle";
import { fireAmmTradeToast } from "@/lib/share-data";
import { formatVox } from "@/lib/currency";
import { useShareCard } from "@/contexts/ShareCardContext";
import type { ClosedMarketMessage } from "@/lib/marketClosedMessaging";
import { PredictCard } from "@/components/predict/PredictCard";
import { WeeklyUpDownCard, type PredictionMarket } from "@/components/predict/WeeklyUpDownCard";
import { pendingWeeklyUpDownPositionFromBet } from "@/components/predict/WeeklyUpDownYourPositionPanel";
import { HeadToHeadCard, h2hUserPickFromBet, type HeadToHeadMarket } from "@/components/predict/HeadToHeadCard";
import {
  TopGainerCard,
  categoryRacePredictionSummaryFromBet,
  type TopGainerMarket,
  type GainerCandidate,
} from "@/components/predict/TopGainerCard";
import { OpenMarketCard } from "@/components/predict/OpenMarketCard";
import { WeeklyJackpotHero } from "@/components/predict/WeeklyJackpotHero";
import { topPositionByMarket, positionTotalsByMarket, type AmmOpenPositionLike } from "@/lib/ammPositionMaps";
import { StepModal } from "@/components/StepModal";
import { PREDICT_RULES_STEPS } from "@/components/rulesStepData";
import { useCategoryRaceMap } from "@/hooks/useCategoryRaceMap";
import { useLeaderboardCategories } from "@/hooks/useLeaderboardCategories";
import {
  TrendingUp,
  ChevronRight,
  Scale,
  Swords,
  HelpCircle,
  Loader2,
  Trophy,
} from "lucide-react";
import { UnifiedSectionHeader } from "@/components/UnifiedSectionHeader";
import { normalizeMarketCategory, getMarketCategoryLabel, type FilterCategory } from "@shared/constants";

interface PredictTabProps {
  personId: string;
  personName: string;
  personAvatar?: string;
  currentScore: number;
  personRank?: number | null;
  /** Induction profiles only show World Markets (no native trend-score markets). */
  variant?: "full" | "induction";
  /** Inline Vote to Induct card rendered in the induction empty state. */
  inductionVoteSlot?: ReactNode;
}

/**
 * Minimal shape of `/api/me/amm-positions` for profile Predict-tab cards.
 * Shared aggregators live in `ammPositionMaps.ts`.
 */
interface PredictTabAmmOpenPosition extends AmmOpenPositionLike {
  entryId: string;
}

/** Center 1–2 cards; use 3-column grid when there are 3+ cards. */
function predictSectionGridClass(n: number): { container: string; item: string } {
  if (n <= 0) return { container: "grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4", item: "" };
  if (n === 1) return { container: "flex justify-center", item: "w-full max-w-sm" };
  if (n === 2) return { container: "flex flex-col sm:flex-row flex-wrap justify-center gap-4", item: "w-full max-w-sm" };
  return { container: "grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4", item: "" };
}

type CategoryFilter = FilterCategory;

function SectionHeader({ 
  icon, 
  title, 
  subtitle, 
  count,
  onViewAll,
  showViewAll = false,
  infoTooltip,
  meta,
  subtitleMeta
}: { 
  icon: React.ReactNode;
  title: string; 
  subtitle: string;
  count?: number;
  onViewAll?: () => void;
  showViewAll?: boolean;
  infoTooltip?: string;
  meta?: React.ReactNode;
  subtitleMeta?: React.ReactNode;
}) {
  const actions = (
    <div className="flex items-center gap-2">
      {infoTooltip && (
        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant="ghost" size="icon" className="text-violet-600 dark:text-violet-400 hover:text-violet-600 dark:hover:text-violet-400" aria-label="How it works">
              <HelpCircle className="h-5 w-5" />
            </Button>
          </TooltipTrigger>
          <TooltipContent className="bg-popover dark:bg-slate-900/95 border-border dark:border-slate-700 text-popover-foreground dark:text-slate-200 text-xs max-w-xs">
            {infoTooltip}
          </TooltipContent>
        </Tooltip>
      )}
      {showViewAll && onViewAll && (
        <Button 
          variant="ghost" 
          size="sm" 
          onClick={onViewAll}
          className="text-violet-700 dark:text-violet-500 shrink-0"
          data-testid="button-view-all-community"
        >
          View all
          <ChevronRight className="h-4 w-4 ml-1" />
        </Button>
      )}
    </div>
  );

  return (
    <UnifiedSectionHeader
      title={title}
      titleAddon={count !== undefined ? <Badge variant="secondary" className="text-xs">{count}</Badge> : undefined}
      subtitle={subtitle}
      icon={icon}
      accent="violet"
      actions={actions}
      meta={meta}
      subtitleMeta={subtitleMeta}
    />
  );
}

export function PredictTab({
  personId,
  personName,
  personAvatar,
  currentScore,
  personRank,
  variant = "full",
  inductionVoteSlot,
}: PredictTabProps) {
  const isInduction = variant === "induction";
  const [jackpotModalOpen, setJackpotModalOpen] = useState(false);
  const [rulesModalOpen, setRulesModalOpen] = useState<string | null>(null);
  const [visibleWorldCount, setVisibleWorldCount] = useState(3);

  const { data: nativeUpdownData, isLoading: updownLoading } = useQuery<any[]>({
    queryKey: ['/api/native-markets/updown'],
    enabled: !isInduction,
  });
  const { data: nativeH2hData, isLoading: h2hLoading } = useQuery<any[]>({
    queryKey: ['/api/native-markets/h2h'],
    enabled: !isInduction,
  });
  const { data: nativeGainerData, isLoading: gainerLoading } = useQuery<any[]>({
    queryKey: ['/api/native-markets/gainer'],
    enabled: !isInduction,
  });
  const { data: nativeJackpotData, isLoading: jackpotLoading } = useQuery<any[]>({
    queryKey: ['/api/native-markets/jackpot'],
    enabled: !isInduction,
  });

  const { serverBettingCutoff, serverResolutionDeadline } = useMemo(() => {
    const allNative = [
      ...(nativeUpdownData || []),
      ...(nativeH2hData || []),
      ...(nativeGainerData || []),
      ...(nativeJackpotData || []),
    ];
    const canonical = getCanonicalNativeCycle(allNative);
    return { serverBettingCutoff: canonical.bettingCutoff, serverResolutionDeadline: canonical.resolutionDeadline };
  }, [nativeUpdownData, nativeH2hData, nativeGainerData, nativeJackpotData]);

  const marketCycle = useMarketCycle({ bettingCutoff: serverBettingCutoff, resolutionDeadline: serverResolutionDeadline });
  const isMarketClosed = marketCycle.status !== "OPEN";
  const closedMarketMessage = useMemo(() => {
    return getClosedMarketMessage({
      bettingCutoff: serverBettingCutoff,
      resolutionDeadline: serverResolutionDeadline,
    });
  }, [serverBettingCutoff, serverResolutionDeadline]);
  const { data: openMarketsData, isLoading: openMarketsLoading } = useQuery<any[]>({ queryKey: ['/api/open-markets'] });

  const isLoading = isInduction
    ? openMarketsLoading
    : updownLoading || h2hLoading || gainerLoading || jackpotLoading || openMarketsLoading;

  const weeklyMarket = useMemo((): PredictionMarket | undefined => {
    const toTimestamp = (value: unknown, fallback: number) => {
      if (!value) return fallback;
      const ts = Date.parse(String(value));
      return Number.isFinite(ts) ? ts : fallback;
    };

    const candidateMarkets = (nativeUpdownData || [])
      .filter((m: any) => m.visibility === "live" && m.personId === personId)
      .slice()
      .sort((a: any, b: any) => {
        const aEnd = toTimestamp(a.endAt, Number.POSITIVE_INFINITY);
        const bEnd = toTimestamp(b.endAt, Number.POSITIVE_INFINITY);
        if (aEnd !== bEnd) return aEnd - bEnd;

        const aCreated = toTimestamp(a.createdAt, 0);
        const bCreated = toTimestamp(b.createdAt, 0);
        if (aCreated !== bCreated) return bCreated - aCreated;

        return String(a.id || "").localeCompare(String(b.id || ""));
      });

    const m = candidateMarkets[0];
    if (!m) return undefined;

    const person = m.person || {};
    const entries = m.entries || [];
    const upEntry = entries.find((e: any) => e.label?.toLowerCase() === "up");
    const downEntry = entries.find((e: any) => e.label?.toLowerCase() === "down");
    const upStake = Number(upEntry?.totalStake || 0);
    const downStake = Number(downEntry?.totalStake || 0);
    const total = upStake + downStake || 1;
    const upPercent = Math.round((upStake / total) * 100);
    const cs = Number(person.trendScore || person.fameIndex || 0);
    const baselineScore = getMarketBaselineScore(m, cs) ?? cs;
    return {
      id: m.id,
      personId: m.personId || "",
      personName: person.name || m.title?.replace(/: Up or Down\?$/, "") || "Unknown",
      personAvatar: person.avatar || "",
      currentScore: cs,
      baselineScore,
      startScore: baselineScore,
      change7d: Number(person.change7d || 0),
      endTime: "",
      upPoolPercent: upPercent || 50,
      category: normalizeMarketCategory(m.category || person.category || "misc") as CategoryFilter,
      upEntryId: upEntry?.id,
      downEntryId: downEntry?.id,
      startAt: m.startAt,
      endAt: m.endAt,
      bettingCutoff: m.bettingCutoff || null,
      engine: "amm",
      ammState: m.ammState ?? null,
    };
  }, [nativeUpdownData, personId]);

  const h2hBattles = useMemo((): HeadToHeadMarket[] => {
    const dbMarkets = (nativeH2hData || []).filter((m: any) => m.visibility === "live");
    const all: HeadToHeadMarket[] = dbMarkets.map((m: any) => {
      const entries = m.entries || [];
      const e1 = entries[0] || {};
      const e2 = entries[1] || {};
      const p1 = e1.person || {};
      const p2 = e2.person || {};
      const s1 = Number(e1.totalStake || 0);
      const s2 = Number(e2.totalStake || 0);
      const total = s1 + s2 || 1;
      return {
        id: m.id,
        title: m.title || `${p1.name || "?"} vs ${p2.name || "?"}`,
        person1: { name: p1.name || e1.label || "?", avatar: p1.avatar || "", currentScore: Number(p1.trendScore || 0) },
        person2: { name: p2.name || e2.label || "?", avatar: p2.avatar || "", currentScore: Number(p2.trendScore || 0) },
        person1Id: e1.personId || "",
        person2Id: e2.personId || "",
        person1EntryId: e1.id,
        person2EntryId: e2.id,
        person1EntryLabel: typeof e1.label === "string" ? e1.label : undefined,
        person2EntryLabel: typeof e2.label === "string" ? e2.label : undefined,
        category: normalizeMarketCategory(m.category || "misc") as CategoryFilter,
        endTime: "",
        endAt: m.endAt || null,
        startAt: m.startAt || null,
        bettingCutoff: m.bettingCutoff || null,
        person1Percent: (s1 + s2) === 0 ? 50 : Math.round((s1 / total) * 100),
        totalBets: Number(m.activeParticipantCount || 0) || 0,
        activeParticipantCount: Number(m.activeParticipantCount || 0),
        recentParticipants: m.recentParticipants || [],
        modelP1Percent: typeof m.modelP1Percent === "number" ? m.modelP1Percent : undefined,
        modelConfidence: m.modelConfidence ?? undefined,
        engine: "amm",
        ammState: m.ammState ?? null,
        volume: Number(m.volume ?? m.ammState?.totalUserCreditsIn ?? 0) || 0,
      };
    });
    return all.filter(h => h.person1Id === personId || h.person2Id === personId);
  }, [nativeH2hData, personId]);

  const gainerMarkets = useMemo((): TopGainerMarket[] => {
    const dbMarkets = (nativeGainerData || []).filter((m: any) => m.visibility === "live");
    const all: TopGainerMarket[] = dbMarkets.map((m: any) => {
      const entries = m.entries || [];
      const openingScoresMap = new Map<string, number>();
      const rawOpeningScores = (m.metadata as any)?.openingScores;
      if (Array.isArray(rawOpeningScores)) {
        for (const os of rawOpeningScores) {
          if (os.personId && os.score > 0) openingScoresMap.set(os.personId, os.score);
        }
      }

      const allCandidates: GainerCandidate[] = entries.map((e: any) => {
        const p = e.person || {};
        const currentScore = Number(p.trendScore || 0);
        const openScore = openingScoresMap.get(e.personId || "");
        const pctGain = openScore && openScore > 0
          ? ((currentScore - openScore) / openScore) * 100
          : Number(p.change7d || 0);
        const ptsAdded = openScore && openScore > 0
          ? currentScore - openScore
          : pctGain * currentScore / 100;
        return {
          name: p.name || e.label || "?",
          avatar: p.avatar || "",
          currentGain: ptsAdded,
          percentGain: Math.round(pctGain * 10) / 10,
          rank: Number(p.rank || 0),
          entryId: e.id,
          personId: e.personId || "",
          totalStake: Number(e.totalStake || 0),
        };
      }).sort((a: GainerCandidate, b: GainerCandidate) => b.percentGain - a.percentGain);
      return {
        id: m.id,
        category: normalizeMarketCategory(m.category || "misc") as CategoryFilter,
        leaders: allCandidates.slice(0, 3),
        allCandidates,
        endTime: "",
        endAt: m.endAt || null,
        startAt: m.startAt || null,
        bettingCutoff: m.bettingCutoff || null,
        totalEntries: entries.length,
        candidateCount: allCandidates.length,
        teaser: typeof m.teaser === "string" && m.teaser.trim() ? m.teaser.trim() : null,
        engine: "amm" as const,
        ammState: m.ammState ?? null,
      };
    });
    return all.filter(g => (g.allCandidates || g.leaders).some(l => l.personId === personId));
  }, [nativeGainerData, personId]);

  const openMarketsForPerson = useMemo(() => {
    return (openMarketsData || [])
      .filter((m: any) => m.visibility === "live")
      .filter((m: any) => m.personId === personId || (m.relatedPersonIds || []).includes(personId));
  }, [openMarketsData, personId]);

  const jackpotMarket = useMemo(() => {
    if (!nativeJackpotData) return null;
    return nativeJackpotData.find(
      (m: any) => m.personId === personId && m.status === "OPEN" && m.visibility === "live"
    ) || null;
  }, [nativeJackpotData, personId]);

  const hasAnyMarkets = isInduction
    ? openMarketsForPerson.length > 0
    : !!(weeklyMarket || h2hBattles.length > 0 || gainerMarkets.length > 0 || openMarketsForPerson.length > 0 || jackpotMarket);

  const { user, profile, refreshProfile } = useAuth();
  const { trigger: triggerXpBurst } = useXpBurst();
  // Sprint 3.1: PersonDetail predict tab buys fire AMM trade toasts
  // with a Share action via the global ShareCard modal.
  const { openShareCard } = useShareCard();
  const queryClient = useQueryClient();
  const [, setLocation] = useLocation();
  const [pendingSelection, setPendingSelection] = useState<StakeSelection | null>(null);
  const [stakeModalOpen, setStakeModalOpen] = useState(false);
  // Idempotency key for the active trade-modal intent. See
  // `client/src/lib/useIdempotencyKey.ts`. Mirrors PredictPage's
  // dependency set.
  const tradeIdempotencyKey = useIdempotencyKey(stakeModalOpen, [
    pendingSelection?.marketId,
    pendingSelection?.entryId,
  ]);
  const walletCredits = profile?.predictCredits ?? 0;

  const { data: userPredictionsData } = useQuery<any>({
    queryKey: ["/api/me/predictions"],
    enabled: !!user,
  });

  // Live AMM open positions for the signed-in user. Drives the
  // `unrealisedPnl` banner on UpDown / H2H / race cards on this
  // profile tab so the P&L matches what `PredictPage` already shows
  // on the main markets surface. Auth-gated and tab-aware (pauses
  // when the document is hidden) — same shape as the query in
  // `PredictPage` and `PredictionsPage`. Buy / sell mutations below
  // already invalidate this key on success, so post-trade rehydrate
  // is automatic.
  const { data: ammPositionsData } = useQuery<{ positions: PredictTabAmmOpenPosition[] }>({
    queryKey: ["/api/me/amm-positions"],
    enabled: !!user,
    refetchInterval: () => (typeof document !== "undefined" && document.hidden ? false : 60_000),
  });
  const ammPositionByMarket = useMemo(
    () => topPositionByMarket(ammPositionsData?.positions ?? []),
    [ammPositionsData],
  );
  const ammPositionTotalsByMarket = useMemo(
    () => positionTotalsByMarket(ammPositionsData?.positions ?? []),
    [ammPositionsData],
  );

  const openMarketBets = useMemo(() => {
    const map = new Map<
      string,
      { result: string; payout: number; entryLabel: string; stakeAmount: number; marketId: string; entryId?: string }
    >();
    const betsArray = Array.isArray(userPredictionsData) ? userPredictionsData : (userPredictionsData as any)?.predictions ?? [];
    const grouped = new Map<string, any[]>();
    for (const b of betsArray) {
      const mid = String(b.marketId);
      const arr = grouped.get(mid) || [];
      arr.push(b);
      grouped.set(mid, arr);
    }
    grouped.forEach((bets, marketId) => {
      const totalStake = bets.reduce((s: number, b: any) => s + b.stakeAmount, 0);
      const totalPayout = bets.reduce((s: number, b: any) => s + (b.payout || 0), 0);
      const uniqueEntries = new Set(bets.map((b: any) => b.entryLabel));
      const entryLabel = uniqueEntries.size === 1 ? bets[0].entryLabel : "Multiple positions";
      const uniqueEntryIds = new Set(bets.map((b: any) => b.entryId).filter(Boolean));
      const entryId = uniqueEntryIds.size === 1 ? ([...uniqueEntryIds][0] as string) : undefined;
      const results = new Set(bets.map((b: any) => b.result));
      let result = "pending";
      if (results.has("won") && !results.has("lost")) result = "won";
      else if (results.has("lost") && !results.has("won")) result = "lost";
      else if (results.has("won") && results.has("lost")) result = "won";
      else if (results.has("refunded") && results.size === 1) result = "refunded";
      else result = bets[0].result;
      const key = String(marketId);
      map.set(key, { result, payout: totalPayout, entryLabel, stakeAmount: totalStake, marketId: key, entryId });
    });
    return map;
  }, [userPredictionsData]);

  // Per-(market, entry) aggregate of the user's active stakes split by
  // direction. Mirrors the shape used by PredictPage so consumers
  // (OpenMarketCard) can read both sides — needed for the no-hedging
  // guard which has to detect "user already has a No on this entry".
  const userBetsPerEntry = useMemo(() => {
    const map = new Map<string, Map<string, { yesStake: number; noStake: number }>>();
    const betsArray = Array.isArray(userPredictionsData) ? userPredictionsData : (userPredictionsData as any)?.predictions ?? [];
    for (const b of betsArray as any[]) {
      if (!b.marketId || !b.entryId) continue;
      const mId = String(b.marketId);
      const eId = String(b.entryId);
      let inner = map.get(mId);
      if (!inner) { inner = new Map(); map.set(mId, inner); }
      const dir = b.direction === "no" ? "no" : "yes";
      const prev = inner.get(eId) ?? { yesStake: 0, noStake: 0 };
      inner.set(eId, {
        yesStake: prev.yesStake + (dir === "yes" ? (b.stakeAmount || 0) : 0),
        noStake: prev.noStake + (dir === "no" ? (b.stakeAmount || 0) : 0),
      });
    }
    return map;
  }, [userPredictionsData]);

  const categoryRaceMap = useCategoryRaceMap();
  const leaderboardCategories = useLeaderboardCategories();
  const handleCategoryFilter = (_category: string) => setLocation("/predict");

  const updownBetMutation = useMutation({
    mutationFn: async ({
      marketId,
      entryId,
      stakeAmount,
      maxPricePerShare,
    }: {
      marketId: string;
      entryId: string;
      stakeAmount: number;
      maxPricePerShare?: number;
    }) => {
      const res = await apiRequest(
        "POST",
        `/api/native-markets/updown/${marketId}/bet`,
        { entryId, stakeAmount, ...(maxPricePerShare != null ? { maxPricePerShare } : {}) },
        { idempotencyKey: tradeIdempotencyKey },
      );
      return res.json();
    },
    onMutate: () => {
      const toastId = showPendingVoteToast("updown", "Prediction submitted!");
      return { toastId };
    },
    onSuccess: async (data: any, variables, context) => {
      let entryLabel = "Up";
      if (variables.entryId === weeklyMarket?.downEntryId) entryLabel = "Down";
      else if (variables.entryId === weeklyMarket?.upEntryId) entryLabel = "Up";

      // Sprint 3.1: AMM-aware share toast on PersonDetail predict tab.
      // The dedicated detail pages already do this; the tab was still
      // on the legacy static description.
      if (data?.engine === "amm" && weeklyMarket) {
        const origin =
          typeof window !== "undefined" ? window.location.origin : "";
        fireAmmTradeToast({
          response: data,
          actionType: "buy",
          username: profile?.username || "you",
          personName: weeklyMarket.personName ?? null,
          personAvatar: weeklyMarket.personAvatar ?? null,
          marketTitle: `${weeklyMarket.personName}: Up or Down?`,
          category: weeklyMarket.category,
          entryLabel: entryLabel.toUpperCase(),
          direction: entryLabel.toLowerCase() === "down" ? "down" : "up",
          marketKind: "updown",
          openShareCard,
          fallbackShareUrl: `${origin}/predict/updown/${weeklyMarket.id}`,
          toastId: context?.toastId,
        });
      } else {
        showVoteToast("updown", "Prediction placed!", {
          id: context?.toastId,
          description: "Your weekly up/down prediction has been recorded.",
        });
      }
      setStakeModalOpen(false);
      setPendingSelection(null);

      const seededStats = {
        total: 1,
        won: 0,
        lost: 0,
        refunded: 0,
        pending: 1,
        netCredits: 0,
        winRate: 0,
        bestCategory: null,
        currentStreak: 0,
      };

      queryClient.setQueryData(["/api/me/predictions"], (old: any) => {
        const mid = String(variables.marketId);
        const newBet = {
          betId: `optimistic-${Date.now()}`,
          marketId: mid,
          entryId: variables.entryId,
          entryLabel,
          stakeAmount: variables.stakeAmount,
          result: "pending" as const,
          payout: 0,
          direction: null,
        };
        if (old == null) {
          return { predictions: [newBet], stats: seededStats };
        }
        if (Array.isArray(old)) {
          const already = old.some((b: any) => String(b.marketId) === mid);
          return already ? old : [...old, newBet];
        }
        const preds = old.predictions ?? [];
        const already = preds.some((b: any) => String(b.marketId) === mid);
        if (already) return old;
        return { ...old, predictions: [...preds, newBet] };
      });

      await Promise.all([
        refreshProfile?.(),
        queryClient.invalidateQueries({ queryKey: ["/api/native-markets/updown"] }),
        queryClient.invalidateQueries({ queryKey: ["/api/me/predictions"] }),
        queryClient.invalidateQueries({ queryKey: ["/api/profile/me"] }),
      ]);
    },
    onError: (err: Error, _variables, context) => {
      dismissVoteToast(context?.toastId);
      const { title, description } = parseApiError(err, "Failed to place prediction");
      toast.error(title, { description });
    },
  });

  /**
   * Phase C1 (PredictTab parity): metadata passed alongside the H2H /
   * race buy mutation so the success handler can fire the same AMM
   * share-toast that PredictPage and the dedicated detail pages already
   * use. Without this, profile-tab buyers got a flat "Prediction
   * placed!" toast while the same buy from /predict produced a confetti
   * + share-card moment — a meaningful UX gap that gets worse as
   * profile traffic ramps. Fields mirror `FireAmmTradeToastArgs`.
   */
  type NativeBetToastMeta = {
    personName: string | null;
    personAvatar: string | null;
    marketTitle: string;
    category: string | null;
    entryLabel: string;
    direction: "up" | "down" | "other";
    fallbackShareUrl: string;
  };

  const nativeMarketBetMutation = useMutation({
    mutationFn: async ({
      marketId,
      entryId,
      stakeAmount,
      marketType: _marketType,
      toastMeta: _toastMeta,
      maxPricePerShare,
    }: {
      marketId: string;
      entryId: string;
      stakeAmount: number;
      marketType: string;
      toastMeta?: NativeBetToastMeta;
      maxPricePerShare?: number;
    }) => {
      const res = await apiRequest(
        "POST",
        `/api/native-markets/${marketId}/bet`,
        { entryId, stakeAmount, ...(maxPricePerShare != null ? { maxPricePerShare } : {}) },
        { idempotencyKey: tradeIdempotencyKey },
      );
      return res.json();
    },
    onMutate: (variables) => {
      const kind = variables.marketType === "h2h" ? "h2h" : "gainer";
      const toastId = showPendingVoteToast(kind, "Prediction submitted!");
      return { toastId };
    },
    onSuccess: async (data: any, variables, context) => {
      // AMM share-toast on success when we have enough metadata to
      // build a sensible share card; legacy / non-AMM paths or callers
      // that didn't pass meta still get the simple confirmation toast.
      if (data?.engine === "amm" && variables.toastMeta) {
        fireAmmTradeToast({
          response: data,
          actionType: "buy",
          username: profile?.username || "you",
          personName: variables.toastMeta.personName,
          personAvatar: variables.toastMeta.personAvatar,
          marketTitle: variables.toastMeta.marketTitle,
          category: variables.toastMeta.category,
          entryLabel: variables.toastMeta.entryLabel,
          direction: variables.toastMeta.direction,
          marketKind: variables.marketType === "h2h" ? "h2h" : "gainer",
          openShareCard,
          fallbackShareUrl: variables.toastMeta.fallbackShareUrl,
          toastId: context?.toastId,
        });
      } else {
        showVoteToast(variables.marketType === "h2h" ? "h2h" : "gainer", "Prediction placed!", {
          id: context?.toastId,
          description: variables.marketType === "h2h" ? "Your head-to-head prediction has been recorded." : "Your prediction has been recorded.",
        });
      }
      setStakeModalOpen(false);
      setPendingSelection(null);
      await Promise.all([
        refreshProfile?.(),
        queryClient.invalidateQueries({ queryKey: [`/api/native-markets/${variables.marketType}`] }),
        queryClient.invalidateQueries({ queryKey: ["/api/me/predictions"] }),
        queryClient.invalidateQueries({ queryKey: ["/api/profile/me"] }),
      ]);
    },
    onError: (err: Error, _variables, context) => {
      dismissVoteToast(context?.toastId);
      const { title, description } = parseApiError(err, "Failed to place prediction");
      toast.error(title, { description });
    },
  });

  const communityMarketBetMutation = useMutation({
    mutationFn: async ({
      slug,
      entryId,
      stakeAmount,
      direction,
      maxPricePerShare,
    }: {
      slug: string;
      entryId: string;
      stakeAmount: number;
      direction: "yes" | "no";
      maxPricePerShare?: number;
    }) => {
      const res = await apiRequest(
        "POST",
        `/api/open-markets/${slug}/bet`,
        { entryId, stakeAmount, direction, ...(maxPricePerShare != null ? { maxPricePerShare } : {}) },
        { idempotencyKey: tradeIdempotencyKey },
      );
      return res.json();
    },
    onMutate: () => {
      const toastId = showPendingVoteToast("world", "Prediction submitted!");
      return { toastId };
    },
    onSuccess: async (data: any, variables, context) => {
      if (data?.xp?.xpAwarded) {
        triggerXpBurst(data.xp.xpAwarded, undefined, data.xp.reason);
      }
      const origin = typeof window !== "undefined" ? window.location.origin : "";
      const market = openMarketsForPerson.find(
        (m: any) => String(m.slug) === String(variables.slug),
      );
      const entry =
        market?.entries?.find((e: any) => String(e.id) === String(variables.entryId)) ?? null;
      const person = entry?.person ?? null;
      const isBinary = market?.openMarketType === "binary";
      const entryLabel = isBinary
        ? variables.direction === "no"
          ? "No"
          : "Yes"
        : entry?.label ?? person?.name ?? variables.direction.toUpperCase();
      const direction: "up" | "down" | "other" = isBinary
        ? variables.direction === "no"
          ? "down"
          : "up"
        : "other";
      fireAmmTradeToast({
        response: data,
        actionType: "buy",
        username: profile?.username || "you",
        personName: person?.name ?? null,
        personAvatar: person?.avatar ?? null,
        marketTitle: market?.title ?? "World Market",
        category: market?.category ?? null,
        entryLabel: String(entryLabel),
        direction,
        marketKind: "world",
        openShareCard,
        fallbackShareUrl: market?.slug ? `${origin}/markets/${market.slug}` : origin,
        toastId: context?.toastId,
      });
      setStakeModalOpen(false);
      setPendingSelection(null);
      await Promise.all([
        refreshProfile?.(),
        queryClient.invalidateQueries({ queryKey: ["/api/open-markets"] }),
        queryClient.invalidateQueries({ queryKey: ["/api/me/predictions"] }),
        queryClient.invalidateQueries({ queryKey: ["/api/me/amm-positions"] }),
        queryClient.invalidateQueries({ queryKey: ["/api/profile/me"] }),
      ]);
    },
    onError: (err: Error, _variables, context) => {
      dismissVoteToast(context?.toastId);
      const { title, description } = parseApiError(err, "Failed to place prediction");
      toast.error(title, { description });
    },
  });

  const handleCommunityPickEntry = (market: any, entry: any, direction: "yes" | "no") => {
    if (isCommunityTradingClosed(market) || market.visibility !== "live") {
      return;
    }
    if (!user) {
      navigateToLogin(setLocation, { mode: "signup", reason: "predict_signup" });
      return;
    }

    const isBinary = market.openMarketType === "binary";
    const isDualOutcome =
      isBinary || market.openMarketType === "updown";
    const marketBets = userBetsPerEntry.get(String(market.id));

    if (isDualOutcome && marketBets) {
      for (const [eId, bets] of marketBets) {
        if (eId !== String(entry.id) && (bets.yesStake > 0 || bets.noStake > 0)) {
          toast("Stick with your pick", {
            description: "You've already backed the other side. Top up your existing pick instead.",
          });
          return;
        }
      }
    }

    const sameEntryBets = marketBets?.get(String(entry.id));
    const sameDirStake = direction === "yes" ? sameEntryBets?.yesStake ?? 0 : sameEntryBets?.noStake ?? 0;
    const oppositeStake = direction === "yes" ? sameEntryBets?.noStake ?? 0 : sameEntryBets?.yesStake ?? 0;

    if (oppositeStake > 0) {
      toast("Stick with your pick", {
        description: "You've already taken the other direction on this option. Top up your existing pick instead.",
      });
      return;
    }

    const isTopUp = sameDirStake > 0;

    const oppositeEntry =
      isDualOutcome
        ? (market.entries ?? []).find((e: any) => String(e.id) !== String(entry.id))
        : null;

    setPendingSelection({
      type: "community",
      choice: entry.label,
      marketName: market.title,
      marketId: market.id,
      entryId: entry.id,
      endAt: market.endAt,
      bettingCutoff: market.closeAt ?? market.endAt ?? null,
      direction: "yes",
      openMarketType: market.openMarketType ?? null,
      opponentName: oppositeEntry?.label,
      isTopUp,
      existingStake: isTopUp ? sameDirStake : undefined,
      engine: "amm",
      ammState: market.ammState ?? null,
    });
    refreshProfile?.();
    setStakeModalOpen(true);
  };

  const handleUpDownSelect = (market: PredictionMarket, choice: "up" | "down") => {
    if (isMarketClosed) {
      return;
    }
    if (!user) {
      toast("Sign in required", { description: "Sign in to place predictions." });
      navigateToLogin(setLocation);
      return;
    }
    const entryId = choice === "up" ? market.upEntryId : market.downEntryId;
    if (!entryId) {
      toast.error("Market unavailable", { description: "This market is missing required entries. Please try another market." });
      return;
    }
    const existing = openMarketBets.get(String(market.id));
    const userPick = existing && existing.result === "pending"
      ? (existing.entryLabel || "").toLowerCase() as "up" | "down" | string
      : null;
    const isTopUp = userPick === choice;
    setPendingSelection({
      type: "updown",
      choice: choice === "up" ? "Trend Score UP" : "Trend Score DOWN",
      marketName: market.personName,
      marketId: market.id,
      entryId,
      startScore: market.baselineScore,
      currentScore: market.currentScore,
      crowdSentiment: choice === "up" ? market.upPoolPercent : 100 - market.upPoolPercent,
      baselineScore: market.baselineScore,
      baselineTimestamp: market.startAt,
      endAt: serverResolutionDeadline ?? undefined,
      bettingCutoff: serverBettingCutoff,
      isTopUp,
      existingStake: isTopUp ? existing?.stakeAmount : undefined,
      engine: "amm",
      ammState: market.ammState ?? null,
    });
    setStakeModalOpen(true);
  };

  const handleH2HSelect = (market: HeadToHeadMarket, person: 1 | 2) => {
    if (isMarketClosed) {
      return;
    }
    if (!user) {
      toast("Sign in required", { description: "Sign in to place predictions." });
      navigateToLogin(setLocation);
      return;
    }
    const entryId = person === 1 ? market.person1EntryId : market.person2EntryId;
    if (!entryId) {
      toast.error("Market unavailable", { description: "This market is missing required entries. Please try another market." });
      return;
    }
    const picked = person === 1 ? market.person1 : market.person2;
    const opponent = person === 1 ? market.person2 : market.person1;
    const sentiment = person === 1 ? market.person1Percent : 100 - market.person1Percent;
    const existing = openMarketBets.get(String(market.id));
    const userPickSide = existing && existing.result === "pending"
      ? h2hUserPickFromBet(market, { entryLabel: existing.entryLabel, entryId: existing.entryId })
      : null;
    if (userPickSide && person !== userPickSide) {
      const myName = userPickSide === 1 ? market.person1.name : market.person2.name;
      toast("Stick with your pick", {
        description: `You already backed ${myName}. Top up your existing pick instead.`,
      });
      return;
    }
    const isTopUp = userPickSide === person;
    setPendingSelection({
      type: "h2h",
      choice: picked.name,
      marketName: market.title,
      personName: picked.name,
      opponentName: opponent.name,
      marketId: market.id,
      entryId,
      currentScore: picked.currentScore,
      opponentScore: opponent.currentScore,
      crowdSentiment: sentiment,
      endAt: serverResolutionDeadline ?? undefined,
      bettingCutoff: serverBettingCutoff,
      isTopUp,
      existingStake: isTopUp ? existing?.stakeAmount : undefined,
      engine: "amm",
      ammState: (market as { ammState?: unknown }).ammState as StakeSelection["ammState"] ?? null,
    });
    setStakeModalOpen(true);
  };

  const handleGainerSelect = (market: TopGainerMarket, candidate: GainerCandidate) => {
    if (isMarketClosed) {
      return;
    }
    if (!user) {
      toast("Sign in required", { description: "Sign in to place predictions." });
      navigateToLogin(setLocation);
      return;
    }
    if (!candidate.entryId) {
      toast.error("Market unavailable", { description: "This market is missing required entries. Please try another market." });
      return;
    }
    const categoryLabel = getMarketCategoryLabel(market.category);
    const ammStateLike = (market as { ammState?: unknown }).ammState as Parameters<typeof snapshotFromApi>[0] | null;
    const snapshot = ammStateLike ? snapshotFromApi(ammStateLike) : null;
    const prices = snapshot ? pricesFor(snapshot) : null;
    const crowdSentiment = prices && candidate.entryId
      ? Math.round((prices[candidate.entryId] ?? 0) * 100)
      : 0;
    const priorStake = userBetsPerEntry.get(String(market.id))?.get(String(candidate.entryId))?.yesStake ?? 0;
    const isTopUp = priorStake > 0;
    setPendingSelection({
      type: "gainer",
      choice: candidate.name,
      marketName: `Category Race: ${categoryLabel}`,
      marketId: market.id,
      entryId: candidate.entryId,
      currentScore: candidate.currentGain,
      candidateRank: candidate.rank,
      candidatePercentGain: candidate.percentGain,
      candidatePointsAdded: candidate.currentGain,
      crowdSentiment,
      endAt: serverResolutionDeadline ?? undefined,
      bettingCutoff: serverBettingCutoff,
      isTopUp,
      existingStake: isTopUp ? priorStake : undefined,
      engine: "amm",
      ammState: (market as { ammState?: unknown }).ammState as StakeSelection["ammState"] ?? null,
    });
    setStakeModalOpen(true);
  };

  const gainerHighlightedEntryId = useCallback(
    (marketId: string) => {
      if (
        stakeModalOpen &&
        pendingSelection?.type === "gainer" &&
        pendingSelection.marketId === marketId
      ) {
        return pendingSelection.entryId ?? null;
      }
      return openMarketBets.get(marketId)?.entryId ?? null;
    },
    [stakeModalOpen, pendingSelection, openMarketBets],
  );

  const handleConfirmStake = async (
    amount: number,
    meta?: { maxPricePerShare?: number },
  ) => {
    if (!pendingSelection || !pendingSelection.marketId) {
      setStakeModalOpen(false);
      setPendingSelection(null);
      return;
    }
    if (pendingSelection.type === "gainer" && pendingSelection.entryId) {
      // Build the AMM share-toast meta from the race market + chosen
      // candidate so the success handler can fire `fireAmmTradeToast`
      // with the right avatar / category — matches PredictPage parity.
      // Search BOTH `leaders` (top few visible on the card) AND
      // `allCandidates` (full pool reachable through the picker dialog),
      // because a user picking from the dialog can land on a candidate
      // that isn't in the top-leaders slice. Without that fallback the
      // toast meta would be undefined and we'd silently downgrade to
      // the plain "Prediction placed!" toast.
      const gainerMarket = gainerMarkets.find((m) => m.id === pendingSelection.marketId);
      const candidate =
        gainerMarket?.leaders.find((c) => c.entryId === pendingSelection.entryId) ??
        gainerMarket?.allCandidates?.find((c) => c.entryId === pendingSelection.entryId);
      const origin = typeof window !== "undefined" ? window.location.origin : "";
      const toastMeta: NativeBetToastMeta | undefined = gainerMarket
        ? {
            personName: candidate?.name ?? pendingSelection.choice,
            personAvatar: candidate?.avatar ?? null,
            marketTitle: pendingSelection.marketName ?? `Category Race: ${getMarketCategoryLabel(gainerMarket.category)}`,
            category: gainerMarket.category,
            entryLabel: candidate?.name ?? pendingSelection.choice,
            direction: "other",
            fallbackShareUrl: `${origin}/predict/race/${pendingSelection.marketId}`,
          }
        : undefined;
      await nativeMarketBetMutation.mutateAsync({
        marketId: pendingSelection.marketId,
        entryId: pendingSelection.entryId,
        stakeAmount: amount,
        marketType: "gainer",
        toastMeta,
        maxPricePerShare: meta?.maxPricePerShare,
      });
      return;
    }
    if (pendingSelection.type === "h2h" && pendingSelection.entryId) {
      // Build H2H toast meta (picked person's avatar / category) so the
      // confirmation experience matches /predict's H2H flow.
      const h2hMarket = h2hBattles.find((m) => m.id === pendingSelection.marketId);
      const picked =
        h2hMarket && pendingSelection.entryId === h2hMarket.person1EntryId
          ? h2hMarket.person1
          : h2hMarket?.person2;
      const origin = typeof window !== "undefined" ? window.location.origin : "";
      const toastMeta: NativeBetToastMeta | undefined = h2hMarket && picked
        ? {
            personName: picked.name,
            personAvatar: picked.avatar ?? null,
            marketTitle: h2hMarket.title ?? pendingSelection.marketName ?? "Head-to-head",
            category: h2hMarket.category,
            entryLabel: picked.name,
            direction: "other",
            fallbackShareUrl: `${origin}/predict/h2h/${pendingSelection.marketId}`,
          }
        : undefined;
      await nativeMarketBetMutation.mutateAsync({
        marketId: pendingSelection.marketId,
        entryId: pendingSelection.entryId,
        stakeAmount: amount,
        marketType: "h2h",
        toastMeta,
        maxPricePerShare: meta?.maxPricePerShare,
      });
      return;
    }
    if (pendingSelection.type === "updown") {
      const entryId = pendingSelection.choice.toUpperCase().includes("UP") ? weeklyMarket?.upEntryId : weeklyMarket?.downEntryId;
      if (!entryId) {
        toast.error("Market unavailable", { description: "Missing entry. Please try again." });
        setStakeModalOpen(false);
        setPendingSelection(null);
        return;
      }
      await updownBetMutation.mutateAsync({
        marketId: pendingSelection.marketId,
        entryId,
        stakeAmount: amount,
        maxPricePerShare: meta?.maxPricePerShare,
      });
      return;
    }

    if (pendingSelection.type === "community") {
      if (!pendingSelection.entryId) {
        toast.error("Selection unavailable", { description: "This market selection is not available right now." });
        return;
      }
      const market = openMarketsForPerson.find(
        (m: any) => String(m.id) === String(pendingSelection.marketId),
      );
      if (!market?.slug) {
        toast.error("Market unavailable", { description: "Could not find the selected market. Please refresh and try again." });
        setStakeModalOpen(false);
        setPendingSelection(null);
        return;
      }
      await communityMarketBetMutation.mutateAsync({
        slug: market.slug,
        entryId: pendingSelection.entryId,
        stakeAmount: amount,
        direction: pendingSelection.direction === "no" ? "no" : "yes",
        maxPricePerShare: meta?.maxPricePerShare,
      });
    }
  };

  /**
   * Live AMM state for the currently-open selection. Keeps modal
   * prices in sync with /api/native-markets/* polling rather than
   * snapshotting on open.
   */
  const liveAmmStateForPending = useMemo(() => {
    if (!pendingSelection || pendingSelection.engine !== "amm") return null;
    const id = pendingSelection.marketId;
    const sources: any[][] = [
      openMarketsForPerson ?? [],
      weeklyMarket ? [weeklyMarket] : [],
      h2hBattles ?? [],
      gainerMarkets ?? [],
    ];
    for (const list of sources) {
      const m = list.find((entry: any) => String(entry?.id) === String(id));
      if (m && (m as any).ammState) return (m as any).ammState as StakeSelection["ammState"];
    }
    return null;
  }, [pendingSelection, openMarketsForPerson, weeklyMarket, h2hBattles, gainerMarkets]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-6 w-6 animate-spin text-violet-700 dark:text-violet-500" />
        <span className="ml-2 text-sm text-muted-foreground">Loading prediction markets...</span>
      </div>
    );
  }

  const worldCards = openMarketsForPerson.slice(0, visibleWorldCount);
  const worldGrid = predictSectionGridClass(worldCards.length);
  const h2hGrid = predictSectionGridClass(h2hBattles.length);
  const gainerGrid = predictSectionGridClass(gainerMarkets.length);

  return (
    <div className="space-y-6">
      {/* World Markets (Open Markets) */}
      {openMarketsForPerson.length > 0 && (
        <section>
          <SectionHeader
            icon={<Scale className="h-5 w-5 text-violet-600 dark:text-violet-400" />}
            title="World Markets"
            subtitle="Predict the outcome of global events"
            count={openMarketsForPerson.length || undefined}
            infoTooltip="Prediction markets about real-world events involving this person"
          />
          <div className={worldGrid.container}>
            {worldCards.map((market: any) => (
              <div key={market.id} className={worldGrid.item}>
                <OpenMarketCard
                  market={market}
                  onNavigate={(slug, pick, direction) =>
                    setLocation(`/markets/${slug}${pick ? `?pick=${pick}${direction ? `&direction=${direction}` : ''}` : ''}`)
                  }
                  onPickEntry={handleCommunityPickEntry}
                  isMarketClosed={market.status !== "OPEN"}
                  userBetResult={openMarketBets.get(String(market.id))}
                  userBetsPerEntry={userBetsPerEntry.get(String(market.id))}
                  onFilterCategory={handleCategoryFilter}
                  categoryRaceMap={categoryRaceMap}
                  leaderboardCategories={leaderboardCategories}
                  unrealisedPnl={
                    ammPositionTotalsByMarket.get(String(market.id))?.unrealisedPnl
                    ?? ammPositionByMarket.get(String(market.id))?.unrealisedPnl
                    ?? null
                  }
                  netCreditsIn={
                    ammPositionTotalsByMarket.get(String(market.id))?.netCreditsIn
                    ?? ammPositionByMarket.get(String(market.id))?.netCreditsIn
                    ?? null
                  }
                  positionCount={
                    ammPositionTotalsByMarket.get(String(market.id))?.count
                    ?? (ammPositionByMarket.has(String(market.id)) ? 1 : 0)
                  }
                />
              </div>
            ))}
          </div>
          {openMarketsForPerson.length > visibleWorldCount && (
            <div className="flex justify-center mt-4">
              <Button variant="outline" size="sm" onClick={() => setVisibleWorldCount(c => c + 3)}>
                Load more
              </Button>
            </div>
          )}
        </section>
      )}

      {/* Induction empty state: World Markets only — no native sections */}
      {isInduction && !hasAnyMarkets && (
        <div className="space-y-4 max-w-lg mx-auto" data-testid="induction-predict-empty">
          <Card className="p-5 sm:p-8 text-center border-dashed space-y-2">
            <p className="text-lg font-semibold">No World Markets yet</p>
            <p className="text-sm sm:text-base text-muted-foreground">
              {personName} isn&apos;t featured in any World Markets right now.
              Check back after the next scout run — new markets are added daily.
            </p>
            <p className="text-xs sm:text-sm text-muted-foreground">
              Vote below to unlock native prediction markets once they join the main leaderboard.
            </p>
          </Card>
          {inductionVoteSlot}
        </div>
      )}

      {!isInduction && (
        <>
      <MarketCycleHero marketState={marketCycle} constrainedWidth />

      {/* Weekly Jackpot — same hero as main Predict page; static person row
          (no celebrity picker). Server-side jackpot eligibility is capped
          at the top N most-famous people (default 20) to concentrate pool
          depth, so most profile pages won't have a jackpot market. We hide
          the section entirely in that case rather than rendering an empty
          "no market available" stub — users in the long tail of the
          leaderboard simply don't see a jackpot widget on their profile. */}
      {jackpotMarket && (
        <section data-testid="profile-jackpot-widget">
          <WeeklyJackpotHero
            variant="profile"
            profilePerson={{
              id: personId,
              name: personName,
              avatar: personAvatar || "",
              rank: personRank,
            }}
            onEnterJackpot={() => setJackpotModalOpen(true)}
            marketStatus={marketCycle.status}
            timeRemaining={marketCycle.timeRemaining}
            jackpotMarket={jackpotMarket}
            onRulesClick={() => setRulesModalOpen("jackpot")}
          />

          <JackpotEntryModal
            open={jackpotModalOpen}
            onClose={() => setJackpotModalOpen(false)}
            person={{ id: personId, name: personName, avatar: personAvatar || "", trendScore: currentScore, rank: personRank ?? undefined } as any}
            marketId={jackpotMarket.id}
            userCredits={walletCredits}
            bettingCutoff={jackpotMarket.bettingCutoff || null}
            resolveAt={jackpotMarket.endAt || null}
            isCutoffPassed={jackpotMarket.isCutoffPassed || false}
          />
        </section>
      )}

      {/* Up/Down Predictions */}
      <section>
        <SectionHeader
          icon={<TrendingUp className="h-5 w-5 text-violet-600 dark:text-violet-400" />}
          title="Weekly Up / Down"
          subtitle="Will their Trend Score be higher / lower"
          infoTooltip="Predict whether their Trend Score finishes the week above or below the starting value"
        />
        {weeklyMarket ? (
          <WeeklyUpDownCard
            market={weeklyMarket}
            isMarketClosed={isMarketClosed}
            closedMessage={closedMarketMessage}
            onSelect={(choice) => handleUpDownSelect(weeklyMarket, choice)}
            onAdd={() => {
              const pos = pendingWeeklyUpDownPositionFromBet(openMarketBets.get(String(weeklyMarket.id)));
              if (pos?.pick) handleUpDownSelect(weeklyMarket, pos.pick);
            }}
            onFilterCategory={handleCategoryFilter}
            categoryRaceMap={categoryRaceMap}
            leaderboardCategories={leaderboardCategories}
            pendingPosition={(() => {
              const pending = pendingWeeklyUpDownPositionFromBet(openMarketBets.get(String(weeklyMarket.id)));
              if (!pending) return null;
              const ammPos = ammPositionByMarket.get(String(weeklyMarket.id));
              if (ammPos && Number.isFinite(ammPos.netCreditsIn) && ammPos.netCreditsIn >= 0) {
                return { ...pending, stakeAmount: Math.round(ammPos.netCreditsIn) };
              }
              return pending;
            })()}
            unrealisedPnl={ammPositionByMarket.get(String(weeklyMarket.id))?.unrealisedPnl ?? null}
          />
        ) : (
          <div className="text-center py-6 text-muted-foreground">
            No weekly Up/Down market for {personName} yet.
          </div>
        )}
      </section>

      {/* Head-to-Head Battles */}
      <section>
        <SectionHeader
          icon={<Swords className="h-5 w-5 text-violet-600 dark:text-violet-400" />}
          title="Head-to-Head Battles"
          subtitle="Who will finish with the higher Trend Score?"
          count={h2hBattles.length || undefined}
          infoTooltip="Face-off markets matching this person against another rival"
        />
        {h2hBattles.length > 0 ? (
          <div className={h2hGrid.container}>
            {h2hBattles.map((battle) => {
              const aggregated = openMarketBets.get(String(battle.id));
              const ammPos = ammPositionByMarket.get(String(battle.id));
              const h2hUserPick = h2hUserPickFromBet(
                battle,
                aggregated ? { entryLabel: aggregated.entryLabel, entryId: aggregated.entryId } : undefined
              );
              const h2hStake =
                ammPos && Number.isFinite(ammPos.netCreditsIn) && ammPos.netCreditsIn >= 0
                  ? Math.round(ammPos.netCreditsIn)
                  : aggregated?.stakeAmount;
              return (
                <div key={battle.id} className={h2hGrid.item}>
                  <HeadToHeadCard
                    market={battle}
                    isMarketClosed={isMarketClosed}
                    closedMessage={closedMarketMessage}
                    onSelect={(person) => handleH2HSelect(battle, person)}
                    userPick={h2hUserPick}
                    userStake={h2hStake}
                    unrealisedPnl={ammPos?.unrealisedPnl ?? null}
                    onFilterCategory={handleCategoryFilter}
                    categoryRaceMap={categoryRaceMap}
                    leaderboardCategories={leaderboardCategories}
                  />
                </div>
              );
            })}
          </div>
        ) : (
          <div className="text-center py-6 text-muted-foreground">
            No head-to-head battles involving {personName} yet.
          </div>
        )}
      </section>

      {/* Category Races */}
      <section>
        <SectionHeader
          icon={<Trophy className="h-5 w-5 text-violet-600 dark:text-violet-400" />}
          title="Category Races"
          subtitle="Pick the biggest mover in each category"
          count={gainerMarkets.length || undefined}
        />
        {gainerMarkets.length > 0 ? (
          <div className={gainerGrid.container}>
            {gainerMarkets.map((gainer) => {
              const marketId = String(gainer.id);
              const gainerBet = openMarketBets.get(marketId);
              const totals = ammPositionTotalsByMarket.get(marketId);
              const top = ammPositionByMarket.get(marketId);
              const summary = categoryRacePredictionSummaryFromBet(
                gainerBet,
                totals?.netCreditsIn ?? top?.netCreditsIn,
              );
              const isMultiPick = summary?.pickLabel === "Multiple picks";
              return (
              <div key={gainer.id} className={gainerGrid.item}>
                <TopGainerCard
                  market={gainer}
                  isMarketClosed={isMarketClosed}
                  closedMessage={closedMarketMessage}
                  onSelectCandidate={handleGainerSelect}
                  highlightedEntryId={gainerHighlightedEntryId(marketId)}
                  entryStakes={userBetsPerEntry.get(marketId)}
                  isPredicted={openMarketBets.has(marketId)}
                  predictionSummary={summary}
                  onFilterCategory={handleCategoryFilter}
                  categoryRaceMap={categoryRaceMap}
                  leaderboardCategories={leaderboardCategories}
                  unrealisedPnl={
                    isMultiPick
                      ? (totals?.unrealisedPnl ?? null)
                      : (top?.unrealisedPnl ?? null)
                  }
                />
              </div>
              );
            })}
          </div>
        ) : (
          <div className="text-center py-6 text-muted-foreground">
            No top gainer markets featuring {personName} yet.
          </div>
        )}
      </section>

      {/* Fallback when there are no markets at all */}
      {!hasAnyMarkets && (
        <Card className="p-8 text-center border-dashed">
          <div className="space-y-3">
            <p className="text-lg font-semibold">No active markets</p>
            <p className="text-muted-foreground">
              There are currently no prediction markets for {personName}.
            </p>
            <p className="text-sm text-muted-foreground mt-4">
              Check back later or visit the main Prediction Markets page to explore all available markets.
            </p>
          </div>
        </Card>
      )}
        </>
      )}

      <StakeModal
        open={stakeModalOpen}
        onClose={() => { setStakeModalOpen(false); setPendingSelection(null); }}
        selection={pendingSelection}
        onConfirm={handleConfirmStake}
        liveAmmState={liveAmmStateForPending}
        walletBalance={walletCredits}
        onChangePick={pendingSelection?.type === "gainer" ? () => {
          setStakeModalOpen(false);
          setPendingSelection(null);
        } : undefined}
        onDirectionChange={(dir) => {
          if (!pendingSelection) return;

          if (pendingSelection.type === "community" && (dir === "yes" || dir === "no")) {
            const market = openMarketsForPerson.find(
              (m: any) => String(m.id) === String(pendingSelection.marketId),
            );
            if (!market) return;

            if (
              pendingSelection.openMarketType === "binary" ||
              pendingSelection.openMarketType === "updown"
            ) {
              const other = (market.entries ?? []).find(
                (e: any) => String(e.id) !== String(pendingSelection.entryId),
              );
              if (!other) return;
              setPendingSelection({
                ...pendingSelection,
                choice: other.label,
                entryId: other.id,
                direction: "yes",
                opponentName: pendingSelection.choice,
                engine: "amm",
                ammState: market.ammState ?? null,
              });
              return;
            }

            const entry = market?.entries?.find(
              (e: any) => String(e.id) === String(pendingSelection.entryId),
            );
            if (!entry) return;
            // Multi: AMM buys the outcome only — ignore Yes/No flips.
            setPendingSelection({
              ...pendingSelection,
              choice: entry.label,
              direction: "yes",
            });
            return;
          }

          /* Sprint 4 (Polymarket pass): adding the in-modal Up/Down
             toggle here too so the experience is consistent with
             HomePage / PredictPage. The toggle now also carries
             cost-per-share chips for AMM markets, so users on a
             person's detail page can comparison-shop without closing
             the modal. weeklyMarket is the only updown market in
             scope for this tab (one market per person per week). */
          if (pendingSelection.type !== "updown") return;
          if (dir !== "up" && dir !== "down") return;
          if (!weeklyMarket) return;
          const entryId = dir === "up" ? weeklyMarket.upEntryId : weeklyMarket.downEntryId;
          if (!entryId) return;
          setPendingSelection({
            ...pendingSelection,
            choice: dir === "up" ? "Trend Score UP" : "Trend Score DOWN",
            entryId,
            crowdSentiment: dir === "up" ? weeklyMarket.upPoolPercent : 100 - weeklyMarket.upPoolPercent,
            engine: "amm",
            ammState: weeklyMarket.ammState ?? null,
          });
        }}
      />

      {(["predictions", "community", "jackpot", "updown", "h2h", "gainer"] as const).map((key) => {
        const cfg = PREDICT_RULES_STEPS[key];
        return (
          <StepModal
            key={key}
            open={rulesModalOpen === key}
            onClose={() => setRulesModalOpen(null)}
            steps={cfg.steps}
            ctaLabel={cfg.ctaLabel}
            accent={cfg.accent}
          />
        );
      })}
    </div>
  );
}
