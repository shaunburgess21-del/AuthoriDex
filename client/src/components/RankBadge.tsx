import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

interface RankBadgeProps {
  rank: number;
}

export function RankBadge({ rank }: RankBadgeProps) {
  const isTop10 = rank <= 10;
  const isTop50 = rank <= 50 && rank > 10;

  return (
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
  );
}
