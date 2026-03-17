export const MARKET_TYPE_LABELS: Record<string, string> = {
  community: "World Markets",
  updown: "Weekly Up/Down",
  h2h: "Head-to-Head Battles",
  gainer: "Category Races",
  jackpot: "Weekly Jackpot",
};

export function getMarketTypeLabel(marketType: string): string {
  return MARKET_TYPE_LABELS[marketType] || marketType;
}

export const BASE_FILTER_CATEGORIES = [
  "All",
  "Favorites",
  "Trending",
  "Tech",
  "Politics",
  "Business",
  "Music",
  "Sports",
  "Film & TV",
  "Gaming",
  "Creator",
  "Food & Drink",
  "Lifestyle",
] as const;

export const FILTER_CATEGORIES_WITH_CUSTOM = [
  "All",
  "Favorites",
  "Trending",
  "Tech",
  "Politics",
  "Business",
  "Music",
  "Sports",
  "Film & TV",
  "Gaming",
  "Creator",
  "misc",
  "Food & Drink",
  "Lifestyle",
] as const;

export const FILTER_CATEGORIES = BASE_FILTER_CATEGORIES;

export type FilterCategory = (typeof FILTER_CATEGORIES_WITH_CUSTOM)[number];

export const BASE_CATEGORY_FILTER_OPTIONS: { id: FilterCategory; label: string }[] = [
  { id: "All", label: "All" },
  { id: "Favorites", label: "Favorites" },
  { id: "Trending", label: "Trending" },
  { id: "Tech", label: "Tech" },
  { id: "Politics", label: "Politics" },
  { id: "Business", label: "Business" },
  { id: "Music", label: "Music" },
  { id: "Sports", label: "Sports" },
  { id: "Film & TV", label: "Film & TV" },
  { id: "Gaming", label: "Gaming" },
  { id: "Creator", label: "Creator" },
  { id: "Food & Drink", label: "Food & Drink" },
  { id: "Lifestyle", label: "Lifestyle" },
];

export const CATEGORY_FILTER_OPTIONS_WITH_CUSTOM: { id: FilterCategory; label: string }[] = [
  { id: "All", label: "All" },
  { id: "Favorites", label: "Favorites" },
  { id: "Trending", label: "Trending" },
  { id: "Tech", label: "Tech" },
  { id: "Politics", label: "Politics" },
  { id: "Business", label: "Business" },
  { id: "Music", label: "Music" },
  { id: "Sports", label: "Sports" },
  { id: "Film & TV", label: "Film & TV" },
  { id: "Gaming", label: "Gaming" },
  { id: "Creator", label: "Creator" },
  { id: "misc", label: "Misc" },
  { id: "Food & Drink", label: "Food & Drink" },
  { id: "Lifestyle", label: "Lifestyle" },
];

export const CATEGORY_FILTER_OPTIONS = BASE_CATEGORY_FILTER_OPTIONS;

export const LEGACY_FILTER_CATEGORIES = [
  "All",
  "Tech",
  "Politics",
  "Business",
  "Music",
  "Sports",
  "Film & TV",
  "Gaming",
  "Creator",
] as const;

export type LegacyFilterCategory = (typeof LEGACY_FILTER_CATEGORIES)[number];

export function getFilterCategories(includeCustomTopic: boolean) {
  return includeCustomTopic ? FILTER_CATEGORIES_WITH_CUSTOM : BASE_FILTER_CATEGORIES;
}

export function getCategoryFilterOptions(includeCustomTopic: boolean) {
  return includeCustomTopic ? CATEGORY_FILTER_OPTIONS_WITH_CUSTOM : BASE_CATEGORY_FILTER_OPTIONS;
}

export const CANONICAL_MARKET_CATEGORIES = [
  "tech",
  "politics",
  "business",
  "music",
  "sports",
  "film-tv",
  "gaming",
  "creator",
  "food-drink",
  "lifestyle",
  "misc",
] as const;

export type CanonicalMarketCategory = (typeof CANONICAL_MARKET_CATEGORIES)[number];

export const MARKET_CATEGORY_LABELS: Record<CanonicalMarketCategory, string> = {
  tech: "Tech",
  politics: "Politics",
  business: "Business",
  music: "Music",
  sports: "Sports",
  "film-tv": "Film & TV",
  gaming: "Gaming",
  creator: "Creator",
  "food-drink": "Food & Drink",
  lifestyle: "Lifestyle",
  misc: "Misc",
};

const MARKET_CATEGORY_ALIASES: Record<string, CanonicalMarketCategory> = {
  tech: "tech",
  politics: "politics",
  business: "business",
  music: "music",
  sports: "sports",
  "film tv": "film-tv",
  "film & tv": "film-tv",
  acting: "film-tv",
  gaming: "gaming",
  creator: "creator",
  "food drink": "food-drink",
  "food & drink": "food-drink",
  lifestyle: "lifestyle",
  misc: "misc",
};

function normalizeCategoryLookupKey(category: string) {
  return category
    .trim()
    .toLowerCase()
    .replace(/_/g, " ")
    .replace(/-/g, " ")
    .replace(/\s*&\s*/g, " & ")
    .replace(/\s+/g, " ");
}

export function normalizeMarketCategory(category: string | null | undefined): string {
  if (!category) return "misc";

  const lookupKey = normalizeCategoryLookupKey(category);
  const canonical = MARKET_CATEGORY_ALIASES[lookupKey];
  if (canonical) return canonical;

  return (
    lookupKey
      .replace(/\s*&\s*/g, " and ")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "misc"
  );
}

export function getMarketCategoryLabel(category: string | null | undefined): string {
  const normalized = normalizeMarketCategory(category);
  if (normalized in MARKET_CATEGORY_LABELS) {
    return MARKET_CATEGORY_LABELS[normalized as CanonicalMarketCategory];
  }

  return normalized
    .split("-")
    .filter(Boolean)
    .map(part => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ") || "Misc";
}

export const MARKET_CATEGORY_OPTIONS = CANONICAL_MARKET_CATEGORIES.map((value) => ({
  value,
  label: MARKET_CATEGORY_LABELS[value],
}));
