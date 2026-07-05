import { CheckCircle2, RotateCcw, TrendingDown, TrendingUp, Trophy } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

/**
 * Settlement receipt for native market detail pages (UpDown / H2H /
 * Race). Renders the "why" behind a resolved or voided market from the
 * projected `nativeDetail.resolution` block (see
 * buildNativeResolutionBlock in server/routes.ts — house P&L fields
 * never reach this shape).
 *
 * Per-type variants:
 *  - updown: score went X → Y (+4.2%) · Outcome: UP
 *  - h2h:    final-vs-final with margin, winner highlighted
 *  - gainer: final standings mini-table sorted by pct change
 *  - void:   amber banner with the void reason (any type)
 */

interface H2HResolutionEntry {
  personId: string | null;
  label: string | null;
  score: number | null;
  snapshotAt: string | null;
}

interface GainerRankingRow {
  personId: string | null;
  label: string | null;
  openScore: number | null;
  closeScore: number | null;
  pctChange: string | null;
}

export interface NativeResolution {
  status: "RESOLVED" | "VOID";
  type?: "updown" | "h2h" | "gainer";
  outcomeLabel: string | null;
  voidReason: string | null;
  resolvedAt: string | null;
  // updown
  openScore?: number | null;
  closeScore?: number | null;
  openSnapshotAt?: string | null;
  closeSnapshotAt?: string | null;
  change?: number | null;
  percentChange?: string | null;
  // h2h
  entryA?: H2HResolutionEntry | null;
  entryB?: H2HResolutionEntry | null;
  margin?: number | null;
  // gainer
  rankings?: GainerRankingRow[];
}

export interface SettlementReceiptProps {
  resolution: NativeResolution | null | undefined;
  /** Market status fallback when resolution evidence is missing. */
  marketStatus?: string | null;
  className?: string;
}

