/**
 * Display helpers for sentiment poll choices.
 * Labels/colors come from shared/lib/sentiment-poll-choice.ts.
 */

import {
  getSentimentPollChoiceColor as sharedGetColor,
  getSentimentPollChoiceLabel as sharedGetLabel,
} from "@shared/lib/sentiment-poll-choice";

/** Full-width Agree-style ghost button (matches Sentiment Poll Agree). */
export const SENTIMENT_POLL_SUPPORT_BUTTON_CLASS =
  "w-full flex items-center justify-center gap-3 px-4 py-2.5 rounded-md bg-[#00C853]/10 border border-[#00C853]/50 text-[#00C853] text-sm font-medium transition-all duration-300 hover:border-[#00C853]/80 hover:bg-[#00C853]/20";

/** Color/hover only — for compact icon vote buttons. */
export const SENTIMENT_POLL_SUPPORT_BUTTON_COMPACT_CLASS =
  "bg-[#00C853]/10 border border-[#00C853]/50 text-[#00C853] hover:border-[#00C853]/80 hover:bg-[#00C853]/20";

/** Solid fill for voted avatar overlay badge (matches Agree / Voted button). */
export const SENTIMENT_POLL_SUPPORT_BADGE_BG_CLASS = "bg-[#00C853]";

export const SENTIMENT_POLL_SUPPORT_BADGE_SHADOW_CLASS = "shadow-[#00C853]/30";

export function getSentimentPollChoiceLabel(choice: string): string {
  return sharedGetLabel(choice);
}

export function getSentimentPollChoiceColor(choice: string): string {
  return sharedGetColor(choice);
}

export function getSentimentPollVotedPillStyle(choice: string | null): {
  color?: string;
  borderColor?: string;
} {
  if (!choice) return {};
  const color = getSentimentPollChoiceColor(choice);
  return { color, borderColor: color };
}
