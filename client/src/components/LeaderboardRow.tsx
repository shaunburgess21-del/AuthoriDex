import { TrendingPerson } from "@shared/schema";
import { PersonAvatar } from "./PersonAvatar";
import { RankBadge } from "./RankBadge";
import { TrendBadge } from "./TrendBadge";
import { Button } from "@/components/ui/button";
import { ChevronRight } from "lucide-react";

interface LeaderboardRowProps {
  person: TrendingPerson;
  onClick?: () => void;
}

export function LeaderboardRow({ person, onClick }: LeaderboardRowProps) {
  return (
    <div
      className="flex items-center gap-4 p-4 border-b hover-elevate active-elevate-2 cursor-pointer"
      onClick={onClick}
      data-testid={`row-person-${person.id}`}
    >
      <RankBadge rank={person.rank} />
      <PersonAvatar name={person.name} avatar={person.avatar} size="md" />
      <div className="flex-1 min-w-0">
        <h3 className="font-semibold text-base truncate" data-testid={`text-name-${person.id}`}>
          {person.name}
        </h3>
        {person.category && (
          <p className="text-sm text-muted-foreground truncate">
            {person.category}
          </p>
        )}
      </div>
      <div className="text-right hidden sm:block">
        <p className="font-mono font-bold text-2xl" data-testid={`text-score-${person.id}`}>
          {person.trendScore.toFixed(0)}
        </p>
        <p className="text-xs text-muted-foreground uppercase tracking-wide">
          Trend Score
        </p>
      </div>
      <div className="hidden md:flex gap-2">
        <div className="text-center">
          <TrendBadge value={person.change24h} size="sm" />
          <p className="text-xs text-muted-foreground mt-1">24h</p>
        </div>
        <div className="text-center">
          <TrendBadge value={person.change7d} size="sm" />
          <p className="text-xs text-muted-foreground mt-1">7d</p>
        </div>
      </div>
      <Button variant="ghost" size="icon" data-testid={`button-view-${person.id}`}>
        <ChevronRight className="h-5 w-5" />
      </Button>
    </div>
  );
}
