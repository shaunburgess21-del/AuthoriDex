/**
 * Go back in browser history if possible, otherwise navigate to a fallback path.
 *
 * Using history.back() preserves the browser's native scroll restoration, so
 * users land exactly where they were on the previous page (e.g. mid-scroll on
 * a listing page). setLocation() pushes a new entry and resets scroll to top,
 * which is almost never what you want for a "back" button.
 *
 * Pass `setLocation` from wouter's useLocation hook as the fallback handler.
 */
export function goBack(
  setLocation: (to: string) => void,
  fallbackPath: string,
): void {
  if (typeof window !== "undefined" && window.history.length > 1) {
    window.history.back();
    return;
  }
  setLocation(fallbackPath);
}
