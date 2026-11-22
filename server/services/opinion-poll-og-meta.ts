import type { OpinionPollOgContext } from "./opinion-poll-og-context";

/** og:description — summary/description stay out of the JPEG. */
export function opinionPollOgDescription(ctx: OpinionPollOgContext): string {
  const text = (ctx.summary || ctx.description || "").trim();
  const base = text || "Cast your vote on VoxDex.";
  const leader = ctx.totalVotes > 0 ? ctx.displayOptions[0] : undefined;
  if (!leader || leader.percent <= 0) return base;
  return `${base} ${leader.name} leads at ${leader.percent}%.`;
}