function formatSettledDate(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

export function SettlementReceipt({ resolution, marketStatus, className }: SettlementReceiptProps) {
  const status = resolution?.status ?? marketStatus;
  if (status !== "RESOLVED" && status !== "VOID") return null;

  const isVoid = status === "VOID";
  const settledDate = formatSettledDate(resolution?.resolvedAt);

  return (
    <Card
      className={cn(
        "p-4",
        isVoid
          ? "border-amber-500/40 dark:border-amber-500/30 bg-amber-500/5 dark:bg-amber-500/[0.04]"
          : "border-emerald-500/40 dark:border-emerald-500/30 bg-emerald-500/5 dark:bg-emerald-500/[0.04]",
        className,
      )}
      data-testid="card-settlement-receipt"
    >
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-2 min-w-0">
          {isVoid ? (
            <RotateCcw className="h-4 w-4 text-amber-600 dark:text-amber-400 shrink-0" />
          ) : (
            <CheckCircle2 className="h-4 w-4 text-emerald-600 dark:text-emerald-400 shrink-0" />
          )}
          <h2 className="text-sm font-semibold">
            {isVoid ? "Market Voided" : "Market Resolved"}
          </h2>
          {!isVoid && resolution?.outcomeLabel && (
            <Badge className="bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 border border-emerald-500/40 uppercase text-[10px] font-bold">
              {resolution.outcomeLabel}
            </Badge>
          )}
        </div>
        {settledDate && (
          <span className="text-[11px] text-muted-foreground">Settled {settledDate}</span>
        )}
      </div>

      {isVoid ? (
        <p className="text-xs text-muted-foreground mt-2">
          {resolution?.voidReason ?? "This market was voided."} All stakes were refunded.
        </p>
      ) : resolution?.type === "updown" ? (
        <UpDownReceiptBody resolution={resolution} />
      ) : resolution?.type === "h2h" ? (
        <H2HReceiptBody resolution={resolution} />
      ) : resolution?.type === "gainer" ? (
        <GainerReceiptBody resolution={resolution} />
      ) : (
        <p className="text-xs text-muted-foreground mt-2">
          This market has been settled{resolution?.outcomeLabel ? ` — outcome: ${resolution.outcomeLabel}` : ""}.
        </p>
      )}
    </Card>
  );
}

function UpDownReceiptBody({ resolution }: { resolution: NativeResolution }) {
  const { openScore, closeScore, percentChange, outcomeLabel } = resolution;
  const wentUp = (resolution.change ?? 0) > 0;

  if (openScore == null || closeScore == null) {
    return (
      <p className="text-xs text-muted-foreground mt-2">
        Final outcome: <span className="font-semibold uppercase">{outcomeLabel ?? "—"}</span>
      </p>
    );
  }

  return (
    <div className="mt-3 flex items-center gap-3 flex-wrap">
      <div className="flex items-center gap-2 font-mono tabular-nums text-sm">
        <span className="text-muted-foreground">{openScore.toLocaleString("en-US")}</span>
        <span className="text-muted-foreground">→</span>
        <span className="font-bold">{closeScore.toLocaleString("en-US")}</span>
      </div>
      <span
        className={cn(
          "inline-flex items-center gap-1 text-xs font-semibold px-1.5 py-0.5 rounded",
          wentUp
            ? "bg-green-500/15 text-green-700 dark:text-green-400"
            : "bg-red-500/15 text-red-700 dark:text-red-400",
        )}
      >
        {wentUp ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
        {percentChange && percentChange !== "N/A"
          ? `${wentUp && !percentChange.startsWith("-") && !percentChange.startsWith("+") ? "+" : ""}${percentChange}`
          : `${wentUp ? "+" : ""}${(resolution.change ?? 0).toLocaleString("en-US")}`}
      </span>
      <span className="text-[11px] text-muted-foreground">
        Score closed {wentUp ? "above" : "below"} baseline — <span className="font-semibold uppercase">{outcomeLabel}</span> wins
      </span>
    </div>
  );
}

function H2HReceiptBody({ resolution }: { resolution: NativeResolution }) {
  const { entryA, entryB, margin, outcomeLabel } = resolution;
  if (!entryA || !entryB) {
    return (
      <p className="text-xs text-muted-foreground mt-2">
        Winner: <span className="font-semibold">{outcomeLabel ?? "—"}</span>
      </p>
    );
  }

  const rows = [entryA, entryB];
  return (
    <div className="mt-3 space-y-1.5">
      {rows.map((entry, idx) => {
        const isWinner = entry.label != null && entry.label === outcomeLabel;
        return (
          <div
            key={entry.personId ?? idx}
            className={cn(
              "flex items-center justify-between gap-2 rounded-md px-2.5 py-1.5 text-sm border",
              isWinner
                ? "bg-emerald-500/10 border-emerald-500/30"
                : "bg-background/40 border-border/40",
            )}
          >
            <span className="flex items-center gap-1.5 min-w-0">
              {isWinner && <Trophy className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400 shrink-0" />}
              <span className={cn("truncate", isWinner && "font-semibold")}>{entry.label ?? "—"}</span>
            </span>
            <span className="font-mono tabular-nums text-sm">
              {entry.score != null ? entry.score.toLocaleString("en-US") : "—"}
            </span>
          </div>
        );
      })}
      {margin != null && (
        <p className="text-[11px] text-muted-foreground pt-0.5">
          Final margin: <span className="font-mono tabular-nums">{margin.toLocaleString("en-US")}</span> points
        </p>
      )}
    </div>
  );
}

function GainerReceiptBody({ resolution }: { resolution: NativeResolution }) {
  const rankings = resolution.rankings ?? [];
  if (rankings.length === 0) {
    return (
      <p className="text-xs text-muted-foreground mt-2">
        Winner: <span className="font-semibold">{resolution.outcomeLabel ?? "—"}</span>
      </p>
    );
  }

  return (
    <div className="mt-3 space-y-1">
      <div className="grid grid-cols-[1.5rem_1fr_auto_auto] gap-x-2 px-2.5 text-[10px] text-muted-foreground uppercase tracking-wide">
        <span>#</span>
        <span>Entry</span>
        <span className="text-right">Open → Close</span>
        <span className="text-right w-14">Change</span>
      </div>
      {rankings.map((row, idx) => {
        const isWinner = idx === 0;
        const pctNegative = (row.pctChange ?? "").startsWith("-");
        return (
          <div
            key={row.personId ?? idx}
            className={cn(
              "grid grid-cols-[1.5rem_1fr_auto_auto] gap-x-2 items-center rounded-md px-2.5 py-1.5 text-sm border",
              isWinner
                ? "bg-emerald-500/10 border-emerald-500/30"
                : "bg-background/40 border-border/40",
            )}
          >
            <span className="text-xs text-muted-foreground font-mono">{idx + 1}</span>
            <span className={cn("truncate flex items-center gap-1.5", isWinner && "font-semibold")}>
              {isWinner && <Trophy className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400 shrink-0" />}
              {row.label ?? "—"}
            </span>
            <span className="font-mono tabular-nums text-[11px] text-muted-foreground text-right">
              {row.openScore != null && row.closeScore != null
                ? `${row.openScore.toLocaleString("en-US")} → ${row.closeScore.toLocaleString("en-US")}`
                : "—"}
            </span>
            <span
              className={cn(
                "font-mono tabular-nums text-xs text-right w-14",
                pctNegative
                  ? "text-red-600 dark:text-red-400"
                  : "text-green-700 dark:text-green-400",
              )}
            >
              {row.pctChange != null ? `${pctNegative ? "" : "+"}${row.pctChange}` : "—"}
            </span>
          </div>
        );
      })}
    </div>
  );
}
