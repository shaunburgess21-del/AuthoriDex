/**
 * Single source of truth for Sentiment Poll (trending_poll) choice vocabulary.
 *
 * Stored values: agree | neutral | disagree
 * Display labels: Agree | Neutral | Disagree
 *
 * Legacy support/oppose are accepted by normalizeSentimentChoice for safety
 * during/after the rename migration.
 */

export type SentimentPollChoice = "agree" | "neutral" | "disagree";

export const SENTIMENT_POLL_CHOICES: readonly SentimentPollChoice[] = [
  "agree",
  "neutral",
  "disagree",
] as const;

export const SENTIMENT_POLL_CHOICE_LABEL: Record<SentimentPollChoice, string> = {
  agree: "Agree",
  neutral: "Neutral",
  disagree: "Disagree",
};

export const SENTIMENT_POLL_CHOICE_COLOR: Record<SentimentPollChoice, string> = {
  agree: "#00C853",
  neutral: "#FFFFFF",
  disagree: "#FF0000",
};

/** Map legacy support/oppose (and current agree/disagree) to canonical choice. */
export function normalizeSentimentChoice(
  raw: string | null | undefined,
): SentimentPollChoice | null {
  if (!raw || typeof raw !== "string") return null;
  const c = raw.trim().toLowerCase();
  if (c === "agree" || c === "support" || c === "approve") return "agree";
  if (c === "disagree" || c === "oppose" || c === "disapprove") return "disagree";
  if (c === "neutral") return "neutral";
  return null;
}

export function isSentimentPollChoice(value: unknown): value is SentimentPollChoice {
  return value === "agree" || value === "neutral" || value === "disagree";
}

export function getSentimentPollChoiceLabel(choice: string | null | undefined): string {
  const normalized = normalizeSentimentChoice(choice);
  if (normalized) return SENTIMENT_POLL_CHOICE_LABEL[normalized];
  if (!choice || !choice.trim()) return "";
  const trimmed = choice.trim();
  return trimmed.charAt(0).toUpperCase() + trimmed.slice(1).toLowerCase();
}

export function getSentimentPollChoiceColor(choice: string | null | undefined): string {
  const normalized = normalizeSentimentChoice(choice);
  if (normalized) return SENTIMENT_POLL_CHOICE_COLOR[normalized];
  return "#FFFFFF";
}
