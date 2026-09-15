/**
 * World-market OG share image cache bust — keep server meta and client meta in sync.
 */
export const MARKET_OG_IMAGE_VERSION = "1";

/** Relative path for useDocumentMeta / og:image (prepend origin on server). */
export function marketOgImagePath(slug: string): string {
  return `/api/og/markets/${encodeURIComponent(slug)}.jpg?v=${MARKET_OG_IMAGE_VERSION}`;
}
