import { formatDelta } from "@/lib/formatNumber";
import { Flame, ChevronDown, ArrowRight } from "lucide-react";
import { PersonAvatar } from "./PersonAvatar";
import { MoverRowSubtext } from "./MoverRowSubtext";
import { Button } from "@/components/ui/button";
import { useQuery } from "@tanstack/react-query";

export interface HotMover {
  id: string;
  name: string;
  avatar: string | null;
  category: string | null;
  rank: number;
  fameIndex: number | null;
  fameIndexLive?: number | null;
  change24h: number | null;
  rankChange: number | null;
}

interface HotMoversResponse {
  data: HotMover[];
}

interface TrendingNowFeedProps {
  onOpenInsight: (person: HotMover) => void;
  collapsed: boolean;
  onToggle: () => void;
}

export function TrendingNowFeed({ onOpenInsight, collapsed, onToggle }: TrendingNowFeedProps) {
  const { data: rawResponse } = useQuery<HotMoversResponse | HotMover[]>({
    queryKey: ['/api/trending/hot-movers'],
    refetchInterval: 60_000,
  });
  const hotMovers: HotMover[] = rawResponse
    ? (Array.isArray(rawResponse) ? rawResponse : rawResponse.data ?? [])
    : [];

  const scrollToLeaderboard = () => {
    const el = document.getElementById("leaderboard");
    if (el) el.scrollIntoView({ behavior: "smooth" });
  };

  return (
    <div
      className="rounded-xl pulse-card-orange transition-all duration-200"
      data-testid="trending-now-feed"
    >
      <div className={`px-3 sm:px-4 ${collapsed ? 'py-4' : 'pt-5 pb-4'}`}>
        <div
          className="flex items-center gap-3 cursor-pointer select-none group"
          onClick={onToggle}
          data-testid="trending-now-header"
        >
          <div className="h-9 w-9 rounded-lg flex items-center justify-center pulse-icon-orange">
            <Flame className="h-4 w-4 text-orange-600 dark:text-orange-400" />
          </div>
          <div className="flex-1">
            <h3 className="text-sm font-semibold text-foreground dark:text-slate-100">Hot Movers</h3>
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
              const displayName = person.name ?? "";
              return (
                <div
                  key={person.id}
                  className="flex items-center gap-2.5 p-2 rounded-lg hover-elevate cursor-pointer bg-muted/40 dark:bg-slate-800/30 border border-border/50 dark:border-slate-700/30 transition-colors hover:border-foreground/20 dark:hover:border-slate-600/50"
                  onClick={() => onOpenInsight(person)}
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
                    <MoverRowSubtext
                      rank={person.rank}
                      fameIndex={person.fameIndex}
                      fameIndexLive={person.fameIndexLive}
                    />
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
