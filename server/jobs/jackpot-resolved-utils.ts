/**
 * Pure helpers for jackpot (parimutuel) resolution notification text.
 */

import { formatSignedVox } from "../services/amm-resolver-notifications";
import { formatVox } from "@shared/currency";

export interface JackpotResolvedWinInput {
  marketTitle: string;
  actualScore: number;
  predictedScore: number;
  diff: number;
  stake: number;
  payout: number;
}

export interface JackpotResolvedLossInput {
  marketTitle: string;
  actualScore: number;
  stake: number;
}

export interface JackpotResolvedNotificationOutput {
  title: string;
  body: string;
}

export function buildJackpotResolvedWinNotification(
  input: JackpotResolvedWinInput,
): JackpotResolvedNotificationOutput {
  const {
    marketTitle,
    actualScore,
    predictedScore,
    diff,
    stake,
    payout,
  } = input;
  const profit = payout - stake;
  const signedProfit = formatSignedVox(profit);
  const title =
    profit > 0
      ? `You won! ${marketTitle} \u2014 ${signedProfit}`
      : `You won! ${marketTitle} \u2014 stake returned`;
  const body =
    `Congrats! Closed at ${actualScore}. You predicted ${predictedScore} (off by ${diff}). ` +
    `Payout ${formatVox(payout)} (net ${signedProfit}).`;
  return { title, body };
}

export function buildJackpotResolvedLossNotification(
  input: JackpotResolvedLossInput,
): JackpotResolvedNotificationOutput {
  const { marketTitle, actualScore, stake } = input;
  return {
    title: `${marketTitle} jackpot didn't land`,
    body: `Closed at ${actualScore}. Lost ${formatVox(stake)}.`,
  };
}
