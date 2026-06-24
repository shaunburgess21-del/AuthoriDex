import { getMarketCategoryLabel, normalizeMarketCategory } from "@shared/constants";

export type SectionCategoryOption = {
  value: string;
  label: string;
};

type BuildOptions = {
  categories: Array<string | null | undefined>;
  /** Additional (secondary) category ids to surface as pills even when no
   * item lists them as its primary category. Flattened across items. */
  secondaryCategories?: Array<string | null | undefined>;
  includeAll?: boolean;
  includeFavorites?: boolean;
  includeTrending?: boolean;
  selectedCategory?: string | null;
  preserveSelectedIfMissing?: boolean;
};

const PINNED_LABELS: Record<string, string> = {
  all: "All Categories",
  favorites: "Favorites",
  trending: "Trending",
};

export function buildSectionCategoryOptions({
  categories,
  secondaryCategories,
  includeAll = true,
  includeFavorites = false,
  includeTrending = true,
  selectedCategory,
  preserveSelectedIfMissing = false,
}: BuildOptions): SectionCategoryOption[] {
  const ids = new Set<string>();

  const addId = (raw: string | null | undefined) => {
    const normalized = normalizeMarketCategory(raw);
    if (!normalized || normalized === "all" || normalized === "favorites" || normalized === "trending") return;
    ids.add(normalized);
  };

  for (const raw of categories) addId(raw);
  for (const raw of secondaryCategories ?? []) addId(raw);

  const dynamic = Array.from(ids)
    .sort((a, b) => getMarketCategoryLabel(a).localeCompare(getMarketCategoryLabel(b)))
    .map((id) => ({
      value: id,
      label: getMarketCategoryLabel(id),
    }));

  const selected = selectedCategory?.toLowerCase();
  if (
    preserveSelectedIfMissing &&
    selected &&
    selected !== "all" &&
    selected !== "favorites" &&
    selected !== "trending" &&
    !dynamic.some((c) => c.value === selected)
  ) {
    dynamic.unshift({ value: selected, label: getMarketCategoryLabel(selected) });
  }

  const pinned: SectionCategoryOption[] = [];
  if (includeAll) pinned.push({ value: "all", label: PINNED_LABELS.all });
  if (includeFavorites) pinned.push({ value: "favorites", label: PINNED_LABELS.favorites });
  if (includeTrending) pinned.push({ value: "trending", label: PINNED_LABELS.trending });

  return [...pinned, ...dynamic];
}

export function isPinnedCategory(category: string): boolean {
  const c = category.toLowerCase();
  return c === "all" || c === "favorites" || c === "trending";
}

export function involvesAnyFavorite(
  favoriteIds: Set<string>,
  ids: Iterable<string | null | undefined>,
): boolean {
  for (const id of ids) {
    if (id && favoriteIds.has(id)) return true;
  }
  return false;
}
