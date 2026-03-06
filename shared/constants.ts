export const MARKET_TYPE_LABELS: Record<string, string> = {
  community: "Real-World Markets",
  updown: "Weekly Up/Down",
  h2h: "Head-to-Head Battles",
  gainer: "Top Gainer Predictions",
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
