import { useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  ArrowLeft,
  TrendingUp,
  Clock,
  CheckCircle,
  XCircle,
  Target,
  Flame,
  Trophy,
  Coins,
  BarChart3,
  Eye,
  EyeOff,
  Zap,
  Share2,
  Check,
  Info,
  Banknote,
} from "lucide-react";
import { useLocation } from "wouter";
import { navigateToLogin } from "@/lib/authReturn";
import { useAuth } from "@/contexts/AuthContext";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { dismissVoteToast, showPendingVoteToast, showVoteToast } from "@/lib/vote-toast";
import { apiRequest, parseApiError } from "@/lib/queryClient";
import { useIdempotencyKey } from "@/lib/useIdempotencyKey";
import { CashOutSheet, type CashOutSelection } from "@/components/CashOutSheet";
import { usePollingAmmState, type ApiAmmStateBlock } from "@/lib/ammClient";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { PLChart } from "@/components/predict/PLChart";
import { ProfileTabs, type ProfileTab } from "@/components/ProfileTabs";
import { CURRENCY, formatVox, formatVoxPrice } from "@/lib/currency";
import { MyPredictionCard, type MyPredictionCardData } from "@/components/me/MyPredictionCard";
import { DoughnutChart, type DoughnutSegment } from "@/components/charts/DoughnutChart";
import { useItemVisibility } from "@/hooks/useItemVisibility";
import { cn } from "@/lib/utils";
import { useShareCard } from "@/contexts/ShareCardContext";
import { buildPositionShareData, inferDirection } from "@/lib/share-data";
import { inferPredictionDirection } from "@/pages/me/predictions-utils";
import { appendShareAttribution } from "@/lib/share";
import { getRecentActivityMarketPath } from "@/lib/predict-display";

type UserPrediction = MyPredictionCardData;

interface PredictionStats {
  total: number;
  won: number;
  lost: number;
  refunded: number;
  pending: number;
  netCredits: number;
  winRate: number;
  bestCategory: string | null;
  currentStreak: number;
  hiddenCount?: number;
}

interface PredictionsResponse {
  predictions: UserPrediction[];
  stats: PredictionStats;
}

type StatusFilter = "all" | "pending" | "won" | "lost" | "refunded";

const STATUS_TABS: { value: StatusFilter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "pending", label: "Active" },
  { value: "won", label: "Won" },
  { value: "lost", label: "Lost" },
  { value: "refunded", label: "Refunded" },
];

const VALID_TABS = ["overview", "predictions", "open"] as const;
type PredictionsTab = (typeof VALID_TABS)[number];

const TABS: ProfileTab[] = [
  { id: "overview", label: "Overview", icon: Eye, accent: "#3C83F6" },
  { id: "predictions", label: "Predictions", icon: TrendingUp, accent: "#8B5CF6" },
  { id: "open", label: "Open", icon: Flame, accent: "#F97316" },
];

function normalizeResponse(data: unknown): { predictions: UserPrediction[]; stats: PredictionStats | null } {
  if (Array.isArray(data)) {
    return { predictions: data as UserPrediction[], stats: null };
  }
  const resp = data as PredictionsResponse;
  return { predictions: resp.predictions ?? [], stats: resp.stats ?? null };
}

function useCopyToClipboard() {
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const copy = async (text: string, label: string, id?: string) => {
    try {
      await navigator.clipboard.writeText(text);
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
      setCopiedId(id ?? "_stats");
      toast(label);
      timeoutRef.current = setTimeout(() => setCopiedId(null), 2000);
    } catch {
      toast.error("Failed to copy to clipboard");
    }
  };
  return { copiedId, copy };
}

function getInitialTab(): PredictionsTab {
  if (typeof window === "undefined") return "overview";
  const param = new URLSearchParams(window.location.search).get("tab");
  return VALID_TABS.includes(param as PredictionsTab) ? (param as PredictionsTab) : "overview";
}

const STATUS_VALUES: StatusFilter[] = ["all", "pending", "won", "lost", "refunded"];

function getInitialStatusFilter(): StatusFilter {
  if (typeof window === "undefined") return "all";
  const param = new URLSearchParams(window.location.search).get("status");
  return STATUS_VALUES.includes(param as StatusFilter) ? (param as StatusFilter) : "all";
}

function getInitialCategoryFilter(): string {
  if (typeof window === "undefined") return "all";
  return new URLSearchParams(window.location.search).get("category") || "all";
}

function getInitialHiddenOnly(): boolean {
  if (typeof window === "undefined") return false;
  return new URLSearchParams(window.location.search).get("hidden") === "1";
}

// Small inline pill used by filter rows. Mirrors the helper on VotesPage but
// defaults to the Predict-tab blue/violet palette.
function FilterPill({
  active,
  onClick,
  children,
  accent = "blue",
  count,
  dataTestId,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
  accent?: "cyan" | "violet" | "amber" | "emerald" | "rose" | "blue" | "slate";
  count?: number;
  dataTestId?: string;
}) {
  const accentClass: Record<string, string> = {
    cyan: "border-cyan-500/50 bg-cyan-500/15 text-cyan-600 dark:text-cyan-300",
    violet: "border-violet-500/50 bg-violet-500/15 text-violet-600 dark:text-violet-300",
    amber: "border-amber-500/50 bg-amber-500/15 text-amber-700 dark:text-amber-300",
    emerald: "border-emerald-500/50 bg-emerald-500/15 text-emerald-600 dark:text-emerald-300",
    rose: "border-rose-500/50 bg-rose-500/15 text-rose-600 dark:text-rose-300",
    blue: "border-blue-500/50 bg-blue-500/15 text-blue-600 dark:text-blue-300",
    slate: "border-slate-400/50 bg-slate-500/15 text-slate-600 dark:text-slate-300",
  };
  return (
    <button
      type="button"
      onClick={onClick}
      data-testid={dataTestId}
      aria-pressed={active}
      className={cn(
        "inline-flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-1 text-[11px] font-medium transition-colors",
        active
          ? accentClass[accent]
          : "border-border/60 text-muted-foreground hover:border-border hover:text-foreground",
      )}
    >
      {children}
      {count !== undefined && count > 0 && (
        <span
          className={cn(
            "rounded-full px-1.5 text-[10px] tabular-nums",
            active ? "bg-background/40" : "bg-muted/60",
          )}
        >
          {count}
        </span>
      )}
    </button>
  );
}

function ScrollableFilterRow({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div
      className={cn(
        "flex items-center gap-2 overflow-x-auto md:flex-wrap",
        "scrollbar-none",
        "[mask-image:linear-gradient(to_right,black_calc(100%-24px),transparent)]",
        "md:[mask-image:none]",
        className,
      )}
    >
      {children}
    </div>
  );
}

const STATUS_ACCENTS: Record<StatusFilter, "blue" | "emerald" | "rose" | "slate" | "violet"> = {
  all: "violet",
  pending: "blue",
  won: "emerald",
  lost: "rose",
  refunded: "slate",
};

