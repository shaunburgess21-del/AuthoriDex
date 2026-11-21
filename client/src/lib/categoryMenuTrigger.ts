import { getMarketCategoryLabel } from "@shared/constants";
import { getCategoryStyle } from "@/components/CategoryPill";
import {
  FILTER_CATEGORY_MENU_CATEGORY,
  FILTER_CATEGORY_MENU_FOCUS,
  FILTER_CATEGORY_MENU_IDLE,
  FILTER_CATEGORY_MENU_IDLE_PREDICT,
  FILTER_CATEGORY_MENU_PINNED,
  FILTER_CATEGORY_MENU_PINNED_PREDICT,
} from "@/lib/filterControlStyles";
import { isPinnedCategory } from "@/lib/sectionCategoryFilters";

/** Vote stays on cyan. Predict uses the page violet-500 accent. */
export type CategoryMenuTheme = "vote" | "predict";

/** Selected labels truncate around this many characters. */
export const CATEGORY_MENU_LABEL_MAX_CH = 12;

const PINNED_TRIGGER_LABELS: Record<string, string> = {
  all: "Categories",
  favorites: "Favorites",
  trending: "Trending",
};

function normalizedKey(value: string | null | undefined): string {
  return (value ?? "").trim().toLowerCase();
}

/**
 * True when `label` is the stored id rather than a display name.
 * "Sports" is a label; "sports" and "film-tv" are slugs.
 */
export function isRawCategorySlug(label: string, value: string): boolean {
  const trimmed = label.trim();
  const key = normalizedKey(value);
  if (!trimmed || !key) return false;
  if (/^[a-z0-9]+(?:-[a-z0-9]+)+$/.test(trimmed)) return true;
  return trimmed === key;
}

/** Trigger text. Registry label when one was supplied; never a raw slug. */
export function categoryMenuTriggerLabel(
  value: string | null | undefined,
  optionLabel?: string | null,
): string {
  const key = normalizedKey(value);
  if (!key || key === "all") return PINNED_TRIGGER_LABELS.all;
  if (key === "favorites" || key === "trending") return PINNED_TRIGGER_LABELS[key];

  const provided = optionLabel?.trim() ?? "";
  if (provided && !isRawCategorySlug(provided, key)) return provided;

  const resolved = getMarketCategoryLabel(key);
  if (resolved && !isRawCategorySlug(resolved, key)) return resolved;
  return PINNED_TRIGGER_LABELS.all;
}

export function categoryMenuIsFiltered(value: string | null | undefined): boolean {
  const key = normalizedKey(value);
  return key.length > 0 && key !== "all";
}

const IDLE_FACE: Record<CategoryMenuTheme, string> = {
  vote: FILTER_CATEGORY_MENU_IDLE,
  predict: FILTER_CATEGORY_MENU_IDLE_PREDICT,
};

const PINNED_FACE: Record<CategoryMenuTheme, string> = {
  vote: FILTER_CATEGORY_MENU_PINNED,
  predict: FILTER_CATEGORY_MENU_PINNED_PREDICT,
};

/**
 * Face classes. Idle and Favorites/Trending follow the page accent.
 * A real category uses the registry chip colour on either theme.
 */
export function categoryMenuFaceClass(
  value: string | null | undefined,
  theme: CategoryMenuTheme = "vote",
): string {
  const key = normalizedKey(value);
  if (!key || key === "all") return `${IDLE_FACE[theme]} ${FILTER_CATEGORY_MENU_FOCUS}`;
  if (isPinnedCategory(key)) return `${PINNED_FACE[theme]} ${FILTER_CATEGORY_MENU_FOCUS}`;
  const style = getCategoryStyle(key, key);
  return `${style.bg} ${style.border} ${style.text} ${FILTER_CATEGORY_MENU_CATEGORY} ${FILTER_CATEGORY_MENU_FOCUS}`;
}
