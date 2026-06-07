import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import {
  AlarmClock,
  Flame,
  LineChart as LineChartIcon,
  Trophy,
  Zap,
} from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { InsightsSection, InsightsEmptyState } from "./insights-ui";
import { PersonAvatar } from "@/components/PersonAvatar";
import { useInsightsQuery } from "@/lib/insights-hooks";
import { logInsightsEvent } from "@/lib/insights-telemetry";
import { formatVox, formatVoxCompact } from "@/lib/currency";
import { cn } from "@/lib/utils";
import type {
  ContestedMarket,
  InsightsMarketsAnalytics,
} from "@shared/insights/types";

/**
 * V1 Predict tab — lifts existing market analytics + adds activity tiles.
 *
 * Tiles:
 *  - Hottest markets by volume (top across all native + community)
 *  - Closing soon (cutoff/end within ~48h)
 *  - Most contested markets (merged AMM + parimutuel, closest to even split)
 *  - Open interest by type (lifted)
 *  - Live bet feed (/api/predict/recent-activity)
 *  - Top predictors this week (/api/leaderboard/users?period=week)
 */

interface NativeMarket {
  id: string;
  slug?: string;
  title: string;
  marketType: "updown" | "h2h" | "gainer" | "jackpot";
  category: string | null;
  volume: number;
  bettingCutoff: string | null;
  resolutionDeadline: string | null;
  status?: string;
}

interface OpenMarket {
  id: string;
  slug?: string;
  title?: string;
  marketType?: string;
  endAt?: string | null;
  closeAt?: string | null;
  category?: string | null;
  volume?: number;
}

interface RecentBet {
  id: string;
  createdAt: string;
  stakeAmount: number;
  actionType: "parimutuel" | "buy" | "sell";
  choiceLabel: string;
  marketId: string;
  marketTitle: string;
  marketSlug: string | null;
  marketType: string;
  displayName: string;
  avatarUrl: string | null;
  isAgent: boolean;
}

interface LeaderboardUser {
  userId: string;
  username: string | null;
  displayName?: string;
  avatarUrl: string | null;
  totalPnl: number;
  winCount: number;
  totalResolved: number;
  winRate?: number;
}

async function fetchJson<T>(path: string): Promise<T> {
  const res = await fetch(path, { credentials: "include" });
  if (!res.ok) throw new Error(`Failed: ${path}`);
  return res.json();
}

function marketTypeLabel(marketType: string): string {
  if (marketType === "gainer") return "Race";
  return marketType.charAt(0).toUpperCase() + marketType.slice(1);
}

function nativeMarketHref(m: { id: string; slug?: string; marketType: string }): string {
  if (m.marketType === "updown") return `/predict/updown/${m.id}`;
  if (m.marketType === "h2h") return `/predict/h2h/${m.id}`;
  if (m.marketType === "gainer") return `/predict/race/${m.id}`;
  if (m.slug) return `/markets/${m.slug}`;
  return "/predict";
}

function openMarketHref(m: OpenMarket): string {
  if (m.marketType === "community" && m.slug) return `/markets/${m.slug}`;
  if (m.marketType === "updown") return `/predict/updown/${m.id}`;
  if (m.marketType === "h2h") return `/predict/h2h/${m.id}`;
  if (m.marketType === "gainer") return `/predict/race/${m.id}`;
  if (m.slug) return `/markets/${m.slug}`;
  return "/predict";
}

function formatClosingLabel(target: string | null | undefined): string | null {
  if (!target) return null;
  const ts = new Date(target).getTime();
  if (isNaN(ts)) return null;
  const diffMs = ts - Date.now();
  if (diffMs <= 0) return "Closing now";
  const hours = Math.round(diffMs / (1000 * 60 * 60));
  if (hours < 1) return "< 1h";
  if (hours < 24) return `${hours}h`;
  const days = Math.round(hours / 24);
  return `${days}d`;
}

