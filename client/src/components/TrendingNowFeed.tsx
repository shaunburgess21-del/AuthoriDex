import { TrendingPerson } from "@shared/schema";
import { compactNumber, formatDelta } from "@/lib/formatNumber";
import { Flame, ChevronDown, ChevronUp, X } from "lucide-react";
import { useState } from "react";
import { PersonAvatar } from "./PersonAvatar";

interface TrendingNowFeedProps {
  people: TrendingPerson[];
  onPersonClick: (id: string) => void;
}

function getSafeLocalStorage(key: string): string | null {
  try {
    return typeof window !== "undefined" ? localStorage.getItem(key) : null;
  } catch {
    return null;
  }
}

export function TrendingNowFeed({ people, onPersonClick }: TrendingNowFeedProps) {
  const [dismissed, setDismissed] = useState(() => getSafeLocalStorage("trending-now-dismissed") === "true");
  const [expanded, setExpanded] = useState(true);

  const hotMovers = people
    .filter(p => p.change24h != null && Math.abs(p.change24h) >= 5)
    .sort((a, b) => Math.abs(b.change24h ?? 0) - Math.abs(a.change24h ?? 0))
    .slice(0, 5);

  if (dismissed || hotMovers.length === 0) return null;

  const handleDismiss = () => {
    setDismissed(true);
    localStorage.setItem("trending-now-dismissed", "true");
  };

  return (
    <div
      className="mb-4 rounded-lg border border-orange-500/20 bg-orange-500/5"
      data-testid="trending-now-feed"
    >
      <div
        className="flex items-center justify-between px-4 py-2.5 cursor-pointer"
        onClick={() => setExpanded(!expanded)}
        data-testid="trending-now-header"
      >
        <div className="flex items-center gap-2">
          <Flame className="h-4 w-4 text-orange-400" />
          <span className="text-sm font-semibold text-orange-300">Trending Now</span>
          <span className="text-[10px] text-muted-foreground uppercase tracking-wider">24h</span>
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={(e) => {
              e.stopPropagation();
              handleDismiss();
            }}
            className="p-1 rounded hover:bg-muted/50 text-muted-foreground"
            data-testid="trending-now-dismiss"
          >
            <X className="h-3 w-3" />
          </button>
          {expanded ? (
            <ChevronUp className="h-4 w-4 text-muted-foreground" />
          ) : (
            <ChevronDown className="h-4 w-4 text-muted-foreground" />
          )}
        </div>
      </div>
      {expanded && (
        <div className="px-4 pb-3 space-y-1">
          {hotMovers.map((person) => {
            const delta = formatDelta(person.change24h);
            const isUp = (person.change24h ?? 0) > 0;
            return (
              <div
                key={person.id}
                className="flex items-center gap-2.5 py-1.5 rounded-md px-2 hover-elevate active-elevate-2 cursor-pointer"
                onClick={() => onPersonClick(person.id)}
                data-testid={`trending-now-item-${person.id}`}
              >
                <PersonAvatar name={person.name} avatar={person.avatar} size="sm" />
                <span className="text-sm font-medium truncate flex-1">{person.name}</span>
                <span className="text-[11px] font-mono text-muted-foreground">
                  {compactNumber(person.fameIndex ?? Math.round(person.trendScore / 100))}
                </span>
                {delta && (
                  <span className={`text-xs font-mono font-semibold ${isUp ? "text-emerald-400" : "text-red-400"}`}>
                    {delta}
                  </span>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
