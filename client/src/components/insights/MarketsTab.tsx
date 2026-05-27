import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  ResponsiveContainer,
  Tooltip,
  CartesianGrid,
} from "recharts";
import type {
  ContestedMarket,
  InsightsMarketsAnalytics,
} from "@shared/insights/types";
import { InsightsSection, InsightsEmptyState } from "./insights-ui";
import { ChartOrList } from "./ChartOrList";
import { logInsightsEvent } from "@/lib/insights-telemetry";

async function fetchMarketsAnalytics(): Promise<InsightsMarketsAnalytics> {
  const res = await fetch("/api/insights/markets/analytics");
  if (!res.ok) throw new Error("markets analytics failed");
  const json = await res.json();
  return json.data;
}

function marketHref(m: { marketId: string; slug: string; marketType: string }): string {
  if (m.marketType === "community") return `/markets/${m.slug}`;
  if (m.marketType === "updown") return `/predict/updown/${m.marketId}`;
  if (m.marketType === "h2h") return `/predict/h2h/${m.marketId}`;
  if (m.marketType === "gainer" || m.marketType === "race") return `/predict/race/${m.marketId}`;
  return `/markets/${m.slug}`;
}

function marketTypeLabel(marketType: string): string {
  if (marketType === "gainer") return "Race";
  return marketType.charAt(0).toUpperCase() + marketType.slice(1);
}

function contestedScoreLabel(market: ContestedMarket): string {
  if (market.engine === "amm") {
    const pctFrom50 = Math.round(market.score * 200);
    return `${pctFrom50}% from 50/50`;
  }
  const evenness = Math.round((1 - market.score) * 100);
  return `${evenness}% even split`;
}

