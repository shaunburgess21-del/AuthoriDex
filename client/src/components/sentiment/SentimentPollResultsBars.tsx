import { cn } from "@/lib/utils";
import { getSentimentPollChoiceLabel } from "@shared/lib/sentiment-poll-choice";

export interface SentimentPollResultsBarsProps {
  agreePercent: number;
  neutralPercent: number;
  disagreePercent: number;
  /** Smaller bars for Voices link-card banners. */
  compact?: boolean;
  /** Grow rows to fill leftover height (Voices card links). */
  fill?: boolean;
  /** Agree / Neutral / Disagree to the right of each bar (hidden below sm). */
  showChoiceLabels?: boolean;
  className?: string;
  testId?: string;
}

export function SentimentPollResultsBars({
  agreePercent,
  neutralPercent,
  disagreePercent,
  compact = false,
  fill = false,
  showChoiceLabels = false,
  className,
  testId = "bar-results",
}: SentimentPollResultsBarsProps) {
  const barHeight = fill ? "h-full min-h-5" : compact ? "h-5 sm:h-6" : "h-9";
  const gap = fill ? "gap-1.5" : compact ? "gap-1" : "gap-2";
  const textSize = compact && !fill ? "text-[10px]" : "text-xs";
  const minWidth = 15;
  const enableHover = !compact && !fill;

  const rows = [
    {
      choice: "agree" as const,
      percent: agreePercent,
      barClass: "border-[#00C853]/50 bg-[#00C853]/10",
      hoverClass: "hover:border-[#00C853]/80 hover:bg-[#00C853]/20",
      textClass: "text-[#00C853]",
    },
    {
      choice: "neutral" as const,
      percent: neutralPercent,
      barClass: "border-white/40 bg-white/5",
      hoverClass: "hover:border-white/80 hover:bg-white/15",
      textClass: "text-white",
    },
    {
      choice: "disagree" as const,
      percent: disagreePercent,
      barClass: "border-[#FF0000]/50 bg-[#FF0000]/10",
      hoverClass: "hover:border-[#FF0000]/80 hover:bg-[#FF0000]/20",
      textClass: "text-[#FF0000]",
    },
  ];

  return (
    <div
      className={cn("flex flex-col", gap, fill && "min-h-0 flex-1", className)}
      data-testid={testId}
    >
      {rows.map((row) => (
        <div
          key={row.choice}
          className={cn(
            "flex min-w-0 gap-2",
            fill ? "min-h-5 flex-1 items-stretch" : "items-center",
          )}
        >
          <div className={cn("min-w-0 flex-1", fill && "h-full min-h-5")}>
            <div
              className={cn(
                barHeight,
                "flex items-center justify-center rounded-md border transition-all duration-300",
                row.barClass,
                enableHover && `cursor-default ${row.hoverClass}`,
              )}
              style={{ width: `${Math.max(row.percent, minWidth)}%` }}
            >
              <span className={cn(textSize, "font-semibold", row.textClass)}>{row.percent}%</span>
            </div>
          </div>
          {showChoiceLabels && (
            <span className={cn("hidden w-14 shrink-0 self-center text-[11px] font-bold sm:block", row.textClass)}>
              {getSentimentPollChoiceLabel(row.choice)}
            </span>
          )}
        </div>
      ))}
    </div>
  );
}
