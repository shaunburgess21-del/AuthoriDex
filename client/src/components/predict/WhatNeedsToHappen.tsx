import { TrendingUp, TrendingDown, Clock } from "lucide-react";

interface WhatNeedsToHappenProps {
  pick: "up" | "down";
  baselineScore: number;
  currentScore: number;
  personName: string;
  timeRemaining?: string;
  compact?: boolean;
}

function formatScore(n: number): string {
  return n.toLocaleString("en-US");
}

function formatDelta(n: number): string {
  const prefix = n >= 0 ? "+" : "";
  return `${prefix}${n.toLocaleString("en-US")}`;
}

function pctChange(from: number, to: number): string {
  if (from === 0) return "0%";
  const pct = ((to - from) / from) * 100;
  const prefix = pct >= 0 ? "+" : "";
  return `${prefix}${pct.toFixed(1)}%`;
}

export function WhatNeedsToHappen({
  pick,
  baselineScore,
  currentScore,
  personName,
  timeRemaining,
  compact = false,
}: WhatNeedsToHappenProps) {
  const delta = currentScore - baselineScore;
  const isAboveBaseline = delta > 0;
  const isAtBaseline = delta === 0;
  const pointsFromBaseline = Math.abs(delta);
  const firstName = personName.split(" ")[0];

  if (compact) {
    if (pick === "up") {
      if (isAboveBaseline) {
        return (
          <p className="text-[11px] text-green-400 leading-snug">
            <TrendingUp className="inline h-3 w-3 mr-0.5" />
            UP leads by {formatScore(pointsFromBaseline)} pts. Wins if {firstName} stays above baseline.
          </p>
        );
      }
      if (isAtBaseline) {
        return (
          <p className="text-[11px] text-amber-400 leading-snug">
            <TrendingUp className="inline h-3 w-3 mr-0.5" />
            {firstName} is exactly at baseline. Any gain secures UP.
          </p>
        );
      }
      return (
        <p className="text-[11px] text-amber-400 leading-snug">
          <TrendingUp className="inline h-3 w-3 mr-0.5" />
          Needs {formatDelta(pointsFromBaseline)} pts ({pctChange(currentScore, baselineScore)}) to cross baseline.
        </p>
      );
    }

    // DOWN pick
    if (!isAboveBaseline && !isAtBaseline) {
      return (
        <p className="text-[11px] text-green-400 leading-snug">
          <TrendingDown className="inline h-3 w-3 mr-0.5" />
          DOWN leads. {firstName} is {formatScore(pointsFromBaseline)} below baseline.
        </p>
      );
    }
    if (isAtBaseline) {
      return (
        <p className="text-[11px] text-amber-400 leading-snug">
          <TrendingDown className="inline h-3 w-3 mr-0.5" />
          {firstName} is exactly at baseline. Any drop secures DOWN.
        </p>
      );
    }
    return (
      <p className="text-[11px] text-amber-400 leading-snug">
        <TrendingDown className="inline h-3 w-3 mr-0.5" />
        {firstName} is {formatScore(pointsFromBaseline)} above baseline. DOWN needs a reversal.
      </p>
    );
  }

  // Full version
  return (
    <div className="rounded-lg border border-border/40 bg-muted/20 p-3 space-y-2">
      <p className="text-xs font-medium text-foreground flex items-center gap-1.5">
        {pick === "up" ? (
          <TrendingUp className="h-3.5 w-3.5 text-green-500" />
        ) : (
          <TrendingDown className="h-3.5 w-3.5 text-red-500" />
        )}
        What needs to happen
      </p>

      <div className="grid grid-cols-2 gap-2 text-[11px]">
        <div>
          <p className="text-muted-foreground">Baseline</p>
          <p className="font-mono font-medium text-foreground">{formatScore(baselineScore)}</p>
        </div>
        <div>
          <p className="text-muted-foreground">Current</p>
          <p className="font-mono font-medium text-foreground">{formatScore(currentScore)}</p>
        </div>
      </div>

      <div className="text-[11px] text-muted-foreground space-y-1">
        {pick === "up" ? (
          isAboveBaseline ? (
            <p className="text-green-400">
              {firstName} is {formatScore(pointsFromBaseline)} pts above baseline ({pctChange(baselineScore, currentScore)}).
              UP wins if score stays above {formatScore(baselineScore)} by close.
            </p>
          ) : isAtBaseline ? (
            <p className="text-amber-400">
              {firstName} is exactly at the baseline. Any gain by close secures UP.
            </p>
          ) : (
            <>
              <p className="text-amber-400">
                {firstName} is {formatScore(pointsFromBaseline)} pts below the weekly baseline.
              </p>
              <p>
                Needs <span className="font-mono font-medium text-foreground">{formatDelta(pointsFromBaseline + 1)}</span> pts
                (<span className="font-medium">{pctChange(currentScore, baselineScore)}</span> from current) by close for UP to win.
              </p>
            </>
          )
        ) : (
          !isAboveBaseline && !isAtBaseline ? (
            <p className="text-green-400">
              DOWN currently leads. {firstName} is {formatScore(pointsFromBaseline)} pts below baseline ({pctChange(baselineScore, currentScore)}).
              DOWN wins if score stays below {formatScore(baselineScore)} by close.
            </p>
          ) : isAtBaseline ? (
            <p className="text-amber-400">
              {firstName} is exactly at baseline. Any drop by close secures DOWN.
            </p>
          ) : (
            <>
              <p className="text-amber-400">
                {firstName} is {formatScore(pointsFromBaseline)} pts above baseline ({pctChange(baselineScore, currentScore)}).
              </p>
              <p>
                DOWN needs {firstName} to drop below <span className="font-mono font-medium text-foreground">{formatScore(baselineScore)}</span> by close.
              </p>
            </>
          )
        )}

        {timeRemaining && (
          <p className="flex items-center gap-1 pt-0.5">
            <Clock className="h-3 w-3" />
            {timeRemaining} remaining
          </p>
        )}
      </div>
    </div>
  );
}
