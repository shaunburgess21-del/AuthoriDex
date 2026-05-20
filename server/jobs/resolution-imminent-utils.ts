/**
 * Pure helpers for the `position_resolution_imminent` deriver.
 *
 * Surfaces a final "your held position resolves soon" ping for users
 * who still own AMM shares as a market drifts into its resolution
 * window. By design this fires AFTER betting close (so users can't
 * react to it by trading) — it's purely informational, a courtesy
 * heads-up before P&L lands in their wallet.
 */

import { formatMarketLead } from "./notification-market-labels";

export interface ResolutionImminentInput {
  marketTitle: string;
  /** Person name or entry side when it adds context beyond marketTitle. */
  contextLabel?: string | null;
  netShares: number;
  hoursRemaining: number;
}

export interface ResolutionImminentOutput {
  title: string;
  body: string;
}

/**
 * Render the title + body for the resolution-imminent notification.
 *
 * Title leads with "Your position" (not celebrity/category). Body
 * names the pick + market via formatMarketLead, then share count.
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

  return {
    title: `Your position resolves in ${label} \u2014 you're still holding`,
    body: `${marketLead} \u00b7 ${sharesRounded.toLocaleString("en-US")} ${shareWord}. Last call before payout lands.`,
  };
}
