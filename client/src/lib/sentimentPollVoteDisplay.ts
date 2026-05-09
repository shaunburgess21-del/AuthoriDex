/** Display strings and colors for sentiment poll choices (support / neutral / oppose). */

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
