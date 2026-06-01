import { Trophy } from "lucide-react";

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
    pill: "px-1 py-0.5 text-[10px] font-medium",
    icon: "h-2.5 w-2.5",
  },
  sm: {
    pill: "px-1.5 py-0.5 text-xs font-medium",
    icon: "h-3 w-3",
  },
} as const;

/** Muted pill styling — matches leaderboard trend score grey, not category accent. */
const MUTED_PILL =
  "border border-muted-foreground/20 bg-muted-foreground/5 text-muted-foreground";

export function OverallRankPill({ rank, size = "xs", className = "" }: OverallRankPillProps) {
  if (rank <= 0) return null;

  const { pill, icon } = SIZE_CLASSES[size];

  return (
    <span
      className={`inline-flex items-center gap-0.5 rounded shrink-0 font-mono tabular-nums ${MUTED_PILL} ${pill} ${className}`}
      data-testid="overall-rank-pill"
    >
      <Trophy className={icon} aria-hidden />
      #{rank}
    </span>
  );
}
