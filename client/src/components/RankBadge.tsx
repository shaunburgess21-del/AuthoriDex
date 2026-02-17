import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

type RankColorMode = "fame" | "approval";

interface RankBadgeProps {
  rank: number;
  rankChange?: number | null;
  colorMode?: RankColorMode;
}

export function RankBadge({ rank, colorMode = "fame" }: RankBadgeProps) {
  const isTop10 = rank <= 10;

  return (
    <Badge
      variant={isTop10 ? "outline" : "secondary"}
      className={cn(
        "font-mono font-bold text-sm justify-center whitespace-nowrap px-2 h-9 min-w-[40px]",
        isTop10 && colorMode === "fame" && "border-[#3C83F6] text-[#3C83F6] bg-[#3C83F6]/10",
        isTop10 && colorMode === "approval" && "border-[#22D3EE] text-[#22D3EE] bg-[#22D3EE]/10"
      )}
      data-testid={`badge-rank-${rank}`}
    >
      #{rank}
    </Badge>
  );
}
