import { cn } from "@/lib/utils";

function formatNum(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}K`;
  return n.toLocaleString("en-US");
}

export function SentimentMiniBar({
  positive,
  negative,
  neutral: _neutral = 0,
  className,
  testId = "sentiment-mini-bar",
  showCounts = true,
}: {
  positive: number;
  negative: number;
  /** Ignored — kept for API compat; neutral is merged into positive server-side. */
  neutral?: number;
  className?: string;
  testId?: string;
  showCounts?: boolean;
}) {
  const sum = positive + negative;
  if (sum <= 0) return null;
  const segments = [
    { key: "pos", pct: (positive / sum) * 100, className: "bg-emerald-500/80" },
    { key: "neg", pct: (negative / sum) * 100, className: "bg-rose-500/80" },
  ];
  return (
    <div className={cn("mt-1", className)} data-testid={testId}>
      <div
        className="flex h-2 w-full overflow-hidden rounded-full"
        role="img"
        aria-label={`Sentiment: ${Math.round((positive / sum) * 100)}% positive`}
      >
        {segments.map((s) =>
          s.pct > 0 ? (
            <div
              key={s.key}
              className={cn("h-full min-w-[2px]", s.className)}
              style={{ width: `${s.pct}%` }}
            />
          ) : null,
        )}
      </div>
      {showCounts && (
        <div className="flex justify-between text-[9px] text-muted-foreground/70 mt-0.5 font-mono">
          <span>+{formatNum(positive)}</span>
          <span>-{formatNum(negative)}</span>
        </div>
      )}
    </div>
  );
}
