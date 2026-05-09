/**
 * Shared Tailwind fragments for Vote / Predict filter rows and view-all overlays.
 * Keeps inactive surfaces aligned with filter search inputs without changing global Input.
 */

/** Inactive rounded-full category pills — Vote page / overlay (cyan family hovers). */
export const FILTER_INACTIVE_PILL_VOTE =
  "bg-background border border-border/60 text-muted-foreground hover:border-foreground/30 dark:text-slate-400 dark:hover:border-slate-600";

/** Inactive rounded-full category pills — Predict section bars / overlay (violet hovers). */
export const FILTER_INACTIVE_PILL_PREDICT =
  "bg-background border border-border/60 text-muted-foreground hover:border-violet-400/30 dark:text-slate-400 dark:hover:border-violet-400/20";

/** Sticky section toggles (rounded-lg) on Vote + Predict headers — inactive only. */
export const FILTER_INACTIVE_SECTION_TOGGLE =
  "bg-background text-muted-foreground hover:bg-muted/40 border border-border/60";

/** Compose onto shadcn Input in filter rows — replaces strong border-input. */
export const FILTER_ROW_SEARCH_INPUT = "border-border/60 shadow-none";
