/**
 * Pure helpers for AMM resolution notification text.
 *
 * Extracted from `amm-resolver.ts` so the title/body decision is
 * exercised by unit tests without dragging in the DB or any other
 * runtime imports. The resolver imports `buildAmmResolutionNotification`
 * and `buildAmmVoidNotification` and fans the results through
 * `createNotification` with the appropriate idempotency keys.
 *
 * Titles lead with formatMarketLead so a resolution-night inbox does
 * not repeat identical generic headlines across many positions.
 */

import { formatMarketLead } from "../jobs/notification-market-labels";
import { CURRENCY, formatVox } from "@shared/currency";

export interface AmmResolutionNotificationInput {
  marketTitle: string;
  /** Person name or entry side when it adds context beyond marketTitle. */
  contextLabel?: string | null;
  won: boolean;
  stake: number;
  payout: number;
  /**
   * Total Vox the user realised via winner-side sells BEFORE this
   * market resolved. Only consulted on the `won && payout === 0`
   * branch — i.e. when the on-row settlement payout was zero because
   * the user had already exited their winning shares. Pass undefined
   * (or omit) when the caller hasn't aggregated pre-close sells; the
   * builder degrades to the legacy "suppress null" behaviour so older
   * call sites don't get a worse experience.
   */
  preResolveSellProceeds?: number;
}

// Whole-Vox signed delta — Ꝟ-prefixed with a `+` for gains and a
// Unicode minus for losses. We can't reuse `formatVoxDelta` here
// because that helper forces two decimal places; resolution
// notifications operate on integer credit grants and rendering
// "+Ꝟ500.00" reads off-brand.
export function formatSignedVox(n: number): string {
  if (!Number.isFinite(n) || n === 0) return `${CURRENCY.symbol}0`;
  const abs = Math.abs(Math.round(n)).toLocaleString("en-US");
  if (n > 0) return `+${CURRENCY.symbol}${abs}`;
  return `\u2212${CURRENCY.symbol}${abs}`;
}

export interface AmmResolutionNotificationOutput {
  title: string;
  body: string;
}

export function buildAmmResolutionNotification(
  input: AmmResolutionNotificationInput,
): AmmResolutionNotificationOutput | null {
  const { marketTitle, contextLabel, won, stake, payout, preResolveSellProceeds } = input;
  const lead = formatMarketLead(marketTitle, contextLabel);

  if (won && payout === 0) {
    const proceeds = preResolveSellProceeds ?? 0;
    if (!Number.isFinite(proceeds) || proceeds <= 0) return null;
    const netRealised = proceeds - stake;
    return {
      title: `${lead} resolved \u2014 you'd sold beforehand`,
      body: `You'd already sold those shares for ${formatVox(proceeds)} (net ${formatSignedVox(netRealised)}).`,
    };
  }

  const profit = won ? payout - stake : -stake;
  const signedProfit = formatSignedVox(profit);

  if (won && profit > 0) {
    return {
      title: `${lead} won ${signedProfit}`,
      body: `Resolved. Payout ${formatVox(payout)} (net ${signedProfit}).`,
    };
  }

  if (won) {
    return {
      title: `${lead} \u2014 stake returned`,
      body: `Resolved. Payout ${formatVox(payout)} (net ${signedProfit}).`,
    };
  }

  return {
    title: `${lead} didn't land`,
    body: `Resolved. Lost ${formatVox(stake)}.`,
  };
}

export interface AmmVoidNotificationInput {
  marketTitle: string;
  refund: number;
}

export function buildAmmVoidNotification(
  input: AmmVoidNotificationInput,
): AmmResolutionNotificationOutput {
  const { marketTitle, refund } = input;
  return {
    title: `Market voided — ${formatVox(refund)} refunded`,
    body: `${marketTitle} was voided. ${formatVox(refund)} returned.`,
  };
}
