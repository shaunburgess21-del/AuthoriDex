import { Lock, LockOpen, Trophy } from "lucide-react";
import { useMarketCycle } from "@/hooks/useMarketCycle";
import { cn } from "@/lib/utils";

export type MarketCycleStripVariant = "compact" | "full" | "modal";

export interface MarketCycleStripProps {
  /** Friday 23:59 UTC cutoff when entries lock. */
  bettingCutoff?: string | Date | null;
  /** Sunday 23:59 UTC resolution time when results are announced. */
  resolveAt?: string | Date | null;
  variant?: MarketCycleStripVariant;
  /**
   * Engine of the underlying market. AMM markets allow continuous
   * buying *and* selling all week, so the parimutuel "Entries close"
   * phrasing (which implies a one-shot opt-in) reads wrong. We swap
   * the verb to "Trading closes" / "Trading closed" while keeping the
   * timestamps identical. Defaults to parimutuel for legacy callers.
   */
  engine?: "amm" | "parimutuel";
  className?: string;
}

/**
 * Single source of truth for the "Entries close Fri … · Results Sun …"
 * timing copy shown across native prediction markets. Three variants:
 *
 *   compact – one calm line for cards. Uses short labels (weekday + time)
 *             so it fits next to category pills / pool size without
 *             wrapping. The page hero already shows the running clock.
 *   full    – two-line strip for detail pages with a live countdown for
 *             the active phase plus the calendar date for the other.
 *   modal   – single-line dates form for confirmation modals. We omit
 *             the live countdown here because the predict page hero
 *             already shows it; duplicating it inside the modal added
 *             a redundant "Entries close" label.
 *
 * Phases mirror useMarketCycle:
 *   OPEN           – betting cutoff in the future
 *   ENTRIES_CLOSED – cutoff past, resolution still pending
 *   RESOLVED       – resolution past
 */
export function MarketCycleStrip({
  bettingCutoff,
  resolveAt,
  variant = "compact",
  engine = "parimutuel",
  className,
}: MarketCycleStripProps) {
  const cycle = useMarketCycle({
    bettingCutoff: bettingCutoff ?? null,
    resolutionDeadline: resolveAt ?? null,
  });

  const cutoffLabelFull =
    formatCycleDate(bettingCutoff, { withDate: true }) ?? "Friday 23:59 UTC";
  const resolveLabelFull =
    formatCycleDate(resolveAt, { withDate: true }) ?? "Sunday 23:59 UTC";
  const cutoffLabelShort =
    formatCycleDate(bettingCutoff, { withDate: false }) ?? "Fri 23:59 UTC";
  const resolveLabelShort =
    formatCycleDate(resolveAt, { withDate: false }) ?? "Sun 23:59 UTC";

  const countdown = formatCountdown(cycle.timeRemaining);
  const urgencyClass =
    cycle.urgencyLevel === "critical"
      ? "text-red-600 dark:text-red-400"
      : cycle.urgencyLevel === "warning"
      ? "text-amber-600 dark:text-amber-400"
      : "text-foreground";

  const isAmm = engine === "amm";

  if (variant === "compact") {
    return (
      <CompactStrip
        status={cycle.status}
        cutoffLabel={cutoffLabelShort}
        resolveLabel={resolveLabelShort}
        isAmm={isAmm}
        className={className}
      />
    );
  }

  if (variant === "modal") {
    return (
      <ModalStrip
        status={cycle.status}
        cutoffLabel={cutoffLabelFull}
        resolveLabel={resolveLabelFull}
        isAmm={isAmm}
        className={className}
      />
    );
  }

  return (
    <FullStrip
      status={cycle.status}
      countdown={countdown}
      urgencyClass={urgencyClass}
      cutoffLabel={cutoffLabelFull}
      resolveLabel={resolveLabelFull}
      isAmm={isAmm}
      className={className}
    />
  );
}

