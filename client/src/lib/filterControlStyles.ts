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

/** Category chip active text (slightly stronger than section toggles). */
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