export default function PredictionsPage() {
  const { user, profile } = useAuth();
  const [, setLocation] = useLocation();
  const [activeTab, setActiveTab] = useState<PredictionsTab>(getInitialTab);
  const [statusFilter, setStatusFilterState] = useState<StatusFilter>(getInitialStatusFilter);
  const [categoryFilter, setCategoryFilterState] = useState<string>(getInitialCategoryFilter);
  const [hiddenOnly, setHiddenOnlyState] = useState<boolean>(getInitialHiddenOnly);
  const { copiedId, copy } = useCopyToClipboard();
  // Sprint 2: share modal is mounted once at app root via
  // <ShareCardProvider> and triggered through `useShareCard()`. The
  // local state-driven mount that used to live here is gone — every
  // share entry point now flows through the global context.
  const { openShareCard } = useShareCard();

  const writeQuery = (patch: Record<string, string | null>) => {
    if (typeof window === "undefined") return;
    const url = new URL(window.location.href);
    for (const [key, value] of Object.entries(patch)) {
      if (value === null || value === "") url.searchParams.delete(key);
      else url.searchParams.set(key, value);
    }
    window.history.replaceState({}, "", url.toString());
  };

  const handleTabChange = (next: string) => {
    const tab = VALID_TABS.includes(next as PredictionsTab) ? (next as PredictionsTab) : "overview";
    setActiveTab(tab);
    writeQuery({ tab: tab === "overview" ? null : tab });
  };

  const setStatusFilter = (next: StatusFilter) => {
    setStatusFilterState(next);
    writeQuery({ status: next === "all" ? null : next });
  };

  const setCategoryFilter = (next: string) => {
    setCategoryFilterState(next);
    writeQuery({ category: next === "all" ? null : next });
  };

  const setHiddenOnly = (next: boolean) => {
    setHiddenOnlyState(next);
    writeQuery({ hidden: next ? "1" : null });
  };

  const { data: rawData, isLoading, error } = useQuery<PredictionsResponse | UserPrediction[]>({
    queryKey: ["/api/me/predictions"],
    enabled: !!user,
  });

  const visibility = useItemVisibility();
  const profileIsPrivate = profile ? profile.isPublic === false : false;

  const { predictions, stats } = rawData
    ? normalizeResponse(rawData)
    : { predictions: [], stats: null };

  const predictionsInitialLoading = isLoading && rawData === undefined;

  const categories = useMemo(
    () => Array.from(new Set(predictions.map((p) => p.marketCategory).filter(Boolean))),
    [predictions],
  );

  const filtered = useMemo(
    () =>
      predictions.filter((p) => {
        if (statusFilter !== "all" && p.result !== statusFilter) return false;
        if (categoryFilter !== "all" && p.marketCategory !== categoryFilter) return false;
        if (hiddenOnly && !p.hidden) return false;
        return true;
      }),
    [predictions, statusFilter, categoryFilter, hiddenOnly],
  );

  const openBets = useMemo(
    () =>
      predictions
        .filter((p) => p.result === "pending")
        .sort((a, b) => {
          const ae = new Date(a.endAt).getTime();
          const be = new Date(b.endAt).getTime();
          if (Number.isNaN(ae)) return 1;
          if (Number.isNaN(be)) return -1;
          return ae - be;
        }),
    [predictions],
  );

  const localHiddenCount = useMemo(
    () => predictions.filter((p) => p.hidden).length,
    [predictions],
  );
  const hiddenCount = stats?.hiddenCount ?? localHiddenCount;

  const plChartData = useMemo(
    () =>
      predictions.map((p) => ({
        createdAt: p.betCreatedAt,
        result: p.result,
        stakeAmount: p.stakeAmount,
        payout: p.payout,
      })),
    [predictions],
  );

  if (!user) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Card className="p-8 text-center max-w-md">
          <TrendingUp className="h-12 w-12 mx-auto mb-4 text-muted-foreground" />
          <h2 className="text-xl font-semibold mb-2">Sign in to view your predictions</h2>
          <Button
            onClick={() => navigateToLogin(setLocation)}
            className="mt-4"
            data-testid="button-sign-in"
          >
            Sign In
          </Button>
        </Card>
      </div>
    );
  }

  const handleToggleVisibility = (prediction: UserPrediction, hidden: boolean) => {
    visibility.mutate({ itemType: "market_bet", itemId: String(prediction.betId), hidden });
  };

  const handleShareWin = (p: UserPrediction) => {
    const pnl = p.payout - p.stakeAmount;
    const direction = inferPredictionDirection(p.entryLabel);
    const mappedDirection: "up" | "down" | "other" =
      direction === "up" ? "up" : direction === "down" ? "down" : "other";
    const fallbackText = `I won +${formatVox(pnl)} on "${p.marketTitle}" on VoxDex!\n${window.location.origin}/markets/${p.marketSlug}`;
    openShareCard({
      data: {
        variant: "win",
        personName: p.personName,
        personAvatar: p.personAvatar,
        marketTitle: p.marketTitle,
        direction: mappedDirection,
        entryLabel: p.entryLabel,
        stakeAmount: p.stakeAmount,
        payout: p.payout,
        baselineScore: p.baselineScore,
        currentScore: p.currentScore,
        category: p.marketCategory,
      },
      fallbackText,
      shareUrl: appendShareAttribution(
        p.marketSlug
          ? `${window.location.origin}/markets/${p.marketSlug}`
          : window.location.origin,
        { sharerUserId: user?.id ?? null, surface: "prediction_win" },
      ),
      filenameBase: `voxdex-win-${p.betId.slice(0, 8)}`,
    });
  };

  const handleSharePosition = (p: AmmOpenPosition) => {
    // Build a "live position" share card from the same fields rendered
    // on the card itself, so the share image and the on-screen card
    // never disagree about cost basis / current value.
    const direction = inferDirection(p.entryLabel);
    const origin = typeof window !== "undefined" ? window.location.origin : "";
    const sharePath =
      p.marketType === "h2h"
        ? `/predict/h2h/${p.marketId}`
        : p.marketType === "updown"
          ? `/predict/updown/${p.marketId}`
          : p.marketType === "race" || p.marketType === "gainer"
            ? `/predict/race/${p.marketId}`
            : p.marketSlug
              ? `/markets/${p.marketSlug}`
              : "/predict";
    const shareUrl = appendShareAttribution(`${origin}${sharePath}`, {
      sharerUserId: user?.id ?? null,
      surface: "portfolio",
    });
    const tradeData = buildPositionShareData({
      username: profile?.username || "you",
      personName: p.personName,
      personAvatar: p.personAvatar,
      marketTitle: p.marketTitle,
      category: p.marketCategory,
      entryLabel: p.entryLabel,
      direction,
      netShares: p.netShares,
      avgEntryPrice: p.avgEntryPrice,
      currentPrice: p.currentPrice,
      costBasis: p.netCreditsIn,
      currentValue: p.currentValue,
      endAt: p.marketEndAt,
    });
    const fallbackText = `Holding ${Math.round(p.netShares)} ${p.entryLabel} shares on "${p.marketTitle}" on VoxDex.\n${shareUrl}`;
    openShareCard({
      data: tradeData,
      fallbackText,
      shareUrl,
      filenameBase: `voxdex-position-${p.marketId.slice(0, 8)}-${p.entryId.slice(0, 6)}`,
    });
  };

  const handleSharePortfolio = (stats: PredictionStats) => {
    const fallbackText = `My VoxDex predictions: ${stats.winRate}% win rate | ${
      stats.netCredits >= 0 ? "+" : "\u2212"
    }${formatVox(Math.abs(stats.netCredits))} net | ${stats.total} predictions\n${
      window.location.origin
    }/predict`;
    openShareCard({
      data: {
        variant: "portfolio",
        username: profile?.username || "voxdex",
        rankName: profile?.rank || null,
        winRate: stats.winRate,
        netCredits: stats.netCredits,
        totalPredictions: stats.total,
        currentStreak: stats.currentStreak,
        bestCategory: stats.bestCategory,
      },
      fallbackText,
      shareUrl: appendShareAttribution(`${window.location.origin}/predict`, {
        sharerUserId: user?.id ?? null,
        surface: "portfolio",
      }),
      filenameBase: `voxdex-portfolio-${profile?.username || "me"}`,
    });
  };

  return (
    <div className="min-h-screen pb-20 md:pb-0">
      <header className="sticky top-0 z-50 border-b bg-background/80 backdrop-blur-xl">
        <div className="container mx-auto px-4 h-14 flex items-center gap-4">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => {
              if (window.history.length > 1) window.history.back();
              else setLocation("/me");
            }}
            data-testid="button-back"
          >
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <div>
            <h1 className="font-semibold">My Predictions</h1>
            <p className="text-xs text-muted-foreground">Track your prediction journey</p>
          </div>
        </div>
      </header>

      <div
        id="profile-tabs-section"
        className="sticky top-14 z-40 border-b bg-background/80 backdrop-blur-xl"
      >
        <div className="container mx-auto px-2 sm:px-4 py-2 max-w-[964px]">
          <ProfileTabs
            activeTab={activeTab}
            onTabChange={handleTabChange}
            tabs={TABS}
            noBottomMargin
          />
        </div>
      </div>

      <div className="container mx-auto px-2 sm:px-4 py-6 max-w-[964px] space-y-6">
        {profileIsPrivate && (
          <Card className="p-3 border-amber-500/30 bg-amber-500/5">
            <div className="flex items-start gap-2 text-xs sm:text-sm">
              <Info className="h-4 w-4 mt-0.5 shrink-0 text-amber-600 dark:text-amber-400" />
              <div>
                <p className="font-medium text-amber-700 dark:text-amber-300">
                  Your profile is private
                </p>
                <p className="text-muted-foreground">
                  Nothing below is currently visible to others. You can still stage visibility
                  choices here — they&apos;ll apply the moment your profile goes public.
                </p>
              </div>
            </div>
          </Card>
        )}

        {activeTab === "overview" && (
          <OverviewTab
            isLoading={predictionsInitialLoading}
            stats={stats}
            predictions={predictions}
            plChartData={plChartData}
            hiddenCount={hiddenCount}
            onSharePortfolio={handleSharePortfolio}
            onJumpToPredictions={() => handleTabChange("predictions")}
            onJumpToOpen={() => handleTabChange("open")}
            onJumpToHidden={() => {
              setHiddenOnly(true);
              handleTabChange("predictions");
            }}
          />
        )}

        {activeTab === "predictions" && (
          <PredictionsTabPanel
            isLoading={predictionsInitialLoading}
            error={error as Error | undefined}
            predictions={predictions}
            filtered={filtered}
            stats={stats}
            categories={categories}
            statusFilter={statusFilter}
            onStatusFilterChange={setStatusFilter}
            categoryFilter={categoryFilter}
            onCategoryFilterChange={setCategoryFilter}
            hiddenOnly={hiddenOnly}
            onToggleHiddenOnly={() => setHiddenOnly(!hiddenOnly)}
            hiddenCount={hiddenCount}
            profileIsPrivate={profileIsPrivate}
            onToggleVisibility={handleToggleVisibility}
            isPending={visibility.isPending}
            copiedId={copiedId}
            onShareWin={handleShareWin}
            setLocation={setLocation}
          />
        )}

        {activeTab === "open" && (
          <OpenTabPanel
            openBets={openBets}
            isLoading={predictionsInitialLoading}
            profileIsPrivate={profileIsPrivate}
            onToggleVisibility={handleToggleVisibility}
            isPending={visibility.isPending}
            setLocation={setLocation}
            onSharePosition={handleSharePosition}
          />
        )}
      </div>
      {/* ShareCardModal lives at app root via <ShareCardProvider> (App.tsx);
          this page just dispatches into the global mount via `openShareCard`. */}
    </div>
  );
}

