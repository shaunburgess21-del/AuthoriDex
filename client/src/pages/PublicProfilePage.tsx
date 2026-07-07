import { useEffect, useMemo, useState } from "react";
import { useRoute, useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { UserProfileAvatar } from "@/components/UserProfileAvatar";
import { apiRequest, getAuthHeaders } from "@/lib/queryClient";
import { toast } from "sonner";
import { useRanks } from "@/hooks/useGamification";
import {
  ArrowLeft, User, Trophy, Vote, TrendingUp, Calendar, Lock,
  BarChart3, Coins, Target, ChevronRight, Loader2, Share2, Check,
  ArrowUpDown, EyeOff, Eye, Settings, Globe, Swords, Star,
  MessageCircle, ImageIcon, UserPlus, ThumbsUp, RefreshCw, Info,
} from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { Skeleton } from "@/components/ui/skeleton";
import { MyVoteCard, type MyVoteCardData } from "@/components/me/MyVoteCard";
import { MyPredictionCard, type MyPredictionCardData } from "@/components/me/MyPredictionCard";
import { ProfileTabs, type ProfileTab } from "@/components/ProfileTabs";
import { BadgeCard, type BadgeCardData } from "@/components/BadgeCard";
import { useShareCard } from "@/contexts/ShareCardContext";
import { UserRankBadge } from "@/components/UserRankBadge";
import { getProfileTheme } from "@shared/profile-theme-config";
import { buildPositionShareData, inferDirection } from "@/lib/share-data";
import { appendShareAttribution } from "@/lib/share";
import { cn } from "@/lib/utils";
import { CountryFlag } from "@/components/ui/CountryFlag";
import { getCountryName, resolveCountryCode } from "@shared/countries";
import { getEthnicityLabel } from "@shared/ethnicity";
import { CURRENCY, formatVox } from "@/lib/currency";

type RankRow = { tier: number; name: string; minXp: number; maxXp: number | null };

function getRankProgress(xp: number, ranks: RankRow[] | undefined) {
  if (!ranks || ranks.length === 0) return null;
  const sorted = [...ranks].sort((a, b) => a.tier - b.tier);
  const cur = sorted.find(r => xp >= r.minXp && (r.maxXp === null || xp <= r.maxXp)) ?? sorted[0];
  const idx = sorted.indexOf(cur);
  const next = idx < sorted.length - 1 ? sorted[idx + 1] : null;
  const pct = next ? ((xp - cur.minXp) / (next.minXp - cur.minXp)) * 100 : 100;
  return {
    pct: Math.min(pct, 100),
    nextName: next?.name ?? null,
    xpToNext: next ? next.minXp - xp : null,
  };
}

interface PublicProfile {
  userId?: string;
  username: string;
  avatarUrl?: string | null;
  rank?: string;
  /** Per-tier visual unlocks (Phase 5) — already tier-gated server-side. */
  profileBannerUrl?: string | null;
  profileTheme?: string | null;
  xpPoints?: number;
  totalVotes?: number;
  totalPredictions?: number;
  winRate?: number;
  isPublic: boolean;
  /** Sprint 1 phase 15.C — when false, the public bets `active` tab and the
   * AMM open positions list are hidden. Settled history stays visible. */
  positionsPublic?: boolean;
  createdAt?: string;
  message?: string;
  profitLoss?: number;
  realisedPnl?: number;
  unrealisedPnl?: number;
  volume?: number;
  totalBets?: number;
  biggestWin?: number;
  openPositionsValue?: number;
  openPositionsCount?: number;
  // Demographic surface — each field is gated server-side by the
  // matching per-field visibility toggle on the profile.
  bio?: string | null;
  countryOfOrigin?: string | null;
  countryOfResidence?: string | null;
  gender?: string | null;
  ethnicity?: string | null;
  age?: number | null;
  socialXHandle?: string | null;
  socialInstagramHandle?: string | null;
  occupationIndustry?: string | null;
}

interface PublicBet {
  betId: string;
  marketSlug: string;
  marketTitle: string;
  marketType: string;
  marketCategory: string;
  entryLabel: string;
  stakeAmount: number;
  payout: number;
  pnl: number;
  status: string;
  actionType?: "parimutuel" | "buy" | "sell";
  shareCount?: number | null;
  pricePerShare?: number | null;
  thesis: string | null;
  predictedScore: number | null;
  placedAt: string;
  settledAt: string | null;
}

interface BetsResponse {
  bets: PublicBet[];
  offset: number;
  limit: number;
  hasMore: boolean;
}

// ---------- Tab plumbing ----------

const VALID_TABS = ["overview", "votes", "predictions"] as const;
type TabId = (typeof VALID_TABS)[number];
const SESSION_KEY = "public_profile_tab";

const TAB_DEFS: ProfileTab[] = [
  { id: "overview", label: "Overview", icon: Eye, accent: "#3C83F6" },
  { id: "votes", label: "Votes", icon: Vote, accent: "#22D3EE" },
  { id: "predictions", label: "Predictions", icon: TrendingUp, accent: "#8B5CF6" },
];

function getInitialTab(): TabId {
  if (typeof window === "undefined") return "overview";
  const urlParam = new URLSearchParams(window.location.search).get("tab");
  if (urlParam && (VALID_TABS as readonly string[]).includes(urlParam)) {
    return urlParam as TabId;
  }
  try {
    const stored = sessionStorage.getItem(SESSION_KEY);
    if (stored && (VALID_TABS as readonly string[]).includes(stored)) {
      return stored as TabId;
    }
  } catch {
    /* ignore */
  }
  return "overview";
}

// ---------- Bet → MyPredictionCard adapter ----------

// The public bets endpoint returns a slimmer shape than `MyPredictionCardData`
// (no marketId, no baseline/current scores, no person, etc). The shared card
// degrades gracefully when those fields are zero/empty, so we fill in just
// enough to keep the layout sensible.
function adaptPublicBet(b: PublicBet): MyPredictionCardData {
  const result: MyPredictionCardData["result"] =
    b.status === "active"
      ? "pending"
      : b.status === "won"
        ? "won"
        : b.status === "lost"
          ? "lost"
          : "refunded";
  return {
    betId: b.betId,
    marketId: "",
    marketSlug: b.marketSlug,
    marketTitle: b.marketTitle,
    marketStatus: b.status,
    marketType: b.marketType,
    marketCadence: "",
    marketCategory: b.marketCategory,
    entryLabel: b.entryLabel,
    stakeAmount: b.stakeAmount,
    potentialPayout: b.payout,
    payout: b.payout,
    result,
    baselineScore: 0,
    currentScore: 0,
    betCreatedAt: b.placedAt,
    personName: null,
    personAvatar: null,
    startAt: "",
    endAt: b.settledAt ?? "",
    engine: b.actionType === "parimutuel" ? "parimutuel" : "amm",
  };
}

// ---------- Filter pill primitives (mirrors My Votes / My Predictions) ----------

const ACCENT_CLASS: Record<string, string> = {
  cyan: "border-cyan-500/50 bg-cyan-500/15 text-cyan-600 dark:text-cyan-300",
  violet: "border-violet-500/50 bg-violet-500/15 text-violet-600 dark:text-violet-300",
  amber: "border-amber-500/50 bg-amber-500/15 text-amber-700 dark:text-amber-300",
  blue: "border-blue-500/50 bg-blue-500/15 text-blue-600 dark:text-blue-300",
};

type PillAccent = keyof typeof ACCENT_CLASS;

function FilterPill({
  active,
  onClick,
  children,
  accent = "cyan",
  count,
  dataTestId,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
  accent?: PillAccent;
  count?: number;
  dataTestId?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      data-testid={dataTestId}
      aria-pressed={active}
      className={cn(
        "inline-flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-1 text-[11px] font-medium transition-colors",
        active
          ? ACCENT_CLASS[accent]
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

// ---------- Share link helper (unchanged behaviour) ----------

function ShareLinkButton({ url, label, sharerUserId }: { url: string; label: string; sharerUserId?: string | null }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async (e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      const attributedUrl = appendShareAttribution(url, {
        sharerUserId: sharerUserId ?? null,
        surface: "public_profile",
      });
      await navigator.clipboard.writeText(attributedUrl);
      setCopied(true);
      toast(label);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error("Failed to copy link");
    }
  };

  return (
    <Button variant="ghost" size="icon" className="h-8 w-8" onClick={handleCopy} title="Copy link">
      {copied ? <Check className="h-4 w-4 text-green-600 dark:text-green-400" /> : <Share2 className="h-4 w-4" />}
    </Button>
  );
}

// ---------- Owner visibility banner ----------

function OwnerBanner({ isPublic }: { isPublic: boolean }) {
  const [, setLocation] = useLocation();
  return (
    <Card
      className={cn(
        "p-3 flex flex-wrap items-center gap-3",
        isPublic
          ? "border-emerald-500/30 bg-emerald-500/5"
          : "border-amber-500/30 bg-amber-500/5",
      )}
      data-testid="owner-banner"
    >
      <Badge
        variant="outline"
        className={cn(
          "gap-1 text-[11px]",
          isPublic
            ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
            : "border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-300",
        )}
      >
        {isPublic ? <Globe className="h-3 w-3" /> : <Lock className="h-3 w-3" />}
        Your profile is {isPublic ? "Public" : "Private"}
      </Badge>
      <p className="text-xs text-muted-foreground flex-1 min-w-[180px]">
        {isPublic
          ? "Visitors can see your public votes and predictions."
          : "Only you can see this page. Visitors see a private notice."}
      </p>
      <div className="flex items-center gap-1.5 ml-auto">
        <Button
          variant="outline"
          size="sm"
          className="h-7 gap-1.5 text-xs"
          onClick={() => setLocation("/me/settings#privacy")}
          data-testid="owner-banner-privacy"
        >
          {isPublic ? "Privacy settings" : "Make public"} →
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className="h-7 gap-1.5 text-xs"
          onClick={() => setLocation("/me/settings")}
          data-testid="owner-banner-edit"
        >
          <Settings className="h-3 w-3" /> Edit profile
        </Button>
      </div>
    </Card>
  );
}

// ---------- Open positions section (kept) ----------

interface PublicAmmPosition {
  marketId: string;
  marketSlug: string;
  marketTitle: string;
  marketStatus: string;
  marketType: string;
  marketCategory?: string | null;
  entryId: string;
  entryLabel: string;
  personName?: string | null;
  personAvatar?: string | null;
  netShares: number;
  netCreditsIn: number;
  avgEntryPrice: number;
  currentPrice: number;
  currentValue: number;
  unrealisedPnl: number;
  marketEndAt: string | null;
}

interface PublicAmmPositionsResponse {
  positions: PublicAmmPosition[];
  positionsPublic: boolean;
}

type PositionsSortKey = "pnl" | "shares" | "endAt";

function OpenPositionsSection({ username }: { username: string }) {
  const [, setLocation] = useLocation();
  const [sortKey, setSortKey] = useState<PositionsSortKey>("pnl");
  const { profile: viewer } = useAuth();
  const isOwnProfile = viewer?.username === username;
  const { openShareCard } = useShareCard();

  const handleShare = (p: PublicAmmPosition) => {
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
    const shareUrl = `${origin}${sharePath}`;
    const tradeData = buildPositionShareData({
      username,
      personName: p.personName ?? null,
      personAvatar: p.personAvatar ?? null,
      marketTitle: p.marketTitle,
      category: p.marketCategory ?? null,
      entryLabel: p.entryLabel,
      direction,
      netShares: p.netShares,
      avgEntryPrice: p.avgEntryPrice,
      currentPrice: p.currentPrice,
      costBasis: p.netCreditsIn,
      currentValue: p.currentValue,
      endAt: p.marketEndAt ?? "",
    });
    const fallbackText = `Holding ${Math.round(p.netShares)} ${p.entryLabel} shares on "${p.marketTitle}" on VoxDex.\n${shareUrl}`;
    openShareCard({
      data: tradeData,
      fallbackText,
      shareUrl,
      filenameBase: `voxdex-position-${p.marketId.slice(0, 8)}-${p.entryId.slice(0, 6)}`,
    });
  };

  const { data, isLoading, error } = useQuery<PublicAmmPositionsResponse>({
    queryKey: ["/api/users", username, "amm-positions"],
    queryFn: async () => {
      const authHeaders = await getAuthHeaders();
      const res = await fetch(`/api/users/${username}/amm-positions`, {
        headers: authHeaders,
        credentials: "include",
      });
      if (!res.ok) throw new Error("Failed to fetch positions");
      return res.json();
    },
    enabled: !!username,
    refetchInterval: 30_000,
  });

  const positionsPublic = data?.positionsPublic ?? true;
  const positions = data?.positions ?? [];

  const shouldHide =
    !isLoading &&
    !error &&
    positionsPublic &&
    positions.length === 0 &&
    !isOwnProfile;
  if (shouldHide) return null;

  const sorted = [...positions].sort((a, b) => {
    if (sortKey === "shares") return Math.abs(b.netShares) - Math.abs(a.netShares);
    if (sortKey === "endAt") {
      const aEnd = a.marketEndAt ? new Date(a.marketEndAt).getTime() : Infinity;
      const bEnd = b.marketEndAt ? new Date(b.marketEndAt).getTime() : Infinity;
      return aEnd - bEnd;
    }
    return b.unrealisedPnl - a.unrealisedPnl;
  });

  return (
    <Card className="p-6">
      <div className="flex items-center justify-between mb-4 gap-2 flex-wrap">
        <div>
          <h2 className="font-semibold">Open Positions</h2>
          <p className="text-[11px] text-muted-foreground mt-0.5">
            Live value across every open prediction{isOwnProfile ? " you're currently in" : ""}.
          </p>
        </div>
        {positions.length > 0 && (
          <div className="flex items-center gap-1 p-0.5 bg-muted rounded-lg text-xs">
            {([
              { key: "pnl", label: "P&L" },
              { key: "shares", label: "Shares" },
              { key: "endAt", label: "Ends" },
            ] as const).map(({ key, label }) => (
              <button
                key={key}
                onClick={() => setSortKey(key)}
                className={`px-2.5 py-1 rounded-md transition-colors flex items-center gap-1 ${
                  sortKey === key
                    ? "bg-background text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                <ArrowUpDown className="h-3 w-3" />
                {label}
              </button>
            ))}
          </div>
        )}
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-8">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </div>
      ) : error ? (
        <div className="text-center py-8 text-destructive text-sm">
          Failed to load open positions
        </div>
      ) : !positionsPublic ? (
        <div className="flex items-center justify-center gap-2 py-8 text-muted-foreground text-sm">
          <EyeOff className="h-4 w-4" />
          Positions hidden
        </div>
      ) : positions.length === 0 ? (
        <div className="text-center py-8 text-muted-foreground text-sm">
          No open positions
        </div>
      ) : (
        <div className="space-y-2">
          {sorted.map((p) => {
            const pnl = p.unrealisedPnl;
            const costBasis = p.netShares * p.avgEntryPrice;
            const pnlPct = costBasis > 0 ? (pnl / costBasis) * 100 : 0;
            return (
              <div
                key={`${p.marketId}-${p.entryId}`}
                className="flex items-center gap-3 p-3 rounded-lg bg-muted/30 hover:bg-muted/50 transition-colors cursor-pointer group"
                onClick={() => setLocation(`/markets/${p.marketSlug}`)}
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-0.5">
                    <span className="text-sm font-medium truncate">
                      {p.marketTitle}
                    </span>
                  </div>
                  <div className="flex items-center gap-2 text-xs text-muted-foreground flex-wrap">
                    <span className="text-violet-600 dark:text-violet-400 font-medium">
                      {p.entryLabel}
                    </span>
                    <span>
                      {Math.round(Math.abs(p.netShares)).toLocaleString()} shares
                    </span>
                    <span>
                      avg {Math.round(p.avgEntryPrice * 100)}%
                    </span>
                    <span className="text-cyan-600 dark:text-cyan-400">
                      now {Math.round(p.currentPrice * 100)}%
                    </span>
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <div className="text-right">
                    <div
                      className={`text-sm font-semibold ${
                        pnl > 0
                          ? "text-emerald-600 dark:text-emerald-400"
                          : pnl < 0
                            ? "text-red-600 dark:text-red-400"
                            : "text-muted-foreground"
                      }`}
                    >
                      {pnl > 0 ? "+" : ""}
                      {Math.round(pnl).toLocaleString()}
                    </div>
                    <div className="text-[10px] text-muted-foreground">
                      {pnl >= 0 ? "+" : ""}
                      {pnlPct.toFixed(1)}%
                    </div>
                  </div>
                  <Button
                    size="icon"
                    variant="ghost"
                    className="h-7 w-7 text-muted-foreground hover:text-foreground"
                    aria-label="Share this position"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleShare(p);
                    }}
                    data-testid={`public-position-share-${p.marketId}-${p.entryId}`}
                  >
                    <Share2 className="h-3.5 w-3.5" />
                  </Button>
                  <ChevronRight className="h-4 w-4 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
                </div>
              </div>
            );
          })}
        </div>
      )}
    </Card>
  );
}

// ---------- Shared fetch hooks for public votes/bets ----------

function usePublicVotes(username: string | undefined) {
  return useQuery<MyVoteCardData[] | { __private: true }>({
    queryKey: ["/api/profile/u", username, "votes"],
    queryFn: async () => {
      const authHeaders = await getAuthHeaders();
      const res = await fetch(`/api/profile/u/${username}/votes`, {
        headers: authHeaders,
        credentials: "include",
      });
      if (res.status === 403) return { __private: true };
      if (!res.ok) throw new Error("Failed to fetch votes");
      return res.json();
    },
    enabled: !!username,
  });
}

function usePublicBets(username: string | undefined, tab: "settled" | "active", enabled: boolean) {
  return useQuery<BetsResponse | { __private: true }>({
    queryKey: ["/api/profile/u", username, "bets", tab],
    queryFn: async () => {
      const authHeaders = await getAuthHeaders();
      const res = await fetch(`/api/profile/u/${username}/bets?tab=${tab}&limit=50`, {
        headers: authHeaders,
        credentials: "include",
      });
      if (res.status === 403) return { __private: true };
      if (!res.ok) throw new Error("Failed to fetch bets");
      return res.json();
    },
    enabled: !!username && enabled,
  });
}

// ---------- Owner hidden-count notes ----------

function OwnerHiddenVotesNote() {
  const { user } = useAuth();
  const { data } = useQuery<{ hiddenCount?: number }>({
    queryKey: ["/api/me/vote-stats"],
    queryFn: async () => {
      const authHeaders = await getAuthHeaders();
      const res = await fetch("/api/me/vote-stats", {
        credentials: "include",
        headers: authHeaders,
      });
      if (!res.ok) throw new Error("vote-stats failed");
      return res.json();
    },
    enabled: !!user,
  });
  const hidden = data?.hiddenCount ?? 0;
  if (hidden <= 0) return null;
  return (
    <p className="text-[11px] text-muted-foreground flex items-center gap-1.5">
      <EyeOff className="h-3 w-3" />
      {hidden} {hidden === 1 ? "vote is" : "votes are"} hidden from public view —{" "}
      <a href="/me/votes" className="text-primary hover:underline">
        Manage visibility →
      </a>
    </p>
  );
}

function OwnerHiddenPredictionsNote() {
  const { user } = useAuth();
  const { data } = useQuery<{ stats?: { hiddenCount?: number } } | unknown>({
    queryKey: ["/api/me/predictions"],
    enabled: !!user,
  });
  const hidden = (() => {
    if (!data || typeof data !== "object") return 0;
    const stats = (data as { stats?: { hiddenCount?: number } }).stats;
    return stats?.hiddenCount ?? 0;
  })();
  if (hidden <= 0) return null;
  return (
    <p className="text-[11px] text-muted-foreground flex items-center gap-1.5">
      <EyeOff className="h-3 w-3" />
      {hidden} {hidden === 1 ? "prediction is" : "predictions are"} hidden from public view —{" "}
      <a href="/me/predictions" className="text-primary hover:underline">
        Manage visibility →
      </a>
    </p>
  );
}

// ---------- Vote type filters (mirrors My Votes minus legacy sentiment) ----------

const VOTE_TYPE_FILTERS = [
  { value: "overall_rating", label: "Overall Rating", icon: ThumbsUp },
  { value: "face_off", label: "Matchups", icon: Swords },
  { value: "value_vote", label: "Underrated/Overrated", icon: Star },
  { value: "trending_poll", label: "Trending Polls", icon: BarChart3 },
  { value: "opinion_poll", label: "Opinion Polls", icon: MessageCircle },
  { value: "image_curate", label: "Image Votes", icon: ImageIcon },
  { value: "induction", label: "Induction", icon: UserPlus },
] as const;
type VoteFilterValue = (typeof VOTE_TYPE_FILTERS)[number]["value"];

// ---------- Recent teasers (Overview) ----------

function RecentVotesTeaser({
  username,
  onSeeAll,
}: {
  username: string;
  onSeeAll: () => void;
}) {
  const { data, isLoading } = usePublicVotes(username);
  if (isLoading) return null;
  if (!data || (data as { __private?: true }).__private) return null;
  const votes = data as MyVoteCardData[];
  if (votes.length === 0) return null;
  return (
    <Card className="p-6">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="font-semibold">Recent Votes</h2>
          <p className="text-xs text-muted-foreground">Latest public picks</p>
        </div>
        <Button variant="ghost" size="sm" className="text-xs" onClick={onSeeAll}>
          See all votes →
        </Button>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {votes.slice(0, 3).map((v) => (
          <MyVoteCard key={`${v.voteType}-${v.id}`} vote={v} />
        ))}
      </div>
    </Card>
  );
}

function RecentPredictionsTeaser({
  username,
  onSeeAll,
}: {
  username: string;
  onSeeAll: () => void;
}) {
  const { data, isLoading } = usePublicBets(username, "settled", true);
  if (isLoading) return null;
  if (!data || (data as { __private?: true }).__private) return null;
  const bets = (data as BetsResponse).bets;
  if (bets.length === 0) return null;
  return (
    <Card className="p-6">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="font-semibold">Recent Predictions</h2>
          <p className="text-xs text-muted-foreground">Latest settled outcomes</p>
        </div>
        <Button variant="ghost" size="sm" className="text-xs" onClick={onSeeAll}>
          See all predictions →
        </Button>
      </div>
      <div className="space-y-3">
        {bets.slice(0, 3).map((b) => (
          <MyPredictionCard key={b.betId} prediction={adaptPublicBet(b)} />
        ))}
      </div>
    </Card>
  );
}

// ---------- Votes tab panel ----------

function VotesTabPanel({
  username,
  displayName,
  isOwner,
}: {
  username: string;
  displayName: string;
  isOwner: boolean;
}) {
  const [filter, setFilter] = useState<VoteFilterValue | null>(null);
  const { data, isLoading, error, refetch, isFetching } = usePublicVotes(username);

  if (data && (data as { __private?: true }).__private) {
    return <PrivateNotice />;
  }
  const votes = (data as MyVoteCardData[] | undefined) ?? [];
  const filtered = filter ? votes.filter((v) => v.voteType === filter) : votes;

  return (
    <div className="space-y-4">
      <ScrollableFilterRow>
        <FilterPill active={!filter} onClick={() => setFilter(null)} dataTestId="public-votes-filter-all">
          All
        </FilterPill>
        {VOTE_TYPE_FILTERS.map((t) => {
          const Icon = t.icon;
          const present = votes.some((v) => v.voteType === t.value);
          if (!present && filter !== t.value) return null;
          return (
            <FilterPill
              key={t.value}
              active={filter === t.value}
              onClick={() => setFilter(t.value)}
              dataTestId={`public-votes-filter-${t.value}`}
            >
              <Icon className="h-3 w-3" />
              {t.label}
            </FilterPill>
          );
        })}
      </ScrollableFilterRow>

      {isOwner && <OwnerHiddenVotesNote />}

      {isLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {[1, 2, 3, 4].map((i) => (
            <Skeleton key={i} className="h-24 w-full rounded-xl" />
          ))}
        </div>
      ) : error ? (
        <Card className="p-8 text-center">
          <Vote className="h-12 w-12 mx-auto mb-4 text-destructive" />
          <h3 className="text-lg font-semibold mb-2">Couldn't load votes</h3>
          <Button onClick={() => refetch()} disabled={isFetching} data-testid="public-votes-retry">
            <RefreshCw className="h-4 w-4 mr-1.5" /> Retry
          </Button>
        </Card>
      ) : filtered.length === 0 ? (
        <Card className="p-8 text-center text-sm text-muted-foreground">
          {votes.length === 0
            ? `${displayName} hasn't made any public votes yet.`
            : "No votes match this filter."}
        </Card>
      ) : (
        <>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {filtered.map((v) => (
              <MyVoteCard key={`${v.voteType}-${v.id}`} vote={v} />
            ))}
          </div>
          {votes.length >= 50 && (
            <p className="text-center text-[11px] text-muted-foreground">
              Showing first 50 public votes
            </p>
          )}
        </>
      )}
    </div>
  );
}

// ---------- Predictions tab panel ----------

function PredictionsTabPanel({
  username,
  displayName,
  isOwner,
  positionsPublic,
}: {
  username: string;
  displayName: string;
  isOwner: boolean;
  positionsPublic: boolean;
}) {
  const [subTab, setSubTab] = useState<"settled" | "active">("settled");
  const [category, setCategory] = useState<string>("all");

  const settledQuery = usePublicBets(username, "settled", true);
  // Skip the active fetch entirely when positions are private (server would
  // return an empty list anyway). Avoids a needless round-trip.
  const activeEnabled = positionsPublic;
  const activeQuery = usePublicBets(username, "active", activeEnabled);

  const activeData =
    subTab === "settled"
      ? settledQuery
      : activeQuery;

  if (settledQuery.data && (settledQuery.data as { __private?: true }).__private) {
    return <PrivateNotice />;
  }

  const settledBets = settledQuery.data && !(settledQuery.data as { __private?: true }).__private
    ? (settledQuery.data as BetsResponse).bets
    : [];
  const activeBets = activeQuery.data && !(activeQuery.data as { __private?: true }).__private
    ? (activeQuery.data as BetsResponse).bets
    : [];
  const bets = subTab === "settled" ? settledBets : activeBets;

  // Categories derived from both tabs so the pill set is stable as the user
  // flips between Settled and Active.
  const categories = useMemo(() => {
    const set = new Set<string>();
    for (const b of [...settledBets, ...activeBets]) {
      if (b.marketCategory) set.add(b.marketCategory);
    }
    return Array.from(set).sort();
  }, [settledBets, activeBets]);

  const filtered = category === "all"
    ? bets
    : bets.filter((b) => b.marketCategory === category);

  const positionsHidden = subTab === "active" && !positionsPublic;

  return (
    <div className="space-y-4">
      <div className="flex gap-1 p-0.5 bg-muted rounded-lg w-fit">
        <button
          onClick={() => setSubTab("settled")}
          className={cn(
            "px-3 py-1.5 text-xs font-medium rounded-md transition-colors",
            subTab === "settled"
              ? "bg-background text-foreground shadow-sm"
              : "text-muted-foreground hover:text-foreground",
          )}
          data-testid="public-predictions-subtab-settled"
        >
          Settled
        </button>
        <button
          onClick={() => setSubTab("active")}
          className={cn(
            "px-3 py-1.5 text-xs font-medium rounded-md transition-colors",
            subTab === "active"
              ? "bg-background text-foreground shadow-sm"
              : "text-muted-foreground hover:text-foreground",
          )}
          data-testid="public-predictions-subtab-active"
        >
          Active
        </button>
      </div>

      {categories.length > 1 && !positionsHidden && (
        <ScrollableFilterRow>
          <FilterPill
            active={category === "all"}
            accent="violet"
            onClick={() => setCategory("all")}
            dataTestId="public-predictions-category-all"
          >
            All
          </FilterPill>
          {categories.map((cat) => (
            <FilterPill
              key={cat}
              active={category === cat}
              accent="violet"
              onClick={() => setCategory(cat)}
              dataTestId={`public-predictions-category-${cat}`}
            >
              {cat.charAt(0).toUpperCase() + cat.slice(1)}
            </FilterPill>
          ))}
        </ScrollableFilterRow>
      )}

      {isOwner && <OwnerHiddenPredictionsNote />}

      {positionsHidden ? (
        <Card className="p-8 text-center">
          <Lock className="h-10 w-10 mx-auto mb-3 text-muted-foreground" />
          <p className="text-sm text-muted-foreground">
            {displayName} has chosen to keep open positions private.
          </p>
        </Card>
      ) : activeData.isLoading ? (
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-28 w-full rounded-xl" />
          ))}
        </div>
      ) : activeData.error ? (
        <Card className="p-8 text-center">
          <TrendingUp className="h-12 w-12 mx-auto mb-4 text-destructive" />
          <h3 className="text-lg font-semibold mb-2">Couldn't load predictions</h3>
          <Button onClick={() => activeData.refetch()} data-testid="public-predictions-retry">
            <RefreshCw className="h-4 w-4 mr-1.5" /> Retry
          </Button>
        </Card>
      ) : filtered.length === 0 ? (
        <Card className="p-8 text-center text-sm text-muted-foreground">
          {bets.length === 0
            ? subTab === "settled"
              ? `${displayName} has no public settled predictions yet.`
              : `${displayName} has no open positions currently.`
            : "No predictions match this category."}
        </Card>
      ) : (
        <>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {filtered.map((b) => (
              <MyPredictionCard
                key={b.betId}
                prediction={adaptPublicBet(b)}
                openMode={subTab === "active"}
              />
            ))}
          </div>
          {bets.length >= 50 && (
            <p className="text-center text-[11px] text-muted-foreground">
              Showing first 50 — refine with the category filter
            </p>
          )}
        </>
      )}
    </div>
  );
}

function PrivateNotice() {
  return (
    <Card className="p-8 text-center">
      <Lock className="h-12 w-12 mx-auto mb-4 text-muted-foreground" />
      <h3 className="text-lg font-semibold mb-1">Private Profile</h3>
      <p className="text-sm text-muted-foreground">
        This user has chosen to keep their profile private.
      </p>
    </Card>
  );
}

// ---------- Identity card (header section in Overview) ----------

function ProfileIdentityCard({
  profile,
  displayName,
  memberSince,
  accuracyPct,
  pnl,
  predictions,
}: {
  profile: PublicProfile;
  displayName: string;
  memberSince: string;
  accuracyPct: number | null;
  pnl: number;
  predictions: number;
}) {
  // Per-tier visual unlocks (Phase 5). Both are already tier-gated by
  // the API (it nulls them out when the owner's current rank no longer
  // qualifies), so we render whatever the server sends.
  const theme = getProfileTheme(profile.profileTheme);
  const banner = profile.profileBannerUrl;

  return (
    <Card
      className="overflow-hidden p-0"
      style={theme ? { borderColor: `${theme.accent}55` } : undefined}
    >
      {banner && (
        <div className="h-32 w-full bg-muted sm:h-40">
          <img src={banner} alt="" className="h-full w-full object-cover" />
        </div>
      )}
      <div
        className="p-6"
        style={
          theme
            ? { background: `linear-gradient(180deg, ${theme.gradient[0]}26, transparent 55%)` }
            : undefined
        }
      >
      <div className={`flex items-start gap-4 mb-6 ${banner ? "-mt-14 sm:-mt-16" : ""}`}>
        <UserProfileAvatar
          displayName={displayName}
          avatarUrl={profile.avatarUrl}
          className={`h-20 w-20 ${banner ? "rounded-full ring-4 ring-background" : ""}`}
          fallbackClassName="text-2xl"
        />
        <div className="flex-1 min-w-0">
          <h1 className={`text-2xl font-bold truncate ${banner ? "mt-14 sm:mt-16" : ""}`}>{displayName}</h1>
          <p className="text-muted-foreground">@{profile.username}</p>
          <div className="flex items-center gap-2 mt-3 flex-wrap">
            <UserRankBadge rank={profile.rank || "Citizen"} />
          </div>
        </div>
      </div>

      <div className="flex items-center gap-2 text-sm text-muted-foreground mb-3">
        <Calendar className="h-4 w-4" />
        <span>Member since {memberSince}</span>
      </div>

      <ProfileAboutStrip profile={profile} className="mb-6" />

      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
        <div className="p-3 rounded-lg bg-muted/50 text-center">
          <TrendingUp className="h-4 w-4 mx-auto mb-1.5 text-violet-600 dark:text-violet-400" />
          <p className="text-xl font-bold">{predictions}</p>
          <p className="text-[10px] text-muted-foreground">Predictions</p>
        </div>
        <div className="p-3 rounded-lg bg-muted/50 text-center">
          <Coins className="h-4 w-4 mx-auto mb-1.5 text-amber-600 dark:text-amber-400" />
          <p className={`text-xl font-bold ${pnl > 0 ? "text-emerald-600 dark:text-emerald-400" : pnl < 0 ? "text-red-600 dark:text-red-400" : ""}`}>
            {pnl > 0 ? "+" : ""}{pnl.toLocaleString()}
          </p>
          <p className="text-[10px] text-muted-foreground">P&L</p>
        </div>
        <div className="p-3 rounded-lg bg-muted/50 text-center">
          <BarChart3 className="h-4 w-4 mx-auto mb-1.5 text-cyan-600 dark:text-cyan-400" />
          <p className="text-xl font-bold">{(profile.volume ?? 0).toLocaleString()}</p>
          <p className="text-[10px] text-muted-foreground">Volume</p>
        </div>
        <div className="p-3 rounded-lg bg-muted/50 text-center">
          <Trophy className="h-4 w-4 mx-auto mb-1.5 text-emerald-600 dark:text-emerald-400" />
          <p className="text-xl font-bold">{accuracyPct ?? profile.winRate ?? 0}%</p>
          <p className="text-[10px] text-muted-foreground">Win Rate</p>
        </div>
        <div className="p-3 rounded-lg bg-muted/50 text-center col-span-2 sm:col-span-1">
          <Vote className="h-4 w-4 mx-auto mb-1.5 text-cyan-600 dark:text-cyan-400" />
          <p className="text-xl font-bold">{(profile.totalVotes ?? 0).toLocaleString()}</p>
          <p className="text-[10px] text-muted-foreground">Public Votes</p>
        </div>
      </div>

      {(profile.biggestWin ?? 0) > 0 && (
        <div className="mt-3 flex items-center gap-2 px-3 py-2 rounded-lg bg-emerald-500/8 dark:bg-emerald-500/5 border border-emerald-500/15">
          <Target className="h-4 w-4 text-emerald-600 dark:text-emerald-400 shrink-0" />
          <span className="text-sm text-emerald-600 dark:text-emerald-400 font-medium">
            Biggest Win: +{formatVox(profile.biggestWin ?? 0)}
          </span>
        </div>
      )}

      {(profile.openPositionsCount ?? 0) > 0 && (
        <div className="mt-3 flex items-center gap-2 px-3 py-2 rounded-lg bg-blue-500/8 dark:bg-blue-500/5 border border-blue-500/15">
          <BarChart3 className="h-4 w-4 text-blue-600 dark:text-blue-400 shrink-0" />
          <span className="text-sm text-blue-600 dark:text-blue-400 font-medium">
            Open positions: {profile.openPositionsCount} ({formatVox(Math.round(profile.openPositionsValue ?? 0))} live value)
          </span>
          {profile.unrealisedPnl != null && Math.abs(profile.unrealisedPnl) >= 1 && (
            <span
              className={`ml-auto text-sm font-semibold ${
                profile.unrealisedPnl > 0
                  ? "text-emerald-600 dark:text-emerald-400"
                  : "text-red-600 dark:text-red-400"
              }`}
            >
              {profile.unrealisedPnl > 0 ? "+" : "\u2212"}{CURRENCY.symbol}
              {Math.round(Math.abs(profile.unrealisedPnl)).toLocaleString()}
            </span>
          )}
        </div>
      )}
      </div>
    </Card>
  );
}

// Renders the user's gated demographic surface — bio, country (with
// flags), age, gender, ethnicity, occupation, social handles. Each
// field only appears when the matching per-field visibility toggle is
// on; the server already redacts hidden fields, so we just render
// what's present.
function ProfileAboutStrip({
  profile,
  className,
}: {
  profile: PublicProfile;
  className?: string;
}) {
  const GENDER_LABELS: Record<string, string> = {
    male: "Male",
    female: "Female",
    woman: "Female",
    man: "Male",
    non_binary: "Non-binary",
    prefer_not_to_say: "Prefer not to say",
    other: "Other",
  };

  const originCode = resolveCountryCode(profile.countryOfOrigin ?? null);
  const residenceCode = resolveCountryCode(profile.countryOfResidence ?? null);
  const originName =
    getCountryName(originCode) ??
    profile.countryOfOrigin ??
    null;
  const residenceName =
    getCountryName(residenceCode) ??
    profile.countryOfResidence ??
    null;
  const sameCountry =
    originName && residenceName && originName === residenceName;

  const items: React.ReactNode[] = [];

  if (originName) {
    items.push(
      <span
        key="origin"
        className="inline-flex items-center gap-1.5"
        title="Country of origin"
      >
        <CountryFlag code={originCode ?? profile.countryOfOrigin} title={originName} />
        <span>{originName}</span>
        {!sameCountry && residenceName && (
          <span className="text-muted-foreground">(origin)</span>
        )}
      </span>,
    );
  }

  if (residenceName && !sameCountry) {
    items.push(
      <span
        key="residence"
        className="inline-flex items-center gap-1.5"
        title="Country of residence"
      >
        <CountryFlag code={residenceCode ?? profile.countryOfResidence} title={residenceName} />
        <span>{residenceName}</span>
        <span className="text-muted-foreground">(resides)</span>
      </span>,
    );
  }

  if (typeof profile.age === "number") {
    items.push(
      <span key="age" className="inline-flex items-center gap-1">
        <span>{profile.age}</span>
        <span className="text-muted-foreground">yrs</span>
      </span>,
    );
  }

  if (profile.gender) {
    items.push(
      <span key="gender" className="capitalize">
        {GENDER_LABELS[profile.gender] ?? profile.gender}
      </span>,
    );
  }

  if (profile.ethnicity) {
    items.push(
      <span key="ethnicity">
        {getEthnicityLabel(profile.ethnicity)}
      </span>,
    );
  }

  if (profile.occupationIndustry) {
    items.push(
      <span key="occupation">{profile.occupationIndustry}</span>,
    );
  }

  const hasBio = Boolean(profile.bio?.trim());
  const hasSocials = Boolean(
    profile.socialXHandle || profile.socialInstagramHandle,
  );

  if (items.length === 0 && !hasBio && !hasSocials) {
    return null;
  }

  return (
    <div className={cn("space-y-2", className)}>
      {hasBio && (
        <p className="text-sm text-foreground/90 whitespace-pre-line">
          {profile.bio}
        </p>
      )}
      {items.length > 0 && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-sm text-foreground/80">
          {items.map((node, i) => (
            <div key={i} className="flex items-center">
              {i > 0 && (
                <span className="mr-3 h-1 w-1 rounded-full bg-muted-foreground/40" />
              )}
              {node}
            </div>
          ))}
        </div>
      )}
      {hasSocials && (
        <div className="flex flex-wrap items-center gap-3 text-sm">
          {profile.socialXHandle && (
            <a
              href={`https://x.com/${profile.socialXHandle}`}
              target="_blank"
              rel="noopener noreferrer"
              className="text-muted-foreground hover:text-foreground transition-colors"
            >
              @{profile.socialXHandle} on X
            </a>
          )}
          {profile.socialInstagramHandle && (
            <a
              href={`https://instagram.com/${profile.socialInstagramHandle}`}
              target="_blank"
              rel="noopener noreferrer"
              className="text-muted-foreground hover:text-foreground transition-colors"
            >
              @{profile.socialInstagramHandle} on Instagram
            </a>
          )}
        </div>
      )}
    </div>
  );
}

function PublicBadgesSection({ userId }: { userId: string }) {
  const { data, isLoading } = useQuery<BadgeCardData[]>({
    queryKey: [`/api/users/${userId}/badges`],
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/users/${userId}/badges`);
      return res.json();
    },
  });

  if (isLoading) {
    return (
      <Card className="p-6">
        <div className="h-5 w-32 mb-4 rounded bg-muted/40 animate-pulse" />
        <div className="flex flex-wrap gap-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <div
              key={i}
              className="h-20 w-20 rounded-lg bg-muted/30 animate-pulse"
            />
          ))}
        </div>
      </Card>
    );
  }
  const badges = data ?? [];
  if (badges.length === 0) return null;

  const visible = badges.slice(0, 8);
  const more = badges.length - visible.length;

  return (
    <Card className="p-6">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="font-semibold flex items-center gap-2">
            <Trophy className="h-4 w-4 text-amber-500" /> Badges
          </h2>
          <p className="text-xs text-muted-foreground">
            {badges.length} earned
          </p>
        </div>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        {visible.map((b) => (
          <BadgeCard key={b.key} badge={b} size="sm" showCategory />
        ))}
      </div>
      {more > 0 && (
        <p className="mt-3 text-xs text-muted-foreground">
          +{more} more {more === 1 ? "badge" : "badges"}
        </p>
      )}
    </Card>
  );
}

function XpProgressCard({
  xp,
  ranks,
}: {
  xp: number;
  ranks: RankRow[] | undefined;
}) {
  return (
    <Card className="p-6">
      <h2 className="font-semibold mb-4">XP Progress</h2>
      <div className="flex items-center gap-4">
        <div className="flex-1">
          <div className="flex justify-end text-sm mb-2">
            <span className="font-mono text-amber-600 dark:text-amber-400">
              {xp.toLocaleString("en-US")} XP
            </span>
          </div>
          {(() => {
            const progress = getRankProgress(xp, ranks);
            if (!progress) {
              return <div className="h-2 bg-muted rounded-full overflow-hidden" />;
            }
            return (
              <>
                <div className="h-2 bg-muted rounded-full overflow-hidden">
                  <div
                    className="h-full bg-gradient-to-r from-amber-500 to-orange-500 rounded-full"
                    style={{ width: `${progress.pct}%` }}
                  />
                </div>
                <p className="text-xs text-muted-foreground mt-1">
                  {progress.nextName && progress.xpToNext !== null
                    ? `${progress.xpToNext.toLocaleString()} XP to ${progress.nextName}`
                    : "Max rank reached"}
                </p>
              </>
            );
          })()}
        </div>
      </div>
    </Card>
  );
}

// ---------- Page ----------

export default function PublicProfilePage() {
  const [, params] = useRoute("/u/:username");
  const [, setLocation] = useLocation();
  const { user: viewerUser } = useAuth();
  const username = params?.username;

  const { data: profile, isLoading, error } = useQuery<PublicProfile>({
    queryKey: ["/api/profile/u", username],
    enabled: !!username,
  });
  const { data: ranks } = useRanks();

  const [activeTab, setActiveTab] = useState<TabId>(getInitialTab);

  // Persist tab selection in sessionStorage and reflect in URL so deep links
  // round-trip cleanly. We use replaceState (not setLocation) to avoid
  // pushing a new history entry per tab click.
  const handleTabChange = (next: string) => {
    const tab = (VALID_TABS as readonly string[]).includes(next) ? (next as TabId) : "overview";
    setActiveTab(tab);
    try {
      sessionStorage.setItem(SESSION_KEY, tab);
    } catch {
      /* ignore */
    }
    if (typeof window === "undefined") return;
    const url = new URL(window.location.href);
    if (tab === "overview") url.searchParams.delete("tab");
    else url.searchParams.set("tab", tab);
    window.history.replaceState({}, "", url.toString());
  };

  // If the user lands with ?tab=... we initialised correctly via
  // getInitialTab. If they navigate within the SPA to a fresh /u/:username,
  // re-read the URL so deep links from elsewhere still work.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const fromUrl = new URLSearchParams(window.location.search).get("tab");
    if (fromUrl && (VALID_TABS as readonly string[]).includes(fromUrl) && fromUrl !== activeTab) {
      setActiveTab(fromUrl as TabId);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [username]);

  if (isLoading && !profile) {
    return (
      <div className="min-h-screen pb-20 md:pb-0">
        <header className="sticky top-0 z-50 border-b bg-background/80 backdrop-blur-xl">
          <div className="container mx-auto px-4 h-14 flex items-center gap-4">
            <Button variant="ghost" size="icon" onClick={() => window.history.length > 1 ? window.history.back() : setLocation("/")} data-testid="button-back">
              <ArrowLeft className="h-5 w-5" />
            </Button>
            <Skeleton className="h-6 w-32" />
          </div>
        </header>
        <div className="container mx-auto px-2 sm:px-4 py-8 max-w-2xl">
          <div className="flex items-center gap-4 mb-6">
            <Skeleton className="h-20 w-20 rounded-full" />
            <div className="space-y-2">
              <Skeleton className="h-6 w-40" />
              <Skeleton className="h-4 w-24" />
            </div>
          </div>
          <div className="grid grid-cols-3 gap-4">
            <Skeleton className="h-24" />
            <Skeleton className="h-24" />
            <Skeleton className="h-24" />
          </div>
        </div>
      </div>
    );
  }

  if (error || !profile) {
    return (
      <div className="min-h-screen pb-20 md:pb-0">
        <header className="sticky top-0 z-50 border-b bg-background/80 backdrop-blur-xl">
          <div className="container mx-auto px-4 h-14 flex items-center gap-4">
            <Button variant="ghost" size="icon" onClick={() => window.history.length > 1 ? window.history.back() : setLocation("/")} data-testid="button-back">
              <ArrowLeft className="h-5 w-5" />
            </Button>
            <span className="font-semibold">Profile</span>
          </div>
        </header>
        <div className="container mx-auto px-2 sm:px-4 py-16 max-w-md">
          <Card className="p-8 text-center">
            <User className="h-16 w-16 mx-auto mb-4 text-muted-foreground" />
            <h2 className="text-xl font-semibold mb-2">User Not Found</h2>
            <p className="text-muted-foreground">The user @{username} does not exist.</p>
            <Button variant="outline" className="mt-6" onClick={() => setLocation("/")} data-testid="button-go-home">Go to Homepage</Button>
          </Card>
        </div>
      </div>
    );
  }

  const isOwner = !!viewerUser?.id && !!profile.userId && viewerUser.id === profile.userId;

  // Private profile: visitors get the lock screen; the owner gets the full
  // page (with the amber banner) so they can preview exactly what will
  // appear once they flip the toggle.
  if (!profile.isPublic && !isOwner) {
    return (
      <div className="min-h-screen pb-20 md:pb-0">
        <header className="sticky top-0 z-50 border-b bg-background/80 backdrop-blur-xl">
          <div className="container mx-auto px-4 h-14 flex items-center gap-4">
            <Button variant="ghost" size="icon" onClick={() => window.history.length > 1 ? window.history.back() : setLocation("/")} data-testid="button-back">
              <ArrowLeft className="h-5 w-5" />
            </Button>
            <span className="font-semibold">Profile</span>
          </div>
        </header>
        <div className="container mx-auto px-2 sm:px-4 py-16 max-w-md">
          <Card className="p-8 text-center">
            <Lock className="h-16 w-16 mx-auto mb-4 text-muted-foreground" />
            <h2 className="text-xl font-semibold mb-2">Private Profile</h2>
            <p className="text-muted-foreground">This user has chosen to keep their profile private.</p>
            <Button variant="outline" className="mt-6" onClick={() => setLocation("/")} data-testid="button-go-home">Go to Homepage</Button>
          </Card>
        </div>
      </div>
    );
  }

  const displayName = profile.username || "User";
  const memberSince = profile.createdAt
    ? new Date(profile.createdAt).toLocaleDateString("en-US", { year: "numeric", month: "long" })
    : "Unknown";
  const accuracyPct =
    profile.winRate != null && profile.winRate > 0
      ? Math.round(profile.winRate)
      : null;
  const pnl = profile.profitLoss ?? 0;
  const predictions = profile.totalPredictions ?? 0;
  const positionsPublic = profile.positionsPublic ?? true;

  return (
    <div className="min-h-screen pb-20 md:pb-0">
      <header className="sticky top-0 z-50 border-b bg-background/80 backdrop-blur-xl">
        <div className="container mx-auto px-4 h-14 flex items-center gap-4">
          <Button variant="ghost" size="icon" onClick={() => window.history.length > 1 ? window.history.back() : setLocation("/")} data-testid="button-back">
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <span className="font-semibold flex-1">@{profile.username}</span>
          <ShareLinkButton url={`${window.location.origin}/u/${profile.username}`} label="Profile link copied!" sharerUserId={viewerUser?.id ?? null} />
        </div>
      </header>

      <div className="container mx-auto px-2 sm:px-4 py-6 max-w-3xl space-y-4">
        {isOwner && <OwnerBanner isPublic={profile.isPublic} />}

        {/* Tab row — horizontal on mobile via ProfileTabs' built-in layout. */}
        <ProfileTabs
          activeTab={activeTab}
          onTabChange={handleTabChange}
          tabs={TAB_DEFS}
          noBottomMargin
        />

        {activeTab === "overview" && (
          <div className="space-y-6 pt-2">
            <ProfileIdentityCard
              profile={profile}
              displayName={displayName}
              memberSince={memberSince}
              accuracyPct={accuracyPct}
              pnl={pnl}
              predictions={predictions}
            />

            {profile.userId && <PublicBadgesSection userId={profile.userId} />}

            <XpProgressCard xp={profile.xpPoints || 0} ranks={ranks} />

            {/* Open positions card respects positionsPublic internally. */}
            {username && positionsPublic && <OpenPositionsSection username={username} />}

            {username && (
              <RecentVotesTeaser
                username={username}
                onSeeAll={() => handleTabChange("votes")}
              />
            )}

            {username && (
              <RecentPredictionsTeaser
                username={username}
                onSeeAll={() => handleTabChange("predictions")}
              />
            )}

            {isOwner && (
              <Card className="p-3 flex items-center gap-2 text-[11px] text-muted-foreground border-dashed">
                <Info className="h-3.5 w-3.5 shrink-0" />
                <span>
                  You're viewing your own public profile. Anything hidden via your{" "}
                  <a href="/me/votes" className="text-primary hover:underline">My Votes</a>
                  {" "}or{" "}
                  <a href="/me/predictions" className="text-primary hover:underline">My Predictions</a>
                  {" "}pages won't appear here.
                </span>
              </Card>
            )}
          </div>
        )}

        {activeTab === "votes" && username && (
          <div className="pt-2">
            <VotesTabPanel
              username={username}
              displayName={displayName}
              isOwner={isOwner}
            />
          </div>
        )}

        {activeTab === "predictions" && username && (
          <div className="pt-2">
            <PredictionsTabPanel
              username={username}
              displayName={displayName}
              isOwner={isOwner}
              positionsPublic={positionsPublic}
            />
          </div>
        )}
      </div>
    </div>
  );
}
