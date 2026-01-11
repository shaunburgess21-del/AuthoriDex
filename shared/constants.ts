export const FILTER_CATEGORIES = [
  "All",
  "Favorites",
  "Tech",
  "Politics",
  "Business",
  "Music",
  "Sports",
  "Creator",
] as const;

export type FilterCategory = (typeof FILTER_CATEGORIES)[number];

export const CATEGORY_FILTER_OPTIONS: { id: FilterCategory; label: string }[] = [
  { id: "All", label: "All" },
  { id: "Favorites", label: "Favorites" },
  { id: "Tech", label: "Tech" },
  { id: "Politics", label: "Politics" },
  { id: "Business", label: "Business" },
  { id: "Music", label: "Music" },
  { id: "Sports", label: "Sports" },
  { id: "Creator", label: "Creator" },
];

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
