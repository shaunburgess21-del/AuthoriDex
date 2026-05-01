import { TrendingUp, TrendingDown, Clock } from "lucide-react";

interface WhatNeedsToHappenProps {
  pick: "up" | "down";
  baselineScore: number;
  currentScore: number;
  personName: string;
  timeRemaining?: string;
  compact?: boolean;
  /**
   * Server tieRule controls who wins at exactly baseline. Defaults to
   * "refund" (the database default), which means an exact tie voids the
   * market. We use this to colour the at-baseline state correctly: if
   * the user's pick wins the tie, show green; if it loses, show red;
   * otherwise show amber (refund pending).
   */
  tieRule?: string | null;
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
  tieRule = "refund",
}: WhatNeedsToHappenProps) {
  const delta = currentScore - baselineScore;
  const isAboveBaseline = delta > 0;
  const isAtBaseline = delta === 0;
  const pointsFromBaseline = Math.abs(delta);
  const firstName = personName.split(" ")[0];

  const tieFavoursPick =
    isAtBaseline &&
    ((tieRule === "up_wins" && pick === "up") ||
      (tieRule === "down_wins" && pick === "down"));
  const tieAgainstPick =
    isAtBaseline &&
    ((tieRule === "up_wins" && pick === "down") ||
      (tieRule === "down_wins" && pick === "up"));

  if (compact) {
    if (pick === "up") {
      if (isAboveBaseline) {
        return (
          <p className="text-[11px] text-green-600 dark:text-green-400 leading-snug">
            <TrendingUp className="inline h-3 w-3 mr-0.5" />
            UP leads by {formatScore(pointsFromBaseline)} pts. Wins if {firstName} stays above baseline.
          </p>
        );
      }
      if (isAtBaseline) {
        if (tieFavoursPick) {
          return (
            <p className="text-[11px] text-green-600 dark:text-green-400 leading-snug">
              <TrendingUp className="inline h-3 w-3 mr-0.5" />
              {firstName} is exactly at baseline. UP wins the tie.
            </p>
          );
        }
        if (tieAgainstPick) {
          return (
            <p className="text-[11px] text-red-600 dark:text-red-400 leading-snug">
              <TrendingUp className="inline h-3 w-3 mr-0.5" />
              {firstName} is exactly at baseline. DOWN wins the tie — UP needs a gain.
            </p>
          );
        }
        return (
          <p className="text-[11px] text-amber-600 dark:text-amber-400 leading-snug">
            <TrendingUp className="inline h-3 w-3 mr-0.5" />
            {firstName} is exactly at baseline. A tie refunds — UP needs any gain.
          </p>
        );
      }
      return (
        <p className="text-[11px] text-red-600 dark:text-red-400 leading-snug">
          <TrendingUp className="inline h-3 w-3 mr-0.5" />
          Needs {formatDelta(pointsFromBaseline)} pts ({pctChange(currentScore, baselineScore)}) to cross baseline.
        </p>
      );
    }

    // DOWN pick
    if (!isAboveBaseline && !isAtBaseline) {
      return (
        <p className="text-[11px] text-green-600 dark:text-green-400 leading-snug">
          <TrendingDown className="inline h-3 w-3 mr-0.5" />
          DOWN leads. {firstName} is {formatScore(pointsFromBaseline)} below baseline.
        </p>
      );
    }
    if (isAtBaseline) {
      if (tieFavoursPick) {
        return (
          <p className="text-[11px] text-green-600 dark:text-green-400 leading-snug">
            <TrendingDown className="inline h-3 w-3 mr-0.5" />
            {firstName} is exactly at baseline. DOWN wins the tie.
          </p>
        );
      }
      if (tieAgainstPick) {
        return (
          <p className="text-[11px] text-red-600 dark:text-red-400 leading-snug">
            <TrendingDown className="inline h-3 w-3 mr-0.5" />
            {firstName} is exactly at baseline. UP wins the tie — DOWN needs a drop.
          </p>
        );
      }
      return (
        <p className="text-[11px] text-amber-600 dark:text-amber-400 leading-snug">
          <TrendingDown className="inline h-3 w-3 mr-0.5" />
          {firstName} is exactly at baseline. A tie refunds — DOWN needs any drop.
        </p>
      );
    }
    return (
      <p className="text-[11px] text-red-600 dark:text-red-400 leading-snug">
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
            <p className="text-green-600 dark:text-green-400">
              {firstName} is {formatScore(pointsFromBaseline)} pts above baseline ({pctChange(baselineScore, currentScore)}).
              UP wins if score stays above {formatScore(baselineScore)} by close.
            </p>
          ) : isAtBaseline ? (
            tieFavoursPick ? (
              <p className="text-green-600 dark:text-green-400">
                {firstName} is exactly at baseline. UP wins the tie under this market's rules.
              </p>
            ) : tieAgainstPick ? (
              <p className="text-red-600 dark:text-red-400">
                {firstName} is exactly at baseline. DOWN wins the tie — UP needs a gain by close.
              </p>
            ) : (
              <p className="text-amber-600 dark:text-amber-400">
                {firstName} is exactly at the baseline. An exact tie refunds; UP needs any gain by close.
              </p>
            )
          ) : (
            <>
              <p className="text-red-600 dark:text-red-400">
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
            <p className="text-green-600 dark:text-green-400">
              DOWN currently leads. {firstName} is {formatScore(pointsFromBaseline)} pts below baseline ({pctChange(baselineScore, currentScore)}).
              DOWN wins if score stays below {formatScore(baselineScore)} by close.
            </p>
          ) : isAtBaseline ? (
            tieFavoursPick ? (
              <p className="text-green-600 dark:text-green-400">
                {firstName} is exactly at baseline. DOWN wins the tie under this market's rules.
              </p>
            ) : tieAgainstPick ? (
              <p className="text-red-600 dark:text-red-400">
                {firstName} is exactly at baseline. UP wins the tie — DOWN needs a drop by close.
              </p>
            ) : (
              <p className="text-amber-600 dark:text-amber-400">
                {firstName} is exactly at baseline. An exact tie refunds; DOWN needs any drop by close.
              </p>
            )
          ) : (
            <>
              <p className="text-red-600 dark:text-red-400">
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
