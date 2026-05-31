import { resolveFameScore } from "@/lib/fameScore";
import { OverallRankPill } from "@/components/OverallRankPill";

interface MoverRowSubtextProps {
  rank?: number | null;
  fameIndex?: number | null;
  fameIndexLive?: number | null;
  trendScore?: number | null;
}

export function MoverRowSubtext({
  rank,
  fameIndex,
  fameIndexLive,
  trendScore,
}: MoverRowSubtextProps) {
  const fameScore = resolveFameScore({ fameIndex, fameIndexLive, trendScore });
  const hasRank = typeof rank === "number" && rank > 0;

  if (fameScore === 0 && !hasRank) return null;

  return (
    <div className="flex items-center gap-1.5 min-w-0 mt-0.5" data-testid="mover-row-subtext">
      <span className="font-mono text-[10px] text-muted-foreground tabular-nums shrink-0">
        {fameScore.toLocaleString("en-US")}
      </span>
      {hasRank && <OverallRankPill rank={rank} size="xs" />}
    </div>
  );
}
