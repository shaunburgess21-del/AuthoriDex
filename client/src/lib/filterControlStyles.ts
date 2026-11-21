/**
 * Shared Tailwind fragments for Vote / Predict filter rows and view-all overlays.
 * Keeps inactive surfaces aligned with filter search inputs without changing global Input.
 */

/** Shared corner radius for category filter chips and card category pills. */
export const CATEGORY_CHIP_RADIUS = "rounded-md";

/** Matched sizing for category (top) and voted (bottom) pills on poll result cards. */
export const POLL_CARD_PILL_SIZE_CLASSES =
  "px-2 py-[4px] text-[11px] leading-none font-medium";

/** Inactive category filter chips — Vote page / overlay (cyan family hovers). */
export const FILTER_INACTIVE_PILL_VOTE =
  "bg-background border border-border/60 text-muted-foreground hover:border-foreground/30 dark:text-slate-400 dark:hover:border-slate-600";

/** Inactive category filter chips — Predict World mode / violet section bars. */
export const FILTER_INACTIVE_PILL_PREDICT =
  "bg-background border border-border/60 text-muted-foreground hover:border-violet-400/30 dark:text-slate-400 dark:hover:border-violet-400/20";

/** Inactive category filter chips — Predict Weekly mode (VoxDex blue hovers). */
export const FILTER_INACTIVE_PILL_WEEKLY =
  "bg-background border border-border/60 text-muted-foreground hover:border-blue-400/30 dark:text-slate-400 dark:hover:border-blue-400/20";

/** Sticky section toggles (rounded-lg) on Vote + Predict headers — inactive only. */
export const FILTER_INACTIVE_SECTION_TOGGLE =
  "bg-background text-muted-foreground hover:bg-muted/40 border border-border/60";

/** Active section-style pills — Insights Rankings source row (slate / tab silver). */
export const FILTER_ACTIVE_PILL_RANKINGS =
  "bg-slate-500/25 dark:bg-slate-400/20 text-slate-600 dark:text-slate-300 border border-slate-400/50 dark:border-slate-400/40 shadow-sm shadow-slate-400/30 dark:shadow-slate-400/20";

/**
 * Active pills — Predict Weekly mode (VoxDex leaderboard blue #3B82F6).
 * Used for type toggles, Positions (show-mine), and Weekly section category chips.
 */
export const FILTER_ACTIVE_PILL_WEEKLY =
  "bg-blue-500/25 dark:bg-blue-500/20 text-blue-600 dark:text-blue-400 border border-blue-500/50 dark:border-blue-400/40 shadow-sm shadow-blue-500/30 dark:shadow-blue-500/20";

/**
 * Active pills — Predict World mode (violet #8B5CF6).
 * Used for Positions (show-mine) and World / violet section category chips.
 */
export const FILTER_ACTIVE_PILL_WORLD =
  "bg-violet-500/25 dark:bg-violet-500/20 text-violet-600 dark:text-violet-400 border border-violet-500/50 dark:border-violet-400/40 shadow-sm shadow-violet-500/30 dark:shadow-violet-500/20";

/**
 * Categories menu, nothing selected. Quieter than the selected All chip
 * (cyan/25 fill, /50 border, glow): ~10–15% accent fill, ~40–50% accent
 * border, light text, no glow.
 */
export const FILTER_CATEGORY_MENU_IDLE =
  "border border-cyan-500/40 bg-cyan-500/10 text-cyan-800 hover:border-cyan-500/60 hover:bg-cyan-500/[0.18] hover:text-cyan-950 active:border-cyan-600/70 active:bg-cyan-500/25 dark:border-cyan-300/50 dark:bg-cyan-400/15 dark:text-cyan-300 dark:hover:border-cyan-200/70 dark:hover:bg-cyan-400/25 dark:hover:text-cyan-200 dark:active:border-cyan-200/80 dark:active:bg-cyan-400/30";

/** Favorites / Trending — accent family, a step stronger than the idle trigger. */
export const FILTER_CATEGORY_MENU_PINNED =
  "border border-cyan-500/50 bg-cyan-500/20 text-cyan-800 hover:border-cyan-500/70 hover:bg-cyan-500/30 active:bg-cyan-500/35 dark:border-cyan-300/55 dark:bg-cyan-400/20 dark:text-cyan-200 dark:hover:bg-cyan-400/30 dark:active:bg-cyan-400/35";

/** Hover/press on top of a category-colour fill from getCategoryStyle. */
export const FILTER_CATEGORY_MENU_CATEGORY =
  "border transition hover:brightness-110 active:brightness-95";

/** One keyboard ring around the whole chip, including the clear control. */
export const FILTER_CATEGORY_MENU_FOCUS =
  "has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring has-[:focus-visible]:ring-offset-2 has-[:focus-visible]:ring-offset-background";

/** Category chip active text (slightly stronger than section toggles). */
export const FILTER_ACTIVE_CHIP_VOTE =
  "bg-cyan-500/25 dark:bg-cyan-500/20 text-cyan-700 dark:text-cyan-300 border border-cyan-500/50 dark:border-cyan-500/40";

export const FILTER_ACTIVE_CHIP_WEEKLY =
  "bg-blue-500/25 dark:bg-blue-500/20 text-blue-700 dark:text-blue-300 border border-blue-500/50 dark:border-blue-400/40 shadow-sm shadow-blue-500/30 dark:shadow-blue-500/20";

export const FILTER_ACTIVE_CHIP_WORLD =
  "bg-violet-500/25 dark:bg-violet-500/20 text-violet-700 dark:text-violet-300 border border-violet-500/50 dark:border-violet-400/40 shadow-sm shadow-violet-500/30 dark:shadow-violet-500/20";

/** Active filter chips — /me/badges (emerald, matches badges tab glow). */
export const FILTER_ACTIVE_PILL_BADGES =
  "bg-emerald-500/15 border-emerald-500/50 text-emerald-700 dark:text-emerald-300";

/** Inactive filter chips — /me/badges (Voices surface-pill pattern). */
export const FILTER_INACTIVE_PILL_BADGES =
  "bg-background border-border text-muted-foreground hover:text-foreground";

/** Compose onto shadcn Input in filter rows — replaces strong border-input. */
export const FILTER_ROW_SEARCH_INPUT = "border-border/60 shadow-none";
