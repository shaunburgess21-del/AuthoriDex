import { formatDelta } from "@/lib/formatNumber";
import { Flame, Activity, ChevronDown, Info, TrendingUp, TrendingDown, Newspaper, Globe, ArrowRight, ArrowUpRight, ArrowDownRight, Clock } from "lucide-react";
import { PersonAvatar } from "./PersonAvatar";
import { useTrendContextBatch, getDriverLabel, TrendDriver } from "@/hooks/useTrendContext";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { useQuery } from "@tanstack/react-query";

interface HotMover {
  id: string;
  name: string;
  avatar: string | null;
  category: string | null;
  rank: number;
  fameIndex: number | null;
  change24h: number | null;
  rankChange: number | null;
  badge?: { label: string; color: string; description: string };
  sourceBreakdown?: { sources: Array<{ key: string; pct: number; status?: string }>; activeSources: number; dominantDriver?: string | null } | null;
}

interface HotMoversMeta {
  currentRunFinishedAt?: string | null;
}

interface HotMoversResponse {
  data: HotMover[];
  meta?: HotMoversMeta;
}

interface TrendingNowFeedProps {
  onPersonClick: (id: string) => void;
  collapsed: boolean;
  onToggle: () => void;
}


function getDriverExplanation(driver: TrendDriver): string {
  switch (driver) {
    case "NEWS": return "Increased news coverage and media mentions";
    case "WIKI": return "Wikipedia pageviews rising fast";
    default: return "";
  }
}

