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
 *   - `won && payout === 0` → null (suppressed). The user sold ALL
 *     their winner-side shares before resolution, so they already
 *     realized P&L via sells. Pinging them now with the original
 *     "Stake returned — 0 credits (net -<stake>)" wording was the
 *     bug visible in the Mark Cuban screenshot. The wallet and
 *     positions tab are the source of truth for that outcome.
 *   - `won && profit > 0` → "Your prediction won — +N credits". The
 *     normal happy path: held the position through resolution, made
 *     money.
 *   - `won && profit === 0` → "Stake returned — N credits". Edge case
 *     where the user bought at price=1.0 (parity) and the share paid
 *     out 1:1. Structurally near-unreachable in LMSR pricing but the
 *     wording is accurate for it. Gated behind `payout > 0` above so
 *     this branch never fires with a self-contradictory "net -<stake>"
 *     anymore.
 *   - `!won` → "Your prediction didn't land". Lost the full stake.
 *
 * `won && profit < 0` is structurally impossible under current AMM
 * pricing: max buy price is 1.0 credit/share and a winning share pays
 * 1 credit, so `payout >= stake` for any winner-side row.
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

  if (won) {
    return {
      title: `Stake returned — ${payout.toLocaleString("en-US")} credits`,
      body: `${marketTitle} resolved. Payout matched your stake (net ${signedProfit}).`,
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
