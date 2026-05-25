/**
 * Pure helpers for the `position_resolution_imminent` deriver.
 *
 * Surfaces a final "your held position resolves soon" ping for users
 * who still own AMM shares as a market drifts into its resolution
 * window. By design this fires AFTER betting close (so users can't
 * react to it by trading) — it's purely informational, a courtesy
 * heads-up before P&L lands in their wallet.
 */

import { formatVox } from "@shared/currency";
import { formatMarketLead } from "./notification-market-labels";

export interface ResolutionImminentInput {
  marketTitle: string;
  /** Person name or entry side when it adds context beyond marketTitle. */
  contextLabel?: string | null;
  netShares: number;
  /** Net credits at risk (buy stakes minus sell proceeds). */
  stakeCredits: number;
  hoursRemaining: number;
}

export interface ResolutionImminentOutput {
  title: string;
  body: string;
}

/**
 * Render the title + body for the resolution-imminent notification.
 *
 * Title leads with the market/pick via formatMarketLead. Body shows
 * stake vs share count and upside if the pick wins (Ꝟ1 per share).
 * Symmetric for winning and losing sides — a losing pick still shows
 * honest stake and max payout without implying current P&L.
 *
 * `hoursRemaining` is clamped to >= 0 and floored to whole hours.
 * Anything under one hour renders as "<1h".
 */
export function formatResolutionImminentNotification(
  input: ResolutionImminentInput,
): ResolutionImminentOutput {
  const { marketTitle, contextLabel, netShares } = input;
  const hoursRemaining = Number.isFinite(input.hoursRemaining)
    ? Math.max(0, input.hoursRemaining)
    : 0;
  const label = hoursRemaining < 1 ? "<1h" : `${Math.floor(hoursRemaining)}h`;
  const sharesRounded = Math.max(0, Math.round(netShares));
  const shareWord = sharesRounded === 1 ? "share" : "shares";
  const marketLead = formatMarketLead(marketTitle, contextLabel);
  const stakeRounded = Number.isFinite(input.stakeCredits)
    ? Math.max(0, Math.round(input.stakeCredits))
    : 0;
  const payoutIfWin = sharesRounded;

  return {
    title: `${marketLead} resolves in ${label}`,
    body:
      `Staked ${formatVox(stakeRounded)} · ${sharesRounded.toLocaleString("en-US")} ${shareWord} ` +
      `(${formatVox(payoutIfWin)} if your pick wins)`,
  };
}
