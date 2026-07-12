/**
 * Sentiment poll OG share image cache bust — keep server meta and client meta in sync.
 */
export const SENTIMENT_POLL_OG_IMAGE_VERSION = "4";

/** Relative path for useDocumentMeta / og:image (prepend origin on server). */
export function sentimentPollOgImagePath(slug: string): string {
  return `/api/og/vote/polls/${encodeURIComponent(slug)}.jpg?v=${SENTIMENT_POLL_OG_IMAGE_VERSION}`;
}
