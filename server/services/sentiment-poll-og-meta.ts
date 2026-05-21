import type { SentimentPollOgContext } from "./sentiment-poll-og-context";

/** og:description — sub-text stays out of the JPEG. */
export function sentimentPollOgDescription(ctx: SentimentPollOgContext): string {
  const text = (ctx.subjectText || ctx.description || "").trim();
  return text || "Cast your vote on VoxDex.";
}