// ---------- Tab: Overview ----------

function PredictionHeadlineHero({
  stats,
  onShare,
}: {
  stats: PredictionStats;
  onShare: (stats: PredictionStats) => void;
}) {
  // Lead with the most brag-worthy stat. Once a user has enough resolved bets
  // to have a meaningful win rate, put it front and centre. Otherwise highlight
  // Net Vox, which is a more personal "you've put skin in the game" metric.
  const resolved = stats.won + stats.lost;
  const leadWithWinRate = resolved >= 3;
  const formatNetVox = (n: number) =>
    n > 0
      ? `+${CURRENCY.symbol}${n.toLocaleString()}`
      : n < 0
        ? `\u2212${CURRENCY.symbol}${Math.abs(n).toLocaleString()}`
        : `${CURRENCY.symbol}0`;
  const leadValue = leadWithWinRate
    ? `${stats.winRate}%`
    : formatNetVox(stats.netCredits);
  const leadLabel = leadWithWinRate ? "Win Rate" : "Net Vox";
  const secondaryLabel = leadWithWinRate ? "Net Vox" : "Open positions";
  const secondaryValue = leadWithWinRate
    ? formatNetVox(stats.netCredits)
    : `${stats.pending}`;
  const leadClass = cn(
    "font-mono text-4xl font-bold tabular-nums leading-none",
    leadWithWinRate
      ? "text-foreground"
      : stats.netCredits > 0
        ? "text-emerald-500"
        : stats.netCredits < 0
          ? "text-rose-500"
          : "text-foreground",
  );

  return (
    <Card className="relative overflow-hidden p-4 sm:p-5">
      <div className="pointer-events-none absolute inset-0 bg-gradient-to-br from-violet-500/15 via-blue-500/10 to-transparent" />
      <div className="relative flex items-center gap-4">
        <div className="min-w-0 flex-1">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            {leadLabel}
          </p>
          <p className={leadClass}>{leadValue}</p>
          <p className="mt-2 text-xs text-muted-foreground">
            <span className="font-semibold text-foreground tabular-nums">{secondaryValue}</span>{" "}
            {secondaryLabel.toLowerCase()}
            <span className="mx-1.5 text-muted-foreground/60">&middot;</span>
            <span className="tabular-nums">{stats.total}</span> predictions
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          className="shrink-0 gap-1.5 text-xs"
          onClick={() => onShare(stats)}
          data-testid="button-hero-share-stats"
        >
          <Share2 className="h-3.5 w-3.5" />
          Share
        </Button>
      </div>
    </Card>
  );
}

