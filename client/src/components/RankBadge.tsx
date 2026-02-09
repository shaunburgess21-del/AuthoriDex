import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { ChevronUp, ChevronDown } from "lucide-react";

interface RankBadgeProps {
  rank: number;
  rankChange?: number | null;
}

export function RankBadge({ rank, rankChange }: RankBadgeProps) {
  const isTop10 = rank <= 10;
  const showChange = rankChange != null && Math.abs(rankChange) >= 2;

  return (
    <div className="flex flex-col items-center gap-0.5 min-w-[3.5rem]">
      <Badge
        variant={isTop10 ? "default" : "secondary"}
        className={cn(
          "font-mono font-bold text-base w-14 justify-center",
          isTop10 && "bg-primary text-primary-foreground"
        )}
        data-testid={`badge-rank-${rank}`}
      >
        #{rank}
      </Badge>
      {showChange && (
        <span
          className={cn(
            "flex items-center text-[10px] font-semibold leading-none",
            rankChange! > 0 ? "text-emerald-400" : "text-red-400"
          )}
          data-testid={`rank-change-${rank}`}
        >
          {rankChange! > 0 ? (
            <ChevronUp className="h-3 w-3 -mr-0.5" />
          ) : (
            <ChevronDown className="h-3 w-3 -mr-0.5" />
          )}
          {Math.abs(rankChange!)}
        </span>
      )}
    </div>
  );
}
