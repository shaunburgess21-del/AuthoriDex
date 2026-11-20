import {
  CANONICAL_CATEGORIES,
  getCategoryBucketId,
  getMarketCategoryLabel,
} from "./constants";

export interface RegistryCategoryInput {
  id: string;
  label: string;
  sortOrder?: number;
}

export interface LeaderboardCategoryOption {
  value: string;
  label: string;
}

const PINNED: LeaderboardCategoryOption[] = [
  { value: "all", label: "All Categories" },
  { value: "favorites", label: "Favorites" },
];

/** A stored slug ("media-and-podcast") is not a display label. */
export function isCategorySlugLabel(label: string): boolean {
  return /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(label.trim());
}

export function registryDisplayLabel(id: string, label: string | undefined): string {
  const trimmed = (label ?? "").trim();
  if (!trimmed || isCategorySlugLabel(trimmed)) return getMarketCategoryLabel(id);
  return trimmed;
}

/**
 * Home (and approval) category dropdown.
 *
 * Built from the category registry — the same list onboarding offers — not
 * from whichever categories happen to have a person on the board. Deduped by
 * canonical id so "Media" and "Media & Podcast" collapse to one chip, sorted
 * by sortOrder, and labelled with the registry label (never a slug).
 *
 * "All Categories" and "Favorites" stay pinned. They are view filters, not
 * registry categories.
 */
export function buildLeaderboardCategoryFilters(
  registry: readonly RegistryCategoryInput[] | null | undefined,
  activeId?: string | null,
): LeaderboardCategoryOption[] {
  const source: RegistryCategoryInput[] =
    registry && registry.length > 0
      ? [...registry]
      : CANONICAL_CATEGORIES.map((category, index) => ({
          id: category.id,
          label: category.label,
          sortOrder: (index + 1) * 10,
        }));

  const byId = new Map<
    string,
    { id: string; label: string; sortOrder: number; canonical: boolean }
  >();

  for (const row of source) {
    if (!row?.id) continue;
    const id = getCategoryBucketId(row.id);
    if (!id || id === "all" || id === "favorites" || id === "trending") continue;
    const label = registryDisplayLabel(id, row.label);
    const sortOrder = row.sortOrder ?? 0;
    const canonical = row.id === id;
    const existing = byId.get(id);
    if (!existing) {
      byId.set(id, { id, label, sortOrder, canonical });
      continue;
    }
    if (canonical && !existing.canonical) {
      byId.set(id, { id, label, sortOrder, canonical: true });
      continue;
    }
    if (canonical === existing.canonical && sortOrder < existing.sortOrder) {
      byId.set(id, {
        ...existing,
        sortOrder,
        label: canonical ? label : existing.label,
      });
    }
  }

  const dynamic = [...byId.values()]
    .sort((a, b) => a.sortOrder - b.sortOrder || a.id.localeCompare(b.id))
    .map((row) => ({ value: row.id, label: row.label }));

  const options = [...PINNED, ...dynamic];

  if (
    activeId &&
    activeId !== "all" &&
    activeId !== "favorites" &&
    activeId !== "trending"
  ) {
    const id = getCategoryBucketId(activeId);
    if (id && !options.some((option) => option.value === id)) {
      options.push({ value: id, label: registryDisplayLabel(id, undefined) });
    }
  }

  return options;
}
