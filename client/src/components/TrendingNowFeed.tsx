import { TrendingPerson } from "@shared/schema";
import { formatDelta } from "@/lib/formatNumber";
import { Flame, ChevronDown, Info } from "lucide-react";
import { useState } from "react";
import { PersonAvatar } from "./PersonAvatar";
import { useTrendContextBatch } from "@/hooks/useTrendContext";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";

interface TrendingNowFeedProps {
  people: TrendingPerson[];
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
            <h3 className="text-sm font-semibold text-slate-100">Trending Now</h3>
            <p className="text-[10px] text-slate-500 uppercase tracking-wider">24h Hot Movers</p>
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
                        {ctx?.reasonTag && ctx.reasonTag !== "Unknown" && (
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
                              className="w-auto max-w-[260px] p-3"
                              onClick={(e) => e.stopPropagation()}
                            >
                              <p className="font-semibold text-xs">{ctx.reasonTag}</p>
                              {ctx.headlineSnippet && (
                                <p className="text-[11px] text-muted-foreground mt-1 italic">"{ctx.headlineSnippet}"</p>
                              )}
                            </PopoverContent>
                          </Popover>
                        )}
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
