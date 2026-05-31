import { Trophy } from "lucide-react";
import { getCategoryStyle } from "@/components/CategoryPill";

const SLATE_STYLE = getCategoryStyle("politics");

interface OverallRankPillProps {
  rank: number;
  size?: "sm" | "xs";
  className?: string;
}

export function OverallRankPill({ rank, size = "xs", className = "" }: OverallRankPillProps) {
  if (rank <= 0) return null;

  const isXs = size === "xs";

  return (
    <span
      className={`inline-flex items-center gap-0.5 rounded font-semibold shrink-0 ${SLATE_STYLE.bg} border ${SLATE_STYLE.border} ${SLATE_STYLE.text} ${
        isXs ? "px-1 py-0.5 text-[10px]" : "px-1.5 py-0.5 text-xs"
      } ${className}`}
      data-testid="overall-rank-pill"
    >
      <Trophy className={isXs ? "h-2.5 w-2.5" : "h-3 w-3"} />
      #{rank}
    </span>
  );
}
