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
 * Sentinel `parent_id` used for standalone "Voices" timeline posts in the
 * unified `comments` table (`parent_type = 'voices_post'`). Standalone posts
 * have no real parent entity, so they all hang off this single virtual parent.
 * Replies attach via `parent_comment_id` as usual.
 */
export const VOICES_TIMELINE_ID = "global";

/**
 * Voices feed "surfaces" — the user-facing filter buckets that map onto the
 * underlying comment parent types. `timeline` = standalone voices posts.
 */
export const VOICES_SURFACES = [
  "timeline",
  "matchup",
  "sentiment_poll",
  "opinion_poll",
  "world_market",
  "profile",
] as const;

export type VoicesSurface = (typeof VOICES_SURFACES)[number];

export const VOICES_SURFACE_LABELS: Record<VoicesSurface, string> = {
  matchup: "Matchups",
  sentiment_poll: "Sentiment Polls",
  opinion_poll: "Opinion Polls",
  world_market: "World Markets",
  profile: "Profiles",
  timeline: "Timeline",
};

/**
 * Card reaction "surfaces" — the Vote/Predict card types a user can Like or
 * Dislike from the category-pill menu. Stored in `card_reactions.surface_type`
 * and shared by the client hook, the pill menu, and the API route so the
 * wire values can never drift.
 */
export const CARD_REACTION_SURFACES = [
  "sentiment_poll",
  "matchup",
  "opinion_poll",
  "value_person",
  "induction_candidate",
  "curate_person",
  "market_updown",
  "market_h2h",
  "market_gainer",
  "market_world",
] as const;

export type CardReactionSurface = (typeof CARD_REACTION_SURFACES)[number];

export const CARD_REACTION_TYPES = ["like", "dislike"] as const;
export type CardReactionType = (typeof CARD_REACTION_TYPES)[number];

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
  { id: "crypto",     label: "Crypto" },
  { id: "ai",         label: "AI" },
  { id: "fashion",    label: "Fashion" },
  { id: "beauty",     label: "Beauty" },
  { id: "health",     label: "Health" },
  { id: "travel",     label: "Travel" },
  { id: "dating",     label: "Dating" },
  { id: "misc",       label: "Misc" },
] as const;

export type CategoryId = (typeof CANONICAL_CATEGORIES)[number]["id"];

/** All 12 categories including misc — for matchup, sentiment_poll, opinion_poll, open_market, and admin. */
export const CATEGORIES_OPEN = CANONICAL_CATEGORIES;

/** 11 categories without misc — for leaderboard-tied suggest modals (induction, profile_image). */
export const CATEGORIES_LEADERBOARD = CANONICAL_CATEGORIES.filter(c => c.id !== "misc");

// ── Opinion Poll options constraints ──────────────────────────────────────────
export const OPINION_POLL_MIN_OPTIONS = 3;
export const OPINION_POLL_MAX_OPTIONS = 30;

// ── Opinion Poll option suggestions (community-suggested options) ─────────────
/** Max characters for a suggested option name. */
export const OPINION_POLL_OPTION_SUGGESTION_MAX_LEN = 60;
/** Max pending suggestions a single user may have on one poll at a time. */
export const OPINION_POLL_OPTION_SUGGESTION_MAX_PER_USER = 3;

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

/**
 * `{ value, label }` shape (value = canonical id, incl. all/favorites/trending)
 * for filter dropdowns/overlays. Single source for fallback option lists so new
 * categories propagate without editing each consumer.
 */
export const CATEGORY_FILTER_SELECT_OPTIONS: { value: FilterCategory; label: string }[] =
  BASE_CATEGORY_FILTER_OPTIONS.map(({ id, label }) => ({ value: id, label }));

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
  crypto: "Crypto",
  ai: "AI",
  fashion: "Fashion",
  beauty: "Beauty",
  health: "Health",
  travel: "Travel",
  dating: "Dating",
  misc: "Misc",
};

const MARKET_CATEGORY_ALIASES: Record<string, CanonicalMarketCategory> = {
  tech: "tech",
  politics: "politics",
  business: "business",
  music: "music",
  sports: "sports",
  sport: "sports",
  "film tv": "film-tv",
  "film & tv": "film-tv",
  acting: "film-tv",
  entertainment: "film-tv",
  gaming: "gaming",
  creator: "creator",
  comedy: "comedy",
  "food drink": "food-drink",
  "food & drink": "food-drink",
  lifestyle: "lifestyle",
  crypto: "crypto",
  cryptocurrency: "crypto",
  ai: "ai",
  "artificial intelligence": "ai",
  fashion: "fashion",
  beauty: "beauty",
  health: "health",
  travel: "travel",
  dating: "dating",
  misc: "misc",
  other: "misc",
  custom: "misc",
  "custom topic": "misc",
};

