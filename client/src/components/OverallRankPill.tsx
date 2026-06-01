import { Trophy } from "lucide-react";
import { getCategoryStyle } from "@/components/CategoryPill";

const SLATE_STYLE = getCategoryStyle("politics");

interface OverallRankPillProps {
  rank: number;
  size?: "sm" | "xs" | "mover";
  className?: string;
}

const SIZE_CLASSES = {
  mover: {
    pill: "px-1 py-0.5 text-[9px] leading-none font-medium",
    icon: "h-2 w-2",
  },
  xs: {
    pill: "px-1 py-0.5 text-[10px] font-semibold",
    icon: "h-2.5 w-2.5",
  },
  sm: {
    pill: "px-1.5 py-0.5 text-xs font-semibold",
    icon: "h-3 w-3",
  },
} as const;

export function OverallRankPill({ rank, size = "xs", className = "" }: OverallRankPillProps) {
  if (rank <= 0) return null;

  const { pill, icon } = SIZE_CLASSES[size];

  return (
    <span
      className={`inline-flex items-center gap-0.5 rounded shrink-0 ${SLATE_STYLE.bg} border ${SLATE_STYLE.border} ${SLATE_STYLE.text} ${pill} ${className}`}
      data-testid="overall-rank-pill"
    >
      <Trophy className={icon} />
      #{rank}
    </span>
  );
}
