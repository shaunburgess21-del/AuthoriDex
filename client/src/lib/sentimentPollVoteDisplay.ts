/** Display strings and colors for sentiment poll choices (support / neutral / oppose). */

/** Full-width Support-style ghost button (matches Sentiment Poll Support). */
export const SENTIMENT_POLL_SUPPORT_BUTTON_CLASS =
  "w-full flex items-center justify-center gap-3 px-4 py-2.5 rounded-md bg-[#00C853]/10 border border-[#00C853]/50 text-[#00C853] text-sm font-medium transition-all duration-300 hover:border-[#00C853]/80 hover:bg-[#00C853]/20";

/** Color/hover only — for compact icon vote buttons. */
export const SENTIMENT_POLL_SUPPORT_BUTTON_COMPACT_CLASS =
  "bg-[#00C853]/10 border border-[#00C853]/50 text-[#00C853] hover:border-[#00C853]/80 hover:bg-[#00C853]/20";

/** Solid fill for voted avatar overlay badge (matches Support / Voted button). */
export const SENTIMENT_POLL_SUPPORT_BADGE_BG_CLASS = "bg-[#00C853]";

export const SENTIMENT_POLL_SUPPORT_BADGE_SHADOW_CLASS = "shadow-[#00C853]/30";

export function getSentimentPollChoiceLabel(choice: string): string {
  const c = choice.trim().toLowerCase();
  if (c === "support") return "Support";
  if (c === "neutral") return "Neutral";
  if (c === "oppose") return "Oppose";
  if (!choice) return "";
  return choice.charAt(0).toUpperCase() + choice.slice(1).toLowerCase();
}

export function getSentimentPollChoiceColor(choice: string): string {
  const c = choice.trim().toLowerCase();
  if (c === "support") return "#00C853";
  if (c === "oppose") return "#FF0000";
  return "#FFFFFF";
}

export function getSentimentPollVotedPillStyle(choice: string | null): { color?: string; borderColor?: string } {
  if (!choice) return {};
  const color = getSentimentPollChoiceColor(choice);
  const c = choice.trim().toLowerCase();
  if (c === "support" || c === "oppose") {
    return { color, borderColor: color };
  }
  return { color };
}
