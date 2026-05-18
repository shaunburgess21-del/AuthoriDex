/**
 * Pure helpers for AMM resolution notification text.
 *
 * Extracted from `amm-resolver.ts` so the title/body decision is
 * exercised by unit tests without dragging in the DB or any other
 * runtime imports. The resolver imports `buildAmmResolutionNotification`
 * and `buildAmmVoidNotification` and fans the results through
 * `createNotification` with the appropriate idempotency keys.
 *
 * Calibration notes (see audit, Sprint: notification-calibration-fixes):
 *   - Returning `null` from `buildAmmResolutionNotification` is how we
 *     suppress the "won-but-fully-sold" edge case (payout=0 on a
 *     winner-side buy row). The user already realized P&L via their
 *     sell trades; pinging them with a self-contradictory
 *     "Stake returned — 0 credits (net -<stake>)" message was the
 *     original bug.
 *   - The "stake returned" branch is structurally unreachable in
 *     production AMM: a winning share always pays out 100 credits,
 *     so any non-zero `payout` strictly exceeds `stake` for a row
 *     marked `won`. The helper still degrades gracefully to a
 *     coherent "didn't land"-style message if it ever hits that
 *     theoretical case — no contradictory text leaks out.
 */

export interface AmmResolutionNotificationInput {
  marketTitle: string;
  won: boolean;
  stake: number;
  payout: number;
}

export interface AmmResolutionNotificationOutput {
  title: string;
  body: string;
}

export function buildAmmResolutionNotification(
  input: AmmResolutionNotificationInput,
): AmmResolutionNotificationOutput | null {
  const { marketTitle, won, stake, payout } = input;

  if (won && payout === 0) return null;

  const profit = won ? payout - stake : -stake;
  const signedProfit = `${profit >= 0 ? "+" : ""}${profit.toLocaleString("en-US")}`;

  if (won && profit > 0) {
    return {
      title: `Your prediction won — ${signedProfit} credits`,
      body: `${marketTitle} resolved. Payout ${payout.toLocaleString("en-US")} credits (net ${signedProfit}).`,
    };
  }

  return {
    title: `Your prediction didn't land`,
    body: `${marketTitle} resolved. Lost ${stake.toLocaleString("en-US")} credits — better luck next round.`,
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
    title: `Market voided — ${refund.toLocaleString("en-US")} credits refunded`,
    body: `${marketTitle} was voided. ${refund.toLocaleString("en-US")} credits returned.`,
  };
}
