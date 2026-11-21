/**
 * When the interests picker should open on a feed surface.
 *
 * First visit (never dismissed, no stated interests) opens immediately.
 * After a dismiss, the picker stays down until REPROMPT_DAYS have passed.
 * Lifetime vote and prediction totals do not shorten that snooze.
 * Saving at least one interest stops the prompt for good.
 */

export const REPROMPT_DAYS = 2;

const MS_PER_DAY = 86_400_000;

export interface InterestsPromptInput {
  statedInterests: readonly string[];
  /** null when the user has never dismissed the prompt. */
  dismissedAtMs: number | null;
  now: number;
  /** Same-document latch. A full page load starts false. */
  shownThisSession: boolean;
  totalVotes: number;
  totalPredictions: number;
}

export function shouldOpenInterestsPrompt(input: InterestsPromptInput): boolean {
  if (input.statedInterests.length > 0) return false;
  // Never dismissed: ask immediately. Counts do not change this.
  if (input.dismissedAtMs === null) return true;
  if (input.shownThisSession) return false;
  if (!Number.isFinite(input.dismissedAtMs)) return false;
  const daysSince = (input.now - input.dismissedAtMs) / MS_PER_DAY;
  return daysSince >= REPROMPT_DAYS;
}
