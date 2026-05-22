/**
 * Person profile OG share image cache bust — keep server meta and client meta in sync.
 */
export const PERSON_OG_IMAGE_VERSION = "3";

/**
 * Relative path for useDocumentMeta / og:image (prepend origin on server).
 * `id` must be the celebrity's `trending_people.id` UUID from `/person/:id` — not a slug or the literal `{id}` placeholder.
 */
export function personOgImagePath(id: string): string {
  return `/api/og/person/${encodeURIComponent(id)}.jpg?v=${PERSON_OG_IMAGE_VERSION}`;
}
