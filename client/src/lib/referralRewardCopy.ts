import { CREDIT_ACTIONS, SIGNUP_CREDIT_GRANT } from "@shared/credit-config";
import { voxWord } from "@/lib/currency";

/**
 * Amounts on the Refer a Friend card. They come from credit-config,
 * the same list the server awards from, so the invite line cannot
 * drift from the panel.
 */
export function referralRewardAmounts(): {
  signupGrant: number;
  signupBonus: number;
  friendStart: number;
  referrerReward: number;
} {
  const signupBonus =
    CREDIT_ACTIONS.find((action) => action.key === "referral_signup_bonus")?.proposedCredits ?? 0;
  const referrerReward =
    CREDIT_ACTIONS.find((action) => action.key === "referral_completed")?.proposedCredits ?? 0;
  return {
    signupGrant: SIGNUP_CREDIT_GRANT,
    signupBonus,
    friendStart: SIGNUP_CREDIT_GRANT + signupBonus,
    referrerReward,
  };
}

/** The sentence already printed on the Refer a Friend card. */
export function referralRewardSentence(): string {
  const amounts = referralRewardAmounts();
  return `Your friend gets ${voxWord(amounts.friendStart)} to start (${voxWord(amounts.signupGrant)} signup grant + ${voxWord(amounts.signupBonus)} bonus). You get ${voxWord(amounts.referrerReward)} when they make their first move.`;
}

/** One line under the vote strip after today's goal flips to done. */
export function goalDoneInviteCopy(): string {
  return `Nice, goal done. Invite a friend: ${referralRewardSentence()}`;
}
