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

/**
 * CANONICAL_CATEGORIES — default seed set and normalization baseline (not the full admin registry).
 *
 * The **authoritative** list of category ids an operator can add/remove lives in Postgres
 * (`content_categories`) and is exposed to admin as `GET /api/admin/categories`. Admin
 * create/edit UIs for polls, markets, matchups, induction, etc. must use that API so new
 * categories appear without code changes. This array stays in sync with the initial
 * migration seed and powers `MARKET_CATEGORY_OPTIONS`, filter helpers, and
 * `normalizeMarketCategory` (which maps legacy display text and slugs to kebab-case ids).
 *
 * ID is kebab-lowercase (typical storage on the wire). Label is for display only.
 *
 * Rules for consumers:
 *   - Filter bars on Vote / Predict / Leaderboard / Induction: use CATEGORIES_WITH_FILTERS
 *     (adds "all", "favorites", "trending" as UI-only filter items).
 *   - Suggest modals for types that REQUIRE a real person from the leaderboard
 *     (induction, profile_image): use CATEGORIES_LEADERBOARD (excludes "misc").
 *   - Suggest modals for types that can be about anything
 *     (matchup, sentiment_poll, opinion_poll, open_market): use CATEGORIES_OPEN (all 12)
 *     as a baseline; prefer registry-backed lists where the UX allows dynamic categories.
 *
 * Note: only the World/Open Markets prediction type has a user-facing suggest flow.
 * The other prediction types (Weekly Up/Down, Head-to-Head, Category Races) are
 * leaderboard-native and admin-created only — they have no suggest modal and therefore
 * don't appear in this rule. If user suggest flows are ever added for those types,
 * they belong in CATEGORIES_LEADERBOARD.
 */
export const CANONICAL_CATEGORIES = [
  { id: "tech",       label: "Tech" },
  { id: "politics",   label: "Politics" },
  { id: "business",   label: "Business" },
  { id: "music",      label: "Music" },
  { id: "sports",     label: "Sports" },
  { id: "film-tv",    label: "Film & TV" },
  { id: "gaming",     label: "Gaming" },
  { id: "creator",    label: "Creator" },
  { id: "comedy",     label: "Comedy" },
  { id: "food-drink", label: "Food & Drink" },
  { id: "lifestyle",  label: "Lifestyle" },
  { id: "misc",       label: "Misc" },
] as const;

export type CategoryId = (typeof CANONICAL_CATEGORIES)[number]["id"];

/** All 12 categories including misc — for matchup, sentiment_poll, opinion_poll, open_market, and admin. */
export const CATEGORIES_OPEN = CANONICAL_CATEGORIES;

/** 11 categories without misc — for leaderboard-tied suggest modals (induction, profile_image). */
export const CATEGORIES_LEADERBOARD = CANONICAL_CATEGORIES.filter(c => c.id !== "misc");

// ── Opinion Poll options constraints ──────────────────────────────────────────
export const OPINION_POLL_MIN_OPTIONS = 3;
export const OPINION_POLL_MAX_OPTIONS = 20;

/**
 * For filter bars that also need the "all"/"favorites"/"trending" UI-only entries.
 * Keep these SEPARATE from the content categories so they can't leak into submit payloads.
 */
export const CATEGORIES_WITH_FILTERS = [
  { id: "all",       label: "All" },
  { id: "favorites", label: "Favorites" },
  { id: "trending",  label: "Trending" },
  ...CANONICAL_CATEGORIES,
] as const;

// ── Legacy / compatibility exports ─────────────────────────────────────────────
// All derived from CANONICAL_CATEGORIES so they stay in sync automatically.

/** @deprecated Use CATEGORIES_WITH_FILTERS instead. */
export const BASE_FILTER_CATEGORIES = CATEGORIES_WITH_FILTERS.map(c => c.id);

/** @deprecated Use CATEGORIES_WITH_FILTERS instead. Both now return the same list. */
export const FILTER_CATEGORIES_WITH_CUSTOM = BASE_FILTER_CATEGORIES;

export const FILTER_CATEGORIES = BASE_FILTER_CATEGORIES;

export type FilterCategory = (typeof CATEGORIES_WITH_FILTERS)[number]["id"];

export const BASE_CATEGORY_FILTER_OPTIONS: { id: FilterCategory; label: string }[] =
  CATEGORIES_WITH_FILTERS.map(c => ({ id: c.id as FilterCategory, label: c.label }));

/** Both lists are now identical — misc is always in the canonical set. */
export const CATEGORY_FILTER_OPTIONS_WITH_CUSTOM = BASE_CATEGORY_FILTER_OPTIONS;

