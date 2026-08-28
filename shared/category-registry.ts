/**
 * Category registry seed — first-paint / empty-DB fallback for GET /api/categories.
 *
 * The live source of truth is Postgres `content_categories` (admin-managed).
 * Client surfaces must prefer that list via GET /api/categories
 * (`useCategoryRegistry`). This seed exists only so first paint and
 * environments without the registry table still have all 23 canonical ids
 * (including media, streaming, science, history) instead of the older 19-id
 * `CANONICAL_CATEGORIES` baseline used by engagement CHECK / market helpers.
 *
 * sortOrder: unique tens. Live DB may still have ties for admin-added rows
 * (historically crypto/media 130, ai/streaming 140, fashion/science 150).
 * Proposed unique tens for those live rows — do NOT apply without an ops
 * edit; this file is not a production migration:
 *   media 200, streaming 210, science 220, history 230
 * (crypto 130, ai 140, fashion 150 stay as seeded in migrations/0084).
 */

export type CategoryRegistrySeedRow = {
  id: string;
  label: string;
  sortOrder: number;
};

export const CATEGORY_REGISTRY_SEED: readonly CategoryRegistrySeedRow[] = [
  { id: "tech", label: "Tech", sortOrder: 10 },
  { id: "politics", label: "Politics", sortOrder: 20 },
  { id: "business", label: "Business", sortOrder: 30 },
  { id: "music", label: "Music", sortOrder: 40 },
  { id: "sports", label: "Sports", sortOrder: 50 },
  { id: "film-tv", label: "Film & TV", sortOrder: 60 },
  { id: "gaming", label: "Gaming", sortOrder: 70 },
  { id: "creator", label: "Creator", sortOrder: 80 },
  { id: "comedy", label: "Comedy", sortOrder: 90 },
  { id: "food-drink", label: "Food & Drink", sortOrder: 100 },
  { id: "lifestyle", label: "Lifestyle", sortOrder: 110 },
  { id: "misc", label: "Misc", sortOrder: 120 },
  { id: "crypto", label: "Crypto", sortOrder: 130 },
  { id: "ai", label: "AI", sortOrder: 140 },
  { id: "fashion", label: "Fashion", sortOrder: 150 },
  { id: "beauty", label: "Beauty", sortOrder: 160 },
  { id: "health", label: "Health", sortOrder: 170 },
  { id: "travel", label: "Travel", sortOrder: 180 },
  { id: "dating", label: "Dating", sortOrder: 190 },
  { id: "media", label: "Media & Podcast", sortOrder: 200 },
  { id: "streaming", label: "Streaming", sortOrder: 210 },
  { id: "science", label: "Science", sortOrder: 220 },
  { id: "history", label: "History", sortOrder: 230 },
] as const;

export const CATEGORY_REGISTRY_IDS: readonly string[] = CATEGORY_REGISTRY_SEED.map(
  (row) => row.id,
);

/** JSON shape returned by GET /api/categories when the DB registry is empty. */
export function categoryRegistryFallback(): CategoryRegistrySeedRow[] {
  return CATEGORY_REGISTRY_SEED.map((row) => ({
    id: row.id,
    label: row.label,
    sortOrder: row.sortOrder,
  }));
}
