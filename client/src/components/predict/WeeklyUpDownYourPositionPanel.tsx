import { Link } from "wouter";
import { BarChart3, ChevronRight, TrendingDown, TrendingUp } from "lucide-react";
import { WhatNeedsToHappen } from "@/components/predict/WhatNeedsToHappen";
import { cn } from "@/lib/utils";
import { formatVox, formatVoxDelta } from "@/lib/currency";

export function weeklyUpDownPickFromEntryLabel(entryLabel: string | undefined): "up" | "down" | null {
  const l = (entryLabel || "").toLowerCase();
  if (l === "up") return "up";
  if (l === "down") return "down";
  return null;
}

export function pendingWeeklyUpDownPositionFromBet(
  bet: { result: string; entryLabel: string; stakeAmount: number } | undefined
): { pick: "up" | "down" | null; stakeAmount: number } | null {
  if (!bet || bet.result !== "pending") return null;
  return {
    pick: weeklyUpDownPickFromEntryLabel(bet.entryLabel),
    stakeAmount: bet.stakeAmount,
  };
}

export function WeeklyUpDownYourPositionPanel({
  pick,
  personName,
  baselineScore,
  currentScore,
  stakeAmount,
  variant = "detail",
  href,
  onLinkClick,
  className,
  tieRule,
  unrealisedPnl = null,
}: {
  pick: "up" | "down" | null;
  personName: string;
  baselineScore: number;
  currentScore: number;
  stakeAmount: number;
  variant?: "detail" | "cardLink";
  href?: string;
  onLinkClick?: () => void;
  className?: string;
  tieRule?: string | null;
  /**
   * Live unrealised P&L (Vox) for the user's open position on
   * this market, shown next to Stake on the card banner. Null when
   * the AMM position summary hasn't loaded yet — in which case we
   * fall back to the Stake-only layout. We deliberately omit a
   * Winning/Behind pill here even though `getUpDownWinningState` is
   * available: that pill is anchored to the trend score crossing the
   * baseline, which can disagree with AMM-driven P&L (the score
   * moved down but the market is pricing your side to win, etc.).
   * P&L is the truer "where do I stand?" signal.
   */
  unrealisedPnl?: number | null;
}) {
  const firstName = personName.split(" ")[0];

  const shell =
    pick === "up"
      ? "border-green-500/40 dark:border-green-500/30 bg-green-500/8 dark:bg-green-500/5"
      : pick === "down"
        ? "border-red-500/40 dark:border-red-500/30 bg-red-500/8 dark:bg-red-500/5"
        : "border-violet-500/40 dark:border-violet-500/30 bg-violet-500/8 dark:bg-violet-500/5";

  const headerClass =
    pick === "up"
      ? "text-green-700 dark:text-green-500"
      : pick === "down"
        ? "text-red-700 dark:text-red-500"
        : "text-violet-700 dark:text-violet-400";

  const iconWrapBase =
    pick === "up"
      ? "bg-green-500/25 dark:bg-green-500/20 border border-green-500/50 dark:border-green-500/40"
      : pick === "down"
        ? "bg-red-500/25 dark:bg-red-500/20 border border-red-500/50 dark:border-red-500/40"
        : "bg-violet-500/25 dark:bg-violet-500/20 border border-violet-500/50 dark:border-violet-500/40";

  /** Matches inactive Up/Down buttons in WeeklyUpDownActionButtons (cardLink only). */
  const cardLinkShell =
    pick === "up"
      ? "bg-[#00C853]/10 border-[#00C853]/50 hover:bg-[#00C853]/20 hover:border-[#00C853]/80"
      : pick === "down"
        ? "bg-[#FF0000]/10 border-[#FF0000]/50 hover:bg-[#FF0000]/20 hover:border-[#FF0000]/80"
        : "border-violet-500/40 dark:border-violet-500/30 bg-violet-500/8 dark:bg-violet-500/5 hover:border-violet-500/55 hover:bg-violet-500/12";

  const cardLinkIconWrap =
    pick === "up"
      ? "bg-[#00C853]/10 border border-[#00C853]/50"
      : pick === "down"
        ? "bg-[#FF0000]/10 border border-[#FF0000]/50"
        : iconWrapBase;

  const cardLinkPickTextClass =
    pick === "up" ? "text-[#00C853]" : pick === "down" ? "text-[#FF0000]" : headerClass;

  const cardLinkGlyphClass =
    pick === "up" ? "text-[#00C853]" : pick === "down" ? "text-[#FF0000]" : "text-violet-700 dark:text-violet-400";

  if (variant === "cardLink") {
    // Sprint 4.3: P&L badge on the card banner. `formatVoxDelta`
    // handles the sub-cent zero clamp (raw -0.001 would otherwise
    // render as "−Ꝟ0.00"); we still need the raw value to drive the
    // colour class, since the formatted string discards the sign at
    // the clamp boundary.
    const hasPnl = unrealisedPnl != null && Number.isFinite(unrealisedPnl);
    const pnlValue = hasPnl ? (unrealisedPnl as number) : 0;
    const pnlIsZero = hasPnl && Math.abs(pnlValue) < 0.005;
    const pnlClass = !hasPnl || pnlIsZero
      ? "text-muted-foreground"
      : pnlValue >= 0
        ? "text-green-700 dark:text-green-400"
        : "text-red-700 dark:text-red-400";
    const pnlText = !hasPnl ? null : formatVoxDelta(pnlValue);

    const compact = (
      <div
        className={cn(
          "flex min-h-10 items-center justify-between gap-2 rounded-md border px-3 py-3 md:py-2 text-left w-full transition-colors",
          cardLinkShell,
          className
        )}
      >
        <div className="flex items-center gap-2 min-w-0 flex-1">
          <div className={cn("h-5 w-5 rounded-full flex items-center justify-center shrink-0", cardLinkIconWrap)}>
            {pick === "up" ? (
              <TrendingUp className={cn("h-2.5 w-2.5", cardLinkGlyphClass)} />
            ) : pick === "down" ? (
              <TrendingDown className={cn("h-2.5 w-2.5", cardLinkGlyphClass)} />
            ) : (
              <BarChart3 className={cn("h-2.5 w-2.5", cardLinkGlyphClass)} />
            )}
          </div>
          <div className="min-w-0 flex flex-row flex-wrap items-center gap-1.5">
            <span className="text-xs font-semibold uppercase tracking-wide leading-none text-foreground">
              Your position
            </span>
            {pick ? (
              <span className={cn("text-xs font-semibold leading-none", cardLinkPickTextClass)}>
                {pick === "up" ? "UP" : "DOWN"}
              </span>
            ) : (
              <span className="text-xs text-muted-foreground leading-none">View details</span>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {pnlText && (
            <span className={cn("text-xs font-semibold font-mono tabular-nums", pnlClass)}>
              {pnlText}
            </span>
          )}
          <div className="flex items-baseline gap-1 tabular-nums">
            <span className="text-[10px] text-muted-foreground">Stake</span>
            <span className="text-xs font-semibold text-foreground">
              {formatVox(stakeAmount)}
            </span>
          </div>
          <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" aria-hidden />
        </div>
      </div>
    );

    // Always link out to the detail page from the cardLink variant —
    // we used to support an in-place top-up handler (`onAddTopUp`)
    // here, but it opened the StakeModal in add-only mode which hid
    // the Sell tab and the opposite-side flip (Sprint 4 smoke-test
    // bug). The detail page is the canonical Buy/Sell/Hedge surface
    // for an open position.
    if (href) {
      return (
        <Link
          href={href}
          onClick={onLinkClick}
          className="block w-full rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
          aria-label={`View your Weekly Up or Down position for ${personName}`}
        >
          {compact}
        </Link>
      );
    }

    return compact;
  }

  return (
    <div className={cn("rounded-xl border p-4", shell, className)}>
      <p className={cn("text-xs font-semibold uppercase tracking-wider mb-2", headerClass)}>Your Position</p>
      <div className="flex items-center gap-3">
        <div className={cn("h-12 w-12 rounded-full flex items-center justify-center shrink-0", iconWrapBase)}>
          {pick === "up" ? (
            <TrendingUp className="h-6 w-6 text-green-700 dark:text-green-500" />
          ) : pick === "down" ? (
            <TrendingDown className="h-6 w-6 text-red-700 dark:text-red-500" />
          ) : (
            <BarChart3 className="h-6 w-6 text-violet-700 dark:text-violet-400" />
          )}
        </div>
        <div className="flex-1 min-w-0">
          {pick ? (
            <>
              <p className="font-semibold text-sm">
                {pick === "up" ? "UP" : "DOWN"} on {firstName}
              </p>
              <WhatNeedsToHappen
                pick={pick}
                baselineScore={baselineScore}
                currentScore={currentScore}
                personName={personName}
                compact
                tieRule={tieRule}
              />
            </>
          ) : (
            <>
              <p className="font-semibold text-sm">Open position</p>
              <p className="text-[11px] text-muted-foreground leading-snug">
                You have Vox on this market. View details for full breakdown.
              </p>
            </>
          )}
        </div>
        <div className="text-right shrink-0">
          <p className="text-xs text-muted-foreground">Stake</p>
          <p className="font-semibold text-sm tabular-nums">{formatVox(stakeAmount)}</p>
        </div>
      </div>
    </div>
  );
}
