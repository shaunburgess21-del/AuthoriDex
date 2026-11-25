import { sentimentDocumentDescription } from "@shared/sentiment-poll-og";
import type { SentimentPollOgContext } from "./sentiment-poll-og-context";

/** og:description — subject text stays the lead; the live split follows when votes exist. */
export function sentimentPollOgDescription(ctx: SentimentPollOgContext): string {
  return sentimentDocumentDescription({
    subjectText: ctx.subjectText,
    description: ctx.description,
    agreePercent: ctx.results?.agreePercent,
    neutralPercent: ctx.results?.neutralPercent,
    disagreePercent: ctx.results?.disagreePercent,
    totalVotes: ctx.results ? 1 : 0,
  });
}
