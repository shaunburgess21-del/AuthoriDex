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
    <Badge
      variant={isTop10 ? "default" : "secondary"}
      className={cn(
        "font-mono font-bold text-sm gap-0.5 min-w-[3rem] justify-center whitespace-nowrap",
        isTop10 && "bg-primary text-primary-foreground"
      )}
      data-testid={`badge-rank-${rank}`}
    >
      #{rank}
      {showChange && (
        <span
          className={cn(
            "inline-flex items-center text-[10px] font-bold ml-0.5",
            rankChange! > 0 ? "text-emerald-200" : "text-red-200"
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
    </Badge>
  );
}
