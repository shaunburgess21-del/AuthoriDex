import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { normalizeMarketCategory, getMarketCategoryLabel } from "@shared/constants";
import { categoryRegistryFallback } from "@shared/category-registry";

export interface RegistryCategory {
  id: string;
  label: string;
  sortOrder?: number;
}

export interface CategoryRegistry {
  /** Registry rows (live API when ready; 23-id seed on first paint). */
  categories: RegistryCategory[];
  /** Lookup by canonical id (e.g. "media" → { id, label }). */
  byId: Map<string, RegistryCategory>;
  /** Lookup by lower-cased label (e.g. "media & podcast" → { id, label }). */
  byLabel: Map<string, RegistryCategory>;
  /**
   * Resolve a stored category text (or id) to a canonical registry id.
   * Tries (in order): exact id match, exact label match (case-insensitive),
   * normalised slug match, then `normalizeMarketCategory(stored)` as a fallback.
   * Returns the normalised slug if no registry hit.
   */
  resolveCanonicalId(stored: string | null | undefined): string;
  /**
   * Return the user-facing label for a stored category. Prefers the registry
   * label, falling back to the legacy `getMarketCategoryLabel` mapping.
   */
  getDisplayLabel(stored: string | null | undefined): string;
  /** True once GET /api/categories has returned. First paint uses the 23-id seed. */
  isReady: boolean;
}

function buildRegistry(rows: RegistryCategory[], isReady: boolean): CategoryRegistry {
  const categories = rows;
  const byId = new Map<string, RegistryCategory>();
  const byLabel = new Map<string, RegistryCategory>();
  // Maps a normalised slug derived from a registry label back to the canonical id.
  // Lets callers resolve cached/legacy values like "media-and-podcast" (the slug form
  // of a renamed label "Media & Podcast") back to the canonical id "media".
  const byNormalisedLabel = new Map<string, RegistryCategory>();

  for (const row of categories) {
    if (!row?.id) continue;
    byId.set(row.id, row);
    if (row.label) {
      byLabel.set(row.label.trim().toLowerCase(), row);
      const normalisedLabel = normalizeMarketCategory(row.label);
      if (normalisedLabel) {
        byNormalisedLabel.set(normalisedLabel, row);
      }
    }
  }

  const resolveCanonicalId = (stored: string | null | undefined): string => {
    if (stored == null) return "misc";
    const trimmed = stored.trim();
    if (!trimmed) return "misc";

    if (byId.has(trimmed)) return trimmed;

    const labelHit = byLabel.get(trimmed.toLowerCase());
    if (labelHit) return labelHit.id;

    const normalised = normalizeMarketCategory(trimmed);
    if (byId.has(normalised)) return normalised;
    const normalisedLabelHit = byNormalisedLabel.get(normalised);
    if (normalisedLabelHit) return normalisedLabelHit.id;
    return normalised;
  };

  const getDisplayLabel = (stored: string | null | undefined): string => {
    const id = resolveCanonicalId(stored);
    const hit = byId.get(id);
    if (hit?.label) return hit.label;
    return getMarketCategoryLabel(stored ?? id);
  };

  return {
    categories,
    byId,
    byLabel,
    resolveCanonicalId,
    getDisplayLabel,
    isReady,
  };
}

/** First-paint fallback: same 23-id seed GET /api/categories uses when the DB is empty. */
const FALLBACK_REGISTRY: CategoryRegistry = buildRegistry(categoryRegistryFallback(), false);

export function useCategoryRegistry(): CategoryRegistry {
  const { data } = useQuery<RegistryCategory[]>({
    queryKey: ["/api/categories"],
    staleTime: 5 * 60 * 1000,
  });

  return useMemo<CategoryRegistry>(() => {
    if (!data || data.length === 0) {
      return FALLBACK_REGISTRY;
    }
    return buildRegistry(data, true);
  }, [data]);
}
