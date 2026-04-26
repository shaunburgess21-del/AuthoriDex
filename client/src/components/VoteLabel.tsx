import { getRatingTileColor } from "@/lib/ratingColors";
import type { ParentVoteLabel } from "@/components/comments/types";

interface VoteLabelProps {
  label: ParentVoteLabel | null;
}

export function VoteLabel({ label }: VoteLabelProps) {
  if (!label) return null;

  if (label.type === "trending_poll") {
    const color =
      label.choice === "support"
        ? "#00C853"
        : label.choice === "oppose"
          ? "#FF0000"
          : "#FFFFFF";

    return (
      <span className="text-xs font-medium shrink-0" style={{ color }}>
        voted
      </span>
    );
  }

  if (label.type === "matchup") {
    const optionClass =
      label.choice === "option_a"
        ? "text-blue-600 dark:text-blue-400"
        : label.choice === "option_b"
          ? "text-amber-600 dark:text-amber-400"
          : "text-white";

    return (
      <span className="inline-flex items-baseline gap-1 text-xs font-medium shrink-0">
        <span className="text-muted-foreground">voted:</span>
        <span className={optionClass}>{label.optionName}</span>
      </span>
    );
  }

  if (label.type === "opinion_poll") {
    return (
      <span className="inline-flex items-baseline gap-1 text-xs font-medium shrink-0">
        <span className="text-muted-foreground">voted:</span>
        <span className="text-cyan-600 dark:text-cyan-400">{label.optionName}</span>
      </span>
    );
  }

  return (
    <span className="inline-flex items-baseline gap-1 text-xs font-medium shrink-0">
      <span className="text-muted-foreground">voted</span>
      <span><span style={{ color: getRatingTileColor(label.rating) }}>{label.rating}</span><span className="text-muted-foreground">/5</span></span>
    </span>
  );
}