function OverviewTab({
  isLoading,
  stats,
  predictions,
  plChartData,
  hiddenCount,
  onSharePortfolio,
  onJumpToPredictions,
  onJumpToOpen,
  onJumpToHidden,
}: {
  isLoading: boolean;
  stats: PredictionStats | null;
  predictions: UserPrediction[];
  plChartData: { createdAt: string; result: "won" | "lost" | "refunded" | "pending"; stakeAmount: number; payout: number }[];
  hiddenCount: number;
  onSharePortfolio: (stats: PredictionStats) => void;
  onJumpToPredictions: () => void;
  onJumpToOpen: () => void;
  onJumpToHidden: () => void;
}) {
  const categoryAccuracy = useMemo(() => {
    const map = new Map<string, { won: number; resolved: number }>();
    for (const p of predictions) {
      if (!p.marketCategory) continue;
      if (p.result !== "won" && p.result !== "lost") continue;
      const cur = map.get(p.marketCategory) ?? { won: 0, resolved: 0 };
      cur.resolved += 1;
      if (p.result === "won") cur.won += 1;
      map.set(p.marketCategory, cur);
    }
    return Array.from(map.entries())
      .map(([category, c]) => ({
        category,
        resolved: c.resolved,
        won: c.won,
        rate: c.resolved > 0 ? (c.won / c.resolved) * 100 : 0,
      }))
      .sort((a, b) => b.rate - a.rate)
      .slice(0, 5);
  }, [predictions]);

  // Doughnut: Result split
  const resultSegments: DoughnutSegment[] = useMemo(() => {
    if (!stats) return [];
    return [
      { id: "won", label: "Won", value: stats.won, color: "#10B981" },
      { id: "lost", label: "Lost", value: stats.lost, color: "#F43F5E" },
      { id: "pending", label: "Pending", value: stats.pending, color: "#3B82F6" },
      { id: "refunded", label: "Refunded", value: stats.refunded, color: "#64748B" },
    ];
  }, [stats]);

  // Doughnut: Category distribution (count of predictions per category).
  const categoryDistribution: DoughnutSegment[] = useMemo(() => {
    const counts = new Map<string, number>();
    for (const p of predictions) {
      if (!p.marketCategory) continue;
      counts.set(p.marketCategory, (counts.get(p.marketCategory) ?? 0) + 1);
    }
    const palette = ["#8B5CF6", "#22D3EE", "#F59E0B", "#10B981", "#EC4899", "#3B82F6", "#F97316", "#64748B"];
    return Array.from(counts.entries())
      .sort((a, b) => b[1] - a[1])
      .map(([category, count], i) => ({
        id: category,
        label: category.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase()),
        value: count,
        color: palette[i % palette.length],
      }));
  }, [predictions]);

  // Best / worst category by win rate (only consider those with >= 2 resolved bets
  // so a single lucky or unlucky call doesn't hijack the headline).
  const categoryMinResolved = 2;
  const bestCategoryCallout = useMemo(() => {
    const candidates = categoryAccuracy.filter((c) => c.resolved >= categoryMinResolved);
    return candidates[0] ?? null;
  }, [categoryAccuracy]);
  const worstCategoryCallout = useMemo(() => {
    const candidates = categoryAccuracy.filter((c) => c.resolved >= categoryMinResolved);
    return candidates.length > 0 ? candidates[candidates.length - 1] : null;
  }, [categoryAccuracy]);

  // Contrarian index: bets with decimal odds > 2.0 were underdog calls.
  const contrarian = useMemo(() => {
    let eligible = 0;
    let underdog = 0;
    let underdogWins = 0;
    for (const p of predictions) {
      const odds =
        p.oddsAtBet != null
          ? p.oddsAtBet
          : p.stakeAmount > 0
            ? p.potentialPayout / p.stakeAmount
            : null;
      if (odds == null || !Number.isFinite(odds)) continue;
      eligible += 1;
      if (odds > 2.0) {
        underdog += 1;
        if (p.result === "won") underdogWins += 1;
      }
    }
    const pct = eligible > 0 ? Math.round((underdog / eligible) * 100) : null;
    return { eligible, underdog, underdogWins, pct };
  }, [predictions]);

  const visibleCount = predictions.length - hiddenCount;

  // Matches the predicate PLChart uses internally. Used to hide the P&L card
  // entirely when there's nothing to plot, rather than rendering a blank box.
  const resolvedCount = useMemo(
    () => plChartData.filter((p) => p.result === "won" || p.result === "lost").length,
    [plChartData],
  );

  if (isLoading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-24 w-full rounded-xl" />
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-6 gap-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-20 w-full rounded-xl" />
          ))}
        </div>
        <Skeleton className="h-56 w-full rounded-xl" />
      </div>
    );
  }

  if (!stats || predictions.length === 0) {
    return <OverviewEmpty onStart={() => window.location.assign("/predict")} />;
  }

  return (
    <div className="space-y-6">
      <PredictionHeadlineHero stats={stats} onShare={onSharePortfolio} />

      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-6 gap-3">
        <Card className="p-3 text-center space-y-1 border-white/5 bg-card/60 backdrop-blur-sm">
          <Clock className="h-4 w-4 mx-auto text-blue-600 dark:text-blue-400" />
          <p className="text-2xl font-mono font-bold tabular-nums">{stats.pending}</p>
          <p className="text-[10px] uppercase tracking-wide text-muted-foreground leading-tight">
            Open
          </p>
        </Card>
        <Card className="p-3 text-center space-y-1 border-white/5 bg-card/60 backdrop-blur-sm">
          <Trophy className="h-4 w-4 mx-auto text-green-600 dark:text-green-400" />
          <p className="text-2xl font-mono font-bold tabular-nums">{stats.won}</p>
          <p className="text-[10px] uppercase tracking-wide text-muted-foreground leading-tight">
            Won
          </p>
        </Card>
        <Card className="p-3 text-center space-y-1 border-white/5 bg-card/60 backdrop-blur-sm">
          <XCircle className="h-4 w-4 mx-auto text-red-600 dark:text-red-400" />
          <p className="text-2xl font-mono font-bold tabular-nums">{stats.lost}</p>
          <p className="text-[10px] uppercase tracking-wide text-muted-foreground leading-tight">
            Lost
          </p>
        </Card>
        <Card className="p-3 text-center space-y-1 border-white/5 bg-card/60 backdrop-blur-sm">
          <Coins className="h-4 w-4 mx-auto text-amber-600 dark:text-amber-400" />
          <p
            className={cn(
              "text-2xl font-mono font-bold tabular-nums",
              stats.netCredits > 0 && "text-green-600 dark:text-green-400",
              stats.netCredits < 0 && "text-red-600 dark:text-red-400",
            )}
          >
            {stats.netCredits > 0
              ? `+${CURRENCY.symbol}${stats.netCredits.toLocaleString()}`
              : stats.netCredits < 0
                ? `\u2212${CURRENCY.symbol}${Math.abs(stats.netCredits).toLocaleString()}`
                : `${CURRENCY.symbol}0`}
          </p>
          <p className="text-[10px] uppercase tracking-wide text-muted-foreground leading-tight">
            Net Vox
          </p>
        </Card>
        <Card className="p-3 text-center space-y-1 border-white/5 bg-card/60 backdrop-blur-sm">
          <BarChart3 className="h-4 w-4 mx-auto text-violet-600 dark:text-violet-400" />
          <p className="text-2xl font-mono font-bold tabular-nums">{stats.winRate}%</p>
          <p className="text-[10px] uppercase tracking-wide text-muted-foreground leading-tight">
            Win Rate
          </p>
        </Card>
        <Card className="p-3 text-center space-y-1 border-white/5 bg-card/60 backdrop-blur-sm">
          <Flame className="h-4 w-4 mx-auto text-orange-600 dark:text-orange-400" />
          <p className="text-2xl font-mono font-bold tabular-nums">{stats.currentStreak}</p>
          <p className="text-[10px] uppercase tracking-wide text-muted-foreground leading-tight">
            Login streak
          </p>
          <p className="text-[9px] text-muted-foreground/70 leading-tight">Days active</p>
        </Card>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <Card className="p-4 sm:p-5 border-white/5 bg-card/60 backdrop-blur-sm">
          <div className="flex items-center justify-between mb-2">
            <div>
              <h3 className="font-semibold text-sm">Result split</h3>
              <p className="text-xs text-muted-foreground">Won, lost, pending, refunded</p>
            </div>
          </div>
          <DoughnutChart
            data={resultSegments}
            centerTitle={stats.total}
            centerSubtitle="predictions"
            height={220}
          />
        </Card>

        <Card className="p-4 sm:p-5 border-white/5 bg-card/60 backdrop-blur-sm">
          <div className="flex items-center justify-between mb-2">
            <div>
              <h3 className="font-semibold text-sm">Category mix</h3>
              <p className="text-xs text-muted-foreground">Where you put your Vox</p>
            </div>
          </div>
          <DoughnutChart
            data={categoryDistribution}
            centerTitle={categoryDistribution.length}
            centerSubtitle="categories"
            height={220}
          />
        </Card>
      </div>

      {resolvedCount > 0 && (
        <Card className="p-4 sm:p-5 border-white/5 bg-card/60 backdrop-blur-sm">
          <div className="flex items-center justify-between mb-3">
            <div>
              <h3 className="font-semibold text-sm">Profit &amp; loss</h3>
              <p className="text-xs text-muted-foreground">
                Cumulative credits across resolved predictions
              </p>
            </div>
            <Badge variant="outline" className="gap-1 text-[10px]">
              {resolvedCount} resolved
            </Badge>
          </div>
          <PLChart predictions={plChartData} />
        </Card>
      )}

      {categoryAccuracy.length > 0 && (
        <Card className="p-4 sm:p-5 border-white/5 bg-card/60 backdrop-blur-sm">
          <div className="flex items-center justify-between mb-3">
            <div>
              <h3 className="font-semibold text-sm">Win rate by category</h3>
              <p className="text-xs text-muted-foreground">Where your calls are sharpest</p>
            </div>
            <Button variant="ghost" size="sm" className="text-xs" onClick={onJumpToPredictions}>
              Browse all →
            </Button>
          </div>

          {(bestCategoryCallout || worstCategoryCallout) && (
            <div className="mb-3 flex flex-wrap gap-2">
              {bestCategoryCallout && (
                <Badge
                  variant="outline"
                  className="gap-1 border-emerald-500/40 bg-emerald-500/10 text-emerald-600 dark:text-emerald-300"
                >
                  <Trophy className="h-3 w-3" /> Strongest:{" "}
                  <span className="capitalize">
                    {bestCategoryCallout.category.replace(/_/g, " ")}
                  </span>{" "}
                  <span className="tabular-nums">({bestCategoryCallout.rate.toFixed(0)}%)</span>
                </Badge>
              )}
              {worstCategoryCallout &&
                worstCategoryCallout.category !== bestCategoryCallout?.category && (
                  <Badge
                    variant="outline"
                    className="gap-1 border-rose-500/40 bg-rose-500/10 text-rose-600 dark:text-rose-300"
                  >
                    <Target className="h-3 w-3" /> Needs work:{" "}
                    <span className="capitalize">
                      {worstCategoryCallout.category.replace(/_/g, " ")}
                    </span>{" "}
                    <span className="tabular-nums">({worstCategoryCallout.rate.toFixed(0)}%)</span>
                  </Badge>
                )}
            </div>
          )}

          <div className="space-y-2.5">
            {categoryAccuracy.map((c) => (
              <div key={c.category} className="space-y-1">
                <div className="flex items-center justify-between text-xs">
                  <span className="capitalize text-muted-foreground">
                    {c.category.replace(/_/g, " ")}
                  </span>
                  <span className="font-medium">
                    {c.won}/{c.resolved}{" "}
                    <span className="text-muted-foreground">({c.rate.toFixed(0)}%)</span>
                  </span>
                </div>
                <div className="h-1.5 rounded-full bg-muted/60 overflow-hidden">
                  <div
                    className={`h-full rounded-full ${
                      c.rate >= 60
                        ? "bg-gradient-to-r from-emerald-500 to-green-500"
                        : c.rate >= 40
                          ? "bg-gradient-to-r from-amber-500 to-yellow-500"
                          : "bg-gradient-to-r from-rose-500 to-red-500"
                    }`}
                    style={{ width: `${Math.max(2, c.rate)}%` }}
                  />
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}

      <PredictionContrarianTile
        pct={contrarian.pct}
        eligible={contrarian.eligible}
        underdog={contrarian.underdog}
        underdogWins={contrarian.underdogWins}
      />

      <PredictionsJourneyTimeline stats={stats} predictions={predictions} />

      <Card className="p-4 sm:p-5 border-white/5 bg-card/60 backdrop-blur-sm">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="font-semibold text-sm">Visibility snapshot</h3>
            <p className="text-xs text-muted-foreground">
              {visibleCount} visible &middot; {hiddenCount} hidden
            </p>
          </div>
          {hiddenCount > 0 ? (
            <Button variant="outline" size="sm" className="text-xs" onClick={onJumpToHidden}>
              <EyeOff className="h-3.5 w-3.5 mr-1.5" /> Review hidden
            </Button>
          ) : (
            <Badge
              variant="outline"
              className="gap-1 border-emerald-500/40 bg-emerald-500/10 text-emerald-600 dark:text-emerald-300"
            >
              <Eye className="h-3 w-3" /> All public
            </Badge>
          )}
        </div>
      </Card>

      <div className="flex items-center justify-between gap-2 flex-wrap pt-2">
        <Button variant="outline" size="sm" className="gap-1.5 text-xs" onClick={onJumpToOpen}>
          <Flame className="h-3.5 w-3.5" /> View open positions ({stats.pending})
        </Button>
        <Button
          variant="outline"
          size="sm"
          className="gap-1.5 text-xs"
          onClick={() => onSharePortfolio(stats)}
          data-testid="button-overview-share-stats"
        >
          <Share2 className="h-3.5 w-3.5" />
          Share Stats
        </Button>
      </div>
    </div>
  );
}

// Contrarian index tile for predictions - underdog = decimal odds > 2.0.
function PredictionContrarianTile({
  pct,
  eligible,
  underdog,
  underdogWins,
}: {
  pct: number | null;
  eligible: number;
  underdog: number;
  underdogWins: number;
}) {
  const readyThreshold = 3;
  const ready = pct !== null && eligible >= readyThreshold;
  const underdogHitRate =
    underdog > 0 ? Math.round((underdogWins / underdog) * 100) : null;
  const persona = ready
    ? pct! >= 60
      ? "Underdog Hunter"
      : pct! >= 40
        ? "Long-Shot Believer"
        : pct! >= 20
          ? "Balanced Predictor"
          : "Favourites Backer"
    : null;

  return (
    <Card className="relative overflow-hidden p-4 sm:p-5">
      <div className="pointer-events-none absolute inset-0 bg-gradient-to-br from-violet-500/15 via-fuchsia-500/10 to-transparent" />
      <div className="relative flex items-start gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-violet-500/10 text-violet-600 dark:text-violet-300">
          <Target className="h-5 w-5" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-2">
            <h3 className="font-semibold text-sm">Contrarian index</h3>
            {persona && (
              <Badge
                variant="outline"
                className="border-violet-500/30 bg-violet-500/10 text-[10px] text-violet-600 dark:text-violet-300"
              >
                {persona}
              </Badge>
            )}
          </div>
          {ready ? (
            <>
              <p className="mt-2 text-3xl font-mono font-bold tabular-nums">{pct}%</p>
              <p className="text-xs text-muted-foreground">
                of your predictions were underdog calls (decimal odds &gt; 2.0)
                <span className="ml-1 text-muted-foreground/80">
                  ({underdog} of {eligible})
                </span>
              </p>
              {underdog > 0 && underdogHitRate !== null && (
                <p className="mt-1 text-xs text-muted-foreground">
                  Underdog hit rate:{" "}
                  <span className="font-semibold text-foreground tabular-nums">
                    {underdogHitRate}%
                  </span>{" "}
                  ({underdogWins}/{underdog})
                </p>
              )}
              <div className="mt-3 h-2 rounded-full bg-muted/60 overflow-hidden">
                <div
                  className="h-full bg-gradient-to-r from-violet-500 to-fuchsia-400"
                  style={{ width: `${pct}%` }}
                />
              </div>
            </>
          ) : (
            <p className="mt-2 text-xs text-muted-foreground">
              Your contrarian streak unlocks after {readyThreshold} predictions with priced odds.
              You&apos;ve got {eligible} so far.
            </p>
          )}
        </div>
      </div>
    </Card>
  );
}

interface PredictionMilestone {
  id: string;
  label: string;
  earned: boolean;
  progress?: number;
  hint?: string;
}

function PredictionsJourneyTimeline({
  stats,
  predictions,
}: {
  stats: PredictionStats;
  predictions: UserPrediction[];
}) {
  const milestones: PredictionMilestone[] = useMemo(() => {
    const total = stats.total;
    const firstWin = stats.won >= 1;
    const wins10 = stats.won >= 10;
    const credits100 = stats.netCredits >= 100;
    const firstUnderdogWin = predictions.some((p) => {
      if (p.result !== "won") return false;
      const odds =
        p.oddsAtBet != null
          ? p.oddsAtBet
          : p.stakeAmount > 0
            ? p.potentialPayout / p.stakeAmount
            : null;
      return odds != null && odds > 2.0;
    });
    const bestCategoryWin = stats.bestCategory
      ? predictions.some((p) => p.marketCategory === stats.bestCategory && p.result === "won")
      : false;
    const pn = (needed: number) => ({
      earned: total >= needed,
      progress: Math.min(1, total / needed),
      hint: `${Math.min(total, needed)}/${needed}`,
    });
    return [
      { id: "first", label: "First prediction", ...pn(1) },
      { id: "first_win", label: "First win", earned: firstWin, progress: firstWin ? 1 : 0 },
      {
        id: "wins_10",
        label: "10 wins",
        earned: wins10,
        progress: Math.min(1, stats.won / 10),
        hint: `${Math.min(stats.won, 10)}/10`,
      },
      {
        id: "credits_100",
        label: `+${CURRENCY.symbol}100`,
        earned: credits100,
        progress: stats.netCredits > 0 ? Math.min(1, stats.netCredits / 100) : 0,
        hint: stats.netCredits >= 100 ? `+${CURRENCY.symbol}${stats.netCredits}` : stats.netCredits > 0 ? `+${CURRENCY.symbol}${stats.netCredits}/${CURRENCY.symbol}100` : `${CURRENCY.symbol}0/${CURRENCY.symbol}100`,
      },
      {
        id: "first_underdog",
        label: "First underdog win",
        earned: firstUnderdogWin,
        progress: firstUnderdogWin ? 1 : 0,
      },
      ...(stats.bestCategory
        ? [
            {
              id: "best_category_win",
              label: `First ${stats.bestCategory.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase())} win`,
              earned: bestCategoryWin,
              progress: bestCategoryWin ? 1 : 0,
            } satisfies PredictionMilestone,
          ]
        : []),
    ];
  }, [stats, predictions]);

  const earnedCount = milestones.filter((m) => m.earned).length;
  const nextIdx = milestones.findIndex((m) => !m.earned);
  const nextProgress =
    nextIdx >= 0 && milestones[nextIdx].progress !== undefined
      ? milestones[nextIdx].progress!
      : 0;
  const denom = Math.max(1, milestones.length - 1);
  const baseFill = earnedCount > 0 ? (earnedCount - 1) / denom : 0;
  const extraFill = earnedCount < milestones.length ? nextProgress / denom : 0;
  const progressPct = Math.min(100, Math.max(0, (baseFill + extraFill) * 100));

  return (
    <Card className="p-4 sm:p-5 border-white/5 bg-card/60 backdrop-blur-sm">
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h3 className="font-semibold text-sm">Your prediction journey</h3>
          <p className="text-xs text-muted-foreground">
            {earnedCount} of {milestones.length} milestones earned
          </p>
        </div>
        <Trophy className="h-4 w-4 text-amber-500" />
      </div>

      {/* Desktop: horizontal track with connecting line + glowing earned nodes */}
      <div className="hidden md:block relative pt-1">
        <div className="absolute left-5 right-5 top-[22px] h-0.5 rounded-full bg-muted" aria-hidden />
        <div
          className="absolute left-5 top-[22px] h-0.5 rounded-full bg-gradient-to-r from-blue-500 to-blue-500/40 transition-all duration-500"
          style={{ width: `calc((100% - 40px) * ${progressPct / 100})` }}
          aria-hidden
        />
        <ol className="relative flex items-start justify-between gap-1">
          {milestones.map((m) => (
            <li key={m.id} className="flex min-w-0 flex-1 flex-col items-center gap-2">
              <div
                className={cn(
                  "relative z-10 flex h-10 w-10 items-center justify-center rounded-full border-2 bg-background transition-all",
                  m.earned
                    ? "border-blue-500 bg-blue-500/15 text-blue-500 shadow-[0_0_12px_-2px_rgba(59,130,246,0.65)]"
                    : "border-dashed border-muted-foreground/40 text-muted-foreground",
                )}
              >
                {m.earned ? <Check className="h-4 w-4" /> : <Target className="h-4 w-4" />}
              </div>
              <p
                className="line-clamp-2 max-w-[96px] text-center text-[10px] font-medium capitalize leading-tight"
                title={m.label}
              >
                {m.label}
              </p>
              {!m.earned && m.hint && (
                <p className="text-[9px] text-muted-foreground tabular-nums">{m.hint}</p>
              )}
            </li>
          ))}
        </ol>
      </div>

      {/* Mobile: vertical timeline. Line lives inside the circle column so it
          stays perfectly centred on the icons and only renders between them. */}
      <ol className="md:hidden">
        {milestones.map((m, idx) => {
          const isLast = idx === milestones.length - 1;
          return (
            <li key={m.id} className="flex gap-3">
              <div className="flex flex-col items-center">
                <div
                  className={cn(
                    "flex h-10 w-10 shrink-0 items-center justify-center rounded-full border-2 bg-background",
                    m.earned
                      ? "border-blue-500 bg-blue-500/15 text-blue-500 shadow-[0_0_12px_-2px_rgba(59,130,246,0.65)]"
                      : "border-dashed border-muted-foreground/40 text-muted-foreground",
                  )}
                >
                  {m.earned ? <Check className="h-4 w-4" /> : <Target className="h-4 w-4" />}
                </div>
                {!isLast && (
                  <div className="my-1 w-0.5 flex-1 rounded-full bg-muted" aria-hidden />
                )}
              </div>
              <div className={cn("flex-1 pt-2", isLast ? "pb-0" : "pb-4")}>
                <p className="text-sm font-medium capitalize leading-tight">{m.label}</p>
                {m.earned ? (
                  <p className="text-[10px] font-semibold uppercase tracking-wide text-blue-600 dark:text-blue-400">
                    Earned
                  </p>
                ) : (
                  <>
                    {m.hint && (
                      <p className="text-[10px] text-muted-foreground tabular-nums">{m.hint}</p>
                    )}
                    {m.progress !== undefined && m.progress > 0 && (
                      <div className="mt-1.5 h-1 w-24 overflow-hidden rounded-full bg-muted/60">
                        <div
                          className="h-full bg-gradient-to-r from-blue-500 to-cyan-500"
                          style={{ width: `${Math.round(m.progress * 100)}%` }}
                        />
                      </div>
                    )}
                  </>
                )}
              </div>
            </li>
          );
        })}
      </ol>
    </Card>
  );
}

function OverviewEmpty({ onStart }: { onStart: () => void }) {
  return (
    <Card className="p-10 text-center space-y-4">
      <div className="inline-flex items-center justify-center h-16 w-16 rounded-2xl bg-primary/10 mx-auto">
        <Zap className="h-8 w-8 text-primary" />
      </div>
      <h2 className="text-xl font-semibold">No predictions yet</h2>
      <p className="text-muted-foreground max-w-sm mx-auto">
        Predict which celebrities will rise or fall in fame. Stake credits and earn rewards when
        you&apos;re right.
      </p>
      <Button size="lg" onClick={onStart} data-testid="button-start-predicting">
        <TrendingUp className="h-4 w-4 mr-2" /> Start Predicting
      </Button>
    </Card>
  );
}

// ---------- Tab: Predictions ----------

function PredictionsTabPanel({
  isLoading,
  error,
  predictions,
  filtered,
  stats,
  categories,
  statusFilter,
  onStatusFilterChange,
  categoryFilter,
  onCategoryFilterChange,
  hiddenOnly,
  onToggleHiddenOnly,
  hiddenCount,
  profileIsPrivate,
  onToggleVisibility,
  isPending,
  copiedId,
  onShareWin,
  setLocation,
}: {
  isLoading: boolean;
  error: Error | undefined;
  predictions: UserPrediction[];
  filtered: UserPrediction[];
  stats: PredictionStats | null;
  categories: string[];
  statusFilter: StatusFilter;
  onStatusFilterChange: (v: StatusFilter) => void;
  categoryFilter: string;
  onCategoryFilterChange: (v: string) => void;
  hiddenOnly: boolean;
  onToggleHiddenOnly: () => void;
  hiddenCount: number;
  profileIsPrivate: boolean;
  onToggleVisibility: (p: UserPrediction, hidden: boolean) => void;
  isPending: boolean;
  copiedId: string | null;
  onShareWin: (p: UserPrediction) => void;
  setLocation: (to: string) => void;
}) {
  return (
    <div className="space-y-4">
      {predictions.length > 0 && (
        <div className="space-y-1.5" data-testid="predictions-filter-row">
          <ScrollableFilterRow>
            {STATUS_TABS.map((tab) => {
              const count =
                stats && tab.value !== "all"
                  ? (stats[tab.value as keyof Pick<PredictionStats, "pending" | "won" | "lost" | "refunded">] as number)
                  : stats && tab.value === "all"
                    ? stats.total
                    : undefined;
              return (
                <FilterPill
                  key={tab.value}
                  active={statusFilter === tab.value}
                  accent={STATUS_ACCENTS[tab.value]}
                  onClick={() => onStatusFilterChange(tab.value)}
                  count={count}
                  dataTestId={`status-filter-${tab.value}`}
                >
                  {tab.label}
                </FilterPill>
              );
            })}
            <FilterPill
              active={hiddenOnly}
              accent="amber"
              onClick={onToggleHiddenOnly}
              count={hiddenCount}
              dataTestId="toggle-prediction-hidden-only"
            >
              <EyeOff className="h-3 w-3" /> Hidden only
            </FilterPill>
          </ScrollableFilterRow>

          {categories.length > 1 && (
            <ScrollableFilterRow>
              <span className="shrink-0 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                Category
              </span>
              <FilterPill
                active={categoryFilter === "all"}
                accent="violet"
                onClick={() => onCategoryFilterChange("all")}
                dataTestId="category-filter-all"
              >
                All
              </FilterPill>
              {categories.map((cat) => (
                <FilterPill
                  key={cat}
                  active={categoryFilter === cat}
                  accent="violet"
                  onClick={() => onCategoryFilterChange(cat)}
                  dataTestId={`category-filter-${cat}`}
                >
                  {cat.charAt(0).toUpperCase() + cat.slice(1)}
                </FilterPill>
              ))}
            </ScrollableFilterRow>
          )}
        </div>
      )}

      {isLoading ? (
        <div className="space-y-3">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-28 w-full rounded-xl" />
          ))}
        </div>
      ) : error ? (
        <Card className="p-8 text-center">
          <TrendingUp className="h-12 w-12 mx-auto mb-4 text-destructive" />
          <h2 className="text-lg font-semibold mb-2">Couldn&apos;t load predictions</h2>
          <p className="text-muted-foreground mb-4">Please try again in a moment.</p>
          <Button onClick={() => window.location.reload()} data-testid="button-retry-predictions">
            Retry
          </Button>
        </Card>
      ) : filtered.length > 0 ? (
        <div className="space-y-3">
          {filtered.map((p) => (
            <MyPredictionCard
              key={p.betId}
              prediction={p}
              profileIsPrivate={profileIsPrivate}
              onToggleVisibility={onToggleVisibility}
              isPending={isPending}
              onShareWin={onShareWin}
              didJustShare={copiedId === p.betId}
            />
          ))}
        </div>
      ) : predictions.length > 0 ? (
        <Card className="p-8 text-center">
          <Target className="h-12 w-12 mx-auto mb-4 text-muted-foreground" />
          <h2 className="text-lg font-semibold mb-2">No matching predictions</h2>
          <p className="text-sm text-muted-foreground mb-4">
            Try adjusting your filters to see more results.
          </p>
          <Button
            variant="outline"
            onClick={() => {
              onStatusFilterChange("all");
              onCategoryFilterChange("all");
              if (hiddenOnly) onToggleHiddenOnly();
            }}
          >
            Clear Filters
          </Button>
        </Card>
      ) : (
        <OverviewEmpty onStart={() => setLocation("/predict")} />
      )}
    </div>
  );
}

