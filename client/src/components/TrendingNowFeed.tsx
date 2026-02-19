import { formatDelta } from "@/lib/formatNumber";
import { Flame, ChevronDown, Info, TrendingUp, TrendingDown, Newspaper, Search, Globe, ArrowRight, ArrowUpRight, ArrowDownRight, Clock } from "lucide-react";
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
  badge: { label: string; color: string; description: string };
}

interface TrendingNowFeedProps {
  onPersonClick: (id: string) => void;
  collapsed: boolean;
  onToggle: () => void;
}


function getDriverExplanation(driver: TrendDriver): string {
  switch (driver) {
    case "NEWS": return "Increased news coverage and media mentions";
    case "SEARCH": return "Search interest surged significantly";
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
  const { data: rawResponse, dataUpdatedAt } = useQuery<{ data: HotMover[]; meta?: any } | HotMover[]>({
    queryKey: ['/api/trending/hot-movers'],
    refetchInterval: 60_000,
  });
  const hotMovers: HotMover[] = rawResponse
    ? (Array.isArray(rawResponse) ? rawResponse : rawResponse.data ?? [])
    : [];

  const visibleIds = !collapsed ? hotMovers.map(p => p.id) : [];
  const { data: trendContexts } = useTrendContextBatch(visibleIds);

  const updatedAgo = formatUpdatedAgo(dataUpdatedAt);

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
            <Flame className="h-4 w-4 text-orange-400" />
          </div>
          <div className="flex-1">
            <div className="flex items-center gap-2">
              <h3 className="text-sm font-semibold text-slate-100">Hot Movers</h3>
              {updatedAgo && (
                <span className="flex items-center gap-1 text-[10px] text-slate-500" data-testid="text-hot-movers-updated">
                  <Clock className="h-2.5 w-2.5" />
                  {updatedAgo}
                </span>
              )}
            </div>
            <p className="text-[10px] text-slate-500 uppercase tracking-wider">Exceptional 24h movement</p>
          </div>
          <div className={`h-6 w-6 rounded-md flex items-center justify-center bg-slate-700/30 transition-transform duration-200 ${collapsed ? '' : 'rotate-180'}`}>
            <ChevronDown className="h-4 w-4 text-slate-400 group-hover:text-slate-200 transition-colors" />
          </div>
        </div>

        {!collapsed && hotMovers.length === 0 && (
          <div className="text-center py-6 mt-4" data-testid="trending-now-empty">
            <p className="text-xs text-slate-500">No exceptional movement right now</p>
            <p className="text-[10px] text-slate-600 mt-1">Updates every hour</p>
            <Button
              variant="outline"
              size="sm"
              onClick={scrollToLeaderboard}
              className="mt-3 gap-1.5 text-[11px] border-slate-600/50 text-slate-400"
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
              const ctx = trendContexts?.[person.id];
              const rc = person.rankChange ?? null;
              const showRankChange = rc !== null && Math.abs(rc) >= 3;
              return (
                <div
                  key={person.id}
                  className="flex items-center gap-2.5 p-2 rounded-lg hover-elevate cursor-pointer bg-slate-800/30 border border-slate-700/30 transition-colors hover:border-slate-600/50"
                  onClick={() => onPersonClick(person.id)}
                  data-testid={`trending-now-item-${person.id}`}
                >
                  <span className="font-mono font-bold text-slate-500 w-4 text-center text-[14px]">{idx + 1}</span>
                  <PersonAvatar name={person.name} avatar={person.avatar} size="sm" />
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-xs truncate text-slate-200">{person.name}</p>
                    <div className="flex items-center gap-1.5">
                      <span className={`text-[10px] ${tag.color}`}>{tag.label}</span>
                      <Popover>
                        <PopoverTrigger asChild>
                          <button
                            onClick={(e) => e.stopPropagation()}
                            className="inline-flex items-center justify-center min-w-[28px] min-h-[28px] rounded-md p-1 -m-1"
                            data-testid={`trending-now-why-${person.id}`}
                          >
                            <Info className="h-3 w-3 text-slate-500" />
                          </button>
                        </PopoverTrigger>
                        <PopoverContent
                          side="top"
                          align="start"
                          className="w-[230px] p-3"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <p className="font-semibold text-xs mb-2">Why {person.name.split(" ")[0]} is moving</p>
                          <div className="space-y-1.5 text-[11px]">
                            <div className="flex items-center justify-between gap-2">
                              <span className="text-muted-foreground flex items-center gap-1">
                                {isUp
                                  ? <TrendingUp className="h-3 w-3 text-emerald-400" />
                                  : <TrendingDown className="h-3 w-3 text-red-400" />}
                                24h Change
                              </span>
                              <span className={`font-mono font-medium ${isUp ? "text-emerald-400" : "text-red-400"}`}>
                                {formatDelta(person.change24h)}
                              </span>
                            </div>
                            <div className="flex items-center justify-between gap-2">
                              <span className="text-muted-foreground flex items-center gap-1">
                                <Globe className="h-3 w-3" />
                                Rank
                              </span>
                              <span className="font-mono font-medium">#{person.rank}</span>
                            </div>
                            {showRankChange && (
                              <div className="flex items-center justify-between gap-2">
                                <span className="text-muted-foreground flex items-center gap-1">
                                  {rc! > 0
                                    ? <ArrowUpRight className="h-3 w-3 text-emerald-400" />
                                    : <ArrowDownRight className="h-3 w-3 text-red-400" />}
                                  Rank move
                                </span>
                                <span className={`font-mono font-medium ${rc! > 0 ? "text-emerald-400" : "text-red-400"}`}>
                                  {rc! > 0 ? `\u2191${rc} spots` : `\u2193${Math.abs(rc!)} spots`}
                                </span>
                              </div>
                            )}
                            {ctx?.primaryDriver && (
                              <div className="flex items-center justify-between gap-2">
                                <span className="text-muted-foreground flex items-center gap-1">
                                  {ctx.primaryDriver === "NEWS" && <Newspaper className="h-3 w-3" />}
                                  {ctx.primaryDriver === "SEARCH" && <Search className="h-3 w-3" />}
                                  {ctx.primaryDriver === "WIKI" && <Globe className="h-3 w-3" />}
                                  Driver
                                </span>
                                <Popover>
                                  <PopoverTrigger asChild>
                                    <button
                                      onClick={(e) => e.stopPropagation()}
                                      className="font-medium cursor-help border-b border-dotted border-muted-foreground/40 text-[11px] bg-transparent p-0"
                                      data-testid={`trending-now-driver-${person.id}`}
                                    >
                                      {getDriverLabel(ctx.primaryDriver)}
                                    </button>
                                  </PopoverTrigger>
                                  <PopoverContent
                                    side="top"
                                    align="end"
                                    className="w-auto max-w-[200px] p-2 text-xs"
                                    onClick={(e) => e.stopPropagation()}
                                  >
                                    {getDriverExplanation(ctx.primaryDriver)}
                                  </PopoverContent>
                                </Popover>
                              </div>
                            )}
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
                          ? "bg-green-500/15 text-green-400"
                          : "bg-red-500/15 text-red-400"
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
