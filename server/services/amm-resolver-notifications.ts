/**
 * Pure helpers for AMM resolution notification text.
 *
 * Extracted from `amm-resolver.ts` so the title/body decision is
 * exercised by unit tests without dragging in the DB or any other
 * runtime imports. The resolver imports `buildAmmResolutionNotification`
 * and `buildAmmVoidNotification` and fans the results through
 * `createNotification` with the appropriate idempotency keys.
 *
 * Branch matrix (see audit, Sprint: notification-calibration-fixes):
 *   - `won && payout === 0 && preResolveSellProceeds > 0` →
 *     "Your market resolved — you'd sold beforehand". The user sold
 *     all their winner-side shares before resolution, so the on-row
 *     payout is zero but they DID realise Vox via the pre-close
 *     sells. We surface that realised P&L so the bell entry matches
 *     what their wallet already shows (Tier 1.7).
 *   - `won && payout === 0` with no realised proceeds → null
 *     (suppressed). Structurally near-unreachable (winning row with
 *     zero payout and zero pre-close sells), but the guard avoids
 *     the legacy "Stake returned — Ꝟ0 (net −<stake>)" bug that was
 *     visible in the Mark Cuban screenshot.
 *   - `won && profit > 0` → "Your prediction won — +ꝞN". The normal
 *     happy path: held the position through resolution, made money.
 *   - `won && profit === 0` → "Stake returned — ꝞN". Edge case where
 *     the user bought at price=1.0 (parity) and the share paid out
 *     1:1. Structurally near-unreachable in LMSR pricing but the
 *     wording is accurate for it. Gated behind `payout > 0` above so
 *     this branch never fires with a self-contradictory "net −<stake>"
 *     anymore.
 *   - `!won` → "Your prediction didn't land". Lost the full stake.
 *
 * `won && profit < 0` is structurally impossible under current AMM
 * pricing: max buy price is Ꝟ1.00 per share and a winning share pays
 * Ꝟ1, so `payout >= stake` for any winner-side row.
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
function formatSignedVox(n: number): string {
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
      title: `Your market resolved — you'd sold beforehand`,
      body: `${lead} resolved on your side. You'd already sold those shares for ${formatVox(proceeds)} (net ${formatSignedVox(netRealised)}).`,
    };
  }

  const profit = won ? payout - stake : -stake;
  const signedProfit = formatSignedVox(profit);

  if (won && profit > 0) {
    return {
      title: `Your prediction won — ${signedProfit}`,
      body: `${lead} resolved. Payout ${formatVox(payout)} (net ${signedProfit}).`,
    };
  }

  if (won) {
    return {
      title: `Stake returned — ${formatVox(payout)}`,
      body: `${lead} resolved. Payout matched your stake (net ${signedProfit}).`,
    };
  }

  return {
    title: `Your prediction didn't land`,
    body: `${lead} resolved. Lost ${formatVox(stake)} — better luck next round.`,
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
