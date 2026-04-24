import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Vote, Users, Flame, ArrowRight } from "lucide-react";
import { useLocation } from "wouter";
import type { WatchlistPoll } from "@/hooks/useFavoritesDashboard";
import { cn } from "@/lib/utils";

interface WatchlistPollsCardProps {
  polls: WatchlistPoll[];
}

function pollKindLabel(kind: WatchlistPoll["kind"]): string {
  switch (kind) {
    case "opinion_poll":
      return "Opinion poll";
    case "matchup":
      return "Matchup";
    case "trending_poll":
      return "Trending";
    default:
      return "Poll";
  }
}

function getPollHref(p: WatchlistPoll): string | null {
  switch (p.kind) {
    case "opinion_poll":
      return p.slug ? `/vote/opinion-polls/${p.slug}` : null;
    case "matchup":
      return p.slug ? `/vote/matchups/${p.slug}` : null;
    case "trending_poll":
      return p.slug ? `/polls/${p.slug}` : null;
    default:
      return null;
  }
}

function PollIcon({ kind }: { kind: WatchlistPoll["kind"] }) {
  switch (kind) {
    case "opinion_poll":
      return <Vote className="h-3.5 w-3.5" />;
    case "matchup":
      return <Users className="h-3.5 w-3.5" />;
    case "trending_poll":
      return <Flame className="h-3.5 w-3.5" />;
    default:
      return <Vote className="h-3.5 w-3.5" />;
  }
}

/**
 * Sibling card to WatchlistMarketsCard, but for poll/vote surfaces:
 * opinion polls, matchups, and trending polls that reference a
 * favorited person.
 */
export function WatchlistPollsCard({ polls }: WatchlistPollsCardProps) {
  const [, setLocation] = useLocation();

  return (
    <Card
      className="p-4 border-border/60"
      data-testid="watchlist-polls-card"
    >
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <Vote className="h-4 w-4 text-muted-foreground" />
          <h3 className="text-sm font-semibold">New votes for your favorites</h3>
        </div>
        <Badge variant="outline" className="text-[10px] font-mono h-5">
          {polls.length}
        </Badge>
      </div>

      {polls.length === 0 ? (
        <p
          className="text-sm text-muted-foreground py-3"
          data-testid="watchlist-polls-empty"
        >
          No new polls or matchups involving your favorites.
        </p>
      ) : (
        <div className="space-y-2">
          {polls.map((p) => {
            const href = getPollHref(p);
            return (
              <button
                key={`${p.kind}:${p.id}`}
                type="button"
                onClick={() => href && setLocation(href)}
                disabled={!href}
                className={cn(
                  "w-full text-left rounded-md px-3 py-2.5",
                  "bg-muted/30 transition-colors",
                  href && "hover:bg-muted/60 hover-elevate",
                  !href && "cursor-default opacity-80",
                )}
                data-testid={`watchlist-poll-${p.kind}-${p.id}`}
              >
                <div className="flex items-start gap-3">
                  <div
                    className={cn(
                      "flex-shrink-0 rounded-md p-1.5",
                      p.kind === "matchup"
                        ? "bg-purple-500/10 text-purple-600 dark:text-purple-400"
                        : p.kind === "trending_poll"
                          ? "bg-orange-500/10 text-orange-600 dark:text-orange-400"
                          : "bg-blue-500/10 text-blue-600 dark:text-blue-400",
                    )}
                  >
                    <PollIcon kind={p.kind} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <Badge variant="outline" className="text-[9px] uppercase tracking-wider h-4 px-1">
                        {pollKindLabel(p.kind)}
                      </Badge>
                      {p.category && (
                        <span className="text-[10px] text-muted-foreground">
                          {p.category}
                        </span>
                      )}
                    </div>
                    <p className="text-sm font-medium mt-1 line-clamp-2">
                      {p.title}
                    </p>
                    {p.matchedPersonNames.length > 0 && (
                      <p className="text-[11px] text-muted-foreground mt-1 truncate">
                        Features: {p.matchedPersonNames.join(", ")}
                      </p>
                    )}
                  </div>
                  {href && (
                    <ArrowRight className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0 self-center" />
                  )}
                </div>
              </button>
            );
          })}
        </div>
      )}

      {polls.length > 0 && (
        <div className="mt-3 pt-3 border-t border-border/40">
          <Button
            variant="ghost"
            size="sm"
            className="w-full text-muted-foreground hover:text-foreground"
            onClick={() => setLocation("/vote")}
            data-testid="watchlist-polls-view-all"
          >
            Browse all votes
            <ArrowRight className="h-3.5 w-3.5 ml-1" />
          </Button>
        </div>
      )}
    </Card>
  );
}
