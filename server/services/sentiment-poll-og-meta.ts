import type { SentimentPollOgContext } from "./sentiment-poll-og-context";

/** og:description — sub-text stays out of the JPEG. */
export function sentimentPollOgDescription(ctx: SentimentPollOgContext): string {
  const text = (ctx.subjectText || ctx.description || "").trim();
  const base = text || "Cast your vote on VoxDex.";
  const results = ctx.results;
  if (!results) return base;
  return `${base} Agree ${results.agreePercent}% · Neutral ${results.neutralPercent}% · Disagree ${results.disagreePercent}%.`;
}
