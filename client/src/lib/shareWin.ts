/**
 * The same "Share Win" card My Predictions already opens.
 * Callers pass their own openShareCard so this stays free of React.
 */

import type { ShareCardOpenArgs } from "@/contexts/ShareCardContext";
import { formatVox } from "@/lib/currency";
import { appendShareAttribution } from "@/lib/share";
import { inferPredictionDirection } from "@/pages/me/predictions-utils";

export interface WinSharePrediction {
  betId: string;
  marketTitle: string;
  marketSlug: string;
  entryLabel: string;
  stakeAmount: number;
  payout: number;
  baselineScore: number;
  currentScore: number;
  marketCategory: string;
  personName: string | null;
  personAvatar: string | null;
}

export function winShareArgs(prediction: WinSharePrediction): ShareCardOpenArgs {
  const pnl = prediction.payout - prediction.stakeAmount;
  const direction = inferPredictionDirection(prediction.entryLabel);
  const mappedDirection: "up" | "down" | "other" =
    direction === "up" ? "up" : direction === "down" ? "down" : "other";
  const origin = typeof window !== "undefined" ? window.location.origin : "";
  const path = prediction.marketSlug ? `/markets/${prediction.marketSlug}` : "";
  const shareUrl = appendShareAttribution(`${origin}${path || ""}`, {
    surface: "prediction_win",
  });
  return {
    data: {
      variant: "win",
      personName: prediction.personName,
      personAvatar: prediction.personAvatar,
      marketTitle: prediction.marketTitle,
      direction: mappedDirection,
      entryLabel: prediction.entryLabel,
      stakeAmount: prediction.stakeAmount,
      payout: prediction.payout,
      baselineScore: prediction.baselineScore,
      currentScore: prediction.currentScore,
      category: prediction.marketCategory,
    },
    fallbackText: `I won +${formatVox(pnl)} on "${prediction.marketTitle}" on VoxDex!\n${origin}${path}`,
    shareUrl,
    filenameBase: `voxdex-win-${prediction.betId.slice(0, 8)}`,
  };
}
