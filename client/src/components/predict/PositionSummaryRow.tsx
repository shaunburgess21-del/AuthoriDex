import { Link } from "wouter";
import { Check, ChevronRight, Plus, type LucideIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { formatVox, formatVoxDelta } from "@/lib/currency";
import { cn } from "@/lib/utils";
import { isValidElement, type CSSProperties, type ReactNode } from "react";

/**
 * Shared "Your pick" footer shell used by World Market, H2H, Category
 * Race, and Weekly Up/Down list cards. Keeps P&L colour / zero-clamp,
 * stake column, chevron, and optional + Add button identical everywhere.
 */
export const POSITION_SUMMARY_SHELL_CLASS =
  "flex min-h-10 items-center gap-2 rounded-lg border px-3 py-3 md:py-2 transition-colors w-full";

/** Sub-cent zero clamp + colour class for unrealised P&L. */
export function formatPositionPnl(unrealisedPnl: number | null | undefined): {
  text: string | null;
  className: string;
} {
  const hasPnl = unrealisedPnl != null && Number.isFinite(unrealisedPnl);
  if (!hasPnl) {
    return { text: null, className: "text-muted-foreground" };
  }
  const pnlValue = unrealisedPnl as number;
  const pnlIsZero = Math.abs(pnlValue) < 0.005;
  const className = pnlIsZero
    ? "text-muted-foreground"
    : pnlValue >= 0
      ? "text-green-700 dark:text-green-400"
      : "text-red-700 dark:text-red-400";
  return { text: formatVoxDelta(pnlValue), className };
}

/** Remap aggregated bet label to the card-footer wording. */
export function formatPickLabel(entryLabel: string | undefined | null): string {
  const label = (entryLabel || "").trim();
  if (!label) return "View position";
  if (label === "Multiple positions") return "Multiple picks";
  return label;
}

export type PositionSummaryRowProps = {
  /** Outcome / pick display name (e.g. "No", person name, "Multiple picks"). */
  pickLabel: string;
  /** Optional stake amount; omit / null hides the Stake column. */
  stakeAmount?: number | null;
  /** Live unrealised P&L; null/undefined hides the delta. */
  unrealisedPnl?: number | null;
  /** Detail-page href for the main row link. */
  href: string;
  onLinkClick?: () => void;
  /** When provided, shows a trailing + Add button (top-up). */
  onAdd?: () => void;
  /** Aria label for the Add button. */
  addAriaLabel?: string;
  /** Aria label for the main link. */
  linkAriaLabel?: string;
  /**
   * Extra classes on the bordered shell (accent colours).
   * Defaults to a neutral violet shell.
   */
  accentShellClassName?: string;
  /**
   * Leading icon. Defaults to Check. Pass a Lucide icon component or
   * a pre-built ReactNode (e.g. TrendingUp with custom colour).
   */
  icon?: LucideIcon | ReactNode;
  /** Extra classes for the default Check / Lucide icon. */
  iconClassName?: string;
  /** Optional className on the outer flex wrapper. */
  className?: string;
  /** Inline styles applied to the bordered shell (dynamic accent colours). */
  shellStyle?: CSSProperties;
  testId?: string;
  addTestId?: string;
  /** Override the small grey label above the pick name. */
  caption?: string;
};

export function PositionSummaryRow({
  pickLabel,
  stakeAmount,
  unrealisedPnl = null,
  href,
  onLinkClick,
  onAdd,
  addAriaLabel,
  linkAriaLabel,
  accentShellClassName = "border-violet-500/40 dark:border-violet-500/30 bg-violet-500/8 dark:bg-violet-500/5 hover:bg-violet-500/12 dark:hover:bg-violet-500/10",
  icon,
  iconClassName = "text-violet-600 dark:text-violet-400",
  className,
  shellStyle,
  testId,
  addTestId,
  caption = "Your pick",
}: PositionSummaryRowProps) {
  const { text: pnlText, className: pnlClass } = formatPositionPnl(unrealisedPnl);
  const showStake = stakeAmount != null && Number.isFinite(stakeAmount);

  const leadingIcon = (() => {
    if (icon == null) {
      return <Check className={cn("h-4 w-4 shrink-0", iconClassName)} />;
    }
    if (isValidElement(icon)) {
      return icon;
    }
    if (typeof icon === "function" || (typeof icon === "object" && icon !== null)) {
      // Lucide icons may be functions or forwardRef objects.
      const Icon = icon as unknown as LucideIcon;
      return <Icon className={cn("h-4 w-4 shrink-0", iconClassName)} />;
    }
    return <Check className={cn("h-4 w-4 shrink-0", iconClassName)} />;
  })();

  const inner = (
    <div
      className={cn(POSITION_SUMMARY_SHELL_CLASS, accentShellClassName)}
      style={shellStyle}
      data-testid={testId}
    >
      {leadingIcon}
      <div className="min-w-0 flex-1 text-left">
        <p className="text-[11px] leading-none text-muted-foreground">{caption}</p>
        <p className="truncate text-sm font-semibold leading-tight text-foreground">{pickLabel}</p>
      </div>
      {/* On narrow screens with both P&L and Stake, stack them to avoid
          crushing the pick label. Wider viewports keep the side-by-side. */}
      {(pnlText || showStake) && (
        <div className="flex shrink-0 items-end gap-2 max-[380px]:flex-col max-[380px]:items-end max-[380px]:gap-0.5">
          {pnlText && (
            <span
              className={cn("text-xs font-semibold font-mono tabular-nums", pnlClass)}
              data-testid={testId ? `${testId}-pnl` : undefined}
            >
              {pnlText}
            </span>
          )}
          {showStake && (
            <div className="flex flex-col items-end tabular-nums">
              <span className="text-[10px] leading-none text-muted-foreground">Stake</span>
              <span className="text-xs font-semibold leading-tight text-foreground">
                {formatVox(stakeAmount as number)}
              </span>
            </div>
          )}
        </div>
      )}
      <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
    </div>
  );

  return (
    <div className={cn("flex items-stretch gap-2 w-full", className)}>
      <Link
        href={href}
        onClick={onLinkClick}
        className="flex-1 min-w-0 block rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
        aria-label={linkAriaLabel ?? `View your pick: ${pickLabel}`}
      >
        {inner}
      </Link>
      {onAdd && (
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={onAdd}
          className="shrink-0 gap-1 self-stretch min-h-10 px-2 md:px-2.5"
          data-testid={addTestId}
          aria-label={addAriaLabel ?? `Add to your ${pickLabel} pick`}
        >
          <Plus className="h-3.5 w-3.5" />
          <span className="hidden min-[360px]:inline">Add</span>
        </Button>
      )}
    </div>
  );
}
