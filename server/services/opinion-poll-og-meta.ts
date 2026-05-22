import type { OpinionPollOgContext } from "./opinion-poll-og-context";

/** og:description — summary/description stay out of the JPEG. */
export function opinionPollOgDescription(ctx: OpinionPollOgContext): string {
  const text = (ctx.summary || ctx.description || "").trim();
  return text || "Cast your vote on VoxDex.";
}
