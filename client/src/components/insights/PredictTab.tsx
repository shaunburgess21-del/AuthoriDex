import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import {
  AlarmClock,
  ArrowUpDown,
  Flame,
  Globe2,
  LineChart as LineChartIcon,
  TrendingDown,
  TrendingUp,
  Trophy,
  Users,
  Zap,
} from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { InsightsSection, InsightsEmptyState } from "./insights-ui";
import { PersonAvatar } from "@/components/PersonAvatar";
import { MarketThumbCollage } from "@/components/predict/MarketThumbCollage";
import { DoughnutChart } from "@/components/charts/DoughnutChart";
import { CountryFlag } from "@/components/ui/CountryFlag";
import { useInsightsQuery } from "@/lib/insights-hooks";
import { logInsightsEvent } from "@/lib/insights-telemetry";
import { formatVox, formatVoxCompact } from "@/lib/currency";
import { marketThumbFromMarket } from "@/lib/marketThumbParticipants";
import {
  useInsightsMarketLists,
  type InsightsNativeMarket,
  type InsightsOpenMarket,
} from "@/lib/useInsightsMarketLists";
import { cn } from "@/lib/utils";
import { getCountryName } from "@shared/countries";
import type {
  ContestedMarket,
  InsightsMarketsAnalytics,
  MarketMover,
  PredictorDemographics,
} from "@shared/insights/types";

/**
 * V1 Predict tab — market analytics + activity tiles.
 *
 * Layout:
 *  - Hottest + Closing soon (2-col)
 *  - Most contested (full)
 *  - Open interest + Top predictors (2-col)
 *  - Predictor demographics (full)
 *  - Biggest movers + Live bet feed (2-col)
 */

interface OpenMarket extends InsightsOpenMarket {}

type NativeMarketWithPeople = InsightsNativeMarket;

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
  const key = marketType === "gainer" ? "race" : marketType.toLowerCase();
  const labels: Record<string, string> = {
    updown: "Up/Down",
    h2h: "Head-to-Head",
    race: "Category Races",
    gainer: "Category Races",
    jackpot: "Weekly Jackpot",
    community: "World Markets",
  };
  return labels[key] ?? (marketType.charAt(0).toUpperCase() + marketType.slice(1));
}

/** Gap subtext for contested rows — wording matches how each market type frames its outcomes. */
function contestedGapLabel(marketType: string, gapPts: number): string {
  const n = gapPts === 1 ? "1 pt gap" : `${gapPts} pt gap`;
  switch (marketType) {
    case "updown":
      return `${n} between Up and Down`;
    case "h2h":
      return `${n} between opponents`;
    case "gainer":
    case "community":
      return `${n} between leaders`;
    default:
      return `${n} between top two`;
  }
}