// ---------- Tab: Open ----------

interface AmmOpenPosition {
  marketId: string;
  marketSlug: string;
  marketTitle: string;
  marketStatus: string;
  marketType: string;
  marketCadence: string;
  marketCategory: string;
  marketEndAt: string;
  marketStartAt: string;
  entryId: string;
  entryLabel: string;
  personName: string | null;
  personAvatar: string | null;
  netShares: number;
  netCreditsIn: number;
  avgEntryPrice: number;
  currentPrice: number;
  currentValue: number;
}

function formatAmmCountdown(iso: string): string {
  if (!iso) return "";
  const end = new Date(iso).getTime();
  if (Number.isNaN(end)) return "";
  const diff = end - Date.now();
  if (diff <= 0) return "Resolving";
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 60) return `${minutes}m left`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h left`;
  const days = Math.floor(hours / 24);
  return `${days}d left`;
}

function AmmOpenPositionCard({
  position,
  onView,
  onShare,
  onCashOut,
}: {
  position: AmmOpenPosition;
  onView: () => void;
  // Sprint 2: side-by-side Share affordance next to View. We
  // accept a handler rather than wiring `useShareCard()` here so the
  // parent can attach username + market URL context the card itself
  // doesn't have.
  onShare: () => void;
  // Opens the CashOutSheet in place — no detour via the detail page.
  onCashOut: () => void;
}) {
  const projectedPnl = position.netShares - position.netCreditsIn;
  const directionLabel = position.entryLabel?.toUpperCase?.() ?? position.entryLabel;
  // `/api/me/amm-positions` returns CLOSED_PENDING markets alongside OPEN ones
  // so a position stays visible while it waits for settlement. Trading is
  // already over though — `loadAndLockTradeContext` requires status='OPEN' — so
  // the card must not offer a cash out the server will reject as
  // `market_closed`. World Markets can sit in this state for days.
  const isAwaitingResolution = position.marketStatus === "CLOSED_PENDING";
  return (
    <Card
      className={cn(
        "group relative overflow-hidden cursor-pointer border-white/5 bg-card/60 backdrop-blur-sm",
        "transition-all duration-150 border-l-2",
        isAwaitingResolution ? "border-l-amber-500/60" : "border-l-emerald-500/60",
        "hover:border-white/10 hover:-translate-y-0.5 hover:shadow-md hover:bg-accent/5",
      )}
      onClick={onView}
      data-testid={`amm-open-${position.marketId}-${position.entryId}`}
    >
      <div className="relative p-4 sm:p-5 space-y-3">
        <div className="flex items-start gap-3">
          <div className="flex-1 min-w-0">
            <p className="font-medium text-sm leading-snug line-clamp-2">
              {position.marketTitle || "Open prediction"}
            </p>
            <p className="text-xs text-muted-foreground mt-1">
              Holding{" "}
              <span className="text-foreground font-medium">
                {position.netShares.toFixed(2)} shares
              </span>{" "}
              of{" "}
              <span className="text-foreground font-medium">{directionLabel}</span>
            </p>
          </div>
          <Badge
            className={cn(
              "text-[10px] shrink-0",
              isAwaitingResolution
                ? "bg-amber-500/25 dark:bg-amber-500/20 text-amber-700 dark:text-amber-300 border-amber-500/40 dark:border-amber-500/30"
                : "bg-emerald-500/25 dark:bg-emerald-500/20 text-emerald-600 dark:text-emerald-300 border-emerald-500/40 dark:border-emerald-500/30",
            )}
          >
            {isAwaitingResolution ? "AWAITING RESULT" : "LIVE"}
          </Badge>
        </div>

        <div className="grid grid-cols-3 gap-2 text-xs">
          <div>
            <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Cost basis</p>
            <p className="font-mono font-semibold">{formatVoxPrice(position.netCreditsIn)}</p>
          </div>
          <div>
            <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Now ≈</p>
            <p className="font-mono font-semibold">{formatVoxPrice(position.currentValue)}</p>
          </div>
          <div>
            <p className="text-[10px] uppercase tracking-wide text-muted-foreground">If win</p>
            <p className="font-mono font-semibold text-emerald-600 dark:text-emerald-400">
              {formatVoxPrice(position.netShares)}
            </p>
          </div>
        </div>

        <div className="flex items-center justify-between gap-2">
          <span className="text-[11px] text-muted-foreground">
            {formatAmmCountdown(position.marketEndAt)}
          </span>
          <Badge
            variant="outline"
            className={cn(
              "h-5 gap-1 text-[10px] font-normal",
              projectedPnl >= 0
                ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-300"
                : "border-rose-500/30 bg-rose-500/10 text-rose-600 dark:text-rose-300",
            )}
          >
            {projectedPnl >= 0 ? "+" : ""}
            {projectedPnl.toFixed(2)} potential
          </Badge>
        </div>

        <div className="flex items-center gap-2">
          <Button
            size="sm"
            disabled={isAwaitingResolution}
            className={cn(
              "flex-1 gap-1 text-white",
              isAwaitingResolution
                ? "bg-muted text-muted-foreground"
                : "bg-gradient-to-r from-violet-600 to-fuchsia-600",
            )}
            onClick={(e) => {
              e.stopPropagation();
              if (isAwaitingResolution) return;
              onCashOut();
            }}
            data-testid={`amm-open-cashout-${position.marketId}-${position.entryId}`}
          >
            {isAwaitingResolution ? (
              <>
                <Clock className="h-3.5 w-3.5" />
                Awaiting settlement
              </>
            ) : (
              <>
                <Banknote className="h-3.5 w-3.5" />
                Cash out ~{formatVox(Math.round(position.currentValue))}
              </>
            )}
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="shrink-0 px-3"
            onClick={(e) => {
              e.stopPropagation();
              onView();
            }}
          >
            View
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="shrink-0 px-3"
            aria-label="Share this position"
            onClick={(e) => {
              e.stopPropagation();
              onShare();
            }}
            data-testid={`amm-open-share-${position.marketId}-${position.entryId}`}
          >
            <Share2 className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>
    </Card>
  );
}

/**
 * Self-contained cash-out flow for the Predictions page: fetches the
 * market's live AMM state on open, dispatches the sell to the right
 * endpoint (native bet route vs community sell route), and renders
 * the shared CashOutSheet. Positions come from /api/me/amm-positions
 * which never includes jackpot (parimutuel) rows.
 */
function AmmPositionCashOut({
  position,
  onClose,
}: {
  position: AmmOpenPosition | null;
  onClose: () => void;
}) {
  const { refreshProfile } = useAuth();
  const queryClient = useQueryClient();
  const open = !!position;
  const idempotencyKey = useIdempotencyKey(open, [
    position?.marketId,
    position?.entryId,
  ]);

  // GET /api/markets/:id — polls while the sheet is open so the
  // proceeds estimate tracks the market. Also carries the market's
  // cutoff metadata (nativeDetail.bettingCutoff for native, closeAt /
  // endAt for community).
  const { data: marketDetail } = usePollingAmmState(position?.marketId, {
    enabled: open,
  });
  const detail = marketDetail as
    | {
        market?: { endAt?: string | null; closeAt?: string | null };
        ammState?: ApiAmmStateBlock | null;
        nativeDetail?: { bettingCutoff?: string | null } | null;
      }
    | undefined;

  const isCommunity = position?.marketType === "community";

  const sellMutation = useMutation({
    mutationFn: async ({
      shares,
      minPricePerShare,
    }: {
      shares: number;
      minPricePerShare?: number;
    }) => {
      if (!position) throw new Error("No position selected");
      const res = isCommunity
        ? await apiRequest(
            "POST",
            `/api/markets/${position.marketId}/sell`,
            { entryId: position.entryId, shares, minPricePerShare },
            { idempotencyKey },
          )
        : await apiRequest(
            "POST",
            `/api/native-markets/${position.marketId}/bet`,
            { entryId: position.entryId, actionType: "sell", shares, minPricePerShare },
            { idempotencyKey },
          );
      return res.json();
    },
    onMutate: () => {
      const mt = position?.marketType;
      const kind =
        mt === "community"
          ? "world"
          : mt === "h2h"
            ? "h2h"
            : mt === "race" || mt === "gainer"
              ? "gainer"
              : "updown";
      const toastId = showPendingVoteToast(kind, "Cashing out…");
      return { toastId };
    },
    onSuccess: async (data: any, _variables, context) => {
      const proceeds = Math.round(Number(data?.proceeds ?? 0));
      const mt = position?.marketType;
      showVoteToast(
        mt === "community"
          ? "world"
          : mt === "h2h"
            ? "h2h"
            : mt === "race" || mt === "gainer"
              ? "gainer"
              : "updown",
        "Cashed out",
        {
          id: context?.toastId,
          description:
            proceeds > 0
              ? `Proceeds credited: +${formatVox(proceeds)}`
              : "Proceeds have been credited to your wallet.",
        },
      );
      onClose();
      await Promise.all([
        refreshProfile?.(),
        queryClient.invalidateQueries({ queryKey: ["/api/me/amm-positions"] }),
        queryClient.invalidateQueries({ queryKey: ["/api/me/predictions"] }),
        queryClient.invalidateQueries({ queryKey: ["/api/profile/me"] }),
      ]);
    },
    onError: (err: Error, _variables, context) => {
      dismissVoteToast(context?.toastId);
      const { title, description } = parseApiError(err, "Failed to cash out position");
      toast.error(title, { description });
    },
  });

  const selection = useMemo((): CashOutSelection | null => {
    if (!position) return null;
    const label = (position.entryLabel || "").toLowerCase();
    const sideTone =
      label === "up" ? ("up" as const) : label === "down" ? ("down" as const) : ("neutral" as const);
    return {
      marketId: position.marketId,
      entryId: position.entryId,
      sideLabel:
        label === "up" || label === "down"
          ? position.entryLabel.toUpperCase()
          : position.entryLabel,
      sideTone,
      marketName: position.marketTitle || "Open prediction",
      netShares: position.netShares,
      netCreditsIn: position.netCreditsIn,
      avgEntryPrice: position.avgEntryPrice,
      bettingCutoff:
        detail?.nativeDetail?.bettingCutoff ??
        detail?.market?.closeAt ??
        detail?.market?.endAt ??
        position.marketEndAt ??
        null,
      endAt: detail?.market?.endAt ?? position.marketEndAt ?? null,
      ammState: detail?.ammState ?? null,
    };
  }, [position, detail]);

  return (
    <CashOutSheet
      open={open}
      onClose={onClose}
      selection={selection}
      liveAmmState={detail?.ammState ?? null}
      onConfirmSell={async (shares, meta) => {
        await sellMutation.mutateAsync({
          shares,
          minPricePerShare: meta?.minPricePerShare,
        });
      }}
    />
  );
}

function OpenTabPanel({
  openBets,
  isLoading,
  profileIsPrivate,
  onToggleVisibility,
  isPending,
  setLocation,
  onSharePosition,
}: {
  openBets: UserPrediction[];
  isLoading: boolean;
  profileIsPrivate: boolean;
  onToggleVisibility: (p: UserPrediction, hidden: boolean) => void;
  isPending: boolean;
  setLocation: (to: string) => void;
  // Sprint 2: parent owns the share-card dispatch so the username +
  // origin live alongside the other handlers (handleShareWin /
  // handleSharePortfolio), keeping the surface here read-only.
  onSharePosition: (p: AmmOpenPosition) => void;
}) {
  const { data: ammPositionsData, isLoading: isLoadingAmm } = useQuery<{ positions: AmmOpenPosition[] }>({
    queryKey: ["/api/me/amm-positions"],
    refetchInterval: (query) => {
      if (typeof document !== "undefined" && document.hidden) return false;
      return 60_000;
    },
  });
  const ammPositions = useMemo(
    () => (ammPositionsData?.positions ?? []).filter((p) => Math.abs(p.netShares) > 1e-6),
    [ammPositionsData],
  );
  // Position currently being cashed out via the in-place sheet.
  const [cashOutPosition, setCashOutPosition] = useState<AmmOpenPosition | null>(null);

  // Don't double-count: AMM markets are aggregated via /amm-positions, so
  // hide their per-bet rows in the open list. Jackpot tickets are the only
  // surviving non-AMM bets — they continue to render through MyPredictionCard
  // with the projected-payout framing the parimutuel jackpot resolver supports.
  const jackpotOpenBets = useMemo(
    () => openBets.filter((p) => (p.engine ?? "amm") !== "amm"),
    [openBets],
  );

  const totalStake = useMemo(
    () =>
      jackpotOpenBets.reduce((sum, p) => sum + (p.stakeAmount || 0), 0) +
      ammPositions.reduce((sum, p) => sum + (p.netCreditsIn || 0), 0),
    [jackpotOpenBets, ammPositions],
  );
  const projectedPayout = useMemo(
    () =>
      jackpotOpenBets.reduce((sum, p) => sum + (p.potentialPayout || 0), 0) +
      ammPositions.reduce((sum, p) => sum + (p.netShares || 0), 0),
    [jackpotOpenBets, ammPositions],
  );
  const totalOpenCount = jackpotOpenBets.length + ammPositions.length;

  if ((isLoading && openBets.length === 0) || (isLoadingAmm && ammPositions.length === 0 && jackpotOpenBets.length === 0)) {
    return (
      <div className="space-y-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <Skeleton key={i} className="h-28 w-full rounded-xl" />
        ))}
      </div>
    );
  }

  if (totalOpenCount === 0) {
    return (
      <Card className="p-10 text-center space-y-4">
        <div className="inline-flex items-center justify-center h-16 w-16 rounded-2xl bg-orange-500/10 mx-auto">
          <Flame className="h-8 w-8 text-orange-500" />
        </div>
        <h2 className="text-xl font-semibold">No live exposure right now</h2>
        <p className="text-muted-foreground max-w-sm mx-auto">
          You don&apos;t have any open predictions. Jump into the markets to stake your next call.
        </p>
        <Button size="lg" onClick={() => setLocation("/predict")}>
          <TrendingUp className="h-4 w-4 mr-2" /> Explore markets
        </Button>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-3 gap-3">
        <Card className="p-3 text-center space-y-1 border-white/5 bg-card/60 backdrop-blur-sm">
          <Flame className="h-4 w-4 mx-auto text-orange-500" />
          <p className="text-2xl font-mono font-bold tabular-nums">{totalOpenCount}</p>
          <p className="text-[10px] uppercase tracking-wide text-muted-foreground leading-tight">
            Open positions
          </p>
        </Card>
        <Card className="p-3 text-center space-y-1 border-white/5 bg-card/60 backdrop-blur-sm">
          <Coins className="h-4 w-4 mx-auto text-amber-500" />
          <p className="text-2xl font-mono font-bold tabular-nums">
            {formatVox(totalStake)}
          </p>
          <p className="text-[10px] uppercase tracking-wide text-muted-foreground leading-tight">
            Vox at stake
          </p>
        </Card>
        <Card className="p-3 text-center space-y-1 border-white/5 bg-card/60 backdrop-blur-sm">
          <TrendingUp className="h-4 w-4 mx-auto text-emerald-500" />
          <p className="text-2xl font-mono font-bold tabular-nums text-emerald-600 dark:text-emerald-400">
            +{formatVox(projectedPayout - totalStake)}
          </p>
          <p className="text-[10px] uppercase tracking-wide text-muted-foreground leading-tight">
            If all win
          </p>
        </Card>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {ammPositions.map((p) => (
          <AmmOpenPositionCard
            key={`amm-${p.marketId}-${p.entryId}`}
            position={p}
            onView={() => {
              const path = getRecentActivityMarketPath(
                p.marketSlug,
                p.marketType,
                p.marketId,
              );
              if (path !== "/predict") setLocation(path);
            }}
            onShare={() => onSharePosition(p)}
            onCashOut={() => setCashOutPosition(p)}
          />
        ))}
        {jackpotOpenBets.map((p) => (
          <MyPredictionCard
            key={p.betId}
            prediction={p}
            profileIsPrivate={profileIsPrivate}
            onToggleVisibility={onToggleVisibility}
            isPending={isPending}
            openMode
          />
        ))}
      </div>

      <AmmPositionCashOut
        position={cashOutPosition}
        onClose={() => setCashOutPosition(null)}
      />
    </div>
  );
}
