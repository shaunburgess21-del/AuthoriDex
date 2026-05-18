/**
 * Pure helpers for the `position_resolution_imminent` deriver.
 *
 * Surfaces a final "your held position resolves soon" ping for users
 * who still own AMM shares as a market drifts into its resolution
 * window. By design this fires AFTER betting close (so users can't
 * react to it by trading) — it's purely informational, a courtesy
 * heads-up before P&L lands in their wallet.
 *
 * Wording is intentionally short — the panel UI truncates long
 * bodies and we don't have new information to convey beyond
 * "imminent, you're holding N shares."
 */

export interface ResolutionImminentInput {
  subjectLabel: string;
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
 * Examples:
 *   - 6h: "Mark Cuban resolves in 6h — you're still holding"
 *         "Your position: 240 shares. Last call before payout lands."
 *   - 3h: "Conor McGregor resolves in 3h — you're still holding"
 *   - <1h: "Tesla resolves in <1h — you're still holding"
 *
 * `hoursRemaining` is clamped to >= 0 and floored to whole hours.
 * Anything under one hour renders as "<1h" so the message doesn't
 * mislead with a stale "0h" label that reads as "right now."
 */
export function formatResolutionImminentNotification(
  input: ResolutionImminentInput,
): ResolutionImminentOutput {
  const { subjectLabel, netShares } = input;
  const hoursRemaining = Number.isFinite(input.hoursRemaining)
    ? Math.max(0, input.hoursRemaining)
    : 0;
  const label = hoursRemaining < 1 ? "<1h" : `${Math.floor(hoursRemaining)}h`;
  const sharesRounded = Math.max(0, Math.round(netShares));
  const shareWord = sharesRounded === 1 ? "share" : "shares";

  return {
    title: `${subjectLabel} resolves in ${label} \u2014 you're still holding`,
    body: `Your position: ${sharesRounded.toLocaleString("en-US")} ${shareWord}. Last call before payout lands.`,
  };
}