export const CATEGORY_FILTER_OPTIONS = BASE_CATEGORY_FILTER_OPTIONS;

/** @deprecated Use CATEGORIES_WITH_FILTERS instead. */
export const LEGACY_FILTER_CATEGORIES = [
  "all", "tech", "politics", "business", "music", "sports",
  "film-tv", "gaming", "creator",
] as const;

export type LegacyFilterCategory = (typeof LEGACY_FILTER_CATEGORIES)[number];

/** @deprecated Use CATEGORIES_WITH_FILTERS.map(c => c.id) instead. */
export function getFilterCategories(_includeCustomTopic: boolean) {
  // Both branches now return the same list — misc is always present.
  return CATEGORIES_WITH_FILTERS.map(c => c.id);
}

/** @deprecated Use BASE_CATEGORY_FILTER_OPTIONS instead. */
export function getCategoryFilterOptions(_includeCustomTopic: boolean) {
  return BASE_CATEGORY_FILTER_OPTIONS;
}

// ── Market-specific exports ─────────────────────────────────────────────────
// Derived from CANONICAL_CATEGORIES so they stay in sync.

export const CANONICAL_MARKET_CATEGORIES = CANONICAL_CATEGORIES.map(c => c.id);

export type CanonicalMarketCategory = CategoryId;

export const MARKET_CATEGORY_LABELS: Record<CanonicalMarketCategory, string> = {
  tech: "Tech",
  politics: "Politics",
  business: "Business",
  music: "Music",
  sports: "Sports",
  "film-tv": "Film & TV",
  gaming: "Gaming",
  creator: "Creator",
  comedy: "Comedy",
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
  comedy: "comedy",
  "food drink": "food-drink",
  "food & drink": "food-drink",
  lifestyle: "lifestyle",
  misc: "misc",
  other: "misc",
};

/** Display labels for legacy person categories not in the canonical 12. */
const PERSON_CATEGORY_LEGACY_LABELS: Record<string, string> = {
  media: "Media",
  streaming: "Streaming",
  "media-and-podcast": "Media & Podcast",
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
  if (normalized in PERSON_CATEGORY_LEGACY_LABELS) {
    return PERSON_CATEGORY_LEGACY_LABELS[normalized]!;
  }

  return normalized
    .split("-")
    .filter(Boolean)
    .map(part => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ") || "Misc";
}

/** Title Case display label for person tables; leaves null/empty unchanged. */
export function canonicalizePersonCategory(
  category: string | null | undefined,
): string | null | undefined {
  if (category == null || !String(category).trim()) return category;
  return getMarketCategoryLabel(category);
}

export const MARKET_CATEGORY_OPTIONS = CANONICAL_CATEGORIES.map((c) => ({
  value: c.id,
  label: c.label,
}));

/** Category Race (gainer) field size — fixed at market creation each Monday. */
export const GAINER_FIELD_SIZE = 5;
/** Minimum eligible people (movement history + opening baseline) before a category races. */
export const GAINER_MIN_ELIGIBLE = 5;
/** Recognizable anchor drawn from highest fame among eligible (not movement-weighted). */
export const GAINER_ANCHOR_COUNT = 1;
export const GAINER_MOVER_COUNT = GAINER_FIELD_SIZE - GAINER_ANCHOR_COUNT;

/** Hourly ingest samples in the trailing window required for movement stats + eligibility. */
export const GAINER_MOVEMENT_MIN_SAMPLES = 24;
export const GAINER_MOVEMENT_STDDEV_DAYS = 30;
export const GAINER_MOVEMENT_MOMENTUM_DAYS = 7;

/** Movement-potential score blend (volatility + recent |% change| + mild lower-base tilt). */
export const GAINER_SCORE_WEIGHT_VOLATILITY = 0.45;
export const GAINER_SCORE_WEIGHT_MOMENTUM = 0.4;
export const GAINER_SCORE_WEIGHT_LOWER_BASE = 0.15;

/** Weekly jackpot / updown anchored field — fixed anchors + rotating movers + wildcards. */
export const ANCHORED_ANCHOR_COUNT = 10;
export const ANCHORED_MOVER_COUNT = 6;
export const ANCHORED_WILDCARD_COUNT = 4;
export const ANCHORED_FIELD_SIZE =
  ANCHORED_ANCHOR_COUNT + ANCHORED_MOVER_COUNT + ANCHORED_WILDCARD_COUNT;
/** 1-based inclusive fame ranks for mover / wildcard pools. */
export const ANCHORED_MOVER_RANK_RANGE = [11, 40] as const;
export const ANCHORED_WILDCARD_RANK_RANGE = [41, 100] as const;
