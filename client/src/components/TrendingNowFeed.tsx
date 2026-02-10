import { TrendingPerson } from "@shared/schema";
import { formatDelta } from "@/lib/formatNumber";
import { Flame, ChevronDown, Info, TrendingUp, TrendingDown, Newspaper, Search, Globe, MessageCircle, ArrowRight, ArrowUpRight, ArrowDownRight } from "lucide-react";
import { useState } from "react";
import { PersonAvatar } from "./PersonAvatar";
import { useTrendContextBatch, getDriverLabel, TrendDriver } from "@/hooks/useTrendContext";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Tooltip as UITooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Button } from "@/components/ui/button";

type EnrichedPerson = TrendingPerson & { rankChange?: number | null };

interface TrendingNowFeedProps {
  people: EnrichedPerson[];
  onPersonClick: (id: string) => void;
  collapsed: boolean;
  onToggle: () => void;
}

function getDriverTag(person: TrendingPerson): { label: string; color: string } | null {
  const delta = person.change24h ?? 0;
  if (Math.abs(delta) < 5) return null;

  if (delta >= 25) return { label: "Spiking", color: "text-yellow-400" };
  if (delta >= 15) return { label: "Surging", color: "text-orange-300" };
  if (delta >= 5) return { label: "Rising", color: "text-emerald-400" };
  if (delta <= -15) return { label: "Cooling", color: "text-blue-400" };
  if (delta <= -5) return { label: "Dipping", color: "text-red-400" };
  return null;
}

function getDriverExplanation(driver: TrendDriver): string {
  switch (driver) {
    case "NEWS": return "Increased news coverage and media mentions";
    case "SEARCH": return "Search interest surged significantly";
    case "WIKI": return "Wikipedia pageviews rising fast";
    case "SOCIAL": return "High social media velocity and engagement";
    default: return "";
  }
}

const DEFAULT_VISIBLE = 3;

export function TrendingNowFeed({ people, onPersonClick, collapsed, onToggle }: TrendingNowFeedProps) {
  const [showAll, setShowAll] = useState(false);

  const hotMovers = people
    .filter(p => p.change24h != null && Math.abs(p.change24h) >= 5)
    .sort((a, b) => Math.abs(b.change24h ?? 0) - Math.abs(a.change24h ?? 0))
    .slice(0, 8);

  const visibleMovers = showAll ? hotMovers : hotMovers.slice(0, DEFAULT_VISIBLE);
  const hasMore = hotMovers.length > DEFAULT_VISIBLE;

  const visibleIds = !collapsed ? visibleMovers.map(p => p.id) : [];
  const { data: trendContexts } = useTrendContextBatch(visibleIds);

  if (hotMovers.length === 0) return null;

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
            <h3 className="text-sm font-semibold text-slate-100">Hot Movers</h3>
            <p className="text-[10px] text-slate-500 uppercase tracking-wider">Top % gainers · 24h</p>
          </div>
          <div className={`h-6 w-6 rounded-md flex items-center justify-center bg-slate-700/30 transition-transform duration-200 ${collapsed ? '' : 'rotate-180'}`}>
            <ChevronDown className="h-4 w-4 text-slate-400 group-hover:text-slate-200 transition-colors" />
          </div>
        </div>

        {!collapsed && (
          <div className="space-y-1.5 mt-4">
            {visibleMovers.map((person, idx) => {
              const delta = formatDelta(person.change24h);
              const isUp = (person.change24h ?? 0) > 0;
              const driver = getDriverTag(person);
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
                    {driver && (
                      <div className="flex items-center gap-1.5">
                        <span className={`text-[10px] ${driver.color}`}>{driver.label}</span>
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
                                    {ctx.primaryDriver === "SOCIAL" && <MessageCircle className="h-3 w-3" />}
                                    Driver
                                  </span>
                                  <UITooltip>
                                    <TooltipTrigger asChild>
                                      <span className="font-medium cursor-help border-b border-dotted border-muted-foreground/40" data-testid={`trending-now-driver-${person.id}`}>
                                        {getDriverLabel(ctx.primaryDriver)}
                                      </span>
                                    </TooltipTrigger>
                                    <TooltipContent side="top" className="text-xs max-w-[200px]">
                                      {getDriverExplanation(ctx.primaryDriver)}
                                    </TooltipContent>
                                  </UITooltip>
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
                    )}
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
            {hasMore && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  setShowAll(!showAll);
                }}
                className="w-full text-center text-xs text-slate-500 hover:text-slate-300 py-1.5 transition-colors"
                data-testid="trending-now-show-more"
              >
                {showAll ? "Show less" : `Show ${hotMovers.length - DEFAULT_VISIBLE} more`}
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
