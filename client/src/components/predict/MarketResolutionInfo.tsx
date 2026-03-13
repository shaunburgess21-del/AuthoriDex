import { Card } from "@/components/ui/card";
import { Shield, Clock, TrendingUp, TrendingDown, RefreshCw, Database, CheckCircle } from "lucide-react";

interface MarketResolutionInfoProps {
  baselineScore: number;
  baselineTimestamp?: string;
  closeTime?: string;
  tieRule?: string;
  resolveMethod?: string;
  personName?: string;
  compact?: boolean;
}

function formatScore(n: number): string {
  return n.toLocaleString("en-US");
}

function formatTimestamp(ts?: string): string {
  if (!ts) return "Mon 00:00 UTC";
  try {
    const d = new Date(ts);
    const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
    return `${days[d.getUTCDay()]} ${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")} UTC`;
  } catch {
    return ts;
  }
}

const TIE_RULE_LABELS: Record<string, string> = {
  refund: "All positions refunded",
  down_wins: "DOWN wins on exact tie",
  up_wins: "UP wins on exact tie",
};

export function MarketResolutionInfo({
  baselineScore,
  baselineTimestamp,
  closeTime,
  tieRule = "refund",
  resolveMethod,
  personName,
  compact = false,
}: MarketResolutionInfoProps) {
  const name = personName || "Subject";
  const tieLabel = TIE_RULE_LABELS[tieRule] || "All positions refunded";
  const resolutionLabel =
    resolveMethod === "admin_manual"
      ? "Admin resolution"
      : "Auto-calculated from AuthoriDex trend engine";

  if (compact) {
    return (
      <div className="text-[11px] text-muted-foreground space-y-0.5 leading-snug">
        <p>
          <TrendingUp className="inline h-3 w-3 text-green-500 mr-1" />
          UP wins if {name} closes above {formatScore(baselineScore)}
        </p>
        <p>
          <TrendingDown className="inline h-3 w-3 text-red-500 mr-1" />
          DOWN wins if {name} closes below {formatScore(baselineScore)}
        </p>
        <p>
          <RefreshCw className="inline h-3 w-3 mr-1" />
          Exact tie: {tieLabel.toLowerCase()}
        </p>
      </div>
    );
  }

  return (
    <Card className="p-3 bg-muted/30 border-border/40 space-y-2">
      <div className="flex items-center gap-1.5 text-xs font-medium text-foreground">
        <Shield className="h-3.5 w-3.5 text-violet-500" />
        How this resolves
      </div>
      <div className="text-[11px] text-muted-foreground space-y-1.5 leading-snug">
        <div className="flex items-start gap-1.5">
          <Database className="h-3 w-3 mt-0.5 shrink-0" />
          <span>
            Baseline Score: <span className="font-mono font-medium text-foreground">{formatScore(baselineScore)}</span>
            {baselineTimestamp && (
              <span className="text-muted-foreground"> at {formatTimestamp(baselineTimestamp)}</span>
            )}
          </span>
        </div>
        <div className="flex items-start gap-1.5">
          <Clock className="h-3 w-3 mt-0.5 shrink-0" />
          <span>Market closes: <span className="font-medium text-foreground">{closeTime || "Sun 23:59 UTC"}</span></span>
        </div>
        <div className="flex items-start gap-1.5">
          <TrendingUp className="h-3 w-3 mt-0.5 shrink-0 text-green-500" />
          <span>UP wins if final trend score is above <span className="font-mono font-medium text-foreground">{formatScore(baselineScore)}</span></span>
        </div>
        <div className="flex items-start gap-1.5">
          <TrendingDown className="h-3 w-3 mt-0.5 shrink-0 text-red-500" />
          <span>DOWN wins if final trend score is below <span className="font-mono font-medium text-foreground">{formatScore(baselineScore)}</span></span>
        </div>
        <div className="flex items-start gap-1.5">
          <RefreshCw className="h-3 w-3 mt-0.5 shrink-0" />
          <span>Exact tie: {tieLabel.toLowerCase()}</span>
        </div>
        <div className="flex items-start gap-1.5">
          <CheckCircle className="h-3 w-3 mt-0.5 shrink-0 text-violet-500" />
          <span>{resolutionLabel}</span>
        </div>
      </div>
    </Card>
  );
}
