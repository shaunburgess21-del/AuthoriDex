import { getMarketCategoryLabel, normalizeMarketCategory } from "@shared/constants";

export type SectionCategoryOption = {
  value: string;
  label: string;
};

type BuildOptions = {
  categories: Array<string | null | undefined>;
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
  includeAll = true,
  includeFavorites = false,
  includeTrending = true,
  selectedCategory,
  preserveSelectedIfMissing = false,
}: BuildOptions): SectionCategoryOption[] {
  const ids = new Set<string>();

  for (const raw of categories) {
    const normalized = normalizeMarketCategory(raw);
    if (!normalized || normalized === "all" || normalized === "favorites" || normalized === "trending") continue;
    ids.add(normalized);
  }

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
