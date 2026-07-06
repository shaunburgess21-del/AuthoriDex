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

/** Inactive category filter chips — Predict section bars / overlay (violet hovers). */
export const FILTER_INACTIVE_PILL_PREDICT =
  "bg-background border border-border/60 text-muted-foreground hover:border-violet-400/30 dark:text-slate-400 dark:hover:border-violet-400/20";

/** Sticky section toggles (rounded-lg) on Vote + Predict headers — inactive only. */
export const FILTER_INACTIVE_SECTION_TOGGLE =
  "bg-background text-muted-foreground hover:bg-muted/40 border border-border/60";

/** Active section-style pills — Insights Rankings source row (slate / tab silver). */
export const FILTER_ACTIVE_PILL_RANKINGS =
  "bg-slate-500/25 dark:bg-slate-400/20 text-slate-600 dark:text-slate-300 border border-slate-400/50 dark:border-slate-400/40 shadow-sm shadow-slate-400/30 dark:shadow-slate-400/20";

/** Active filter chips — /me/badges (emerald, matches badges tab glow). */
export const FILTER_ACTIVE_PILL_BADGES =
  "bg-emerald-500/15 border-emerald-500/50 text-emerald-700 dark:text-emerald-300";

/** Inactive filter chips — /me/badges (Voices surface-pill pattern). */
export const FILTER_INACTIVE_PILL_BADGES =
  "bg-background border-border text-muted-foreground hover:text-foreground";

/** Compose onto shadcn Input in filter rows — replaces strong border-input. */
export const FILTER_ROW_SEARCH_INPUT = "border-border/60 shadow-none";
