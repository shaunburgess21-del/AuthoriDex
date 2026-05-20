/**
 * Matchup OG share image cache bust — keep server meta and client meta in sync.
 */
export const MATCHUP_OG_IMAGE_VERSION = "6";

/** Relative path for useDocumentMeta / og:image (prepend origin on server). */
export function matchupOgImagePath(slug: string): string {
  return `/api/og/vote/matchups/${encodeURIComponent(slug)}.jpg?v=${MATCHUP_OG_IMAGE_VERSION}`;
}
