import { cn } from "@/lib/utils";

export interface SentimentPollResultsBarsProps {
  agreePercent: number;
  neutralPercent: number;
  disagreePercent: number;
  /** Smaller bars for Voices link-card banners. */
  compact?: boolean;
  className?: string;
  testId?: string;
}

export function SentimentPollResultsBars({
  agreePercent,
  neutralPercent,
  disagreePercent,
  compact = false,
  className,
  testId = "bar-results",
}: SentimentPollResultsBarsProps) {
  const barHeight = compact ? "h-5 sm:h-6" : "h-9";
  const gap = compact ? "gap-1" : "gap-2";
  const textSize = compact ? "text-[10px]" : "text-xs";
  const minWidth = 15;

  return (
    <div
      className={cn("flex flex-col", gap, className)}
      data-testid={testId}
    >
      <div
        className={cn(
          barHeight,
          "flex items-center justify-center rounded-md border border-[#00C853]/50 bg-[#00C853]/10 transition-all duration-300",
          !compact && "cursor-default hover:border-[#00C853]/80 hover:bg-[#00C853]/20",
        )}
        style={{ width: `${Math.max(agreePercent, minWidth)}%` }}
      >
        <span className={cn(textSize, "font-semibold text-[#00C853]")}>{agreePercent}%</span>
      </div>
      <div
        className={cn(
          barHeight,
          "flex items-center justify-center rounded-md border border-white/40 bg-white/5 transition-all duration-300",
          !compact && "cursor-default hover:border-white/80 hover:bg-white/15",
        )}
        style={{ width: `${Math.max(neutralPercent, minWidth)}%` }}
      >
        <span className={cn(textSize, "font-semibold text-white")}>{neutralPercent}%</span>
      </div>
      <div
        className={cn(
          barHeight,
          "flex items-center justify-center rounded-md border border-[#FF0000]/50 bg-[#FF0000]/10 transition-all duration-300",
          !compact && "cursor-default hover:border-[#FF0000]/80 hover:bg-[#FF0000]/20",
        )}
        style={{ width: `${Math.max(disagreePercent, minWidth)}%` }}
      >
        <span className={cn(textSize, "font-semibold text-[#FF0000]")}>{disagreePercent}%</span>
      </div>
    </div>
  );
}