function CompactStrip({
  status,
  cutoffLabel,
  resolveLabel,
  isAmm,
  className,
}: {
  status: "OPEN" | "ENTRIES_CLOSED" | "RESOLVED";
  cutoffLabel: string;
  resolveLabel: string;
  isAmm: boolean;
  className?: string;
}) {
  if (status === "RESOLVED") {
    return (
      <div
        className={cn(
          "flex items-center gap-1.5 text-[11px] text-muted-foreground",
          className,
        )}
      >
        <Trophy className="h-3 w-3 shrink-0 text-amber-600 dark:text-amber-500" />
        <span>
          Resolved{" "}
          <span className="font-medium text-foreground">{resolveLabel}</span>
          <span className="text-muted-foreground/70"> · New week starts Monday</span>
        </span>
      </div>
    );
  }

  if (status === "ENTRIES_CLOSED") {
    return (
      <div
        className={cn(
          "flex flex-col sm:flex-row sm:items-center gap-x-1.5 gap-y-0.5 text-[11px] text-muted-foreground",
          className,
        )}
      >
        <span className="flex items-center gap-1.5">
          <Lock className="h-3 w-3 shrink-0 text-amber-600 dark:text-amber-500" />
          <span>{isAmm ? "Trading closed" : "Entries closed"}</span>
        </span>
        <span className="hidden sm:inline text-muted-foreground/70">·</span>
        <span className="pl-[18px] sm:pl-0">
          Results <span className="font-medium text-foreground">{resolveLabel}</span>
        </span>
      </div>
    );
  }

  return (
    <div
      className={cn(
        "flex flex-col sm:flex-row sm:items-center gap-x-1.5 gap-y-0.5 text-[11px] text-muted-foreground",
        className,
      )}
    >
      <span className="flex items-center gap-1.5">
        <LockOpen className="h-3 w-3 shrink-0 text-amber-600 dark:text-amber-500" />
        <span>
          {isAmm ? "Trading closes" : "Entries close"}{" "}
          <span className="font-medium text-foreground">{cutoffLabel}</span>
        </span>
      </span>
      <span className="hidden sm:inline text-muted-foreground/70">·</span>
      <span className="pl-[18px] sm:pl-0">
        Results <span className="font-medium text-foreground">{resolveLabel}</span>
      </span>
    </div>
  );
}

function FullStrip({
  status,
  countdown,
  urgencyClass,
  cutoffLabel,
  resolveLabel,
  isAmm,
  className,
}: {
  status: "OPEN" | "ENTRIES_CLOSED" | "RESOLVED";
  countdown: string;
  urgencyClass: string;
  cutoffLabel: string;
  resolveLabel: string;
  isAmm: boolean;
  className?: string;
}) {
  if (status === "RESOLVED") {
    return (
      <div
        className={cn(
          "rounded-lg border border-border/40 bg-muted/30 p-3 flex items-start gap-2 text-xs",
          className,
        )}
      >
        <Trophy className="h-3.5 w-3.5 mt-0.5 shrink-0 text-amber-600 dark:text-amber-500" />
        <div className="flex-1 min-w-0">
          <span className="text-muted-foreground">Resolved </span>
          <span className="font-medium text-foreground">{resolveLabel}</span>
          <span className="text-muted-foreground/70">
            {" "}
            · New week starts Monday
          </span>
        </div>
      </div>
    );
  }

  return (
    <div
      className={cn(
        "rounded-lg border border-border/40 bg-muted/30 p-3 space-y-1.5",
        className,
      )}
    >
      <div className="flex items-start gap-2 text-xs">
        {status === "OPEN" ? (
          <LockOpen className="h-3.5 w-3.5 mt-0.5 shrink-0 text-amber-600 dark:text-amber-500" />
        ) : (
          <Lock className="h-3.5 w-3.5 mt-0.5 shrink-0 text-amber-600 dark:text-amber-500" />
        )}
        <div className="flex-1 min-w-0">
          <span className="text-muted-foreground">
            {status === "OPEN"
              ? isAmm
                ? "Trading closes "
                : "Entries close "
              : isAmm
                ? "Trading closed "
                : "Entries closed "}
          </span>
          {status === "OPEN" ? (
            <>
              <span className={cn("font-mono font-medium", urgencyClass)}>
                in {countdown}
              </span>
              <span className="text-muted-foreground/80">
                {" "}
                — <span className="font-medium text-foreground">{cutoffLabel}</span>
              </span>
            </>
          ) : (
            <span className="font-medium text-foreground">{cutoffLabel}</span>
          )}
        </div>
      </div>
      <div className="flex items-start gap-2 text-xs">
        <Trophy className="h-3.5 w-3.5 mt-0.5 shrink-0 text-violet-600 dark:text-violet-400" />
        <div className="flex-1 min-w-0">
          <span className="text-muted-foreground">Results </span>
          {status === "ENTRIES_CLOSED" ? (
            <>
              <span className={cn("font-mono font-medium", urgencyClass)}>
                in {countdown}
              </span>
              <span className="text-muted-foreground/80">
                {" "}
                — <span className="font-medium text-foreground">{resolveLabel}</span>
              </span>
            </>
          ) : (
            <span className="font-medium text-foreground">{resolveLabel}</span>
          )}
        </div>
      </div>
    </div>
  );
}

