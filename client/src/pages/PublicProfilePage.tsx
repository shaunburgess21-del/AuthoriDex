import { useState } from "react";
import { useRoute, useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { UserProfileAvatar } from "@/components/UserProfileAvatar";
import { getAuthHeaders } from "@/lib/queryClient";
import { toast } from "sonner";
import { useRanks } from "@/hooks/useGamification";

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
import {
  ArrowLeft, User, Trophy, Vote, TrendingUp, Calendar, Lock,
  BarChart3, Coins, Target, ChevronRight, Loader2, Share2, Check,
  ArrowUpDown, EyeOff,
} from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { Skeleton } from "@/components/ui/skeleton";
import { MyVoteCard, type MyVoteCardData } from "@/components/me/MyVoteCard";
import { useShareCard } from "@/contexts/ShareCardContext";
import { UserRankBadge } from "@/components/UserRankBadge";
import { buildPositionShareData, inferDirection } from "@/lib/share-data";

interface PublicProfile {
  username: string;
  avatarUrl?: string | null;
  rank?: string;
  xpPoints?: number;
  totalVotes?: number;
  totalPredictions?: number;
  winRate?: number;
  isAgent?: boolean;
  isPublic: boolean;
  createdAt?: string;
  message?: string;
  profitLoss?: number;
  /** Same as profitLoss (= parimutuel realised + AMM realised-from-
   *  sells + AMM realised-from-resolution). Surfaced as its own
   *  field so future UX can split realised vs. unrealised without
   *  another contract change. */
  realisedPnl?: number;
  /** Sum of (currentPrice − avgEntryPrice) × netShares across every
   *  open AMM position. Positive when the user's open book is up
   *  relative to its weighted-avg cost basis. */
  unrealisedPnl?: number;
  volume?: number;
  totalBets?: number;
  biggestWin?: number;
  /** Live mark-to-market value of every open AMM position (sum of netShares*currentPrice). */
  openPositionsValue?: number;
  /** Count of distinct (market, entry) rows with non-zero net shares. */
  openPositionsCount?: number;
  agentProfile?: {
    displayName: string;
    bio?: string | null;
    archetype: string;
    specialties: string[];
    totalEntered?: number;
    accuracy?: number | null;
  } | null;
}

interface BetRecord {
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
  /** "parimutuel" for legacy pool bets, "buy"/"sell" for AMM trades. */
  actionType?: "parimutuel" | "buy" | "sell";
  shareCount?: number | null;
  pricePerShare?: number | null;
  confidence: number | null;
  thesis: string | null;
  predictedScore: number | null;
  placedAt: string;
  settledAt: string | null;
}

interface BetsResponse {
  bets: BetRecord[];
  offset: number;
  limit: number;
  hasMore: boolean;
}

function ShareLinkButton({ url, label }: { url: string; label: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async (e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      await navigator.clipboard.writeText(url);
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

// Rank rendering moved to <UserRankBadge /> — see
// client/src/components/UserRankBadge.tsx for the canonical
// implementation. Local map removed as part of the ranks overhaul
// to fix VoxMax Legend silently falling through to Citizen.

function PublicVotesSection({ username }: { username: string }) {
  const { data, isLoading, error } = useQuery<MyVoteCardData[]>({
    queryKey: ["/api/profile/u", username, "votes"],
    queryFn: async () => {
      const authHeaders = await getAuthHeaders();
      const res = await fetch(`/api/profile/u/${username}/votes`, {
        headers: authHeaders,
        credentials: "include",
      });
      if (res.status === 403 || res.status === 404) {
        // Profile private or gone — render nothing at the section level.
        return [];
      }
      if (!res.ok) throw new Error("Failed to fetch votes");
      return res.json();
    },
    enabled: !!username,
  });

  // Hide the entire section on error or when there's nothing to show.
  if (error) return null;
  if (!isLoading && (!data || data.length === 0)) return null;

  return (
    <Card className="p-6">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="font-semibold">Recent Public Votes</h2>
          <p className="text-xs text-muted-foreground">
            What this user has weighed in on lately
          </p>
        </div>
        <Badge variant="outline" className="gap-1 text-[10px]">
          <Vote className="h-3 w-3" /> {(data ?? []).length} visible
        </Badge>
      </div>

      {isLoading ? (
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-20 w-full rounded-xl" />
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {(data ?? []).slice(0, 8).map((vote) => (
            <MyVoteCard key={`${vote.voteType}-${vote.id}`} vote={vote} />
          ))}
        </div>
      )}
    </Card>
  );
}

interface PublicAmmPosition {
  marketId: string;
  marketSlug: string;
  marketTitle: string;
  marketStatus: string;
  marketType: string;
  marketCategory?: string | null;
  entryId: string;
  entryLabel: string;
  // Sprint 2: returned by `loadAmmPositionsFor` so the per-row Share
  // button can build a `position` share card with the right hero. May
  // be null for community markets without a linked person.
  personName?: string | null;
  personAvatar?: string | null;
  netShares: number;
  netCreditsIn: number;
  /** Weighted-average buy cost per share (NOT netCreditsIn/netShares,
   *  which understates avg cost for partial-sell users). */
  avgEntryPrice: number;
  currentPrice: number;
  /** netShares × currentPrice. */
  currentValue: number;
  /** (currentPrice − avgEntryPrice) × netShares, computed server-side
   *  so the panel doesn't have to redo the math. */
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

  // Build a `position` share card for one of this user's open
  // positions. Mirrors the same helper used on /me/predictions so the
  // share card output is identical whether the user opened it from
  // their own dashboard or from their public profile.
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
      // Community markets can be open-ended; the share card renders
      // "Open market" on a blank endAt rather than a misleading
      // "0m left" countdown.
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
    // Live price moves every trade — same refresh cadence as the
    // dashboard's open positions tab to stay in sync without polling
    // hard. Server adds a short Cache-Control as defense in depth.
    refetchInterval: 30_000,
  });

  const positionsPublic = data?.positionsPublic ?? true;
  const positions = data?.positions ?? [];

  // Don't render the section at all for an unknown viewer of a
  // pari-mutuel-only profile (no positions, public) — the page is
  // already busy. Keep it visible on own profile so the user can
  // confirm visibility state.
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

function BetHistorySection({ username, isAgent }: { username: string; isAgent?: boolean }) {
  const [tab, setTab] = useState<"settled" | "active">("settled");
  const [, setLocation] = useLocation();

  const { data, isLoading, error } = useQuery<BetsResponse>({
    queryKey: ["/api/profile/u", username, "bets", tab],
    queryFn: async () => {
      const authHeaders = await getAuthHeaders();
      const res = await fetch(`/api/profile/u/${username}/bets?tab=${tab}&limit=50`, {
        headers: authHeaders,
        credentials: "include",
      });
      if (!res.ok) throw new Error("Failed to fetch bets");
      return res.json();
    },
    enabled: !!username,
  });

  const bets = data?.bets ?? [];

  return (
    <Card className="p-6">
      <div className="flex items-center justify-between mb-4">
        <h2 className="font-semibold">Prediction History</h2>
        <div className="flex gap-1 p-0.5 bg-muted rounded-lg">
          <button
            onClick={() => setTab("settled")}
            className={`px-3 py-1 text-xs font-medium rounded-md transition-colors ${
              tab === "settled" ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
            }`}
          >
            Closed
          </button>
          <button
            onClick={() => setTab("active")}
            className={`px-3 py-1 text-xs font-medium rounded-md transition-colors ${
              tab === "active" ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
            }`}
          >
            Active
          </button>
        </div>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-8">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </div>
      ) : error ? (
        <div className="text-center py-8 text-destructive text-sm">
          Failed to load prediction history
        </div>
      ) : bets.length === 0 ? (
        <div className="text-center py-8 text-muted-foreground text-sm">
          {tab === "active" ? "No active predictions" : "No settled predictions yet"}
        </div>
      ) : (
        <div className="space-y-2">
          {bets.map((bet) => {
            const actionType = bet.actionType ?? "parimutuel";
            const isAmmSell = actionType === "sell";
            const isAmmBuy = actionType === "buy";
            const pricePct = bet.pricePerShare != null
              ? `${Math.round(bet.pricePerShare * 100)}%`
              : null;
            const shareCountLabel = bet.shareCount != null
              ? Math.round(bet.shareCount).toLocaleString()
              : null;
            return (
              <div
                key={bet.betId}
                className="flex items-center gap-3 p-3 rounded-lg bg-muted/30 hover:bg-muted/50 transition-colors cursor-pointer group"
                onClick={() => setLocation(`/markets/${bet.marketSlug}`)}
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-0.5">
                    {bet.status === "won" && (
                      <Badge variant="outline" className="bg-emerald-500/15 dark:bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/40 dark:border-emerald-500/30 text-[10px] px-1.5 py-0">Won</Badge>
                    )}
                    {bet.status === "lost" && (
                      <Badge variant="outline" className="bg-red-500/15 dark:bg-red-500/10 text-red-600 dark:text-red-400 border-red-500/40 dark:border-red-500/30 text-[10px] px-1.5 py-0">Lost</Badge>
                    )}
                    {bet.status === "active" && (
                      <Badge variant="outline" className="bg-blue-500/15 dark:bg-blue-500/10 text-blue-600 dark:text-blue-400 border-blue-500/40 dark:border-blue-500/30 text-[10px] px-1.5 py-0">Active</Badge>
                    )}
                    {bet.status === "settled" && isAmmSell && (
                      <Badge variant="outline" className="bg-amber-500/15 dark:bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/40 dark:border-amber-500/30 text-[10px] px-1.5 py-0">Sold</Badge>
                    )}
                    {(bet.status === "void" || bet.status === "refunded") && (
                      <Badge variant="outline" className="bg-gray-500/15 dark:bg-gray-500/10 text-gray-600 dark:text-gray-400 border-gray-500/40 dark:border-gray-500/30 text-[10px] px-1.5 py-0">Void</Badge>
                    )}
                    <span className="text-sm font-medium truncate">{bet.marketTitle}</span>
                  </div>
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <span className="text-violet-600 dark:text-violet-400 font-medium">
                      {bet.predictedScore != null
                        ? bet.entryLabel
                        : isAmmBuy && shareCountLabel
                          ? `Bought ${shareCountLabel} shares of ${bet.entryLabel}${pricePct ? ` @ ${pricePct}` : ""}`
                          : isAmmSell && shareCountLabel
                            ? `Sold ${shareCountLabel} shares of ${bet.entryLabel}${pricePct ? ` @ ${pricePct}` : ""}`
                            : bet.marketType === 'updown'
                              ? `Picked: ${bet.entryLabel}`
                              : `Backed: ${bet.entryLabel}`}
                    </span>
                    {bet.predictedScore != null && (
                      <span className="text-amber-600 dark:text-amber-400">Score: {Number(bet.predictedScore).toLocaleString()}</span>
                    )}
                    {!isAgent && bet.confidence != null && (
                      <span className="text-cyan-600 dark:text-cyan-400">{Math.round(bet.confidence * 100)}% conf</span>
                    )}
                    {!isAmmSell && (
                      <span>{bet.stakeAmount.toLocaleString()} credits</span>
                    )}
                  </div>
                </div>
                <div className="text-right shrink-0">
                  {bet.status === "won" && (
                    <span className="text-sm font-semibold text-emerald-600 dark:text-emerald-400">+{bet.pnl.toLocaleString()}</span>
                  )}
                  {bet.status === "lost" && (
                    <span className="text-sm font-semibold text-red-600 dark:text-red-400">{bet.pnl.toLocaleString()}</span>
                  )}
                  {bet.status === "settled" && isAmmSell && (
                    <span className="text-sm font-semibold text-amber-600 dark:text-amber-400">+{Math.round(bet.pnl).toLocaleString()}</span>
                  )}
                  {bet.status === "active" && (
                    <span className="text-sm text-muted-foreground">{bet.stakeAmount.toLocaleString()}</span>
                  )}
                  <ChevronRight className="h-4 w-4 text-muted-foreground ml-auto mt-0.5 opacity-0 group-hover:opacity-100 transition-opacity" />
                </div>
              </div>
            );
          })}
          {data?.hasMore && (
            <p className="text-center text-xs text-muted-foreground pt-2">Showing first {bets.length} results</p>
          )}
        </div>
      )}
    </Card>
  );
}

export default function PublicProfilePage() {
  const [, params] = useRoute("/u/:username");
  const [, setLocation] = useLocation();
  const username = params?.username;

  const { data: profile, isLoading, error } = useQuery<PublicProfile>({
    queryKey: ["/api/profile/u", username],
    enabled: !!username,
  });
  const { data: ranks } = useRanks();


  if (isLoading) {
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

  if (!profile.isPublic) {
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
  const memberSince = profile.createdAt ? new Date(profile.createdAt).toLocaleDateString("en-US", {
    year: "numeric",
    month: "long"
  }) : "Unknown";
  const accuracyPct = profile.agentProfile?.accuracy != null
    ? Math.round(profile.agentProfile.accuracy * 100)
    : null;
  const pnl = profile.profitLoss ?? 0;
  const predictions = profile.agentProfile?.totalEntered || profile.totalPredictions || 0;

  return (
    <div className="min-h-screen pb-20 md:pb-0">
      <header className="sticky top-0 z-50 border-b bg-background/80 backdrop-blur-xl">
        <div className="container mx-auto px-4 h-14 flex items-center gap-4">
          <Button variant="ghost" size="icon" onClick={() => window.history.length > 1 ? window.history.back() : setLocation("/")} data-testid="button-back">
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <span className="font-semibold flex-1">@{profile.username}</span>
          <ShareLinkButton url={`${window.location.origin}/u/${profile.username}`} label="Profile link copied!" />
        </div>
      </header>

      <div className="container mx-auto px-2 sm:px-4 py-8 max-w-2xl space-y-6">
        {/* Identity Card */}
        <Card className="p-6">
          <div className="flex items-start gap-4 mb-6">
            <UserProfileAvatar
              displayName={displayName}
              avatarUrl={profile.avatarUrl}
              className="h-20 w-20"
              fallbackClassName="text-2xl"
            />
            <div className="flex-1 min-w-0">
              <h1 className="text-2xl font-bold truncate">{displayName}</h1>
              <p className="text-muted-foreground">@{profile.username}</p>
              <div className="flex items-center gap-2 mt-3 flex-wrap">
                <UserRankBadge rank={profile.rank || "Citizen"} />
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2 text-sm text-muted-foreground mb-6">
            <Calendar className="h-4 w-4" />
            <span>Member since {memberSince}</span>
          </div>

          {/* Stats Grid */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
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
          </div>

          {/* Biggest Win highlight */}
          {(profile.biggestWin ?? 0) > 0 && (
            <div className="mt-3 flex items-center gap-2 px-3 py-2 rounded-lg bg-emerald-500/8 dark:bg-emerald-500/5 border border-emerald-500/15">
              <Target className="h-4 w-4 text-emerald-600 dark:text-emerald-400 shrink-0" />
              <span className="text-sm text-emerald-600 dark:text-emerald-400 font-medium">
                Biggest Win: +{(profile.biggestWin ?? 0).toLocaleString()} credits
              </span>
            </div>
          )}

          {/* Open AMM positions highlight (mark-to-market + unrealised
              P&L). Skipped when the user has no open AMM book so
              parimutuel-only profiles don't get an empty/zero tile.
              The unrealised P&L delta is the most useful number on
              this tile — it's what changes when prices move. */}
          {(profile.openPositionsCount ?? 0) > 0 && (
            <div className="mt-3 flex items-center gap-2 px-3 py-2 rounded-lg bg-blue-500/8 dark:bg-blue-500/5 border border-blue-500/15">
              <BarChart3 className="h-4 w-4 text-blue-600 dark:text-blue-400 shrink-0" />
              <span className="text-sm text-blue-600 dark:text-blue-400 font-medium">
                Open positions: {profile.openPositionsCount} ({Math.round(profile.openPositionsValue ?? 0).toLocaleString()} cr live value)
              </span>
              {profile.unrealisedPnl != null && Math.abs(profile.unrealisedPnl) >= 1 && (
                <span
                  className={`ml-auto text-sm font-semibold ${
                    profile.unrealisedPnl > 0
                      ? "text-emerald-600 dark:text-emerald-400"
                      : "text-red-600 dark:text-red-400"
                  }`}
                >
                  {profile.unrealisedPnl > 0 ? "+" : ""}
                  {Math.round(profile.unrealisedPnl).toLocaleString()} cr
                </span>
              )}
            </div>
          )}

          {/* Votes Cast */}
          {(profile.totalVotes ?? 0) > 0 && (
            <div className="mt-3 flex items-center gap-2 px-3 py-2 rounded-lg bg-muted/30">
              <Vote className="h-4 w-4 text-cyan-600 dark:text-cyan-400 shrink-0" />
              <span className="text-sm text-muted-foreground">
                {profile.totalVotes} votes cast
              </span>
            </div>
          )}
        </Card>

        {/* XP Progress */}
        <Card className="p-6">
          <h2 className="font-semibold mb-4">XP Progress</h2>
            <div className="flex items-center gap-4">
              <div className="flex-1">
                <div className="flex justify-end text-sm mb-2">
                  <span className="font-mono text-amber-600 dark:text-amber-400">{profile.xpPoints?.toLocaleString('en-US') || 0} XP</span>
                </div>
                {(() => {
                  const progress = getRankProgress(profile.xpPoints || 0, ranks);
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

        {/* Open AMM Positions — live MTM book. Sits between headline
            stats and the longer-form Prediction History so the
            "what are they sitting on right now" question is the first
            thing a visitor sees. */}
        {username && <OpenPositionsSection username={username} />}

        {/* Public Votes */}
        {username && <PublicVotesSection username={username} />}

        {/* Bet History */}
        {username && <BetHistorySection username={username} isAgent={profile.isAgent} />}
      </div>
    </div>
  );
}
