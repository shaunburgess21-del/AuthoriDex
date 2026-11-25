/**
 * Sentiment poll OG share image cache bust — keep server meta and client meta in sync.
 * v5: canonical card is the existing 1200×630 PNG with the live split. The .jpg route stays.
 */
export const SENTIMENT_POLL_OG_IMAGE_VERSION = "5";

/** Relative path for useDocumentMeta / og:image (prepend origin on server). */
export function sentimentPollOgImagePath(slug: string): string {
  return `/api/og/vote/polls/${encodeURIComponent(slug)}.png?v=${SENTIMENT_POLL_OG_IMAGE_VERSION}`;
}

export function sentimentDocumentDescription(input: {
  subjectText?: string | null;
  description?: string | null;
  agreePercent?: number | null;
  neutralPercent?: number | null;
  disagreePercent?: number | null;
  totalVotes?: number | null;
}): string {
  const text = (input.subjectText || input.description || "").trim();
  const base = text || "Cast your vote on VoxDex.";
  const votes = input.totalVotes ?? 0;
  if (votes <= 0) return base;
  const agree = input.agreePercent ?? 0;
  const neutral = input.neutralPercent ?? 0;
  const disagree = input.disagreePercent ?? 0;
  if (agree + neutral + disagree <= 0) return base;
  return `${base} Agree ${agree}% · Neutral ${neutral}% · Disagree ${disagree}%.`;
}