function ModalStrip({
  status,
  cutoffLabel,
  resolveLabel,
  isAmm,
  className,
}: {
  status: "OPEN" | "ENTRIES_CLOSED" | "RESOLVED";
  cutoffLabel: string;
  resolveLabel: string;
  isAmm: boolean;
  className?: string;
}) {
  if (status === "RESOLVED") {
    return (
      <div
        className={cn(
          "flex items-center justify-center gap-1.5 text-xs text-muted-foreground text-center",
          className,
        )}
      >
        <Trophy className="h-3.5 w-3.5 text-amber-600 dark:text-amber-500" />
        <span>
          Resolved{" "}
          <span className="font-medium text-foreground">{resolveLabel}</span>
        </span>
      </div>
    );
  }

  return (
    <div
      className={cn(
        "flex flex-col sm:flex-row sm:items-center sm:justify-center gap-x-1.5 gap-y-0.5 text-xs text-muted-foreground",
        className,
      )}
    >
      <span className="flex items-center gap-1.5">
        {status === "OPEN" ? (
          <LockOpen className="h-3.5 w-3.5 shrink-0 text-amber-600 dark:text-amber-500" />
        ) : (
          <Lock className="h-3.5 w-3.5 shrink-0 text-amber-600 dark:text-amber-500" />
        )}
        <span>
          {status === "OPEN"
            ? isAmm
              ? "Trading closes "
              : "Entries close "
            : isAmm
              ? "Trading closed "
              : "Entries closed "}
          <span className="font-medium text-foreground">{cutoffLabel}</span>
        </span>
      </span>
      <span className="hidden sm:inline text-muted-foreground/70">·</span>
      <span className="pl-5 sm:pl-0">
        Results <span className="font-medium text-foreground">{resolveLabel}</span>
      </span>
    </div>
  );
}

function formatCycleDate(
  value: string | Date | null | undefined,
  options: { withDate: boolean } = { withDate: true },
): string | null {
  if (!value) return null;
  const d = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(d.getTime())) return null;
  const weekday = d.toLocaleDateString("en-GB", { weekday: "short", timeZone: "UTC" });
  const hh = String(d.getUTCHours()).padStart(2, "0");
  const mm = String(d.getUTCMinutes()).padStart(2, "0");
  if (!options.withDate) {
    // "Fri 23:59 UTC" — short form for cards.
    return `${weekday} ${hh}:${mm} UTC`;
  }
  // "Fri 1 May, 23:59 UTC" — full form for detail pages and modals,
  // matching the label pattern the team prefers from the Jackpot modal.
  const day = d.toLocaleDateString("en-GB", { day: "numeric", timeZone: "UTC" });
  const month = d.toLocaleDateString("en-GB", { month: "short", timeZone: "UTC" });
  return `${weekday} ${day} ${month}, ${hh}:${mm} UTC`;
}

function formatCountdown(t: {
  days: number;
  hours: number;
  minutes: number;
  seconds: number;
  totalSeconds: number;
}): string {
  if (t.totalSeconds <= 0) return "0m";
  const parts: string[] = [];
  if (t.days > 0) parts.push(`${t.days}d`);
  if (t.days > 0 || t.hours > 0) parts.push(`${t.hours}h`);
  parts.push(`${String(t.minutes).padStart(2, "0")}m`);
  if (t.days === 0 && t.hours === 0) parts.push(`${String(t.seconds).padStart(2, "0")}s`);
  return parts.join(" ");
}