function formatUpdatedAgo(timestamp: number | undefined): string {
  if (!timestamp) return "";
  const seconds = Math.floor((Date.now() - timestamp) / 1000);
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ago`;
}

export function TrendingNowFeed({ onPersonClick, collapsed, onToggle }: TrendingNowFeedProps) {
  const { data: rawResponse } = useQuery<HotMoversResponse | HotMover[]>({
    queryKey: ['/api/trending/hot-movers'],
    refetchInterval: 60_000,
  });
  const hotMovers: HotMover[] = rawResponse
    ? (Array.isArray(rawResponse) ? rawResponse : rawResponse.data ?? [])
    : [];
  const meta: HotMoversMeta | undefined =
    rawResponse && !Array.isArray(rawResponse) ? rawResponse.meta : undefined;

  const visibleIds = !collapsed ? hotMovers.map(p => p.id) : [];
  const { data: trendContexts } = useTrendContextBatch(visibleIds);

  // Drive the freshness clock from the server's reported run-finished
  // timestamp, not TanStack Query's dataUpdatedAt (which is the time of the
  // last successful client refetch and would always read "just now" right
  // after a refetch even though the server response is cached for up to
  // 10 minutes and the underlying ingest runs roughly hourly).
  const updatedAgo = formatUpdatedAgo(
    meta?.currentRunFinishedAt ? Date.parse(meta.currentRunFinishedAt) : undefined
  );

  const scrollToLeaderboard = () => {
    const el = document.getElementById("leaderboard");
    if (el) el.scrollIntoView({ behavior: "smooth" });
  };

  return (
    <div
      className="rounded-xl pulse-card-orange transition-all duration-200"
      data-testid="trending-now-feed"
    >
      <div className={`p-4 ${collapsed ? 'pt-4 pb-4' : 'pt-5'}`}>
        <div
          className="flex items-center gap-3 cursor-pointer select-none group"
          onClick={onToggle}
          data-testid="trending-now-header"
        >
          <div className="h-9 w-9 rounded-lg flex items-center justify-center pulse-icon-orange">
            <Flame className="h-4 w-4 text-orange-600 dark:text-orange-400" />
          </div>
          <div className="flex-1">
            <div className="flex items-center gap-2">
              <h3 className="text-sm font-semibold text-foreground dark:text-slate-100">Hot Movers</h3>
              {updatedAgo && (
                <span className="flex items-center gap-1 text-[10px] text-muted-foreground dark:text-slate-500" data-testid="text-hot-movers-updated">
                  <Clock className="h-2.5 w-2.5" />
                  {updatedAgo}
                </span>
              )}
            </div>
            <p className="text-[10px] text-muted-foreground dark:text-slate-500 uppercase tracking-wider">Exceptional 24h movement</p>
          </div>
          <div className={`h-6 w-6 rounded-md flex items-center justify-center bg-muted/50 dark:bg-slate-700/30 transition-transform duration-200 ${collapsed ? '' : 'rotate-180'}`}>
            <ChevronDown className="h-4 w-4 text-muted-foreground dark:text-slate-400 group-hover:text-foreground dark:group-hover:text-slate-200 transition-colors" />
          </div>
        </div>

        {!collapsed && hotMovers.length === 0 && (
          <div className="text-center py-6 mt-4" data-testid="trending-now-empty">
            <p className="text-xs text-muted-foreground">No exceptional movement right now</p>
            <p className="text-[10px] text-muted-foreground/70 mt-1">Updates every hour</p>
            <Button
              variant="outline"
              size="sm"
              onClick={scrollToLeaderboard}
              className="mt-3 gap-1.5 text-[11px] border-border dark:border-slate-600/50 text-muted-foreground dark:text-slate-400"
              data-testid="button-view-leaderboard"
            >
              View full leaderboard
              <ArrowRight className="h-3 w-3" />
            </Button>
          </div>
        )}

        {!collapsed && hotMovers.length > 0 && (
          <div className="space-y-1.5 mt-4">
            {hotMovers.map((person, idx) => {
              const delta = formatDelta(person.change24h);
              const isUp = (person.change24h ?? 0) > 0;
              const tag = person.badge;
              const displayName = person.name ?? "";
              const firstName = displayName.split(" ")[0] || "this";
              const ctx = trendContexts?.[person.id];
              const rc = person.rankChange ?? null;
              const showRankChange = rc !== null && Math.abs(rc) >= 3;
              return (
                <div
                  key={person.id}
                  className="flex items-center gap-2.5 p-2 rounded-lg hover-elevate cursor-pointer bg-muted/40 dark:bg-slate-800/30 border border-border/50 dark:border-slate-700/30 transition-colors hover:border-foreground/20 dark:hover:border-slate-600/50"
                  onClick={() => onPersonClick(person.id)}
                  data-testid={`trending-now-item-${person.id}`}
                >
                  <div className="relative flex items-center rounded-md overflow-hidden shrink-0">
                    <div className="flex items-center justify-center min-w-[24px] self-stretch rounded-l-md bg-muted dark:bg-[#101318] border-r border-border dark:border-transparent">
                      <span className="font-mono font-semibold text-muted-foreground dark:text-slate-400 text-[12px] tabular-nums">{idx + 1}</span>
                    </div>
                    <PersonAvatar
                      name={displayName}
                      avatar={person.avatar}
                      size="sm"
                      className="h-10 w-10 shrink-0 rounded-none rounded-r-md"
                    />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-xs truncate text-foreground dark:text-slate-200">{displayName}</p>
                    <div className="flex items-center gap-1.5">
                      {tag ? (
                        <span className={`text-[10px] ${tag.color}`}>{tag.label}</span>
                      ) : null}
                      <Popover>
                        <PopoverTrigger asChild>
                          <button
                            onClick={(e) => e.stopPropagation()}
                            className="inline-flex items-center justify-center min-w-[28px] min-h-[28px] rounded-md p-1 -m-1"
                            data-testid={`trending-now-why-${person.id}`}
                          >
                            <Info className="h-3 w-3 text-slate-700 dark:text-slate-500" />
                          </button>
                        </PopoverTrigger>
                        <PopoverContent
                          side="top"
                          align="start"
                          className="w-[230px] p-3"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <p className="font-semibold text-xs mb-2">Why {firstName} is moving</p>
                          <div className="space-y-1.5 text-[11px]">
                            <div className="flex items-center justify-between gap-2">
                              <span className="text-muted-foreground flex items-center gap-1">
                                {isUp
                                  ? <TrendingUp className="h-3 w-3 text-emerald-600 dark:text-emerald-400" />
                                  : <TrendingDown className="h-3 w-3 text-red-600 dark:text-red-400" />}
                                24h Change
                              </span>
                              <span className={`font-mono font-medium ${isUp ? "text-emerald-600 dark:text-emerald-400" : "text-red-600 dark:text-red-400"}`}>
                                {formatDelta(person.change24h)}
                              </span>
                            </div>
                            <div className="flex items-center justify-between gap-2">
                              <span className="text-muted-foreground flex items-center gap-1">
                                <Globe className="h-3 w-3" />
                                Rank
                              </span>
                              <span className="font-mono font-medium">{person.rank ? `#${person.rank}` : 'New'}</span>
                            </div>
                            {showRankChange && (
                              <div className="flex items-center justify-between gap-2">
                                <span className="text-muted-foreground flex items-center gap-1">
                                  {rc! > 0
                                    ? <ArrowUpRight className="h-3 w-3 text-emerald-600 dark:text-emerald-400" />
                                    : <ArrowDownRight className="h-3 w-3 text-red-600 dark:text-red-400" />}
                                  Rank move
                                </span>
                                <span className={`font-mono font-medium ${rc! > 0 ? "text-emerald-600 dark:text-emerald-400" : "text-red-600 dark:text-red-400"}`}>
                                  {rc! > 0 ? `\u2191${rc} spots` : `\u2193${Math.abs(rc!)} spots`}
                                </span>
                              </div>
                            )}
                            {(() => {
                              const sb = person.sourceBreakdown;
                              // `search` was dropped from the icon map Apr 2026 (PR3 of
                              // trend-engine tuning) — it can no longer surface as a
                              // dominant driver since velocity weight is 0. `momentum`
                              // takes its slot with an Activity (pulse) icon to avoid
                              // colliding with the Flame icon used for Surging/Breakout
                              // hot-mover badges (see leaderboard-exceptional.ts) — same
                              // icon as the per-person Momentum Signals card for
                              // surface-to-surface visual consistency.
                              const driverIconMeta: Record<string, { icon: JSX.Element; color: string }> = {
                                news: { icon: <Newspaper className="h-3 w-3" />, color: "text-amber-600 dark:text-amber-400" },
                                wiki: { icon: <Globe className="h-3 w-3" />, color: "text-emerald-600 dark:text-emerald-400" },
                                momentum: { icon: <Activity className="h-3 w-3" />, color: "text-cyan-600 dark:text-cyan-400" },
                              };
                              const topActiveSource = sb?.sources?.find(s => s.status === "active");
                              const driverMeta = topActiveSource ? driverIconMeta[topActiveSource.key] : null;
                              const driverLabel = sb?.dominantDriver;
                              const hasData = sb && sb.sources && sb.sources.some(s => s.status !== "no-data");
                              return (
                                <>
                                  <div className="border-t border-slate-700/40 my-1.5" />
                                  {driverLabel ? (
                                    <div className="flex items-center gap-1.5 mb-1" data-testid={`score-drivers-label-${person.id}`}>
                                      {driverMeta && <span className={driverMeta.color}>{driverMeta.icon}</span>}
                                      <span className="text-[11px] font-medium">Main driver: {driverLabel}</span>
                                    </div>
                                  ) : hasData ? (
                                    <div className="flex items-center gap-1.5 mb-1" data-testid={`score-drivers-label-${person.id}`}>
                                      <TrendingUp className="h-3 w-3 text-emerald-600 dark:text-emerald-400" />
                                      <span className="text-[11px] font-medium text-muted-foreground">Multiple signals contributing</span>
                                    </div>
                                  ) : (
                                    <p className="text-[10px] text-muted-foreground italic" data-testid={`score-drivers-label-${person.id}`}>Driver data not yet available</p>
                                  )}
                                </>
                              );
                            })()}
                          </div>
                          <Button
                            variant="secondary"
                            size="sm"
                            onClick={(e) => {
                              e.stopPropagation();
                              onPersonClick(person.id);
                            }}
                            className="mt-3 w-full gap-1.5 text-[11px]"
                            data-testid={`trending-now-details-${person.id}`}
                          >
                            View full details
                            <ArrowRight className="h-3 w-3" />
                          </Button>
                        </PopoverContent>
                      </Popover>
                    </div>
                  </div>
                  {delta && (
                    <span
                      className={`px-2 py-0.5 rounded text-xs font-mono font-medium tabular-nums ${
                        isUp
                          ? "bg-green-500/15 text-green-600 dark:text-green-400"
                          : "bg-red-500/15 text-red-600 dark:text-red-400"
                      }`}
                    >
                      {delta}
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