function HottestMarketsTile() {
  const updownQ = useQuery({
    queryKey: ["/api/native-markets/updown", "insights"],
    queryFn: () => fetchJson<NativeMarket[]>("/api/native-markets/updown"),
    staleTime: 60_000,
  });
  const h2hQ = useQuery({
    queryKey: ["/api/native-markets/h2h", "insights"],
    queryFn: () => fetchJson<NativeMarket[]>("/api/native-markets/h2h"),
    staleTime: 60_000,
  });
  const gainerQ = useQuery({
    queryKey: ["/api/native-markets/gainer", "insights"],
    queryFn: () => fetchJson<NativeMarket[]>("/api/native-markets/gainer"),
    staleTime: 60_000,
  });
  const openQ = useQuery({
    queryKey: ["/api/open-markets", "insights-hottest"],
    queryFn: () =>
      fetchJson<{ data?: OpenMarket[]; markets?: OpenMarket[] }>(
        "/api/open-markets?limit=12",
      ).then((j) => j.data ?? j.markets ?? []),
    staleTime: 60_000,
  });

  const loading = updownQ.isLoading || h2hQ.isLoading || gainerQ.isLoading;
  if (loading) return <Skeleton className="h-40 w-full" />;

  type Row = {
    id: string;
    title: string;
    marketType: string;
    volume: number;
    href: string;
  };

  const native: Row[] = [
    ...(updownQ.data ?? []).slice(0, 3),
    ...(h2hQ.data ?? []).slice(0, 3),
    ...(gainerQ.data ?? []).slice(0, 3),
  ].map((m) => ({
    id: m.id,
    title: m.title,
    marketType: m.marketType,
    volume: Number(m.volume ?? 0),
    href: nativeMarketHref(m),
  }));

  const community: Row[] = (openQ.data ?? [])
    .filter((m) => m.marketType === "community")
    .slice(0, 3)
    .map((m) => ({
      id: m.id,
      title: m.title ?? "Untitled market",
      marketType: "community",
      volume: Number(m.volume ?? 0),
      href: openMarketHref(m),
    }));

  const combined = [...native, ...community]
    .sort((a, b) => b.volume - a.volume)
    .slice(0, 6);

  if (combined.length === 0) {
    return <InsightsEmptyState message="No active markets right now." />;
  }

  return (
    <ul className="space-y-2">
      {combined.map((m) => (
        <li key={`${m.marketType}-${m.id}`}>
          <Link
            href={m.href}
            onClick={() =>
              logInsightsEvent("predict", "hottest_click", {
                marketId: m.id,
                marketType: m.marketType,
              })
            }
            className="flex items-center gap-3 p-3 rounded-lg border border-border/40 bg-background/50 hover:bg-muted/40 transition-colors"
          >
            <div className="h-8 w-8 rounded-md bg-orange-500/15 flex items-center justify-center shrink-0">
              <Flame className="h-4 w-4 text-orange-500" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium truncate">{m.title}</p>
              <p className="text-[10px] text-muted-foreground uppercase tracking-wide mt-0.5">
                {marketTypeLabel(m.marketType)}
              </p>
            </div>
            <span className="text-xs font-mono text-muted-foreground tabular-nums shrink-0">
              {formatVoxCompact(m.volume) ?? "—"}
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}

function ClosingSoonTile() {
  const updownQ = useQuery({
    queryKey: ["/api/native-markets/updown", "insights"],
    queryFn: () => fetchJson<NativeMarket[]>("/api/native-markets/updown"),
    staleTime: 60_000,
  });
  const h2hQ = useQuery({
    queryKey: ["/api/native-markets/h2h", "insights"],
    queryFn: () => fetchJson<NativeMarket[]>("/api/native-markets/h2h"),
    staleTime: 60_000,
  });
  const gainerQ = useQuery({
    queryKey: ["/api/native-markets/gainer", "insights"],
    queryFn: () => fetchJson<NativeMarket[]>("/api/native-markets/gainer"),
    staleTime: 60_000,
  });

  const loading = updownQ.isLoading || h2hQ.isLoading || gainerQ.isLoading;
  if (loading) return <Skeleton className="h-40 w-full" />;

  const horizonMs = 48 * 60 * 60 * 1000;
  interface Row {
    id: string;
    title: string;
    marketType: string;
    cutoff: string;
    href: string;
    diff: number;
  }

  const allNative = [
    ...(updownQ.data ?? []),
    ...(h2hQ.data ?? []),
    ...(gainerQ.data ?? []),
  ];

  const rows: Row[] = [];
  for (const m of allNative) {
    const cutoff = m.bettingCutoff ?? m.resolutionDeadline;
    if (!cutoff) continue;
    const diff = new Date(cutoff).getTime() - Date.now();
    if (!Number.isFinite(diff) || diff <= 0 || diff > horizonMs) continue;
    rows.push({
      id: m.id,
      title: m.title,
      marketType: m.marketType,
      cutoff,
      href: nativeMarketHref(m),
      diff,
    });
  }
  rows.sort((a, b) => a.diff - b.diff);
  rows.splice(5);

  if (rows.length === 0) {
    return (
      <InsightsEmptyState message="No markets closing in the next 48 hours." />
    );
  }

  return (
    <ul className="space-y-2">
      {rows.map((r) => (
        <li key={`${r.marketType}-${r.id}`}>
          <Link
            href={r.href}
            onClick={() =>
              logInsightsEvent("predict", "closing_soon_click", {
                marketId: r.id,
                marketType: r.marketType,
              })
            }
            className="flex items-center gap-3 p-3 rounded-lg border border-border/40 bg-background/50 hover:bg-muted/40 transition-colors"
          >
            <div className="h-8 w-8 rounded-md bg-amber-500/15 flex items-center justify-center shrink-0">
              <AlarmClock className="h-4 w-4 text-amber-500" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium truncate">{r.title}</p>
              <p className="text-[10px] text-muted-foreground uppercase tracking-wide mt-0.5">
                {marketTypeLabel(r.marketType)}
              </p>
            </div>
            <span className="text-xs font-mono text-amber-600 dark:text-amber-400 tabular-nums shrink-0">
              {formatClosingLabel(r.cutoff)}
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}

function ContestedRow({ market }: { market: ContestedMarket }) {
  const href =
    market.marketType === "community"
      ? `/markets/${market.slug}`
      : market.marketType === "updown"
        ? `/predict/updown/${market.marketId}`
        : market.marketType === "h2h"
          ? `/predict/h2h/${market.marketId}`
          : market.marketType === "gainer"
            ? `/predict/race/${market.marketId}`
            : `/markets/${market.slug}`;

  // Unified "distance from an even split" so AMM and parimutuel markets read
  // on one scale (0% = perfectly even, higher = more lopsided). The engine is
  // never surfaced — users see the market-type badge instead.
  const pctFromEven =
    market.engine === "amm"
      ? Math.round(market.score * 200)
      : Math.round(market.score * 100);

  return (
    <li>
      <Link
        href={href}
        className="block p-3 rounded-lg border border-border/40 bg-background/50 hover:bg-muted/40 transition-colors"
        onClick={() =>
          logInsightsEvent("predict", "contested_click", {
            marketId: market.marketId,
            engine: market.engine,
          })
        }
      >
        <div className="flex items-start justify-between gap-2">
          <p className="text-sm font-medium line-clamp-2 flex-1">{market.title}</p>
          <Badge variant="outline" className="text-[10px] shrink-0 uppercase">
            {marketTypeLabel(market.marketType)}
          </Badge>
        </div>
        <p className="text-[10px] text-muted-foreground mt-1">
          {pctFromEven}% from an even split
        </p>
        {market.topPair.length > 0 && (
          <p className="text-xs text-muted-foreground mt-2">
            {market.topPair.map((p) => `${p.label} ${p.pct}%`).join(" · ")}
          </p>
        )}
      </Link>
    </li>
  );
}

function ContestedTile() {
  const { data, isLoading } = useInsightsQuery<InsightsMarketsAnalytics>(
    "/api/insights/markets/analytics",
  );

  if (isLoading) return <Skeleton className="h-40 w-full" />;
  const contested = data?.contested;

  // Merge both engines into one list ranked by closeness to an even split.
  // Distance is normalised so AMM (abs(price-0.5), 0..0.5) and parimutuel
  // (max-min stake share, 0..1) compare on the same 0..1 scale.
  const evennessDistance = (m: ContestedMarket) =>
    m.engine === "amm" ? m.score * 2 : m.score;
  const combined = [...(contested?.amm ?? []), ...(contested?.parimutuel ?? [])].sort(
    (a, b) => evennessDistance(a) - evennessDistance(b),
  );

  if (combined.length === 0) {
    return <InsightsEmptyState message="No contested markets right now." />;
  }

  return (
    <ul className="grid gap-2 sm:grid-cols-2">
      {combined.slice(0, 6).map((m) => (
        <ContestedRow key={m.marketId} market={m} />
      ))}
    </ul>
  );
}

function OpenInterestTile() {
  const { data, isLoading } = useInsightsQuery<InsightsMarketsAnalytics>(
    "/api/insights/markets/analytics",
  );

  if (isLoading) return <Skeleton className="h-32 w-full" />;
  const openInterest = data?.openInterest;
  const rows = openInterest?.byMarketType ?? [];

  if (rows.length === 0) {
    return <InsightsEmptyState message="No open interest right now." />;
  }

  const maxOi = Math.max(...rows.map((r) => r.total), 1);

  return (
    <div className="space-y-3">
      <p className="text-[11px] text-muted-foreground">
        {formatVoxCompact(openInterest?.total ?? 0) ?? formatVox(0)} across open markets.
      </p>
      <ul className="space-y-2.5">
        {rows.map((r) => (
          <li key={r.key}>
            <div className="flex justify-between text-xs mb-1">
              <span className="font-medium">{r.label}</span>
              <span className="text-muted-foreground tabular-nums">
                {formatVoxCompact(r.total) ?? formatVox(0)} · {r.marketCount}{" "}
                {r.marketCount === 1 ? "market" : "markets"}
              </span>
            </div>
            <div className="h-2 rounded-full bg-muted/60 overflow-hidden">
              <div
                className="h-full rounded-full bg-gradient-to-r from-amber-500/80 to-amber-300/60"
                style={{ width: `${Math.max(4, (r.total / maxOi) * 100)}%` }}
              />
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

function LiveBetFeedTile() {
  const { data, isLoading } = useQuery({
    queryKey: ["/api/predict/recent-activity", 8],
    queryFn: () => fetchJson<RecentBet[]>("/api/predict/recent-activity?limit=8"),
    staleTime: 30_000,
    refetchInterval: 30_000,
  });

  if (isLoading) return <Skeleton className="h-40 w-full" />;
  const rows = data ?? [];
  if (rows.length === 0) {
    return <InsightsEmptyState message="No recent activity yet." />;
  }

  return (
    <ul className="space-y-1.5">
      {rows.slice(0, 8).map((bet) => {
        const href =
          bet.marketType === "community" && bet.marketSlug
            ? `/markets/${bet.marketSlug}`
            : bet.marketType === "updown"
              ? `/predict/updown/${bet.marketId}`
              : bet.marketType === "h2h"
                ? `/predict/h2h/${bet.marketId}`
                : bet.marketType === "gainer"
                  ? `/predict/race/${bet.marketId}`
                  : bet.marketSlug
                    ? `/markets/${bet.marketSlug}`
                    : "/predict";
        return (
          <li key={bet.id}>
            <Link
              href={href}
              className="flex items-center gap-2.5 p-2.5 rounded-lg hover:bg-muted/40 transition-colors"
              onClick={() =>
                logInsightsEvent("predict", "feed_click", {
                  betId: bet.id,
                  marketId: bet.marketId,
                })
              }
            >
              <PersonAvatar
                name={bet.displayName}
                avatar={bet.avatarUrl}
                size="xs"
              />
              <div className="min-w-0 flex-1 text-xs">
                <p className="truncate">
                  <span className="font-medium text-foreground">
                    {bet.displayName}
                  </span>{" "}
                  <span className="text-muted-foreground">
                    backed <span className="text-foreground">{bet.choiceLabel}</span>
                  </span>
                </p>
                <p className="text-[10px] text-muted-foreground truncate">
                  {bet.marketTitle}
                </p>
              </div>
              <span className="text-[10px] font-mono text-muted-foreground tabular-nums shrink-0">
                {formatVox(Number(bet.stakeAmount))}
              </span>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

function TopPredictorsTile() {
  const { data, isLoading } = useQuery({
    queryKey: ["/api/leaderboard/users", "insights-week"],
    queryFn: () =>
      fetchJson<{ data: LeaderboardUser[]; total: number }>(
        "/api/leaderboard/users?period=week&limit=5",
      ),
    staleTime: 90_000,
  });

  if (isLoading) return <Skeleton className="h-40 w-full" />;
  const users = data?.data ?? [];
  if (users.length === 0) {
    return <InsightsEmptyState message="No settled predictions this week yet." />;
  }

  return (
    <ul className="space-y-1.5">
      {users.slice(0, 5).map((u, idx) => {
        const winRate =
          typeof u.winRate === "number"
            ? u.winRate
            : u.totalResolved > 0
              ? Math.round((u.winCount / u.totalResolved) * 100)
              : null;
        const pnlPositive = u.totalPnl > 0;
        const pnlNegative = u.totalPnl < 0;
        const inner = (
          <>
            <span className="text-xs font-mono text-muted-foreground w-5 tabular-nums shrink-0">
              {idx + 1}
            </span>
            <PersonAvatar
              name={u.displayName ?? u.username ?? "?"}
              avatar={u.avatarUrl}
              size="xs"
            />
            <span className="text-sm font-medium truncate flex-1">
              {u.displayName ?? u.username ?? "Anonymous"}
            </span>
            <div className="text-right shrink-0">
              <p
                className={cn(
                  "text-sm font-semibold tabular-nums",
                  pnlPositive && "text-green-600 dark:text-green-400",
                  pnlNegative && "text-red-500",
                  !pnlPositive && !pnlNegative && "text-muted-foreground",
                )}
              >
                {pnlPositive ? "+" : ""}
                {formatVox(Math.round(u.totalPnl))}
              </p>
              {winRate != null && (
                <p className="text-[10px] text-muted-foreground tabular-nums">
                  {winRate}% wins
                </p>
              )}
            </div>
          </>
        );

        const className =
          "flex items-center gap-2.5 p-2.5 rounded-lg border border-border/40 bg-background/50 transition-colors";

        return (
          <li key={u.userId}>
            {u.username ? (
              <Link
                href={`/u/${u.username}`}
                className={cn(className, "hover:bg-muted/40")}
              >
                {inner}
              </Link>
            ) : (
              <div className={className}>{inner}</div>
            )}
          </li>
        );
      })}
    </ul>
  );
}

export function PredictTab() {
  return (
    <div className="space-y-6 md:space-y-8">
      <div className="grid lg:grid-cols-2 gap-6">
        <InsightsSection
          title={
            <span className="inline-flex items-center gap-1.5">
              <Flame className="h-4 w-4 text-orange-500" /> Hottest markets
            </span>
          }
          description="Where prediction credits are flowing right now."
          accent="blue"
        >
          <HottestMarketsTile />
        </InsightsSection>

        <InsightsSection
          title={
            <span className="inline-flex items-center gap-1.5">
              <AlarmClock className="h-4 w-4 text-amber-500" /> Closing soon
            </span>
          }
          description="Markets where the betting window shuts in under 48 hours."
        >
          <ClosingSoonTile />
        </InsightsSection>
      </div>

      <InsightsSection
        title={
          <span className="inline-flex items-center gap-1.5">
            <Zap className="h-4 w-4 text-blue-500" /> Most contested markets
          </span>
        }
        description="Native and community markets closest to an even split."
        accent="voxdex"
      >
        <ContestedTile />
      </InsightsSection>

      <div className="grid lg:grid-cols-2 gap-6">
        <InsightsSection
          title={
            <span className="inline-flex items-center gap-1.5">
              <LineChartIcon className="h-4 w-4 text-amber-500" /> Open interest
            </span>
          }
          description="How predictions are split across market types."
        >
          <OpenInterestTile />
        </InsightsSection>

        <InsightsSection
          title={
            <span className="inline-flex items-center gap-1.5">
              <Trophy className="h-4 w-4 text-yellow-500" /> Top predictors · 7d
            </span>
          }
          description="Best P&L in settled predictions over the last week."
        >
          <TopPredictorsTile />
        </InsightsSection>
      </div>

      <InsightsSection
        title="Live bet feed"
        description="Latest activity across all prediction markets."
      >
        <LiveBetFeedTile />
      </InsightsSection>
    </div>
  );
}