function ContestedRow({ market, listKind }: { market: ContestedMarket; listKind: string }) {
  const href = marketHref(market);
  return (
    <li>
      <Link
        href={href}
        className="block p-3 rounded-lg border border-border/40 bg-background/50 hover:bg-muted/40 transition-colors"
        onClick={() =>
          logInsightsEvent("markets", "row_click", {
            kind: "contested",
            list: listKind,
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
        <p className="text-[10px] text-muted-foreground mt-1">{contestedScoreLabel(market)}</p>
        {market.topPair.length > 0 && (
          <p className="text-xs text-muted-foreground mt-2">
            {market.topPair.map((p) => `${p.label} ${p.pct}%`).join(" · ")}
          </p>
        )}
      </Link>
    </li>
  );
}

function ContestedList({ markets, listKind }: { markets: ContestedMarket[]; listKind: string }) {
  if (markets.length === 0) {
    return <InsightsEmptyState message="No open markets in this bucket right now." />;
  }
  return (
    <ul className="space-y-2">
      {markets.map((m) => (
        <ContestedRow key={m.marketId} market={m} listKind={listKind} />
      ))}
    </ul>
  );
}

export function MarketsTab() {
  const analyticsQuery = useQuery({
    queryKey: ["/api/insights/markets/analytics"],
    queryFn: fetchMarketsAnalytics,
    staleTime: 90_000,
  });

  const openMarketsQuery = useQuery({
    queryKey: ["/api/open-markets", "insights"],
    queryFn: async () => {
      const res = await fetch("/api/open-markets?limit=12");
      if (!res.ok) return [];
      const json = await res.json();
      return json.data ?? json.markets ?? [];
    },
    staleTime: 60_000,
  });

  const { data, isLoading, isError } = analyticsQuery;
  const calibration = data?.calibration;
  const contested = data?.contested;
  const openInterest = data?.openInterest;

  const calibrationChart = (calibration?.buckets ?? [])
    .filter((b) => b.count > 0)
    .map((b) => ({
      label: b.label,
      winRate: Math.round(b.actualWinRate * 100),
      count: b.count,
      avgBrier: b.avgBrier,
    }))
    .sort((a, b) => parseInt(a.label, 10) - parseInt(b.label, 10));

  const maxOi = Math.max(...(openInterest?.byMarketType ?? []).map((r) => r.total), 1);

  if (isLoading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-72 w-full rounded-xl" />
        <Skeleton className="h-48 w-full rounded-xl" />
        <Skeleton className="h-48 w-full rounded-xl" />
      </div>
    );
  }

  if (isError || !data) {
    return (
      <p className="text-sm text-destructive text-center py-8">
        Could not load market analytics. Try again in a moment.
      </p>
    );
  }

  return (
    <div className="space-y-6 md:space-y-8">
      <InsightsSection
        title="Platform calibration"
        description="Settled predictions: implied odds at entry vs actual win rate (Brier-style buckets)."
        accent="voxdex"
      >
        {(calibration?.totalSettled ?? 0) < 50 ? (
          <InsightsEmptyState message="Need at least 50 settled platform bets before calibration is meaningful." />
        ) : calibrationChart.length < 2 ? (
          <InsightsEmptyState message="Not enough priced settlements to chart calibration yet." />
        ) : (
          <div className="h-[280px] md:h-[340px] w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={calibrationChart} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-border/40" />
                <XAxis dataKey="label" tick={{ fontSize: 10 }} />
                <YAxis tick={{ fontSize: 10 }} unit="%" domain={[0, 100]} />
                <Tooltip
                  formatter={(value: number, _name: string, item: { payload?: { count: number; avgBrier: number } }) => [
                    `${value}% (${item.payload?.count ?? 0} bets, Brier ${(item.payload?.avgBrier ?? 0).toFixed(3)})`,
                    "Win rate",
                  ]}
                />
                <Bar dataKey="winRate" fill="hsl(217 91% 60%)" radius={[4, 4, 0, 0]} name="Win %" />
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
      </InsightsSection>

      <InsightsSection
        title="Contested lines"
        description="AMM markets closest to 50/50; parimutuel pools with the most even stake split."
      >
        <ChartOrList
          chart={
            <div className="grid md:grid-cols-2 gap-6">
              <div>
                <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-3">
                  AMM near 50%
                </h3>
                <ContestedList markets={contested?.amm ?? []} listKind="amm" />
              </div>
              <div>
                <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-3">
                  Parimutuel evenly split
                </h3>
                <ContestedList markets={contested?.parimutuel ?? []} listKind="parimutuel" />
              </div>
            </div>
          }
          list={
            <div className="space-y-6">
              <div>
                <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-3">
                  AMM near 50%
                </h3>
                <ContestedList markets={contested?.amm ?? []} listKind="amm" />
              </div>
              <div>
                <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-3">
                  Parimutuel evenly split
                </h3>
                <ContestedList markets={contested?.parimutuel ?? []} listKind="parimutuel" />
              </div>
            </div>
          }
        />
      </InsightsSection>

      <InsightsSection
        title="Open interest"
        description={`~${(openInterest?.total ?? 0).toLocaleString()} credits across open markets.`}
      >
        {(openInterest?.byMarketType ?? []).length === 0 ? (
          <InsightsEmptyState message="No open interest on active markets." />
        ) : (
          <div className="space-y-6">
            <ul className="space-y-3">
              {(openInterest?.byMarketType ?? []).map((row) => (
                <li key={row.key}>
                  <div className="flex justify-between text-sm mb-1">
                    <span className="font-medium">{row.label}</span>
                    <span className="text-muted-foreground tabular-nums">
                      {row.total.toLocaleString()} · {row.marketCount} markets
                    </span>
                  </div>
                  <div className="h-2 rounded-full bg-muted overflow-hidden">
                    <div
                      className="h-full rounded-full bg-primary/80"
                      style={{ width: `${Math.max(4, (row.total / maxOi) * 100)}%` }}
                    />
                  </div>
                </li>
              ))}
            </ul>
            {(openInterest?.byCategory ?? []).length > 0 && (
              <div>
                <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">
                  By category
                </h3>
                <ul className="space-y-1.5">
                  {(openInterest?.byCategory ?? []).slice(0, 8).map((row) => (
                    <li
                      key={row.key}
                      className="flex justify-between text-sm text-muted-foreground"
                    >
                      <span>{row.label}</span>
                      <span className="tabular-nums">{row.total.toLocaleString()}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}
      </InsightsSection>

      <InsightsSection
        title="Active markets"
        description="Open prediction markets you can explore now."
      >
        {openMarketsQuery.isLoading && (
          <div className="grid sm:grid-cols-2 gap-2">
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} className="h-16 w-full" />
            ))}
          </div>
        )}
        {!openMarketsQuery.isLoading && (openMarketsQuery.data ?? []).length === 0 && (
          <InsightsEmptyState message="No open markets right now." />
        )}
        <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {(openMarketsQuery.data ?? []).slice(0, 12).map(
            (m: { id: string; slug?: string; title?: string; marketType?: string }) => (
              <li key={m.id}>
                <Link
                  href={
                    m.marketType === "community" && m.slug
                      ? `/markets/${m.slug}`
                      : m.marketType === "updown"
                        ? `/predict/updown/${m.id}`
                        : m.marketType === "h2h"
                          ? `/predict/h2h/${m.id}`
                          : m.marketType === "gainer"
                            ? `/predict/race/${m.id}`
                            : m.slug
                              ? `/markets/${m.slug}`
                              : "/predict"
                  }
                  className="block p-4 rounded-lg border border-border/40 bg-background/50 hover:bg-muted/40 hover:border-border/60 transition-colors h-full"
                  onClick={() =>
                    logInsightsEvent("markets", "row_click", {
                      kind: "active",
                      marketId: m.id,
                      marketType: m.marketType,
                    })
                  }
                >
                  <p className="font-medium text-sm line-clamp-2">{m.title ?? "Market"}</p>
                  {m.marketType && (
                    <p className="text-[10px] text-muted-foreground uppercase tracking-wide mt-2">
                      {marketTypeLabel(m.marketType)}
                    </p>
                  )}
                </Link>
              </li>
            ),
          )}
        </ul>
      </InsightsSection>
    </div>
  );
}
