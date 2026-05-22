/**
 * Person profile OG share image cache bust — keep server meta and client meta in sync.
 */
export const PERSON_OG_IMAGE_VERSION = "2";

/** Relative path for useDocumentMeta / og:image (prepend origin on server). */
export function personOgImagePath(id: string): string {
  return `/api/og/person/${encodeURIComponent(id)}.jpg?v=${PERSON_OG_IMAGE_VERSION}`;
}
