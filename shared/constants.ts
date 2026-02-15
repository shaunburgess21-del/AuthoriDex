export const BASE_FILTER_CATEGORIES = [
  "All",
  "Favorites",
  "Trending",
  "Tech",
  "Politics",
  "Business",
  "Music",
  "Sports",
  "Creator",
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
  "Creator",
  "misc",
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
  { id: "Creator", label: "Creator" },
];

export const CATEGORY_FILTER_OPTIONS_WITH_CUSTOM: { id: FilterCategory; label: string }[] = [
  ...BASE_CATEGORY_FILTER_OPTIONS,
  { id: "misc", label: "Custom Topic" },
];

export const CATEGORY_FILTER_OPTIONS = BASE_CATEGORY_FILTER_OPTIONS;

export const LEGACY_FILTER_CATEGORIES = [
  "All",
  "Tech",
  "Politics",
  "Business",
  "Music",
  "Sports",
  "Creator",
] as const;

export type LegacyFilterCategory = (typeof LEGACY_FILTER_CATEGORIES)[number];

export function getFilterCategories(includeCustomTopic: boolean) {
  return includeCustomTopic ? FILTER_CATEGORIES_WITH_CUSTOM : BASE_FILTER_CATEGORIES;
}

export function getCategoryFilterOptions(includeCustomTopic: boolean) {
  return includeCustomTopic ? CATEGORY_FILTER_OPTIONS_WITH_CUSTOM : BASE_CATEGORY_FILTER_OPTIONS;
}
