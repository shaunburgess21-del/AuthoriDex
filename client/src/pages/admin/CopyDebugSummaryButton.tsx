import { useState } from "react";
import { Check, Copy } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { ScoreBreakdownData } from "./adminTypes";

/**
 * Small button that copies a one-line text summary of the current
 * ScoreBreakdownData payload to the clipboard — handy for Slack / bug
 * reports when investigating scoring anomalies.
 *
 * Extracted from AdminDashboard.tsx.
 */
export function CopyDebugSummaryButton({ scoreBreakdown }: { scoreBreakdown: ScoreBreakdownData }) {
  const [copied, setCopied] = useState(false);

  const copyDebugSummary = () => {
    const prev = scoreBreakdown.previousHourComparison;
    const spikes = [
      scoreBreakdown.spikeStatus.wiki && "Wiki",
      scoreBreakdown.spikeStatus.news && "News",
      scoreBreakdown.spikeStatus.search && "Search",
    ]
      .filter(Boolean)
      .join("+") || "None";

    const rankChange = prev
      ? prev.previousRank !== prev.currentRank
        ? `#${prev.previousRank}→#${prev.currentRank}`
        : `#${prev.currentRank}`
      : `#${scoreBreakdown.currentRank}`;

    const changeStr = prev && prev.finalChangePercent !== 0
      ? `(${prev.finalChangePercent >= 0 ? "+" : ""}${prev.finalChangePercent.toFixed(1)}%)`
      : "";

    const summary = `${scoreBreakdown.celebrity.name} ${rankChange} | Fame: ${scoreBreakdown.scoreBreakdown.fameIndex.toLocaleString()} ${changeStr} | Spikes: ${spikes} (${scoreBreakdown.stabilizationParams.spikingSourceCount}) | Cap: ${(scoreBreakdown.stabilizationParams.effectiveRateCap * 100).toFixed(0)}% | Alpha: ${scoreBreakdown.stabilizationParams.effectiveAlpha.toFixed(2)}${scoreBreakdown.stabilizationParams.isRecalibrationActive ? " | RECAL" : ""}`;

    navigator.clipboard.writeText(summary).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }).catch((err) => {
      console.error("[AdminDashboard] Clipboard copy failed:", err);
      // Fallback: create a temporary textarea in case the Clipboard API is
      // unavailable (older browsers, iframes without permissions policy, etc.)
      try {
        const textarea = document.createElement("textarea");
        textarea.value = summary;
        document.body.appendChild(textarea);
        textarea.select();
        document.execCommand("copy");
        document.body.removeChild(textarea);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      } catch (fallbackErr) {
        console.error("[AdminDashboard] Fallback copy also failed:", fallbackErr);
      }
    });
  };

  return (
    <Button
      variant="ghost"
      size="sm"
      onClick={copyDebugSummary}
      className="h-7 text-xs gap-1"
      data-testid="button-copy-debug"
    >
      {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
      {copied ? "Copied!" : "Copy Summary"}
    </Button>
  );
}