/** Display labels for legacy person categories not in the canonical 12. */
const PERSON_CATEGORY_LEGACY_LABELS: Record<string, string> = {
  // Registry id `media` was renamed to "Media & Podcast"; keep both slug forms
  // pointing at the same display label so chip builders and canonicalizePersonCategory
  // collapse the old "Media" spelling.
  media: "Media & Podcast",
  streaming: "Streaming",
  "media-and-podcast": "Media & Podcast",
};

/**
 * Normalised slugs that should share one bucket for counts, filters, and colours
 * (e.g. registry id `media` with label `Media & Podcast` → slug `media-and-podcast`).
 */
export const CATEGORY_BUCKET_ALIASES: Record<string, string> = {
  "media-and-podcast": "media",
};

/** Canonical bucket id for aggregating counts (top-50 mix, filters, etc.). */
export function getCategoryBucketId(category: string | null | undefined): string {
  const normalized = normalizeMarketCategory(category);
  return CATEGORY_BUCKET_ALIASES[normalized] ?? normalized;
}

/**
 * Key used to look up category colours. Prefer an explicit registry/canonical id;
 * otherwise map known legacy slugs (e.g. `media-and-podcast` → `media`).
 */
export function resolveCategoryColorKey(
  category: string | null | undefined,
  canonicalIdOverride?: string,
): string {
  if (canonicalIdOverride?.trim()) return canonicalIdOverride.trim();
  const normalized = normalizeMarketCategory(category ?? "");
  return CATEGORY_BUCKET_ALIASES[normalized] ?? normalized;
}

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

/**
 * True if `filter` matches the item's primary OR any of its secondary categories.
 *
 * Both sides are run through getCategoryBucketId so renamed/aliased spellings
 * (e.g. "Media" vs "Media & Podcast" / `media-and-podcast`) share one bucket.
 * Values may be Title Case labels (people) or kebab ids (polls/markets).
 * The UI-only "all"/"trending"/"favorites" filters are handled by callers
 * (favorites needs person ids), so this returns true for "all"/"trending"
 * and otherwise compares against the bucketed category set.
 */
export function matchesCategoryFilter(
  primary: string | null | undefined,
  secondary: readonly string[] | null | undefined,
  filter: string,
): boolean {
  if (filter === "all" || filter === "trending") return true;
  const filterId = getCategoryBucketId(filter);
  if (getCategoryBucketId(primary) === filterId) return true;
  if (!secondary || secondary.length === 0) return false;
  return secondary.some((s) => getCategoryBucketId(s) === filterId);
}

/**
 * Normalizes a list of incoming secondary category values to canonical kebab ids,
 * keeping only ids present in `allowedIds` (the registry), dropping the primary
 * category, and de-duplicating. Returns a clean array safe to persist.
 *
 * `allowedIds` defaults to the canonical set; callers with the live
 * `content_categories` registry should pass those ids so admin-added categories
 * are accepted.
 */
export function sanitizeSecondaryCategories(
  input: unknown,
  primary: string | null | undefined,
  allowedIds?: Iterable<string>,
): string[] {
  if (!Array.isArray(input)) return [];
  const allowed = new Set<string>(
    [...(allowedIds ?? CANONICAL_MARKET_CATEGORIES)].map((id) =>
      normalizeMarketCategory(id),
    ),
  );
  const primaryId = primary ? normalizeMarketCategory(primary) : null;
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of input) {
    if (typeof raw !== "string") continue;
    const id = normalizeMarketCategory(raw);
    if (!id || id === primaryId) continue;
    if (!allowed.has(id)) continue;
    if (seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}

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

/**
 * Opening-score band tiers for Gainer field selection (tried in order).
 * Compresses the field so raw % change stops favouring the smallest base.
 * Thin categories that never hit a tier fall back to whole-category selection.
 */
export const GAINER_BAND_TIERS = [
  { maxRatio: 1.5, minPool: 7 },
  { maxRatio: 1.75, minPool: 7 },
  { maxRatio: 2.0, minPool: 6 },
] as const;

/** Weekly jackpot / updown anchored field — fixed anchors + rotating movers + wildcards. */
export const ANCHORED_ANCHOR_COUNT = 10;
export const ANCHORED_MOVER_COUNT = 6;
export const ANCHORED_WILDCARD_COUNT = 4;
export const ANCHORED_FIELD_SIZE =
  ANCHORED_ANCHOR_COUNT + ANCHORED_MOVER_COUNT + ANCHORED_WILDCARD_COUNT;
/** 1-based inclusive fame ranks for mover / wildcard pools. */
export const ANCHORED_MOVER_RANK_RANGE = [11, 40] as const;
export const ANCHORED_WILDCARD_RANK_RANGE = [41, 100] as const;
