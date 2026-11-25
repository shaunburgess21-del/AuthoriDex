import { opinionDocumentDescription } from "@shared/opinion-poll-og";
import type { OpinionPollOgContext } from "./opinion-poll-og-context";

/** og:description — summary stays the lead; the leader percent follows when votes exist. */
export function opinionPollOgDescription(ctx: OpinionPollOgContext): string {
  const leader = ctx.totalVotes > 0 ? ctx.displayOptions[0] : undefined;
  return opinionDocumentDescription({
    summary: ctx.summary,
    description: ctx.description,
    leaderName: leader?.name,
    leaderPercent: leader?.percent,
    totalVotes: ctx.totalVotes,
  });
}
