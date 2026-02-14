import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

interface RankBadgeProps {
  rank: number;
  rankChange?: number | null;
}

export function RankBadge({ rank }: RankBadgeProps) {
  const isTop10 = rank <= 10;

  return (
    <Badge
      variant={isTop10 ? "default" : "secondary"}
      className={cn(
        "font-mono font-bold text-sm justify-center whitespace-nowrap px-2 h-7 min-w-[32px]",
        isTop10 && "bg-primary text-primary-foreground"
      )}
      data-testid={`badge-rank-${rank}`}
    >
      #{rank}
    </Badge>
  );
}