function MarketThumbSlot({
  marketType,
  market,
}: {
  marketType: string;
  market: Record<string, unknown>;
}) {
  const thumb = marketThumbFromMarket(marketType, market);
  return (
    <div className="shrink-0">
      <MarketThumbCollage
        variant={thumb.variant}
        participants={thumb.participants}
        size="sm"
        className={cn(
          thumb.variant === "split" && "w-14",
          thumb.variant === "grid" && "w-10",
        )}
      />
    </div>
  );
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
  const { updownQ, h2hQ, gainerQ, openQ, isLoading } = useInsightsMarketLists(12);

  if (isLoading) return <Skeleton className="h-40 w-full" />;

  type Row = {
    id: string;
    title: string;
    marketType: string;
    volume: number;
    href: string;
    market: Record<string, unknown>;
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
    market: m as unknown as Record<string, unknown>,
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
      market: m as unknown as Record<string, unknown>,
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
            <MarketThumbSlot marketType={m.marketType} market={m.market} />
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
  const { updownQ, h2hQ, gainerQ, openQ, isLoading } = useInsightsMarketLists(50, "closing");

  if (isLoading) return <Skeleton className="h-40 w-full" />;

  const horizonMs = 48 * 60 * 60 * 1000;
  interface Row {
    id: string;
    title: string;
    marketType: string;
    cutoff: string;
    href: string;
    diff: number;
    market: Record<string, unknown>;
  }

  const allNative: Array<NativeMarketWithPeople & { marketType: string }> = [
    ...(updownQ.data ?? []).map((m) => ({ ...m, marketType: "updown" as const })),
    ...(h2hQ.data ?? []).map((m) => ({ ...m, marketType: "h2h" as const })),
    ...(gainerQ.data ?? []).map((m) => ({ ...m, marketType: "gainer" as const })),
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
      market: m as unknown as Record<string, unknown>,
    });
  }

  for (const m of openQ.data ?? []) {
    if (m.marketType !== "community") continue;
    const cutoff = m.closeAt ?? m.endAt;
    if (!cutoff) continue;
    const diff = new Date(cutoff).getTime() - Date.now();
    if (!Number.isFinite(diff) || diff <= 0 || diff > horizonMs) continue;
    rows.push({
      id: m.id,
      title: m.title ?? "Untitled market",
      marketType: "community",
      cutoff,
      href: openMarketHref(m),
      diff,
      market: m as unknown as Record<string, unknown>,
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
            <MarketThumbSlot marketType={r.marketType} market={r.market} />
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

function ContestedRow({
  market,
  thumbMarket,
}: {
  market: ContestedMarket;
  thumbMarket?: Record<string, unknown>;
}) {
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

  // score = price gap between the top two outcomes (0–1); smaller = more contested.
  const gapPts = Math.round(market.score * 100);
  const gapLabel = contestedGapLabel(market.marketType, gapPts);

  return (
    <li>
      <Link
        href={href}
        className="flex items-start gap-3 p-3 rounded-lg border border-border/40 bg-background/50 hover:bg-muted/40 transition-colors"
        onClick={() =>
          logInsightsEvent("predict", "contested_click", {
            marketId: market.marketId,
            engine: market.engine,
          })
        }
      >
        <MarketThumbSlot
          marketType={market.marketType}
          market={
            thumbMarket ??
            ({
              title: market.title,
              marketType: market.marketType,
              ...(market.coverImageUrl ? { coverImageUrl: market.coverImageUrl } : {}),
            } as Record<string, unknown>)
          }
        />
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <p className="text-sm font-medium line-clamp-2 flex-1">{market.title}</p>
            <Badge variant="outline" className="text-[10px] shrink-0 uppercase">
              {marketTypeLabel(market.marketType)}
            </Badge>
          </div>
          <p className="text-[10px] text-muted-foreground mt-1">{gapLabel}</p>
          {market.topPair.length > 0 && (
            <p className="text-xs text-muted-foreground mt-2">
              {market.topPair.map((p) => `${p.label} ${p.pct}%`).join(" · ")}
            </p>
          )}
        </div>
      </Link>
    </li>
  );
}

function ContestedTile() {
  const { data, isLoading } = useInsightsQuery<InsightsMarketsAnalytics>(
    "/api/insights/markets/analytics",
  );
  const { marketById, isLoading: listsLoading } = useInsightsMarketLists(50, "closing");

  if (isLoading || listsLoading) return <Skeleton className="h-40 w-full" />;
  const contested = data?.contested;

  // Card covers native + community AMM markets only (no jackpots / parimutuel).
  const combined = [...(contested?.amm ?? [])].sort((a, b) => a.score - b.score);

  if (combined.length === 0) {
    return <InsightsEmptyState message="No contested markets right now." />;
  }

  return (
    <ul className="grid gap-2 sm:grid-cols-2">
      {combined.slice(0, 6).map((m) => (
        <ContestedRow
          key={m.marketId}
          market={m}
          thumbMarket={marketById.get(m.marketId) as Record<string, unknown> | undefined}
        />
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
            <div className="flex flex-col gap-0.5 sm:flex-row sm:justify-between sm:items-center text-xs mb-1">
              <span className="font-medium">{marketTypeLabel(r.key)}</span>
              <span className="text-muted-foreground tabular-nums shrink-0">
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
    <div className="space-y-2">
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
      <Link
        href="/predictions/leaderboard"
        className="block text-center text-xs text-muted-foreground hover:text-foreground transition-colors pt-1"
        onClick={() => logInsightsEvent("predict", "leaderboard_link_click")}
      >
        View full leaderboard →
      </Link>
    </div>
  );
}

function moverHref(m: MarketMover): string {
  if (m.marketType === "updown") return `/predict/updown/${m.marketId}`;
  if (m.marketType === "h2h") return `/predict/h2h/${m.marketId}`;
  if (m.marketType === "gainer") return `/predict/race/${m.marketId}`;
  if (m.marketType === "community" && m.slug) return `/markets/${m.slug}`;
  if (m.slug) return `/markets/${m.slug}`;
  return "/predict";
}

function MoversTile() {
  const moversQ = useInsightsQuery<MarketMover[]>("/api/insights/markets/movers");
  const { marketById, isLoading: listsLoading } = useInsightsMarketLists(50, "hottest");

  if (moversQ.isLoading || listsLoading) return <Skeleton className="h-40 w-full" />;
  const movers = moversQ.data ?? [];
  if (movers.length === 0) {
    return <InsightsEmptyState message="No significant price moves in the last 24 hours." />;
  }

  return (
    <ul className="space-y-2">
      {movers.map((m) => {
        const market =
          marketById.get(m.marketId) ??
          ({
            title: m.title,
            marketType: m.marketType,
          } as Record<string, unknown>);
        const up = m.direction === "up";
        return (
          <li key={m.marketId}>
            <Link
              href={moverHref(m)}
              onClick={() =>
                logInsightsEvent("predict", "mover_click", {
                  marketId: m.marketId,
                  deltaPts: m.deltaPts,
                })
              }
              className="flex items-center gap-3 p-3 rounded-lg border border-border/40 bg-background/50 hover:bg-muted/40 transition-colors"
            >
              <MarketThumbSlot marketType={m.marketType} market={market} />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium truncate">{m.title}</p>
                <p className="text-[10px] text-muted-foreground mt-0.5 truncate">
                  {m.entryLabel}: {m.pctPrev}% → {m.pctNow}%
                </p>
              </div>
              <span
                className={cn(
                  "inline-flex items-center gap-0.5 text-xs font-mono tabular-nums shrink-0",
                  up
                    ? "text-green-600 dark:text-green-400"
                    : "text-red-500 dark:text-red-400",
                )}
              >
                {up ? (
                  <TrendingUp className="h-3.5 w-3.5" />
                ) : (
                  <TrendingDown className="h-3.5 w-3.5" />
                )}
                {up ? "+" : ""}
                {m.deltaPts} pts
              </span>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

type DemographicMetric = "predictors" | "bets" | "volume";
type DemographicWindow = "all" | "30d" | "7d";

const DEMOGRAPHIC_GENDER_COLORS: Record<string, string> = {
  male: "#3B82F6",
  female: "#A78BFA",
  prefer_not_to_say: "#94A3B8",
};

function DemographicsWindowToggle({
  value,
  onChange,
}: {
  value: DemographicWindow;
  onChange: (next: DemographicWindow) => void;
}) {
  return (
    <div
      className="inline-flex shrink-0 rounded-lg border border-border/50 bg-muted/40 p-0.5 text-[11px] font-medium"
      role="group"
      aria-label="Demographics time window"
    >
      {(
        [
          ["all", "All time"],
          ["30d", "30d"],
          ["7d", "7d"],
        ] as const
      ).map(([key, label]) => (
        <button
          key={key}
          type="button"
          aria-pressed={value === key}
          onClick={() => onChange(key)}
          className={cn(
            "rounded-md px-2.5 py-1.5 transition-colors sm:px-3",
            value === key
              ? "bg-background text-foreground shadow-sm"
              : "text-muted-foreground hover:text-foreground",
          )}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

function DemographicsTile({ timeWindow }: { timeWindow: DemographicWindow }) {
  const path =
    timeWindow === "all"
      ? "/api/insights/markets/demographics"
      : `/api/insights/markets/demographics?window=${timeWindow}`;
  const { data, isLoading } = useInsightsQuery<PredictorDemographics>(path, {
    queryKey: [path],
  });
  const [metric, setMetric] = useState<DemographicMetric>("predictors");

  if (isLoading) return <Skeleton className="h-56 w-full" />;
  if (!data || data.predictorCount === 0) {
    return <InsightsEmptyState message="No predictor demographics yet." />;
  }

  const metricValue = (row: { predictors: number; bets: number; totalStaked: number }) => {
    if (metric === "bets") return row.bets;
    if (metric === "volume") return row.totalStaked;
    return row.predictors;
  };

  const formatMetric = (value: number) => {
    if (metric === "volume") return formatVoxCompact(value) ?? formatVox(value);
    return value.toLocaleString();
  };

  const genderSegments = data.byGender.map((row) => ({
    id: row.key,
    label: row.label,
    value: metricValue(row),
    color: DEMOGRAPHIC_GENDER_COLORS[row.key],
  }));

  const centerTitle =
    metric === "volume"
      ? formatVoxCompact(data.totalStaked) ?? formatVox(data.totalStaked)
      : metric === "bets"
        ? data.totalBets.toLocaleString()
        : data.predictorCount.toLocaleString();
  const centerSubtitle =
    metric === "volume" ? "wagered" : metric === "bets" ? "predictions" : "predictors";

  const topCountries = data.byCountry.slice(0, 8);
  const maxCountryMetric = Math.max(...topCountries.map((r) => metricValue(r)), 1);

  const topGender = data.byGender[0];
  const topCountry = data.byCountry[0];

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
          <span>
            <span className="font-semibold text-foreground tabular-nums">
              {data.predictorCount.toLocaleString()}
            </span>{" "}
            predictors
          </span>
          <span>
            <span className="font-semibold text-foreground tabular-nums">
              {data.countryCount}
            </span>{" "}
            countries
          </span>
          <span>
            <span className="font-semibold text-foreground tabular-nums">
              {formatVoxCompact(data.totalStaked) ?? formatVox(data.totalStaked)}
            </span>{" "}
            wagered
          </span>
        </div>
        <div
          className="inline-flex w-full sm:w-auto shrink-0 rounded-lg border border-border/50 bg-muted/40 p-0.5 text-[11px] font-medium"
          role="group"
          aria-label="Demographics metric"
        >
          {(
            [
              ["predictors", "Predictors"],
              ["bets", "Predictions"],
              ["volume", "Volume"],
            ] as const
          ).map(([key, label]) => (
            <button
              key={key}
              type="button"
              aria-pressed={metric === key}
              onClick={() => setMetric(key)}
              className={cn(
                "rounded-md px-3 py-1.5 transition-colors",
                metric === key
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <div>
          <p className="text-xs font-medium text-muted-foreground mb-3">Gender split</p>
          <DoughnutChart
            data={genderSegments}
            centerTitle={centerTitle}
            centerSubtitle={centerSubtitle}
            height={200}
            innerRadiusRatio={0.62}
          />
          {topGender ? (
            <p className="mt-2 text-[11px] text-muted-foreground">
              Largest group: {topGender.label} ({formatMetric(metricValue(topGender))})
            </p>
          ) : null}
        </div>

        <div>
          <p className="text-xs font-medium text-muted-foreground mb-3">Top countries</p>
          <ul className="space-y-2.5">
            {topCountries.map((row) => {
              const value = metricValue(row);
              const pct = Math.round((value / maxCountryMetric) * 100);
              const countryName = row.label || getCountryName(row.key) || row.key;
              return (
                <li key={row.key}>
                  <div className="flex items-center justify-between gap-2 text-xs mb-1">
                    <span className="inline-flex items-center gap-2 min-w-0">
                      <CountryFlag code={row.key} title={countryName} />
                      <span className="font-medium truncate">{countryName}</span>
                    </span>
                    <span className="text-muted-foreground tabular-nums shrink-0">
                      {formatMetric(value)}
                    </span>
                  </div>
                  <div className="h-2 rounded-full bg-muted/60 overflow-hidden">
                    <div
                      className="h-full rounded-full bg-gradient-to-r from-violet-500/80 to-violet-300/60"
                      style={{ width: `${Math.max(4, pct)}%` }}
                    />
                  </div>
                </li>
              );
            })}
          </ul>
          {topCountry ? (
            <p className="mt-2 text-[11px] text-muted-foreground inline-flex items-center gap-1.5">
              <Globe2 className="h-3.5 w-3.5" />
              Most active: {getCountryName(topCountry.key) ?? topCountry.key} (
              {formatMetric(metricValue(topCountry))})
            </p>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function DemographicsSection() {
  const [timeWindow, setTimeWindow] = useState<DemographicWindow>("all");

  return (
    <InsightsSection
      tab="predict"
      title={
        <span className="inline-flex items-center gap-1.5">
          <Users className="h-4 w-4 text-violet-500" /> Predictor demographics
        </span>
      }
      description="Where our predictors are from and how activity breaks down."
      action={<DemographicsWindowToggle value={timeWindow} onChange={setTimeWindow} />}
    >
      <DemographicsTile timeWindow={timeWindow} />
    </InsightsSection>
  );
}

export function PredictTab() {
  return (
    <div className="space-y-6 md:space-y-8">
      <div className="grid lg:grid-cols-2 gap-6">
        <InsightsSection
          tab="predict"
          title={
            <span className="inline-flex items-center gap-1.5">
              <Flame className="h-4 w-4 text-orange-500" /> Hottest markets
            </span>
          }
          description="Where prediction credits are flowing right now."
        >
          <HottestMarketsTile />
        </InsightsSection>

        <InsightsSection
          tab="predict"
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
        tab="predict"
        title={
          <span className="inline-flex items-center gap-1.5">
            <Zap className="h-4 w-4 text-blue-500" /> Most contested markets
          </span>
        }
        description="Where the top two favorites are closest together."
      >
        <ContestedTile />
      </InsightsSection>

      <div className="grid lg:grid-cols-2 gap-6">
        <InsightsSection
          tab="predict"
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
          tab="predict"
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

      <DemographicsSection />

      <div className="grid lg:grid-cols-2 gap-6">
        <InsightsSection
          tab="predict"
          title={
            <span className="inline-flex items-center gap-1.5">
              <ArrowUpDown className="h-4 w-4 text-blue-500" /> Biggest movers
            </span>
          }
          description="Markets where prices moved the most in the last 24 hours as bettors changed their conviction."
        >
          <MoversTile />
        </InsightsSection>

        <InsightsSection
          tab="predict"
          title="Live bet feed"
          description="Latest activity across all prediction markets."
        >
          <LiveBetFeedTile />
        </InsightsSection>
      </div>
    </div>
  );
}
