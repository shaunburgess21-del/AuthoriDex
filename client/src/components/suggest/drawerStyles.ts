/**
 * Shared layout classes for the Suggest bottom-sheet drawers (Poll, Market,
 * Matchup, Opinion, Profile Image, Induction). Defined once so padding, width,
 * and centering stay consistent across every suggest modal and can be tuned in
 * a single place.
 *
 * On desktop the sheet is centered and width-constrained (`sm:max-w-2xl`) so
 * fields no longer stretch edge-to-edge; horizontal padding grows from `px-4`
 * to `sm:px-6`.
 */

export const SUGGEST_DRAWER_OVERLAY = "fixed inset-0 z-[70] bg-black/40";

export const SUGGEST_DRAWER_CONTENT =
  "fixed inset-x-0 bottom-0 z-[70] mx-auto w-full sm:max-w-2xl flex flex-col rounded-t-2xl border-t border-border/50 bg-background max-h-[85dvh]";

export const SUGGEST_DRAWER_HANDLE =
  "mx-auto mt-3 mb-2 h-1.5 w-16 rounded-full bg-muted-foreground/60";

export const SUGGEST_DRAWER_HEADER =
  "flex items-center justify-between px-4 sm:px-6 pb-2";

export const SUGGEST_DRAWER_BODY =
  "flex-1 overflow-y-auto px-4 sm:px-6 pb-4 min-h-0 space-y-5";

export const SUGGEST_DRAWER_FOOTER =
  "border-t border-border/40 px-4 sm:px-6 py-3 flex gap-2";

export const SUGGEST_DRAWER_TITLE =
  "text-base font-semibold text-foreground flex items-center gap-2";

export const SUGGEST_DRAWER_DESCRIPTION =
  "text-xs text-muted-foreground mt-0.5";
