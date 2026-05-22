/**
 * Opinion poll OG share image cache bust — keep server meta and client meta in sync.
 */
export const OPINION_POLL_OG_IMAGE_VERSION = "2";

/** Relative path for useDocumentMeta / og:image (prepend origin on server). */
export function opinionPollOgImagePath(slug: string): string {
  return `/api/og/vote/opinion-polls/${encodeURIComponent(slug)}.jpg?v=${OPINION_POLL_OG_IMAGE_VERSION}`;
}
