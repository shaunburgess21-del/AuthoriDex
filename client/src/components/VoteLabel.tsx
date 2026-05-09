import { getRatingTileColor } from "@/lib/ratingColors";
import {
  getSentimentPollChoiceColor,
  getSentimentPollChoiceLabel,
} from "@/lib/sentimentPollVoteDisplay";
import type { ParentVoteLabel } from "@/components/comments/types";

interface VoteLabelProps {
  label: ParentVoteLabel | null;
}

export function VoteLabel({ label }: VoteLabelProps) {
  if (!label) return null;

  if (label.type === "trending_poll") {
    const color = getSentimentPollChoiceColor(label.choice);
    const text = getSentimentPollChoiceLabel(label.choice).trim();
    if (!text) return null;

    return (
      <span className="text-xs font-medium shrink-0" style={{ color }}>
        {text}
      </span>
    );
  }

  if (label.type === "matchup") {
    const optionClass =
      label.choice === "option_a"
        ? "text-blue-600 dark:text-blue-400"
        : label.choice === "option_b"
          ? "text-amber-600 dark:text-amber-400"
          : "text-white";

    return (
      <span className={`text-xs font-medium shrink-0 ${optionClass}`}>{label.optionName}</span>
    );
  }

  if (label.type === "opinion_poll") {
    return (
      <span className="text-xs font-medium shrink-0 text-cyan-600 dark:text-cyan-400">
        {label.optionName}
      </span>
    );
  }

  if (label.type === "open_market_binary") {
    const yes = label.side === "yes";
    return (
      <span className="text-xs font-medium shrink-0" style={{ color: yes ? "#00C853" : "#FF0000" }}>
        {yes ? "Yes" : "No"}
      </span>
    );
  }

  if (label.type === "open_market_multi") {
    return (
      <span className="text-xs font-medium shrink-0 text-violet-600 dark:text-violet-400">
        {label.optionName}
      </span>
    );
  }

  if (label.type === "open_market_updown") {
    const above = label.side === "above";
    return (
      <span className="text-xs font-medium shrink-0" style={{ color: above ? "#00C853" : "#FF0000" }}>
        {above ? "Above" : "Below"}
      </span>
    );
  }

  if (label.type === "approval_rating") {
    return (
      <span className="text-xs font-medium shrink-0">
        <span style={{ color: getRatingTileColor(label.rating) }}>{label.rating}</span>
        <span className="text-muted-foreground">/5</span>
      </span>
    );
  }

  const _exhaustive: never = label;
  return _exhaustive;
}
