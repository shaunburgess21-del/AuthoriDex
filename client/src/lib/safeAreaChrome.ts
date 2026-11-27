/**
 * Bottom chrome clearance. `env(safe-area-inset-bottom)` is 0 on desktop
 * and on browsers without a home indicator, so these match the previous
 * `pb-20` / `bottom-0` layout there.
 *
 * Phones: the tab bar is 4rem plus the home indicator.
 * md and up: the tab bar is hidden, but iPad and landscape iPhone still
 * have a home indicator, so fixed docks sit on that inset instead of 0.
 */

export const ABOVE_TAB_BAR_BOTTOM =
  "bottom-[calc(4rem+env(safe-area-inset-bottom,0px))] md:bottom-[env(safe-area-inset-bottom,0px)]";

/**
 * Page footer. 5rem matches the old `pb-20` gap above the tab bar.
 * `--anon-nudge-height` is 0px unless the vote-hub signup bar is open,
 * so this adds nothing on other pages. On `md` the tab bar is gone and
 * the bar sits on the home indicator; `--anon-nudge-safe` is that inset
 * while the bar is open and 0px otherwise, so a hidden bar adds no padding.
 */
export const ABOVE_TAB_BAR_PADDING =
  "pb-[calc(5rem+var(--safe-area-inset-bottom,env(safe-area-inset-bottom,0px))+var(--anon-nudge-height,0px)+var(--anon-nudge-pills,0px))] md:pb-[calc(var(--anon-nudge-height,0px)+var(--anon-nudge-safe,0px))]";

export const PREDICTION_DOCK_CLASS =
  `fixed ${ABOVE_TAB_BAR_BOTTOM} left-0 right-0 z-40 border-t border-border/50 bg-background/95 backdrop-blur-md`;
